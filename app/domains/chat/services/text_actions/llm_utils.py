"""Нативные хелперы вызова LLM для text-actions (без LangChain)."""

import json
import re

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
_JSON_OBJ_RE = re.compile(r"\{.*\}", re.DOTALL)


def strip_think(text: str) -> str:
    """Убрать блоки рассуждений reasoning-модели (``<think>…</think>``).

    Подстраховка на случай, если sglang не сконфигурирован с
    ``--reasoning-parser`` и рассуждения попали в ``content``.
    """
    return _THINK_RE.sub("", text or "")


async def run_text_call(
    client,
    *,
    model: str,
    temperature: float,
    system: str,
    user: str,
    retry_call,
    timeout: float,
) -> str:
    """One-shot вызов LLM ``text → text`` (Фича «Корректор»).

    ``retry_call`` — обёртка ``retry_on_transient`` над вызываемым; она сама
    ретраит transient-ошибки, ``timeout`` ограничивает каждую попытку.
    """
    wrapped = retry_call(client.chat.completions.create)
    resp = await wrapped(
        model=model,
        temperature=temperature,
        stream=False,
        timeout=timeout,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    content = resp.choices[0].message.content or ""
    return strip_think(content).strip()


def extract_json(text: str) -> dict:
    """Достаёт JSON-объект из ответа LLM (Фича «Формализация»).

    Срезает ``<think>…</think>`` и берёт первый ``{…}``-блок — провайдер-
    агностично защищает разбор от протёкших рассуждений и префиксов-пояснений.
    Кидает ``ValueError``/``json.JSONDecodeError`` на отсутствующий/битый объект.
    """
    cleaned = strip_think(text or "")
    m = _JSON_OBJ_RE.search(cleaned)
    if not m:
        raise ValueError("В ответе LLM не найден JSON-объект")
    return json.loads(m.group(0))


async def run_json_call(
    client,
    *,
    model: str,
    temperature: float,
    system: str,
    user: str,
    retry_call,
    timeout: float,
) -> dict:
    """One-shot вызов LLM с разбором JSON-ответа (Фича «Формализация»).

    Тот же транспорт, что ``run_text_call``, но результат — распарсенный dict
    (см. ``extract_json``). Провайдер-специфичный ``response_format`` НЕ
    используется: структуру задаёт промпт, надёжность даёт разбор ответа.
    """
    wrapped = retry_call(client.chat.completions.create)
    resp = await wrapped(
        model=model,
        temperature=temperature,
        stream=False,
        timeout=timeout,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    content = resp.choices[0].message.content or ""
    return extract_json(content)
