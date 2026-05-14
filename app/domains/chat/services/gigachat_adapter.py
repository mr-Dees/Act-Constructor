"""Адаптер OpenAI ↔ native GigaChat REST.

GigaChat-proxy частично OpenAI-совместим:
- Streaming не поддерживается (422 EventException).
- Tools передаются как плоский `functions=[{name,description,parameters}]`,
  без OpenAI-обёртки `{type:"function", function:{...}}`.
- Ответ содержит `message.function_call: {name, arguments}` (singular),
  где arguments — dict, а не JSON-строка.

Адаптер скрывает эту разницу: внешне ведёт себя как AsyncOpenAI,
внутри переводит формат запроса/ответа на лету.
"""
from __future__ import annotations

import logging
from typing import Any

from openai import AsyncOpenAI

logger = logging.getLogger(
    "audit_workstation.domains.chat.services.gigachat_adapter",
)


class _Completions:
    """Прокси над `AsyncOpenAI.chat.completions`, переводящий формат."""

    def __init__(self, underlying: AsyncOpenAI) -> None:
        self._underlying = underlying

    async def create(self, **kwargs: Any):
        # На этой задаче — простой проброс. Перевод появится в Task 3+.
        return await self._underlying.chat.completions.create(**kwargs)


class _Chat:
    def __init__(self, underlying: AsyncOpenAI) -> None:
        self.completions = _Completions(underlying)


class GigaChatAdapterClient:
    """Duck-typed обёртка над AsyncOpenAI для GigaChat-proxy."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        default_headers: dict[str, str] | None = None,
        timeout: float | int = 60.0,
    ) -> None:
        self._underlying = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            default_headers=dict(default_headers or {}),
            timeout=timeout,
        )
        self.chat = _Chat(self._underlying)

    @property
    def base_url(self):
        """Проксируем base_url, чтобы тесты могли его проверять."""
        return self._underlying.base_url


def _msg_to_dict(msg: Any) -> dict:
    """Pydantic-объект openai SDK → dict. dict → копия."""
    if isinstance(msg, dict):
        return dict(msg)
    if hasattr(msg, "model_dump"):
        return msg.model_dump(exclude_none=False)
    if hasattr(msg, "__dict__"):
        return dict(msg.__dict__)
    raise TypeError(
        f"GigaChat-адаптер: не умею сериализовать сообщение типа {type(msg)!r}",
    )


def _translate_messages(messages: list[Any]) -> list[dict]:
    """Переводит OpenAI-сообщения в native GigaChat-формат.

    - assistant с `tool_calls=[...]` → `function_call={name,arguments}` (первый).
    - tool-сообщение `{role:"tool", tool_call_id}` →
      `{role:"function", name:<из mapping предыдущих assistant>}`.
    - System/user/function — без изменений (копируются).
    """
    # Строим mapping tool_call_id → function_name из всей истории за один проход.
    id_to_name: dict[str, str] = {}
    for m in messages:
        md = _msg_to_dict(m)
        if md.get("role") != "assistant":
            continue
        tcs = md.get("tool_calls") or []
        for tc in tcs:
            tc_d = tc if isinstance(tc, dict) else _msg_to_dict(tc)
            tc_id = tc_d.get("id")
            fn = tc_d.get("function") or {}
            fn_d = fn if isinstance(fn, dict) else _msg_to_dict(fn)
            if tc_id and fn_d.get("name"):
                id_to_name[tc_id] = fn_d["name"]

    out: list[dict] = []
    for m in messages:
        md = _msg_to_dict(m)
        role = md.get("role")

        if role == "tool":
            tc_id = md.get("tool_call_id")
            name = id_to_name.get(tc_id) if tc_id else None
            if not name:
                logger.warning(
                    "GigaChat-адаптер: не нашли mapping для "
                    "tool_call_id=%r, использую 'unknown_function'",
                    tc_id,
                )
                name = "unknown_function"
            out.append({
                "role": "function",
                "name": name,
                "content": md.get("content") or "",
            })
            continue

        if role == "assistant" and md.get("tool_calls"):
            tcs = md["tool_calls"]
            if len(tcs) > 1:
                logger.warning(
                    "GigaChat поддерживает 1 function_call за раунд; "
                    "из %d параллельных tool_calls берётся первый",
                    len(tcs),
                )
            tc = tcs[0] if isinstance(tcs[0], dict) else _msg_to_dict(tcs[0])
            fn = tc.get("function") or {}
            fn_d = fn if isinstance(fn, dict) else _msg_to_dict(fn)
            new_msg = {
                "role": "assistant",
                "content": md.get("content"),
                "function_call": {
                    "name": fn_d.get("name", ""),
                    "arguments": fn_d.get("arguments", ""),
                },
            }
            out.append(new_msg)
            continue

        # Всё прочее — копия без поля tool_calls
        copy = {k: v for k, v in md.items() if k != "tool_calls"}
        out.append(copy)

    return out


def _tools_to_functions(tools: list[dict]) -> list[dict]:
    """Распаковывает OpenAI tools[] в native GigaChat functions[].

    Вход:  [{"type":"function","function":{"name","description","parameters"}}]
    Выход: [{"name","description","parameters"}]
    """
    out: list[dict] = []
    for tool in tools:
        if tool.get("type") != "function":
            raise ValueError(
                f"GigaChat-адаптер: ожидался type=function, получен "
                f"{tool.get('type')!r}",
            )
        fn = tool.get("function")
        if not fn:
            raise ValueError(
                "GigaChat-адаптер: отсутствует поле function в tool",
            )
        flat: dict = {"name": fn["name"]}
        if "description" in fn:
            flat["description"] = fn["description"]
        if "parameters" in fn:
            flat["parameters"] = fn["parameters"]
        out.append(flat)
    return out
