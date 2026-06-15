"""Сбор замечаний структурной валидации акта (статус акта, фича #8).

Чистая, НЕ бросающая исключений функция: вычисляет состояние акта при
сохранении. Зеркалит фронтовые проверки (validation-act.js /
validation-table-core.js), но это ИСТОЧНИК ИСТИНЫ для хранимого статуса —
фронту доверять нельзя (может быть устаревшим/обойдённым). Каждое замечание —
{code, severity, message, ref?}. severity: 'error' (акт сломан) /
'warning' (заполнен не полностью).

Намеренно НЕ дублирует жёсткие интеграционные проверки `_validate_tree`
(глубина/корень — они по-прежнему бросают ActValidationError: дерево без
корня нельзя сохранить вообще) и грид-дефекты таблиц (P6a → 422 на схеме):
здесь собираются «мягкие» замечания, при которых акт сохраняется как WIP.
"""

from __future__ import annotations

from typing import Any

from app.domains.acts.schemas.act_content import ActDataSchema

# Базовые разделы 1–5 (по id, как ValidationAct.validateStructure на фронте).
_BASE_SECTION_IDS = ("1", "2", "3", "4", "5")


def _table_node_labels(tree: dict | None) -> dict[str, str]:
    """tableId → человекочитаемая метка узла-таблицы (для сообщений)."""
    labels: dict[str, str] = {}
    stack: list[Any] = [tree] if tree else []
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        tid = node.get("tableId")
        if tid:
            labels[tid] = node.get("customLabel") or node.get("label") or "Таблица"
        stack.extend(node.get("children") or [])
    return labels


def _count_header_rows(grid) -> int:
    """Число подряд идущих сверху строк-заголовков (как countHeaderRows)."""
    count = 0
    for row in grid:
        if not any(getattr(cell, "isHeader", False) for cell in row):
            break
        count += 1
    return count


def _has_empty_headers(grid, header_rows: int) -> bool:
    """Есть ли пустые видимые ячейки в шапке (как hasEmptyHeaders)."""
    for r in range(header_rows):
        for cell in grid[r]:
            if (
                not getattr(cell, "isSpanned", False)
                and getattr(cell, "isHeader", False)
                and not (getattr(cell, "content", "") or "").strip()
            ):
                return True
    return False


def _has_data_rows(grid, header_rows: int) -> bool:
    """Есть ли хотя бы одна заполненная строка данных (как hasDataRows)."""
    for r in range(header_rows, len(grid)):
        for cell in grid[r]:
            if not getattr(cell, "isSpanned", False) and (getattr(cell, "content", "") or "").strip():
                return True
    return False


def collect_validation_issues(data: ActDataSchema) -> list[dict[str, Any]]:
    """Собирает замечания структуры/контента акта (без исключений)."""
    issues: list[dict[str, Any]] = []
    tree = data.tree if isinstance(data.tree, dict) else None

    # ── Структура (зеркало ValidationAct.validateStructure) ──
    children = tree.get("children") if tree else None
    if not children or not isinstance(children, list):
        issues.append({
            "code": "empty_structure", "severity": "error",
            "message": "Структура акта пуста: добавьте хотя бы один раздел",
        })
    else:
        sections = [c for c in children if isinstance(c, dict)]
        by_id = {c.get("id"): c for c in sections}
        missing = [sid for sid in _BASE_SECTION_IDS if sid not in by_id]
        if missing:
            issues.append({
                "code": "missing_sections", "severity": "error",
                "message": f"Базовая структура повреждена: отсутствуют разделы {', '.join(missing)}",
            })
        unprotected = [
            sid for sid in _BASE_SECTION_IDS
            if sid in by_id and (not by_id[sid].get("protected") or by_id[sid].get("deletable") is not False)
        ]
        if unprotected:
            issues.append({
                "code": "unprotected_sections", "severity": "error",
                "message": f"Базовая структура повреждена: разделы {', '.join(unprotected)} не защищены от изменения",
            })

    # ── Таблицы (зеркало validation-table-core) ──
    labels = _table_node_labels(tree)
    for tid, table in (data.tables or {}).items():
        grid = getattr(table, "grid", None) or []
        if not grid:
            continue
        name = labels.get(tid) or labels.get(getattr(table, "nodeId", "")) or "Таблица"
        header_rows = _count_header_rows(grid)
        if header_rows == 0:
            issues.append({
                "code": "table_no_header", "severity": "error", "ref": tid,
                "message": f"Таблица «{name}» без строки заголовка",
            })
        elif _has_empty_headers(grid, header_rows):
            issues.append({
                "code": "table_empty_header", "severity": "error", "ref": tid,
                "message": f"Таблица «{name}»: не заполнены заголовки",
            })
        if not _has_data_rows(grid, header_rows):
            issues.append({
                "code": "table_no_data", "severity": "warning", "ref": tid,
                "message": f"Таблица «{name}» без данных",
            })

    return issues


def status_from_issues(issues: list[dict[str, Any]]) -> str:
    """Статус акта по замечаниям: любое замечание → needs_review, иначе ok.

    Любое замечание (error или warning) помечает акт «требует проверки» — это
    максимально полезный сигнал «есть что проверить» (решение #8): и сломанная
    структура, и незаполненность выводят карточку/уведомление с конкретикой.
    """
    return "needs_review" if issues else "ok"
