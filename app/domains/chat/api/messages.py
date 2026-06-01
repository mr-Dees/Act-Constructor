"""Эндпоинты сообщений чата."""

import json
import logging
import uuid

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.core.responses import PaginatedResponse
from app.domains.chat.deps import (
    get_agent_channel_poller,
    get_agent_channel_service,
    get_conversation_service,
    get_file_service,
    get_message_service,
    get_rate_limiter,
)
from app.domains.chat.exceptions import (
    ChatFileValidationError,
)
from app.domains.chat.schemas.responses import FileUploadResponse, MessageResponse
from app.domains.chat.services.agent_channel import AgentChannelService
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.file_service import FileService
from app.domains.chat.services.message_service import MessageService

logger = logging.getLogger("audit_workstation.domains.chat.api.messages")

# Защита роли крепится явно на роутер (defense in depth) — см. конфигурацию
# в conversations.py.
router = APIRouter(dependencies=[Depends(require_domain_access("chat"))])


@router.post(
    "/conversations/{conversation_id}/messages",
    summary="Отправить сообщение",
)
async def send_message(
    conversation_id: str,
    message: str = Form(...),
    domains: str | None = Form(None),
    agent_mode: str = Form("off"),
    files: list[UploadFile] = File(default=[]),
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
    msg_service: MessageService = Depends(get_message_service),
    file_service: FileService = Depends(get_file_service),
    channel_service: AgentChannelService = Depends(get_agent_channel_service),
):
    """
    Отправляет сообщение в беседу.

    Принимает FormData: message, domains (JSON-список), agent_mode, files.
    Всегда возвращает JSON {"message_id": ...}.

    agent_mode:
      - "always": AgentChannelService.submit → поллер.subscribe;
                  LLM-оркестратор не запускается.
      - "adaptive": оркестратор.run синхронно; forward-тул доступен LLM,
                    и при его вызове запрос форвардится внешнему агенту
                    через bus-канал (AgentChannelService).
      - "off" / любое другое: оркестратор.run синхронно, только локальный
                    LLM/GigaChat — forward-тул скрыт от LLM.
    """
    logger.info(
        "Получен запрос пользователя: conversation=%s, message_len=%d, "
        "files=%d, agent_mode=%s",
        conversation_id, len(message or ""), len(files), agent_mode,
    )
    logger.debug(
        "Тело запроса (truncated): message=%r, domains=%r",
        (message[:500] + "...") if message and len(message) > 500 else message,
        domains,
    )

    # Проверяем, что беседа существует и принадлежит пользователю
    await conv_service.get(conversation_id, username)

    # Per-user rate limit: защита от злоупотребления (до сохранения сообщения)
    await get_rate_limiter().check_and_consume(username)

    # Парсим домены из JSON-строки
    domains_list: list[str] | None = None
    if domains:
        try:
            domains_list = json.loads(domains)
        except json.JSONDecodeError:
            domains_list = [d.strip() for d in domains.split(",") if d.strip()]

    # Валидируем количество файлов
    max_files = file_service.settings.max_files_per_message
    if len(files) > max_files:
        raise ChatFileValidationError(
            f"Слишком много файлов (максимум {max_files}).",
        )

    # Читаем все файлы и проверяем суммарный размер
    file_entries: list[tuple[UploadFile, bytes]] = []
    total_size = 0
    for upload_file in files:
        file_data = await upload_file.read()
        total_size += len(file_data)
        file_entries.append((upload_file, file_data))

    max_total = file_service.settings.max_total_file_size
    if total_size > max_total:
        max_mb = max_total / (1024 * 1024)
        raise ChatFileValidationError(
            f"Суммарный размер файлов слишком велик (максимум {max_mb:.0f} МБ).",
        )

    # Сохраняем файлы после валидации
    file_blocks: list[dict] = []
    for upload_file, file_data in file_entries:
        saved = await file_service.save_file(
            conversation_id=conversation_id,
            user_id=username,
            filename=upload_file.filename or "file",
            mime_type=upload_file.content_type or "application/octet-stream",
            file_data=file_data,
        )
        file_blocks.append({
            "type": "file",
            "file_id": saved["id"],
            "filename": saved["filename"],
            "mime_type": saved["mime_type"],
            "file_size": saved["file_size"],
        })

    # Сохраняем пользовательское сообщение
    await msg_service.save_user_message(
        conversation_id=conversation_id,
        content=message,
        user_id=username,
        file_blocks=file_blocks if file_blocks else None,
    )

    # ID будущего assistant-сообщения. Генерируем здесь, чтобы он совпадал
    # с тем, что попадёт в БД — на нём строится детерминированный block_id
    # ClientActionBlock.
    assistant_message_id = str(uuid.uuid4())

    # Режим «Всегда» (always): отправляем вопрос в bus, подписываем поллер.
    # Оркестратор не запускается — ответ придёт асинхронно.
    if agent_mode == "always":
        poller = get_agent_channel_poller()
        question_uid = await channel_service.submit(
            conversation_id=conversation_id,
            user_id=username,
            assistant_message_id=assistant_message_id,
            text=message,
            mode="always",
            media=file_blocks if file_blocks else None,
        )
        if poller is not None:
            poller.subscribe(
                assistant_message_id=assistant_message_id,
                question_uid=question_uid,
            )
        else:
            logger.warning(
                "AgentChannelPoller не инициализирован — подписка не зарегистрирована "
                "(assistant_message_id=%s, question_uid=%s)",
                assistant_message_id,
                question_uid,
            )
        return JSONResponse({"message_id": assistant_message_id})

    # Режим «Выключен» или «Адаптивный» (off / adaptive / любое другое):
    # оркестратор работает синхронно. В adaptive forward-тул доступен LLM —
    # при его вызове agent_loop форвардит вопрос в bus-канал agent_messages
    # (см. _handle_forward_terminal), draft дозаполняет поллер.
    from app.domains.chat.services.orchestrator import Orchestrator

    orchestrator = Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
    )

    try:
        await orchestrator.run(
            conversation_id=conversation_id,
            user_message=message,
            message_id=assistant_message_id,
            domains=domains_list,
            file_blocks=file_blocks if file_blocks else None,
            user_id=username,
            agent_mode=agent_mode,
        )
    except Exception:
        logger.exception(
            "Ошибка обработки сообщения: conversation=%s", conversation_id,
        )
        raise

    return JSONResponse({"message_id": assistant_message_id})


@router.get(
    "/conversations/{conversation_id}/messages/{message_id}",
    summary="Получить одно сообщение (опрос готовности)",
)
async def get_message(
    conversation_id: str,
    message_id: str,
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
    msg_service: MessageService = Depends(get_message_service),
):
    """Возвращает одно сообщение беседы.

    Используется фронтом для поллинга готовности ответа ассистента:
    клиент периодически запрашивает сообщение по message_id и ждёт
    перехода status из 'streaming' в 'complete' или 'failed'.

    Возвращает {"id", "status", "content"}.
    Отвечает 404 если сообщение не найдено или принадлежит другой беседе.
    """
    # Проверяем принадлежность беседы пользователю
    await conv_service.get(conversation_id, username)

    message = await msg_service.get_message(conversation_id, message_id)
    return {
        "id": message["id"],
        "status": message.get("status", "complete"),
        "content": message.get("content") or [],
    }


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=PaginatedResponse[MessageResponse],
    summary="История сообщений",
)
async def get_messages(
    conversation_id: str,
    limit: int = Query(10000, ge=1, le=10000),
    offset: int = Query(0, ge=0),
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
    msg_service: MessageService = Depends(get_message_service),
):
    """Возвращает историю сообщений беседы.

    По умолчанию отдаёт всю историю (лимит практически неограничен) в порядке
    ASC — клиент (chat-context.js) ничего не пагинирует. Усечение до 50
    скрывало бы свежие сообщения активных бесед.
    """
    # Проверяем принадлежность беседы пользователю
    await conv_service.get(conversation_id, username)

    items, total = await msg_service.get_history(
        conversation_id,
        limit=limit,
        offset=offset,
    )
    return PaginatedResponse[MessageResponse](
        items=items, total=total, limit=limit, offset=offset,
    )
