# app/db/service.py
"""
Сервис для работы с актами в PostgreSQL.
"""

import json
import logging

import asyncpg

from app.db.models import (
    ActCreate,
    ActUpdate,
    ActListItem,
    ActResponse,
    AuditTeamMember,
    ActDirective
)

logger = logging.getLogger("act_constructor.db")


class ActDBService:
    """Сервис для работы с актами в БД."""

    def __init__(self, conn: asyncpg.Connection):
        """
        Инициализация сервиса.

        Args:
            conn: Подключение к PostgreSQL
        """
        self.conn = conn

    async def create_act(
            self,
            act_data: ActCreate,
            username: str
    ) -> ActResponse:
        """
        Создает новый акт с метаданными.

        Args:
            act_data: Данные для создания акта
            username: Имя пользователя-создателя

        Returns:
            Созданный акт

        Raises:
            ValueError: Если пользователь не в составе группы или КМ уже существует
        """
        async with self.conn.transaction():
            # Проверка что пользователь в составе группы
            user_in_team = any(
                member.username == username
                for member in act_data.audit_team
            )
            if not user_in_team:
                raise ValueError(
                    "Пользователь должен быть членом аудиторской группы"
                )

            # Создаем запись акта
            act_id = await self.conn.fetchval(
                """
                INSERT INTO acts (
                    km_number, inspection_name, city, created_date,
                    order_number, order_date, is_process_based,
                    created_by, inspection_start_date, inspection_end_date,
                    last_edited_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
                RETURNING id
                """,
                act_data.km_number,
                act_data.inspection_name,
                act_data.city,
                act_data.created_date,
                act_data.order_number,
                act_data.order_date,
                act_data.is_process_based,
                username,
                act_data.inspection_start_date,
                act_data.inspection_end_date
            )

            # Добавляем членов группы
            for idx, member in enumerate(act_data.audit_team):
                await self.conn.execute(
                    """
                    INSERT INTO audit_team_members (
                        act_id, role, full_name, position, username, order_index
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    act_id,
                    member.role,
                    member.full_name,
                    member.position,
                    member.username,
                    idx
                )

            # Добавляем поручения
            for idx, directive in enumerate(act_data.directives):
                await self.conn.execute(
                    """
                    INSERT INTO act_directives (
                        act_id, point_number, directive_number, order_index
                    )
                    VALUES ($1, $2, $3, $4)
                    """,
                    act_id,
                    directive.point_number,
                    directive.directive_number,
                    idx
                )

            # Создаем пустое дерево
            default_tree = {
                "id": "root",
                "label": act_data.inspection_name or "Акт",
                "children": []
            }

            await self.conn.execute(
                """
                INSERT INTO act_tree (act_id, tree_data)
                VALUES ($1, $2)
                """,
                act_id,
                json.dumps(default_tree)
            )

            logger.info(f"Создан акт ID={act_id}, КМ={act_data.km_number}")

            return await self.get_act_by_id(act_id)

    async def get_user_acts(self, username: str) -> list[ActListItem]:
        """
        Получает список актов, где пользователь является участником.

        Args:
            username: Имя пользователя из JUPYTERHUB_USER

        Returns:
            Список актов с ролью пользователя
        """
        rows = await self.conn.fetch(
            """
            SELECT 
                a.id,
                a.km_number,
                a.inspection_name,
                a.city,
                a.created_date,
                a.last_edited_at,
                atm.role as user_role
            FROM acts a
            INNER JOIN audit_team_members atm ON a.id = atm.act_id
            WHERE atm.username = $1
            GROUP BY a.id, a.km_number, a.inspection_name, a.city, 
                     a.created_date, a.last_edited_at, atm.role
            ORDER BY 
                COALESCE(a.last_edited_at, a.created_at) DESC,
                a.created_at DESC
            """,
            username
        )

        return [
            ActListItem(
                id=row['id'],
                km_number=row['km_number'],
                inspection_name=row['inspection_name'],
                city=row['city'],
                created_date=row['created_date'],
                last_edited_at=row['last_edited_at'],
                user_role=row['user_role']
            )
            for row in rows
        ]

    async def get_act_by_id(self, act_id: int) -> ActResponse:
        """
        Получает полную информацию об акте.

        Args:
            act_id: ID акта

        Returns:
            Полная информация об акте

        Raises:
            ValueError: Если акт не найден
        """
        # Получаем основные данные акта
        act_row = await self.conn.fetchrow(
            """
            SELECT * FROM acts WHERE id = $1
            """,
            act_id
        )

        if not act_row:
            raise ValueError(f"Акт ID={act_id} не найден")

        # Получаем аудиторскую группу
        team_rows = await self.conn.fetch(
            """
            SELECT role, full_name, position, username
            FROM audit_team_members
            WHERE act_id = $1
            ORDER BY order_index
            """,
            act_id
        )

        audit_team = [
            AuditTeamMember(
                role=row['role'],
                full_name=row['full_name'],
                position=row['position'],
                username=row['username']
            )
            for row in team_rows
        ]

        # Получаем поручения
        directive_rows = await self.conn.fetch(
            """
            SELECT point_number, directive_number
            FROM act_directives
            WHERE act_id = $1
            ORDER BY order_index
            """,
            act_id
        )

        directives = [
            ActDirective(
                point_number=row['point_number'],
                directive_number=row['directive_number']
            )
            for row in directive_rows
        ]

        return ActResponse(
            id=act_row['id'],
            km_number=act_row['km_number'],
            inspection_name=act_row['inspection_name'],
            city=act_row['city'],
            created_date=act_row['created_date'],
            order_number=act_row['order_number'],
            order_date=act_row['order_date'],
            is_process_based=act_row['is_process_based'],
            inspection_start_date=act_row['inspection_start_date'],
            inspection_end_date=act_row['inspection_end_date'],
            audit_team=audit_team,
            directives=directives,
            created_at=act_row['created_at'],
            updated_at=act_row['updated_at'],
            created_by=act_row['created_by'],
            last_edited_by=act_row['last_edited_by'],
            last_edited_at=act_row['last_edited_at']
        )

    async def update_act_metadata(
            self,
            act_id: int,
            act_update: ActUpdate,
            username: str
    ) -> ActResponse:
        """
        Обновляет метаданные акта.

        Args:
            act_id: ID акта
            act_update: Данные для обновления
            username: Имя пользователя (для last_edited_by)

        Returns:
            Обновленный акт
        """
        async with self.conn.transaction():
            # Строим SQL динамически только для переданных полей
            updates = []
            values = []
            param_idx = 1

            if act_update.inspection_name is not None:
                updates.append(f"inspection_name = ${param_idx}")
                values.append(act_update.inspection_name)
                param_idx += 1

            if act_update.city is not None:
                updates.append(f"city = ${param_idx}")
                values.append(act_update.city)
                param_idx += 1

            if act_update.created_date is not None:
                updates.append(f"created_date = ${param_idx}")
                values.append(act_update.created_date)
                param_idx += 1

            if act_update.order_number is not None:
                updates.append(f"order_number = ${param_idx}")
                values.append(act_update.order_number)
                param_idx += 1

            if act_update.order_date is not None:
                updates.append(f"order_date = ${param_idx}")
                values.append(act_update.order_date)
                param_idx += 1

            if act_update.inspection_start_date is not None:
                updates.append(f"inspection_start_date = ${param_idx}")
                values.append(act_update.inspection_start_date)
                param_idx += 1

            if act_update.inspection_end_date is not None:
                updates.append(f"inspection_end_date = ${param_idx}")
                values.append(act_update.inspection_end_date)
                param_idx += 1

            if act_update.is_process_based is not None:
                updates.append(f"is_process_based = ${param_idx}")
                values.append(act_update.is_process_based)
                param_idx += 1

            # Всегда обновляем last_edited_by и last_edited_at
            updates.append(f"last_edited_by = ${param_idx}")
            values.append(username)
            param_idx += 1

            updates.append(f"last_edited_at = ${param_idx}")
            values.append("CURRENT_TIMESTAMP")
            param_idx += 1

            if updates:
                values.append(act_id)  # для WHERE clause

                await self.conn.execute(
                    f"""
                    UPDATE acts
                    SET {', '.join(updates)}
                    WHERE id = ${param_idx}
                    """,
                    *values
                )

            # Обновляем аудиторскую группу если передана
            if act_update.audit_team is not None:
                # Удаляем старых членов
                await self.conn.execute(
                    "DELETE FROM audit_team_members WHERE act_id = $1",
                    act_id
                )

                # Добавляем новых
                for idx, member in enumerate(act_update.audit_team):
                    await self.conn.execute(
                        """
                        INSERT INTO audit_team_members (
                            act_id, role, full_name, position, username, order_index
                        )
                        VALUES ($1, $2, $3, $4, $5, $6)
                        """,
                        act_id,
                        member.role,
                        member.full_name,
                        member.position,
                        member.username,
                        idx
                    )

            # Обновляем поручения если переданы
            if act_update.directives is not None:
                # Удаляем старые поручения
                await self.conn.execute(
                    "DELETE FROM act_directives WHERE act_id = $1",
                    act_id
                )

                # Добавляем новые
                for idx, directive in enumerate(act_update.directives):
                    await self.conn.execute(
                        """
                        INSERT INTO act_directives (
                            act_id, point_number, directive_number, order_index
                        )
                        VALUES ($1, $2, $3, $4)
                        """,
                        act_id,
                        directive.point_number,
                        directive.directive_number,
                        idx
                    )

            logger.info(f"Обновлены метаданные акта ID={act_id}")

            return await self.get_act_by_id(act_id)

    async def duplicate_act(
            self,
            act_id: int,
            new_km_number: str,
            username: str
    ) -> ActResponse:
        """
        Создает дубликат акта с новым номером КМ.

        Args:
            act_id: ID исходного акта
            new_km_number: Новый номер КМ
            username: Имя пользователя-создателя

        Returns:
            Новый акт
        """
        # Получаем исходный акт
        original = await self.get_act_by_id(act_id)

        # Создаем новый акт с теми же данными
        new_act_data = ActCreate(
            km_number=new_km_number,
            inspection_name=original.inspection_name,
            city=original.city,
            created_date=original.created_date,
            order_number=original.order_number,
            order_date=original.order_date,
            audit_team=original.audit_team,
            inspection_start_date=original.inspection_start_date,
            inspection_end_date=original.inspection_end_date,
            is_process_based=original.is_process_based,
            directives=original.directives
        )

        new_act = await self.create_act(new_act_data, username)

        # Копируем дерево
        tree_row = await self.conn.fetchrow(
            "SELECT tree_data FROM act_tree WHERE act_id = $1",
            act_id
        )

        if tree_row:
            await self.conn.execute(
                """
                UPDATE act_tree
                SET tree_data = $1
                WHERE act_id = $2
                """,
                tree_row['tree_data'],
                new_act.id
            )

        # Копируем таблицы
        tables = await self.conn.fetch(
            "SELECT * FROM act_tables WHERE act_id = $1",
            act_id
        )

        for table in tables:
            await self.conn.execute(
                """
                INSERT INTO act_tables (
                    act_id, table_id, node_id, node_number, table_label,
                    grid_data, col_widths, is_protected, is_deletable,
                    is_metrics_table, is_main_metrics_table,
                    is_regular_risk_table, is_operational_risk_table
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                """,
                new_act.id,
                table['table_id'],
                table['node_id'],
                table['node_number'],
                table['table_label'],
                table['grid_data'],
                table['col_widths'],
                table['is_protected'],
                table['is_deletable'],
                table['is_metrics_table'],
                table['is_main_metrics_table'],
                table['is_regular_risk_table'],
                table['is_operational_risk_table']
            )

        # Копируем текстовые блоки
        textblocks = await self.conn.fetch(
            "SELECT * FROM act_textblocks WHERE act_id = $1",
            act_id
        )

        for tb in textblocks:
            await self.conn.execute(
                """
                INSERT INTO act_textblocks (
                    act_id, textblock_id, node_id, node_number, content, formatting
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                new_act.id,
                tb['textblock_id'],
                tb['node_id'],
                tb['node_number'],
                tb['content'],
                tb['formatting']
            )

        # Копируем нарушения
        violations = await self.conn.fetch(
            "SELECT * FROM act_violations WHERE act_id = $1",
            act_id
        )

        for v in violations:
            await self.conn.execute(
                """
                INSERT INTO act_violations (
                    act_id, violation_id, node_id, node_number, violated, established,
                    description_list, additional_content, reasons, consequences,
                    responsible, recommendations
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """,
                new_act.id,
                v['violation_id'],
                v['node_id'],
                v['node_number'],
                v['violated'],
                v['established'],
                v['description_list'],
                v['additional_content'],
                v['reasons'],
                v['consequences'],
                v['responsible'],
                v['recommendations']
            )

        logger.info(f"Создан дубликат акта: ID={act_id} -> ID={new_act.id}")

        return new_act

    async def check_user_access(self, act_id: int, username: str) -> bool:
        """
        Проверяет доступ пользователя к акту.

        Args:
            act_id: ID акта
            username: Имя пользователя

        Returns:
            True если пользователь имеет доступ
        """
        result = await self.conn.fetchval(
            """
            SELECT EXISTS(
                SELECT 1
                FROM audit_team_members
                WHERE act_id = $1 AND username = $2
            )
            """,
            act_id,
            username
        )

        return result
