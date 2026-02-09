"""
API эндпоинты для работы с содержимым актов.

Предоставляет операции загрузки и сохранения структурированного содержимого:
- Метаданные акта
- Дерево структуры акта (tree)
- Таблицы (tables)
- Текстовые блоки (textBlocks)
- Нарушения (violations)

Авторизация и проверка доступа к акту осуществляется через зависимость get_username.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.deps.auth_deps import get_username
from app.db.connection import get_db, get_adapter
from app.db.repositories.act_repository import ActDBService
from app.schemas.act_content import ActDataSchema

logger = logging.getLogger("act_constructor.api.content")
router = APIRouter()


@router.get("/{act_id}/content")
async def get_act_content(
        act_id: int,
        username: str = Depends(get_username)
) -> dict:
    """
    Получает полное содержимое акта для редактора.

    Загружает из БД:
    - Полные метаданные акта (ActResponse)
    - Дерево структуры (act_tree)
    - Таблицы (act_tables)
    - Текстовые блоки (act_textblocks)
    - Нарушения (act_violations)

    Args:
        act_id: ID акта
        username: Имя пользователя (из зависимости)

    Returns:
        Содержимое акта в формате {metadata, tree, tables, textBlocks, violations}

    Raises:
        HTTPException: 403 если нет доступа к акту
        HTTPException: 404 если акт не найден
        HTTPException: 500 при ошибках загрузки
    """
    async with get_db() as conn:
        db_service = ActDBService(conn)

        # Проверяем доступ и получаем права пользователя
        permission = await db_service.get_user_edit_permission(act_id, username)
        if not permission["has_access"]:
            raise HTTPException(status_code=403, detail="Нет доступа к акту")

        try:
            # Получаем полные метаданные акта через ActResponse
            act_metadata = await db_service.get_act_by_id(act_id)

            # Получаем адаптер и имена таблиц
            adapter = get_adapter()
            acts_tree = adapter.get_table_name("act_tree")
            acts_tables = adapter.get_table_name("act_tables")
            acts_textblocks = adapter.get_table_name("act_textblocks")
            acts_violations = adapter.get_table_name("act_violations")

            # Получаем дерево
            tree_row = await conn.fetchrow(
                f"SELECT tree_data FROM {acts_tree} WHERE act_id = $1",
                act_id
            )

            tree = json.loads(tree_row['tree_data']) if tree_row else {
                "id": "root",
                "label": "Акт",
                "children": []
            }

            # Получаем таблицы
            table_rows = await conn.fetch(
                f"""
                SELECT table_id, node_id, grid_data, col_widths, is_protected, 
                       is_deletable, is_metrics_table, is_main_metrics_table,
                       is_regular_risk_table, is_operational_risk_table
                FROM {acts_tables}
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
                f"""
                SELECT textblock_id, node_id, content, formatting
                FROM {acts_textblocks}
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
                f"""
                SELECT violation_id, node_id, violated, established,
                       description_list, additional_content, reasons,
                       consequences, responsible, recommendations
                FROM {acts_violations}
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

            # Получаем фактуры
            invoices_list = await db_service.get_invoices_for_act(act_id)
            invoices = {inv["node_id"]: inv for inv in invoices_list}

            logger.info(
                f"Загружено содержимое акта ID={act_id}, "
                f"КМ={act_metadata.km_number}, is_process_based={act_metadata.is_process_based}"
            )

            # Возвращаем метаданные + содержимое + права пользователя
            return {
                'metadata': act_metadata.model_dump(mode='json'),
                'tree': tree,
                'tables': tables,
                'textBlocks': textBlocks,
                'violations': violations,
                'invoices': invoices,
                'userPermission': {
                    'canEdit': permission["can_edit"],
                    'role': permission["role"]
                }
            }
        except HTTPException:
            raise
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
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
        username: str = Depends(get_username)
) -> dict:
    """
    Сохраняет содержимое акта.

    Обновляет в БД:
    - Дерево структуры (act_tree)
    - Таблицы (act_tables) - с пересозданием всех записей
    - Текстовые блоки (act_textblocks) - с пересозданием
    - Нарушения (act_violations) - с пересозданием
    - Метку last_edited_at и last_edited_by в таблице acts

    Args:
        act_id: ID акта
        data: Полное содержимое акта (валидировано через ActDataSchema)
        username: Имя пользователя (из зависимости)

    Returns:
        Сообщение об успешном сохранении

    Raises:
        HTTPException: 403 если нет доступа к акту
        HTTPException: 500 при ошибках сохранения
    """
    async with get_db() as conn:
        db_service = ActDBService(conn)

        # Проверяем доступ и права на редактирование
        permission = await db_service.get_user_edit_permission(act_id, username)
        if not permission["has_access"]:
            raise HTTPException(status_code=403, detail="Нет доступа к акту")
        if not permission["can_edit"]:
            raise HTTPException(
                status_code=403,
                detail="Недостаточно прав для сохранения. Роль 'Участник' имеет доступ только для просмотра."
            )

        try:
            # Получаем адаптер и имена таблиц
            adapter = get_adapter()
            acts = adapter.get_table_name("acts")
            acts_tree = adapter.get_table_name("act_tree")
            acts_tables = adapter.get_table_name("act_tables")
            acts_textblocks = adapter.get_table_name("act_textblocks")
            acts_violations = adapter.get_table_name("act_violations")

            async with conn.transaction():
                # Обновляем дерево
                await conn.execute(
                    f"""
                    UPDATE {acts_tree}
                    SET tree_data = $1, updated_at = CURRENT_TIMESTAMP
                    WHERE act_id = $2
                    """,
                    json.dumps(data.tree),
                    act_id
                )

                # Удаляем старые таблицы и добавляем новые
                await conn.execute(
                    f"DELETE FROM {acts_tables} WHERE act_id = $1",
                    act_id
                )

                for table_id, table_data in data.tables.items():
                    # Получаем nodeId из Pydantic-модели
                    node_id = table_data.nodeId
                    node_number = _extract_node_number(data.tree, node_id)
                    node_label = _find_node_label(data.tree, node_id)

                    await conn.execute(
                        f"""
                        INSERT INTO {acts_tables} (
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
                    f"DELETE FROM {acts_textblocks} WHERE act_id = $1",
                    act_id
                )

                for tb_id, tb_data in data.textBlocks.items():
                    node_id = tb_data.nodeId
                    node_number = _extract_node_number(data.tree, node_id)

                    await conn.execute(
                        f"""
                        INSERT INTO {acts_textblocks} (
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
                    f"DELETE FROM {acts_violations} WHERE act_id = $1",
                    act_id
                )

                for v_id, v_data in data.violations.items():
                    node_id = v_data.nodeId
                    node_number = _extract_node_number(data.tree, node_id)

                    await conn.execute(
                        f"""
                        INSERT INTO {acts_violations} (
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

                # Синхронизируем фактуры: удаляем записи для узлов без фактур
                acts_invoices = adapter.get_table_name("act_invoices")

                if data.invoiceNodeIds:
                    # Удаляем фактуры для узлов, которых нет в списке
                    await conn.execute(
                        f"""
                        DELETE FROM {acts_invoices}
                        WHERE act_id = $1
                          AND node_id != ALL($2::varchar[])
                        """,
                        act_id,
                        data.invoiceNodeIds,
                    )

                    # Обновляем node_number для оставшихся фактур
                    for nid in data.invoiceNodeIds:
                        node_number = _extract_node_number(data.tree, nid)
                        if node_number:
                            await conn.execute(
                                f"""
                                UPDATE {acts_invoices}
                                SET node_number = $1
                                WHERE act_id = $2 AND node_id = $3
                                  AND (node_number IS DISTINCT FROM $1)
                                """,
                                node_number, act_id, nid,
                            )
                else:
                    # Список пуст — удаляем все фактуры акта
                    await conn.execute(
                        f"DELETE FROM {acts_invoices} WHERE act_id = $1",
                        act_id,
                    )

                # Обновляем last_edited_by и last_edited_at в acts
                await conn.execute(
                    f"""
                    UPDATE {acts}
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
