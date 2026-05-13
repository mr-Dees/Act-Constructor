"""Handler'ы action-инструментов домена acts."""

from __future__ import annotations

import json
import logging

from app.core.chat.names import ACTION_NOTIFY, ACTION_OPEN_URL

logger = logging.getLogger("audit_workstation.domains.acts.integrations.action_handlers")


def _client_action(action: str, params: dict, label: str) -> str:
    return json.dumps(
        {"type": "client_action", "action": action, "params": params, "label": label},
        ensure_ascii=False,
    )


async def _fetch_acts(
    *,
    km_number: str | None,
    sz_number: str | None,
) -> list[dict]:
    """Ищет акты по КМ-номеру и/или СЗ. Возвращает список строк (может быть пустым)."""
    # Импорт внутри функции, чтобы тесты могли патчить get_db/get_adapter
    # на уровне модуля app.db.connection (lookup происходит при вызове).
    from app.db.connection import get_adapter, get_db

    where_parts: list[str] = []
    params: list[object] = []

    if km_number:
        try:
            from app.domains.acts.utils import KMUtils
            km_digit = KMUtils.extract_km_digits(km_number)
            params.append(km_digit)
            where_parts.append(f"km_number_digit = ${len(params)}")
        except Exception as exc:
            logger.warning("Не удалось извлечь цифры из КМ '%s': %s", km_number, exc)
            params.append(km_number)
            where_parts.append(f"km_number = ${len(params)}")

    if sz_number:
        params.append(sz_number)
        where_parts.append(f"service_note = ${len(params)}")

    adapter = get_adapter()
    acts_table = adapter.get_table_name("acts")
    sql = (
        f"SELECT id, km_number, service_note, part_number "
        f"FROM {acts_table} WHERE {' AND '.join(where_parts)} "
        f"ORDER BY part_number"
    )

    async with get_db() as conn:
        rows = await conn.fetch(sql, *params)
    return list(rows)


async def resolve_act_url(
    km_number: str | None,
    sz_number: str | None,
) -> str | None:
    """Резолвит КМ/СЗ в URL акта; None — если не найдено или найдено несколько."""
    if not km_number and not sz_number:
        return None
    rows = await _fetch_acts(km_number=km_number, sz_number=sz_number)
    if len(rows) != 1:
        return None
    return f"/constructor?act_id={rows[0]['id']}"


async def open_act_page_handler(
    *,
    km_number: str | None = None,
    sz_number: str | None = None,
) -> str:
    """Открывает страницу акта в интерфейсе AuditWorkstation.

    Поиск возможен по КМ-номеру или по номеру служебной записки (СЗ).
    - Если по критериям найден ровно один акт — возвращает ClientActionBlock
      с переходом на /constructor?act_id={id}.
    - Если найдено несколько — возвращает текст со списком и просьбой уточнить.
    - Если ничего — возвращает текст, что не найдено.
    """
    if not km_number and not sz_number:
        return ("Не указан ни КМ-номер, ни номер служебной записки. "
                "Укажите хотя бы один параметр для поиска акта.")

    criteria_label: list[str] = []
    if km_number:
        criteria_label.append(f"КМ {km_number}")
    if sz_number:
        criteria_label.append(f"СЗ {sz_number}")

    rows = await _fetch_acts(km_number=km_number, sz_number=sz_number)

    if not rows:
        return f"Акт по критериям ({', '.join(criteria_label)}) не найден."

    if len(rows) == 1:
        row = rows[0]
        url = f"/constructor?act_id={row['id']}"
        return _client_action(
            action=ACTION_OPEN_URL,
            params={"url": url},
            label=f"Открываю акт {row['km_number']}…",
        )

    items = []
    for r in rows:
        sz = r["service_note"] or "без СЗ"
        items.append(
            f"  • {r['km_number']} (часть {r['part_number']}, СЗ: {sz}) — id={r['id']}"
        )
    return (
        f"По критериям ({', '.join(criteria_label)}) найдено несколько актов:\n"
        + "\n".join(items)
        + "\n\nУточните номер служебной записки, чтобы открыть нужный акт."
    )


async def open_act_page_button_translator(params: dict) -> dict:
    """Транслятор серверной кнопки acts.open_act_page → клиентский action.

    Резолвит КМ/СЗ в URL акта; на успехе — open_url, иначе — notify уровня error.
    """
    km = (params or {}).get("km_number")
    sz = (params or {}).get("sz_number")
    url = await resolve_act_url(km, sz)
    if url:
        return {"action": ACTION_OPEN_URL, "params": {"url": url}}
    identifier = km or sz or "?"
    return {
        "action": ACTION_NOTIFY,
        "params": {
            "message": f"Акт {identifier} не найден",
            "level": "error",
        },
    }
