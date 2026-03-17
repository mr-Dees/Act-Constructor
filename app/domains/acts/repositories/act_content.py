"""
Репозиторий операций с содержимым актов.

Инкапсулирует SQL-запросы для загрузки и сохранения:
- Дерево структуры (act_tree)
- Таблицы (act_tables)
- Текстовые блоки (act_textblocks)
- Нарушения (act_violations)
- Синхронизация фактур и поручений
"""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository
from app.domains.acts.utils import ActDirectivesValidator, ActTreeUtils
from app.domains.acts.schemas.act_content import ActDataSchema

logger = logging.getLogger("act_constructor.db.repository.content")


class ActContentRepository(BaseRepository):
    """Операции загрузки и сохранения содержимого актов."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.acts = self.adapter.get_table_name("acts")
        self.tree = self.adapter.get_table_name("act_tree")
        self.tables = self.adapter.get_table_name("act_tables")
        self.textblocks = self.adapter.get_table_name("act_textblocks")
        self.violations = self.adapter.get_table_name("act_violations")
        self.invoices = self.adapter.get_table_name("act_invoices")
        self.directives = self.adapter.get_table_name("act_directives")

    # -------------------------------------------------------------------------
    # ПУБЛИЧНЫЕ МЕТОДЫ
    # -------------------------------------------------------------------------

    async def get_content(self, act_id: int) -> dict:
        """
        Загружает содержимое акта: дерево, таблицы, текстовые блоки, нарушения.

        Args:
            act_id: ID акта

        Returns:
            Словарь {tree, tables, textBlocks, violations}
        """
        tree = await self._load_tree(act_id)
        tables = await self._load_tables(act_id)
        text_blocks = await self._load_textblocks(act_id)
        violations = await self._load_violations(act_id)

        return {
            "tree": tree,
            "tables": tables,
            "textBlocks": text_blocks,
            "violations": violations,
        }

    async def save_content(self, act_id: int, data: ActDataSchema, username: str) -> dict:
        """
        Сохраняет содержимое акта в транзакции.

        Обновляет дерево, пересоздаёт таблицы/текстовые блоки/нарушения,
        синхронизирует фактуры и поручения, обновляет метку редактирования.

        Args:
            act_id: ID акта
            data: Валидированные данные акта
            username: Имя пользователя

        Returns:
            Словарь {status, message}
        """
        async with self.conn.transaction():
            # Получаем audit_act_id из таблицы acts
            audit_act_id = await self.conn.fetchval(
                f"SELECT audit_act_id FROM {self.acts} WHERE id = $1",
                act_id
            )

            # Маппинг {node_id -> audit_point_id} обходом дерева
            audit_point_map = ActDirectivesValidator.build_audit_point_map(data.tree)

            await self._save_tree(act_id, data.tree)
            await self._save_tables(act_id, audit_act_id, data, audit_point_map)
            await self._save_textblocks(act_id, audit_act_id, data, audit_point_map)
            await self._save_violations(act_id, audit_act_id, data, audit_point_map)
            await self._sync_invoices(act_id, audit_act_id, data, audit_point_map)
            await self._sync_directives(act_id, audit_act_id, data, audit_point_map)
            await self._update_edit_timestamp(act_id, username)

            logger.info(f"Сохранено содержимое акта ID={act_id} пользователем {username}")

            return {"status": "success", "message": "Содержимое акта сохранено"}

    # -------------------------------------------------------------------------
    # ЗАГРУЗКА
    # -------------------------------------------------------------------------

    async def _load_tree(self, act_id: int) -> dict:
        """Загружает дерево структуры акта."""
        row = await self.conn.fetchrow(
            f"SELECT tree_data FROM {self.tree} WHERE act_id = $1",
            act_id
        )
        if row:
            return json.loads(row['tree_data'])
        return {"id": "root", "label": "Акт", "children": []}

    async def _load_tables(self, act_id: int) -> dict[str, dict]:
        """Загружает таблицы акта."""
        rows = await self.conn.fetch(
            f"""
            SELECT table_id, node_id, grid_data, col_widths, is_protected,
                   is_deletable, is_metrics_table, is_main_metrics_table,
                   is_regular_risk_table, is_operational_risk_table
            FROM {self.tables}
            WHERE act_id = $1
            """,
            act_id
        )
        return {
            row['table_id']: {
                'id': row['table_id'],
                'nodeId': row['node_id'],
                'grid': json.loads(row['grid_data']),
                'colWidths': json.loads(row['col_widths']),
                'protected': row['is_protected'],
                'deletable': row['is_deletable'],
                'isMetricsTable': row['is_metrics_table'],
                'isMainMetricsTable': row['is_main_metrics_table'],
                'isRegularRiskTable': row['is_regular_risk_table'],
                'isOperationalRiskTable': row['is_operational_risk_table']
            }
            for row in rows
        }

    async def _load_textblocks(self, act_id: int) -> dict[str, dict]:
        """Загружает текстовые блоки акта."""
        rows = await self.conn.fetch(
            f"""
            SELECT textblock_id, node_id, content, formatting
            FROM {self.textblocks}
            WHERE act_id = $1
            """,
            act_id
        )
        return {
            row['textblock_id']: {
                'id': row['textblock_id'],
                'nodeId': row['node_id'],
                'content': row['content'],
                'formatting': json.loads(row['formatting'])
            }
            for row in rows
        }

    async def _load_violations(self, act_id: int) -> dict[str, dict]:
        """Загружает нарушения акта."""
        rows = await self.conn.fetch(
            f"""
            SELECT violation_id, node_id, violated, established,
                   description_list, additional_content, reasons,
                   consequences, responsible, recommendations
            FROM {self.violations}
            WHERE act_id = $1
            """,
            act_id
        )
        return {
            row['violation_id']: {
                'id': row['violation_id'],
                'nodeId': row['node_id'],
                'violated': row['violated'] or '',
                'established': row['established'] or '',
                'descriptionList': json.loads(row['description_list'] or '{"enabled": false, "items": []}'),
                'additionalContent': json.loads(row['additional_content'] or '{"enabled": false, "items": []}'),
                'reasons': json.loads(row['reasons'] or '{"enabled": false, "content": ""}'),
                'consequences': json.loads(row['consequences'] or '{"enabled": false, "content": ""}'),
                'responsible': json.loads(row['responsible'] or '{"enabled": false, "content": ""}'),
                'recommendations': json.loads(row['recommendations'] or '{"enabled": false, "content": ""}')
            }
            for row in rows
        }

    # -------------------------------------------------------------------------
    # СОХРАНЕНИЕ
    # -------------------------------------------------------------------------

    async def _save_tree(self, act_id: int, tree: dict) -> None:
        """Обновляет дерево структуры акта."""
        await self.conn.execute(
            f"""
            UPDATE {self.tree}
            SET tree_data = $1, updated_at = CURRENT_TIMESTAMP
            WHERE act_id = $2
            """,
            json.dumps(tree),
            act_id
        )

    async def _save_tables(
        self, act_id: int, audit_act_id: str | None,
        data: ActDataSchema, audit_point_map: dict
    ) -> None:
        """Пересоздаёт таблицы акта."""
        await self.conn.execute(
            f"DELETE FROM {self.tables} WHERE act_id = $1",
            act_id
        )

        for table_id, table_data in data.tables.items():
            node_id = table_data.nodeId
            node_number = ActTreeUtils.extract_node_number(data.tree, node_id)
            node_label = ActTreeUtils.find_node_label(data.tree, node_id)

            parent_node_id = ActTreeUtils.find_parent_item_node_id(data.tree, node_id)
            audit_point_id = audit_point_map.get(parent_node_id) if parent_node_id else None

            await self.conn.execute(
                f"""
                INSERT INTO {self.tables} (
                    act_id, audit_act_id, audit_point_id,
                    table_id, node_id, node_number, table_label,
                    grid_data, col_widths, is_protected, is_deletable,
                    is_metrics_table, is_main_metrics_table,
                    is_regular_risk_table, is_operational_risk_table
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                """,
                act_id,
                audit_act_id,
                audit_point_id,
                table_id,
                node_id,
                node_number,
                node_label,
                json.dumps([
                    [cell.model_dump() for cell in row]
                    for row in table_data.grid
                ]),
                json.dumps(table_data.colWidths),
                table_data.protected,
                table_data.deletable,
                getattr(table_data, 'isMetricsTable', False),
                getattr(table_data, 'isMainMetricsTable', False),
                getattr(table_data, 'isRegularRiskTable', False),
                getattr(table_data, 'isOperationalRiskTable', False)
            )

    async def _save_textblocks(
        self, act_id: int, audit_act_id: str | None,
        data: ActDataSchema, audit_point_map: dict
    ) -> None:
        """Пересоздаёт текстовые блоки акта."""
        await self.conn.execute(
            f"DELETE FROM {self.textblocks} WHERE act_id = $1",
            act_id
        )

        for tb_id, tb_data in data.textBlocks.items():
            node_id = tb_data.nodeId
            node_number = ActTreeUtils.extract_node_number(data.tree, node_id)

            parent_node_id = ActTreeUtils.find_parent_item_node_id(data.tree, node_id)
            audit_point_id = audit_point_map.get(parent_node_id) if parent_node_id else None

            await self.conn.execute(
                f"""
                INSERT INTO {self.textblocks} (
                    act_id, audit_act_id, audit_point_id,
                    textblock_id, node_id, node_number, content, formatting
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                act_id,
                audit_act_id,
                audit_point_id,
                tb_id,
                node_id,
                node_number,
                tb_data.content,
                json.dumps(tb_data.formatting.model_dump())
            )

    async def _save_violations(
        self, act_id: int, audit_act_id: str | None,
        data: ActDataSchema, audit_point_map: dict
    ) -> None:
        """Пересоздаёт нарушения акта."""
        await self.conn.execute(
            f"DELETE FROM {self.violations} WHERE act_id = $1",
            act_id
        )

        for v_id, v_data in data.violations.items():
            node_id = v_data.nodeId
            node_number = ActTreeUtils.extract_node_number(data.tree, node_id)

            parent_node_id = ActTreeUtils.find_parent_item_node_id(data.tree, node_id)
            audit_point_id = audit_point_map.get(parent_node_id) if parent_node_id else None

            await self.conn.execute(
                f"""
                INSERT INTO {self.violations} (
                    act_id, audit_act_id, audit_point_id,
                    violation_id, node_id, node_number, violated, established,
                    description_list, additional_content, reasons, consequences,
                    responsible, recommendations
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                """,
                act_id,
                audit_act_id,
                audit_point_id,
                v_id,
                node_id,
                node_number,
                v_data.violated,
                v_data.established,
                json.dumps(v_data.descriptionList.model_dump()),
                json.dumps(v_data.additionalContent.model_dump()),
                json.dumps(v_data.reasons.model_dump()),
                json.dumps(v_data.consequences.model_dump()),
                json.dumps(v_data.responsible.model_dump()),
                json.dumps(v_data.recommendations.model_dump())
            )

    async def _sync_invoices(
        self, act_id: int, audit_act_id: str | None,
        data: ActDataSchema, audit_point_map: dict
    ) -> None:
        """Синхронизирует фактуры: удаляет записи для узлов без фактур."""
        if data.invoiceNodeIds:
            # Удаляем фактуры для узлов, которых нет в списке
            await self.conn.execute(
                f"""
                DELETE FROM {self.invoices}
                WHERE act_id = $1
                  AND node_id != ALL($2::varchar[])
                """,
                act_id,
                data.invoiceNodeIds,
            )

            # Обновляем node_number, audit_act_id, audit_point_id для оставшихся
            for nid in data.invoiceNodeIds:
                node_number = ActTreeUtils.extract_node_number(data.tree, nid)
                inv_audit_point_id = audit_point_map.get(nid)
                await self.conn.execute(
                    f"""
                    UPDATE {self.invoices}
                    SET node_number = COALESCE($1, node_number),
                        audit_act_id = $4,
                        audit_point_id = $5
                    WHERE act_id = $2 AND node_id = $3
                    """,
                    node_number, act_id, nid,
                    audit_act_id, inv_audit_point_id,
                )
        else:
            # Список пуст — удаляем все фактуры акта
            await self.conn.execute(
                f"DELETE FROM {self.invoices} WHERE act_id = $1",
                act_id,
            )

    async def _sync_directives(
        self, act_id: int, audit_act_id: str | None,
        data: ActDataSchema, audit_point_map: dict
    ) -> None:
        """Синхронизирует поручения: обновляет point_number по node_id."""
        directives_with_node = await self.conn.fetch(
            f"""
            SELECT id, node_id, point_number
            FROM {self.directives}
            WHERE act_id = $1 AND node_id IS NOT NULL
            """,
            act_id,
        )

        for dir_row in directives_with_node:
            new_number = ActTreeUtils.extract_node_number(data.tree, dir_row["node_id"])
            dir_audit_point_id = audit_point_map.get(dir_row["node_id"])
            if new_number and new_number != dir_row["point_number"]:
                await self.conn.execute(
                    f"""
                    UPDATE {self.directives}
                    SET point_number = $1,
                        audit_act_id = $3,
                        audit_point_id = $4
                    WHERE id = $2
                    """,
                    new_number, dir_row["id"],
                    audit_act_id, dir_audit_point_id,
                )
            else:
                await self.conn.execute(
                    f"""
                    UPDATE {self.directives}
                    SET audit_act_id = $2,
                        audit_point_id = $3
                    WHERE id = $1
                    """,
                    dir_row["id"],
                    audit_act_id, dir_audit_point_id,
                )

    async def _update_edit_timestamp(self, act_id: int, username: str) -> None:
        """Обновляет метку последнего редактирования."""
        await self.conn.execute(
            f"""
            UPDATE {self.acts}
            SET last_edited_by = $1, last_edited_at = CURRENT_TIMESTAMP
            WHERE id = $2
            """,
            username,
            act_id
        )
