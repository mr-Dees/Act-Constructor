"""
Сервис генерации идентификаторов аудита.

Предоставляет методы для получения уникальных идентификаторов
акта (audit_act_id) и пунктов (audit_point_id).

TODO: Заменить mock-реализацию на вызов реального внешнего сервиса
идентификации аудита.
"""

import logging
import uuid

logger = logging.getLogger("act_constructor.services.audit_id")


class AuditIdService:
    """Сервис генерации идентификаторов аудита (заглушка)."""

    @staticmethod
    async def generate_audit_act_id() -> str:
        """
        Генерирует уникальный идентификатор акта.

        TODO: Реализовать вызов внешнего сервиса идентификации аудита.
        Текущая реализация — локальная генерация UUID v4.

        Returns:
            Уникальный идентификатор акта (UUID v4)
        """
        # TODO: Заменить на вызов внешнего сервиса:
        # from app.core.config import get_settings
        # settings = get_settings()
        # async with httpx.AsyncClient() as client:
        #     resp = await client.post(
        #         f"{settings.audit_id_service_url}/audit-act-id",
        #         timeout=settings.audit_id_service_timeout
        #     )
        #     return resp.json()["audit_act_id"]

        audit_act_id = str(uuid.uuid4())
        logger.info(f"Сгенерирован audit_act_id (mock): {audit_act_id}")
        return audit_act_id

    @staticmethod
    async def generate_audit_point_ids(node_ids: list[str]) -> dict[str, str]:
        """
        Генерирует уникальные идентификаторы для пунктов акта (batch).

        TODO: Реализовать вызов внешнего сервиса идентификации аудита.
        Текущая реализация — локальная генерация UUID v4 для каждого узла.

        Args:
            node_ids: Список ID узлов дерева, для которых нужны audit_point_id

        Returns:
            Словарь {node_id: audit_point_id}
        """
        if not node_ids:
            return {}

        # TODO: Заменить на вызов внешнего сервиса:
        # from app.core.config import get_settings
        # settings = get_settings()
        # async with httpx.AsyncClient() as client:
        #     resp = await client.post(
        #         f"{settings.audit_id_service_url}/audit-point-ids",
        #         json={"node_ids": node_ids},
        #         timeout=settings.audit_id_service_timeout
        #     )
        #     return resp.json()

        result = {node_id: str(uuid.uuid4()) for node_id in node_ids}
        logger.info(
            f"Сгенерировано {len(result)} audit_point_id (mock) "
            f"для узлов: {node_ids[:5]}{'...' if len(node_ids) > 5 else ''}"
        )
        return result
