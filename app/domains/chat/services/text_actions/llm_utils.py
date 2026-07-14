"""Нативные хелперы вызова LLM для text-actions (без LangChain)."""

import re

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


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
