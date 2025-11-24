# app/api/v1/endpoints/act_content.py
"""
API эндпоинты для работы с содержимым актов.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.endpoints.acts import get_username
from app.db.connection import get_db
from app.db.service import ActDBService
from app.schemas.act import ActDataSchema

logger = logging.getLogger("act_constructor.api")
router = APIRouter()


@router.get("/{act_id}/content")
async def get_act_content(
        act_id: int,
        username: str = Depends(get_username),
        conn=Depends(get_db)
) -> dict:
    """
    Получает полное содержимое акта для редактора.

    Returns:
        Содержимое акта в формате {tree, tables, textBlocks, violations}
    """
    db_service = ActDBService(conn)

    has_access = await db_service.check_user_access(act_id, username)
    if not has_access:
        raise HTTPException(status_code=403, detail="Нет доступа к акту")

    try:
        # Получаем дерево
        tree_row = await conn.fetchrow(
            "SELECT tree_data FROM act_tree WHERE act_id = $1",
            act_id
        )

        tree = json.loads(tree_row['tree_data']) if tree_row else {
            "id": "root",
            "label": "Акт",
            "children": []
        }

        # Получаем таблицы
        table_rows = await conn.fetch(
            """
            SELECT table_id, node_id, grid_data, col_widths, is_protected, 
                   is_deletable, is_metrics_table, is_main_metrics_table,
                   is_regular_risk_table, is_operational_risk_table
            FROM act_tables
            WHERE act_id = $1
            """,
            act_id
        )

        tables = {
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
            for row in table_rows
        }

        # Получаем текстовые блоки
        tb_rows = await conn.fetch(
            """
            SELECT textblock_id, node_id, content, formatting
            FROM act_textblocks
            WHERE act_id = $1
            """,
            act_id
        )

        textBlocks = {
            row['textblock_id']: {
                'id': row['textblock_id'],
                'nodeId': row['node_id'],
                'content': row['content'],
                'formatting': json.loads(row['formatting'])
            }
            for row in tb_rows
        }

        # Получаем нарушения
        v_rows = await conn.fetch(
            """
            SELECT violation_id, node_id, violated, established,
                   description_list, additional_content, reasons,
                   consequences, responsible, recommendations
            FROM act_violations
            WHERE act_id = $1
            """,
            act_id
        )

        violations = {
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
            for row in v_rows
        }

        logger.info(f"Загружено содержимое акта ID={act_id}")

        return {
            'tree': tree,
            'tables': tables,
            'textBlocks': textBlocks,
            'violations': violations
        }
    except Exception as e:
        logger.exception(f"Ошибка загрузки содержимого акта ID={act_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail="Ошибка загрузки содержимого акта"
        )


@router.put("/{act_id}/content")
async def save_act_content(
        act_id: int,
        data: ActDataSchema,
        username: str = Depends(get_username),
        conn=Depends(get_db)
) -> dict:
    """
    Сохраняет содержимое акта.

    Обновляет дерево, таблицы, текстовые блоки и нарушения.
    Обновляет last_edited_at и last_edited_by в таблице acts.
    """
    db_service = ActDBService(conn)

    has_access = await db_service.check_user_access(act_id, username)
    if not has_access:
        raise HTTPException(status_code=403, detail="Нет доступа к акту")

    try:
        async with conn.transaction():
            # Обновляем дерево
            await conn.execute(
                """
                UPDATE act_tree
                SET tree_data = $1, updated_at = CURRENT_TIMESTAMP
                WHERE act_id = $2
                """,
                json.dumps(data.tree),
                act_id
            )

            # Удаляем старые таблицы и добавляем новые
            await conn.execute(
                "DELETE FROM act_tables WHERE act_id = $1",
                act_id
            )

            for table_id, table_data in data.tables.items():
                # Получаем nodeId из Pydantic-модели
                node_id = table_data.nodeId
                node_number = _extract_node_number(data.tree, node_id)
                node_label = _find_node_label(data.tree, node_id)

                await conn.execute(
                    """
                    INSERT INTO act_tables (
                        act_id, table_id, node_id, node_number, table_label,
                        grid_data, col_widths, is_protected, is_deletable,
                        is_metrics_table, is_main_metrics_table,
                        is_regular_risk_table, is_operational_risk_table
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    """,
                    act_id,
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

            # Удаляем старые текстовые блоки и добавляем новые
            await conn.execute(
                "DELETE FROM act_textblocks WHERE act_id = $1",
                act_id
            )

            for tb_id, tb_data in data.textBlocks.items():
                node_id = tb_data.nodeId
                node_number = _extract_node_number(data.tree, node_id)

                await conn.execute(
                    """
                    INSERT INTO act_textblocks (
                        act_id, textblock_id, node_id, node_number, content, formatting
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    act_id,
                    tb_id,
                    node_id,
                    node_number,
                    tb_data.content,
                    json.dumps(tb_data.formatting.model_dump())
                )

            # Удаляем старые нарушения и добавляем новые
            await conn.execute(
                "DELETE FROM act_violations WHERE act_id = $1",
                act_id
            )

            for v_id, v_data in data.violations.items():
                node_id = v_data.nodeId
                node_number = _extract_node_number(data.tree, node_id)

                await conn.execute(
                    """
                    INSERT INTO act_violations (
                        act_id, violation_id, node_id, node_number, violated, established,
                        description_list, additional_content, reasons, consequences,
                        responsible, recommendations
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    """,
                    act_id,
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

            # Обновляем last_edited_by и last_edited_at в acts
            await conn.execute(
                """
                UPDATE acts
                SET last_edited_by = $1, last_edited_at = CURRENT_TIMESTAMP
                WHERE id = $2
                """,
                username,
                act_id
            )

            logger.info(f"Сохранено содержимое акта ID={act_id} пользователем {username}")

            return {"status": "success", "message": "Содержимое акта сохранено"}

    except Exception as e:
        logger.exception(f"Ошибка сохранения содержимого акта ID={act_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Ошибка сохранения содержимого акта: {str(e)}"
        )


def _extract_node_number(tree: dict, node_id: str, current_node: dict = None) -> str | None:
    """Рекурсивно извлекает номер узла из дерева."""
    if current_node is None:
        current_node = tree

    if current_node.get('id') == node_id:
        return current_node.get('number')

    for child in current_node.get('children', []):
        result = _extract_node_number(tree, node_id, child)
        if result:
            return result

    return None


def _find_node_label(tree: dict, node_id: str, current_node: dict = None) -> str | None:
    """Рекурсивно ищет метку узла в дереве."""
    if current_node is None:
        current_node = tree

    if current_node.get('id') == node_id:
        return current_node.get('label')

    for child in current_node.get('children', []):
        result = _find_node_label(tree, node_id, child)
        if result:
            return result

    return None
