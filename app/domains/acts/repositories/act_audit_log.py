"""
Репозиторий аудит-лога.

Записывает чувствительные операции для compliance-отчётности.
Вычисляет diff содержимого при content_save.
"""

import json
import logging
from datetime import date, datetime

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("audit_workstation.db.repository.audit_log")


class ActAuditLogRepository(BaseRepository):
    """Запись и чтение операций аудит-лога."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.audit_log = self.adapter.get_table_name("audit_log")
        self._tables = self.adapter.get_table_name("act_tables")
        self._textblocks = self.adapter.get_table_name("act_textblocks")
        self._violations = self.adapter.get_table_name("act_violations")
        self._tree = self.adapter.get_table_name("act_tree")

    async def log(
        self,
        action: str,
        username: str,
        act_id: int | None = None,
        details: dict | None = None,
        changelog: list[dict] | None = None,
    ) -> None:
        """
        Записывает операцию в аудит-лог.

        Args:
            action: Тип операции (create, update, delete, duplicate, lock, unlock,
                    content_save, save_invoice, export, download, restore)
            username: Пользователь
            act_id: ID акта (опционально)
            details: Дополнительные данные (опционально)
            changelog: Гранулярный лог локальных изменений (опционально)
        """
        details_json = json.dumps(details or {}, ensure_ascii=False, default=str)
        changelog_json = json.dumps(changelog or [], ensure_ascii=False, default=str)
        try:
            await self.conn.execute(
                f"""
                INSERT INTO {self.audit_log} (act_id, action, username, details, changelog)
                VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
                """,
                act_id,
                action,
                username,
                details_json,
                changelog_json,
            )
        except Exception:
            # Ошибка записи аудит-лога не должна блокировать основную операцию
            logger.exception(
                f"Не удалось записать аудит-лог: action={action}, "
                f"act_id={act_id}, username={username}"
            )

    # -------------------------------------------------------------------------
    # ЧТЕНИЕ
    # -------------------------------------------------------------------------

    async def get_log(
        self,
        act_id: int,
        *,
        action: str | None = None,
        username: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Записи аудит-лога с фильтрацией и пагинацией."""
        where = ["act_id = $1"]
        params: list = [act_id]
        idx = 2

        if action:
            actions = [a.strip() for a in action.split(",") if a.strip()]
            if len(actions) == 1:
                where.append(f"action = ${idx}")
                params.append(actions[0])
                idx += 1
            elif actions:
                placeholders = ", ".join(f"${idx + i}" for i in range(len(actions)))
                where.append(f"action IN ({placeholders})")
                params.extend(actions)
                idx += len(actions)
        if username:
            where.append(f"username ILIKE ${idx}")
            params.append(f"%{username}%")
            idx += 1
        if from_date:
            where.append(f"created_at >= ${idx}")
            parsed = datetime.fromisoformat(from_date) if "T" in from_date else datetime.combine(date.fromisoformat(from_date), datetime.min.time())
            params.append(parsed)
            idx += 1
        if to_date:
            where.append(f"created_at <= ${idx}")
            parsed = datetime.fromisoformat(to_date) if "T" in to_date else datetime.combine(date.fromisoformat(to_date), datetime.max.time().replace(microsecond=0))
            params.append(parsed)
            idx += 1

        where_clause = " AND ".join(where)

        count_row = await self.conn.fetchrow(
            f"SELECT COUNT(*) AS cnt FROM {self.audit_log} WHERE {where_clause}",
            *params,
        )
        total = count_row["cnt"]

        params.extend([limit, offset])
        rows = await self.conn.fetch(
            f"""
            SELECT id, action, username, details, changelog, created_at
            FROM {self.audit_log}
            WHERE {where_clause}
            ORDER BY created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *params,
        )
        items = []
        for r in rows:
            entry = dict(r)
            details_val = entry.get("details")
            if isinstance(details_val, str):
                entry["details"] = json.loads(details_val)
            changelog_val = entry.get("changelog")
            if isinstance(changelog_val, str):
                entry["changelog"] = json.loads(changelog_val)
            elif changelog_val is None:
                entry["changelog"] = []
            items.append(entry)
        return items, total

    # -------------------------------------------------------------------------
    # CONTENT DIFF
    # -------------------------------------------------------------------------

    async def compute_content_diff(self, act_id: int, data) -> dict:
        """
        Вычисляет diff: загружает текущие ID+хеши из БД, сравнивает с входящими.

        Args:
            act_id: ID акта
            data: ActDataSchema с входящими данными

        Returns:
            dict с информацией об изменениях в tree, tables, textblocks, violations
        """
        try:
            # Последовательные запросы — asyncpg не поддерживает параллельные
            # операции на одном соединении
            db_tables = await self.conn.fetch(
                f"SELECT table_id, md5(grid_data::text) AS hash "
                f"FROM {self._tables} WHERE act_id = $1",
                act_id,
            )
            db_textblocks = await self.conn.fetch(
                f"SELECT textblock_id, md5(content) AS hash "
                f"FROM {self._textblocks} WHERE act_id = $1",
                act_id,
            )
            db_violations = await self.conn.fetch(
                f"SELECT violation_id, md5(COALESCE(violated, '') || COALESCE(established, '')) AS hash "
                f"FROM {self._violations} WHERE act_id = $1",
                act_id,
            )
            db_tree_row = await self.conn.fetchrow(
                f"SELECT tree_data FROM {self._tree} WHERE act_id = $1",
                act_id,
            )

            # Tables diff
            db_table_ids = {r["table_id"]: r["hash"] for r in db_tables}
            new_table_ids = set(data.tables.keys())
            old_table_ids = set(db_table_ids.keys())

            tables_added = len(new_table_ids - old_table_ids)
            tables_removed = len(old_table_ids - new_table_ids)
            tables_possibly_changed = len(new_table_ids & old_table_ids)

            # Textblocks diff
            db_tb_ids = {r["textblock_id"]: r["hash"] for r in db_textblocks}
            new_tb_ids = set(data.textBlocks.keys())
            old_tb_ids = set(db_tb_ids.keys())

            # Violations diff
            db_viol_ids = {r["violation_id"]: r["hash"] for r in db_violations}
            new_viol_ids = set(data.violations.keys())
            old_viol_ids = set(db_viol_ids.keys())

            # Tree diff
            tree_nodes_added = 0
            tree_nodes_removed = 0
            tree_total = 0
            if db_tree_row and db_tree_row["tree_data"]:
                old_tree = db_tree_row["tree_data"]
                if isinstance(old_tree, str):
                    old_tree = json.loads(old_tree)
                old_node_ids = self._extract_node_ids(old_tree)
                new_node_ids = self._extract_node_ids(data.tree)
                tree_nodes_added = len(new_node_ids - old_node_ids)
                tree_nodes_removed = len(old_node_ids - new_node_ids)
                tree_total = len(new_node_ids)
            else:
                new_node_ids = self._extract_node_ids(data.tree)
                tree_total = len(new_node_ids)
                tree_nodes_added = tree_total

            content_map = self._build_node_content_map(data.tree)

            return {
                "tree": {
                    "nodes_added": tree_nodes_added,
                    "nodes_removed": tree_nodes_removed,
                    "total": tree_total,
                },
                "tables": {
                    "added": tables_added,
                    "removed": tables_removed,
                    "existing": tables_possibly_changed,
                    "total": len(new_table_ids),
                    "added_names": [content_map.get(tid, tid) for tid in (new_table_ids - old_table_ids)],
                    "removed_ids": list(old_table_ids - new_table_ids),
                },
                "textblocks": {
                    "added": len(new_tb_ids - old_tb_ids),
                    "removed": len(old_tb_ids - new_tb_ids),
                    "existing": len(new_tb_ids & old_tb_ids),
                    "total": len(new_tb_ids),
                    "added_names": [content_map.get(tid, tid) for tid in (new_tb_ids - old_tb_ids)],
                    "removed_ids": list(old_tb_ids - new_tb_ids),
                },
                "violations": {
                    "added": len(new_viol_ids - old_viol_ids),
                    "removed": len(old_viol_ids - new_viol_ids),
                    "existing": len(new_viol_ids & old_viol_ids),
                    "total": len(new_viol_ids),
                    "added_names": [content_map.get(vid, vid) for vid in (new_viol_ids - old_viol_ids)],
                    "removed_ids": list(old_viol_ids - new_viol_ids),
                },
            }

        except Exception:
            logger.exception(f"Не удалось вычислить diff содержимого: act_id={act_id}")
            return {"error": "diff computation failed"}

    async def compute_field_diffs(self, act_id: int, data) -> dict[str, dict]:
        """
        Вычисляет field-level diff для элементов, изменённых при content_save.

        Сравнивает текущее состояние в БД с входящими данными.
        Лимит: не более 20 элементов, 50 ячеек на таблицу.

        Returns:
            {element_id: {type, name, ...changes}}
        """
        try:
            content_map = self._build_node_content_map(data.tree)
            result: dict[str, dict] = {}
            processed = 0
            max_elements = 20

            # --- Таблицы ---
            db_tables = await self.conn.fetch(
                f"SELECT table_id, grid_data FROM {self._tables} WHERE act_id = $1",
                act_id,
            )
            db_table_map = {r["table_id"]: r["grid_data"] for r in db_tables}

            for table_id, new_table in data.tables.items():
                if processed >= max_elements:
                    break
                old_grid_raw = db_table_map.get(table_id)
                if old_grid_raw is None:
                    continue  # новая таблица — не diff
                old_grid = json.loads(old_grid_raw) if isinstance(old_grid_raw, str) else old_grid_raw
                new_grid = [
                    [cell.model_dump() for cell in row]
                    for row in new_table.grid
                ]
                cells = self._diff_table_cells(old_grid, new_grid)
                if cells:
                    result[table_id] = {
                        "type": "table",
                        "name": content_map.get(table_id, table_id),
                        "cells": cells[:50],
                    }
                    processed += 1

            # --- Текстблоки ---
            db_tbs = await self.conn.fetch(
                f"SELECT textblock_id, content FROM {self._textblocks} WHERE act_id = $1",
                act_id,
            )
            db_tb_map = {r["textblock_id"]: r["content"] for r in db_tbs}

            for tb_id, new_tb in data.textBlocks.items():
                if processed >= max_elements:
                    break
                old_content = db_tb_map.get(tb_id)
                if old_content is None:
                    continue
                new_content = new_tb.content or ""
                if old_content != new_content:
                    result[tb_id] = {
                        "type": "textblock",
                        "name": content_map.get(tb_id, tb_id),
                        "old_length": len(old_content),
                        "new_length": len(new_content),
                    }
                    processed += 1

            # --- Нарушения ---
            db_viols = await self.conn.fetch(
                f"SELECT violation_id, "
                f"COALESCE(violated, '') AS violated, "
                f"COALESCE(established, '') AS established, "
                f"COALESCE(reasons, '') AS reasons, "
                f"COALESCE(consequences, '') AS consequences, "
                f"COALESCE(responsible, '') AS responsible, "
                f"COALESCE(recommendations, '') AS recommendations "
                f"FROM {self._violations} WHERE act_id = $1",
                act_id,
            )
            db_viol_map = {r["violation_id"]: dict(r) for r in db_viols}

            viol_fields = ("violated", "established", "reasons", "consequences", "responsible", "recommendations")
            for viol_id, new_viol in data.violations.items():
                if processed >= max_elements:
                    break
                old = db_viol_map.get(viol_id)
                if old is None:
                    continue
                changed_fields: dict[str, dict] = {}
                for field in viol_fields:
                    old_val = old.get(field, "")
                    # Для optional fields (reasons, etc.) — берём .content
                    new_attr = getattr(new_viol, field, None)
                    if hasattr(new_attr, "content"):
                        new_val = new_attr.content or ""
                    else:
                        new_val = new_attr or ""
                    if old_val != new_val:
                        changed_fields[field] = {"changed": True}
                if changed_fields:
                    result[viol_id] = {
                        "type": "violation",
                        "name": content_map.get(viol_id, viol_id),
                        "fields": changed_fields,
                    }
                    processed += 1

            return result

        except Exception:
            logger.exception(f"Не удалось вычислить field-level diff: act_id={act_id}")
            return {}

    @staticmethod
    def _diff_table_cells(old_grid: list, new_grid: list) -> list[dict]:
        """Попарное сравнение ячеек двух grid, возвращает список изменённых."""
        changes: list[dict] = []
        max_rows = max(len(old_grid), len(new_grid))
        max_cols = 0
        if old_grid:
            max_cols = max(max_cols, max(len(r) for r in old_grid))
        if new_grid:
            max_cols = max(max_cols, max(len(r) for r in new_grid))

        # Определяем имена колонок из заголовочной строки
        header_names: list[str] = []
        for grid in (old_grid, new_grid):
            if grid and grid[0]:
                for c_idx, cell in enumerate(grid[0]):
                    is_header = cell.get("isHeader", False) if isinstance(cell, dict) else False
                    if is_header and cell.get("content"):
                        while len(header_names) <= c_idx:
                            header_names.append("")
                        header_names[c_idx] = cell["content"]
                break

        for r in range(max_rows):
            for c in range(max_cols):
                old_val = ""
                new_val = ""
                if r < len(old_grid) and c < len(old_grid[r]):
                    cell = old_grid[r][c]
                    if isinstance(cell, dict) and not cell.get("isSpanned"):
                        old_val = cell.get("content", "")
                if r < len(new_grid) and c < len(new_grid[r]):
                    cell = new_grid[r][c]
                    if isinstance(cell, dict) and not cell.get("isSpanned"):
                        new_val = cell.get("content", "")
                if old_val != new_val:
                    col_name = header_names[c] if c < len(header_names) and header_names[c] else f"кол. {c + 1}"
                    changes.append({
                        "row": r,
                        "col": c,
                        "col_name": col_name,
                        "old": str(old_val)[:100],
                        "new": str(new_val)[:100],
                    })
                    if len(changes) >= 50:
                        return changes
        return changes

    @staticmethod
    def _build_node_content_map(tree: dict) -> dict:
        """Строит маппинг contentId -> label из дерева."""
        mapping = {}
        if not tree:
            return mapping

        def walk(node):
            if not node:
                return
            label = node.get("label", "")
            if node.get("tableId"):
                mapping[node["tableId"]] = label
            if node.get("textBlockId"):
                mapping[node["textBlockId"]] = label
            if node.get("violationId"):
                mapping[node["violationId"]] = label
            for child in node.get("children", []):
                walk(child)

        walk(tree)
        return mapping

    @staticmethod
    def _extract_node_ids(tree: dict) -> set[str]:
        """Рекурсивно извлекает все node_id из дерева."""
        ids: set[str] = set()
        if not tree:
            return ids

        node_id = tree.get("id")
        if node_id:
            ids.add(node_id)

        for child in tree.get("children", []):
            ids.update(ActAuditLogRepository._extract_node_ids(child))

        return ids
