# app/db/service.py
"""
Сервис бизнес-логики для работы с актами в PostgreSQL.

Включает высокоуровневый класс ActDBService для:
- Создания, удаления, обновления актов и связанных сущностей
- Получения актов пользователя и полной информации по акту
- Дублирования документа с копированием дерева, таблиц, текстблоков, нарушений
- Проверки доступа пользователя
"""

import json
import logging
import re
from datetime import datetime

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
    """
    Сервис для работы с актами и их связанными сущностями в базе данных.

    Создаётся с помощью существующего подключения к PostgreSQL, затем
    предоставляет основной CRUD-интерфейс для актов и публичные методы
    для сервисных операций в приложении.
    """

    def __init__(self, conn: asyncpg.Connection):
        """
        Инициализирует сервис с подключением к БД.

        Args:
            conn: Асинхронное подключение к PostgreSQL
        """
        self.conn = conn

    async def create_act(
            self,
            act_data: ActCreate,
            username: str
    ) -> ActResponse:
        """
        Создает новый акт с метаданными, аудиторской группой и поручениями.

        Выполняет следующие действия в транзакции:
        1. Проверяет что текущий пользователь входит в аудиторскую группу
        2. Создает запись акта в таблице acts
        3. Добавляет членов аудиторской группы
        4. Добавляет поручения
        5. Создает пустое дерево структуры

        Args:
            act_data: Валидированные данные для создания акта
            username: Имя пользователя-создателя (из JUPYTERHUB_USER)

        Returns:
            Полная информация о созданном акте

        Raises:
            ValueError: Если пользователь не входит в состав группы
            asyncpg.UniqueViolationError: Если КМ номер уже существует
        """
        async with self.conn.transaction():
            # Проверка: пользователь должен быть членом аудиторской группы
            user_in_team = any(
                member.username == username
                for member in act_data.audit_team
            )
            if not user_in_team:
                raise ValueError(
                    "Пользователь должен быть членом аудиторской группы"
                )

            # Создаем основную запись акта
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

            # Добавляем членов аудиторской группы с сохранением порядка
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
                    idx  # Сохраняем порядок для корректного отображения
                )

            # Добавляем действующие поручения
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

            # Создаем пустое дерево структуры (корневой узел)
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

            # Возвращаем полную информацию о созданном акте
            return await self.get_act_by_id(act_id)

    async def get_user_acts(self, username: str) -> list[ActListItem]:
        """
        Получает список актов, где пользователь является участником.

        Возвращает только те акты, где пользователь состоит в аудиторской группе.
        Результат отсортирован по дате последнего редактирования (последние первыми).

        Args:
            username: Имя пользователя из JUPYTERHUB_USER

        Returns:
            Список актов с информацией о роли пользователя в каждом акте
        """
        rows = await self.conn.fetch(
            """
            SELECT 
                a.id,
                a.km_number,
                a.inspection_name,
                a.order_number,
                a.inspection_start_date,
                a.inspection_end_date,
                a.last_edited_at,
                atm.role as user_role
            FROM acts a
            INNER JOIN audit_team_members atm ON a.id = atm.act_id
            WHERE atm.username = $1
            GROUP BY a.id, a.km_number, a.inspection_name, a.order_number,
                     a.inspection_start_date, a.inspection_end_date,
                     a.last_edited_at, atm.role
            ORDER BY 
                COALESCE(a.last_edited_at, a.created_at) DESC,
                a.created_at DESC
            """,
            username
        )

        # Преобразуем строки БД в Pydantic модели
        return [
            ActListItem(
                id=row['id'],
                km_number=row['km_number'],
                inspection_name=row['inspection_name'],
                order_number=row['order_number'],
                inspection_start_date=row['inspection_start_date'],
                inspection_end_date=row['inspection_end_date'],
                last_edited_at=row['last_edited_at'],
                user_role=row['user_role']
            )
            for row in rows
        ]

    async def get_act_by_id(self, act_id: int) -> ActResponse:
        """
        Получает полную информацию об акте по его ID.

        Извлекает:
        - Основные метаданные акта
        - Состав аудиторской группы
        - Список действующих поручений

        Args:
            act_id: Внутренний ID акта в БД

        Returns:
            Полная информация об акте

        Raises:
            ValueError: Если акт с указанным ID не найден
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

        # Получаем аудиторскую группу с сохранением порядка
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

        # Получаем поручения с сохранением порядка
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

        # Собираем полную информацию об акте
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
        Обновляет метаданные акта (частичное обновление).

        Поддерживает обновление только переданных полей (PATCH-семантика).
        Автоматически обновляет last_edited_by и last_edited_at.

        Args:
            act_id: ID акта для обновления
            act_update: Данные для обновления (все поля опциональны)
            username: Имя пользователя, выполняющего редактирование

        Returns:
            Обновленный акт с актуальными данными

        Raises:
            ValueError: Если акт не найден
        """
        async with self.conn.transaction():
            # Строим динамический SQL для обновления только переданных полей
            updates = []
            values = []
            param_idx = 1

            # Обрабатываем каждое опциональное поле
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

            # Всегда обновляем информацию о редактировании
            updates.append(f"last_edited_by = ${param_idx}")
            values.append(username)
            param_idx += 1

            updates.append("last_edited_at = CURRENT_TIMESTAMP")

            # Выполняем UPDATE если есть изменения
            if updates:
                values.append(act_id)  # Для WHERE clause

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
                # Удаляем старых членов группы
                await self.conn.execute(
                    "DELETE FROM audit_team_members WHERE act_id = $1",
                    act_id
                )

                # Добавляем новых членов с сохранением порядка
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

                # Добавляем новые поручения
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

            # Возвращаем актуальную информацию об акте
            return await self.get_act_by_id(act_id)

    async def _generate_unique_copy_name(self, original_name: str) -> str:
        """
        Генерирует уникальное название для копии акта.

        Логика именования:
        - "Название" → "Название (Копия)"
        - "Название (Копия)" → "Название (Копия 2)"
        - "Название (Копия 2)" → "Название (Копия 3)"
        - И т.д.

        Использует рекурсию для гарантированного поиска уникального названия.

        Args:
            original_name: Исходное название проверки

        Returns:
            Уникальное название копии, не конфликтующее с существующими актами
        """
        # Ищем паттерн "(Копия N)" в конце названия
        match = re.search(r'^(.+?)\s*\(Копия\s*(\d*)\)\s*$', original_name)

        if match:
            # Уже есть "(Копия)" или "(Копия N)" в названии
            base_name = match.group(1)
            existing_num = match.group(2)

            if existing_num:
                # Есть номер - увеличиваем
                next_num = int(existing_num) + 1
            else:
                # Нет номера (просто "(Копия)") - ставим 2
                next_num = 2

            new_name = f"{base_name} (Копия {next_num})"
        else:
            # Это первая копия
            new_name = f"{original_name} (Копия)"

        # Проверяем уникальность в БД
        exists = await self.conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM acts WHERE inspection_name = $1)",
            new_name
        )

        if exists:
            # Если всё ещё не уникально - рекурсивно пробуем следующий номер
            return await self._generate_unique_copy_name(new_name)

        return new_name

    async def duplicate_act(
            self,
            act_id: int,
            username: str
    ) -> ActResponse:
        """
        Создает полную копию акта со всеми данными.

        Копирует:
        - Метаданные акта с автогенерацией уникального названия
        - Аудиторскую группу
        - Поручения
        - Дерево структуры
        - Все таблицы
        - Все текстовые блоки
        - Все нарушения

        Новый КМ генерируется как: "{original_km}_copy_{timestamp}"

        Args:
            act_id: ID исходного акта для дублирования
            username: Имя пользователя-создателя копии

        Returns:
            Полная информация о новом акте (копии)

        Raises:
            ValueError: Если исходный акт не найден
        """
        # Получаем исходный акт
        original = await self.get_act_by_id(act_id)

        # Генерируем уникальное название для копии
        new_inspection_name = await self._generate_unique_copy_name(
            original.inspection_name
        )

        # Генерируем уникальный КМ с временной меткой
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        new_km_number = f"{original.km_number}_copy_{timestamp}"

        # Создаем новый акт с теми же данными
        new_act_data = ActCreate(
            km_number=new_km_number,
            inspection_name=new_inspection_name,
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

        # Копируем дерево структуры
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

        # Копируем все таблицы с сохранением метаданных
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

        # Копируем все текстовые блоки
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

        # Копируем все нарушения
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

        logger.info(
            f"Создан дубликат акта: ID={act_id} -> ID={new_act.id}, "
            f"название='{new_inspection_name}'"
        )

        return new_act

    async def delete_act(self, act_id: int) -> None:
        """
        Удаляет акт и все связанные данные.

        Благодаря ON DELETE CASCADE в схеме БД автоматически удаляются:
        - Члены аудиторской группы
        - Поручения
        - Дерево структуры
        - Все таблицы
        - Все текстовые блоки
        - Все нарушения

        Args:
            act_id: ID акта для удаления

        Raises:
            ValueError: Если акт с указанным ID не найден
        """
        # Проверяем что акт существует
        exists = await self.conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM acts WHERE id = $1)",
            act_id
        )

        if not exists:
            raise ValueError(f"Акт ID={act_id} не найден")

        # Удаляем акт (каскадно удалятся все связанные данные)
        await self.conn.execute(
            "DELETE FROM acts WHERE id = $1",
            act_id
        )

        logger.info(f"Акт ID={act_id} успешно удален со всеми связанными данными")

    async def check_user_access(self, act_id: int, username: str) -> bool:
        """
        Проверяет имеет ли пользователь доступ к акту.

        Пользователь имеет доступ если он входит в состав аудиторской группы акта.

        Args:
            act_id: ID акта для проверки
            username: Имя пользователя из JUPYTERHUB_USER

        Returns:
            True если пользователь имеет доступ, False иначе
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
