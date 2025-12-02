# app/db/service.py
"""
Сервис бизнес-логики для работы с актами в PostgreSQL.
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
    """Сервис для работы с актами и их связанными сущностями в базе данных."""

    def __init__(self, conn: asyncpg.Connection):
        """Инициализирует сервис с подключением к БД."""
        self.conn = conn

    async def check_km_exists(self, km_number: str) -> dict:
        """
        Проверяет существование актов с данным КМ номером.

        Args:
            km_number: КМ номер для проверки

        Returns:
            Словарь с информацией:
            - exists: bool - существуют ли акты с таким КМ
            - current_parts: int - текущее количество частей
            - next_part: int - номер следующей части
        """
        row = await self.conn.fetchrow(
            """
            SELECT 
                COUNT(*) as count,
                MAX(part_number) as max_part,
                MAX(total_parts) as total_parts
            FROM acts 
            WHERE km_number = $1
            """,
            km_number
        )

        exists = row['count'] > 0
        current_parts = row['total_parts'] if exists else 0
        next_part = (row['max_part'] + 1) if exists else 1

        return {
            'exists': exists,
            'current_parts': current_parts,
            'next_part': next_part
        }

    async def _update_total_parts_for_km(self, km_number: str, new_total: int) -> None:
        """
        Обновляет total_parts для всех актов с данным КМ номером.

        Args:
            km_number: КМ номер
            new_total: Новое общее количество частей
        """
        await self.conn.execute(
            """
            UPDATE acts 
            SET total_parts = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE km_number = $2
            """,
            new_total,
            km_number
        )
        logger.info(f"Обновлено total_parts={new_total} для КМ={km_number}")

    async def _recalculate_parts_after_delete(self, km_number: str, deleted_part: int) -> None:
        """
        Пересчитывает номера частей после удаления акта.

        Сдвигает номера частей, которые были после удаленной.
        Обновляет total_parts для всех актов с данным КМ.

        Args:
            km_number: КМ номер
            deleted_part: Номер удаленной части
        """
        async with self.conn.transaction():
            # Сдвигаем номера частей, которые были после удаленной
            await self.conn.execute(
                """
                UPDATE acts
                SET part_number = part_number - 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE km_number = $1 AND part_number > $2
                """,
                km_number,
                deleted_part
            )

            # Получаем новое общее количество частей
            new_total = await self.conn.fetchval(
                "SELECT COUNT(*) FROM acts WHERE km_number = $1",
                km_number
            )

            # Обновляем total_parts для всех актов с этим КМ
            if new_total > 0:
                await self._update_total_parts_for_km(km_number, new_total)
                logger.info(
                    f"Пересчитаны части для КМ={km_number}: "
                    f"удалена часть {deleted_part}, новый total={new_total}"
                )

    async def create_act(
            self,
            act_data: ActCreate,
            username: str,
            force_new_part: bool = False
    ) -> ActResponse:
        """
        Создает новый акт с метаданными, аудиторской группой и поручениями.

        Args:
            act_data: Валидированные данные для создания акта
            username: Имя пользователя-создателя
            force_new_part: Если True, создает новую часть существующего КМ

        Returns:
            Полная информация о созданном акте
        """
        async with self.conn.transaction():
            # Проверяем существование КМ и определяем номер части
            km_info = await self.check_km_exists(act_data.km_number)

            if km_info['exists'] and force_new_part:
                # Создаем новую часть существующего КМ
                part_number = km_info['next_part']
                total_parts = km_info['current_parts'] + 1

                # Обновляем total_parts для всех существующих частей
                await self._update_total_parts_for_km(act_data.km_number, total_parts)
            elif km_info['exists'] and not force_new_part:
                # Дубликат - не должно произойти, но на всякий случай
                raise ValueError(
                    f"Акт с КМ '{act_data.km_number}' уже существует. "
                    f"Используйте force_new_part=True для создания новой части."
                )
            else:
                # Новый КМ - первая часть
                part_number = 1
                total_parts = 1

            # Проверка: пользователь должен быть членом аудиторской группы
            user_in_team = any(
                member.username == username
                for member in act_data.audit_team
            )
            if not user_in_team:
                raise ValueError(
                    "Пользователь должен быть членом аудиторской группы"
                )

            # Создаем основную запись акта с рассчитанными частями
            act_id = await self.conn.fetchval(
                """
                INSERT INTO acts (
                    km_number, part_number, total_parts, inspection_name, city, created_date,
                    order_number, order_date, is_process_based,
                    created_by, inspection_start_date, inspection_end_date,
                    last_edited_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
                RETURNING id
                """,
                act_data.km_number,
                part_number,
                total_parts,
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
                    idx
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

            logger.info(
                f"Создан акт ID={act_id}, КМ={act_data.km_number}, "
                f"часть {part_number}/{total_parts}"
            )

            # Возвращаем полную информацию о созданном акте
            return await self.get_act_by_id(act_id)

    async def get_user_acts(self, username: str) -> list[ActListItem]:
        """Получает список актов, где пользователь является участником."""
        rows = await self.conn.fetch(
            """
            SELECT 
                a.id,
                a.km_number,
                a.part_number,
                a.total_parts,
                a.inspection_name,
                a.order_number,
                a.inspection_start_date,
                a.inspection_end_date,
                a.last_edited_at,
                atm.role as user_role
            FROM acts a
            INNER JOIN audit_team_members atm ON a.id = atm.act_id
            WHERE atm.username = $1
            GROUP BY a.id, a.km_number, a.part_number, a.total_parts,
                     a.inspection_name, a.order_number,
                     a.inspection_start_date, a.inspection_end_date,
                     a.last_edited_at, atm.role
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
                part_number=row['part_number'],
                total_parts=row['total_parts'],
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
        """Получает полную информацию об акте по его ID."""
        # Получаем основные данные акта
        act_row = await self.conn.fetchrow(
            """
            SELECT 
                id, km_number, part_number, total_parts,
                inspection_name, city, created_date,
                order_number, order_date, is_process_based,
                inspection_start_date, inspection_end_date,
                needs_created_date, needs_directive_number, needs_invoice_check,
                created_at, updated_at, created_by,
                last_edited_by, last_edited_at
            FROM acts 
            WHERE id = $1
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
            part_number=act_row['part_number'],
            total_parts=act_row['total_parts'],
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
            needs_created_date=act_row['needs_created_date'],
            needs_directive_number=act_row['needs_directive_number'],
            needs_invoice_check=act_row['needs_invoice_check'],
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

        При изменении КМ номера пересчитывает части для старого и нового КМ.
        """
        async with self.conn.transaction():
            # Получаем текущие данные акта
            current_act = await self.get_act_by_id(act_id)
            old_km = current_act.km_number
            old_part = current_act.part_number

            # Валидация поручений если они переданы
            if act_update.directives is not None:
                await self._validate_directives_points(act_id, act_update.directives)

            # Проверяем изменение КМ номера
            km_changed = act_update.km_number is not None and act_update.km_number != old_km

            if km_changed:
                new_km = act_update.km_number

                # Проверяем существование нового КМ
                km_info = await self.check_km_exists(new_km)

                if km_info['exists']:
                    # Новый КМ уже существует - добавляем как новую часть
                    new_part = km_info['next_part']
                    new_total = km_info['current_parts'] + 1

                    # Обновляем total_parts для всех актов нового КМ
                    await self._update_total_parts_for_km(new_km, new_total)
                else:
                    # Новый КМ не существует - создаем первую часть
                    new_part = 1
                    new_total = 1

                # Принудительно устанавливаем новые значения для обновляемого акта
                act_update.part_number = new_part
                act_update.total_parts = new_total

                logger.info(
                    f"Акт ID={act_id} изменяет КМ: {old_km}(часть {old_part}) -> {new_km}(часть {new_part})"
                )

            # Строим динамический SQL для обновления только переданных полей
            updates = []
            values = []
            param_idx = 1

            # Обрабатываем каждое опциональное поле
            if act_update.km_number is not None:
                updates.append(f"km_number = ${param_idx}")
                values.append(act_update.km_number)
                param_idx += 1

            if act_update.part_number is not None:
                updates.append(f"part_number = ${param_idx}")
                values.append(act_update.part_number)
                param_idx += 1

            if act_update.total_parts is not None:
                updates.append(f"total_parts = ${param_idx}")
                values.append(act_update.total_parts)
                param_idx += 1

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
                await self.conn.execute(
                    "DELETE FROM audit_team_members WHERE act_id = $1",
                    act_id
                )

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
                await self.conn.execute(
                    "DELETE FROM act_directives WHERE act_id = $1",
                    act_id
                )

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

            # ВАЖНО: Пересчитываем части для старого КМ ПОСЛЕ обновления текущего акта
            if km_changed:
                await self._recalculate_parts_after_delete(old_km, old_part)
                logger.info(f"Пересчитаны части для старого КМ={old_km} после перемещения акта ID={act_id}")

            logger.info(f"Обновлены метаданные акта ID={act_id}")

            return await self.get_act_by_id(act_id)

    async def _validate_directives_points(self, act_id: int, directives: list[ActDirective]) -> None:
        """Проверяет что все пункты поручений существуют в структуре акта."""
        if not directives:
            return

        tree_row = await self.conn.fetchrow(
            "SELECT tree_data FROM act_tree WHERE act_id = $1",
            act_id
        )

        if not tree_row:
            raise ValueError("Структура акта не найдена")

        tree_data = tree_row['tree_data']
        existing_points = self._collect_node_numbers(tree_data)

        for directive in directives:
            point = directive.point_number

            if not point.startswith('5.'):
                raise ValueError(
                    f"Поручение '{directive.directive_number}' ссылается на пункт '{point}', "
                    f"но поручения могут быть только в разделе 5"
                )

            if point not in existing_points:
                raise ValueError(
                    f"Поручение '{directive.directive_number}' ссылается на несуществующий "
                    f"пункт '{point}'. Сначала создайте этот пункт в структуре акта."
                )

    def _collect_node_numbers(self, node: dict, numbers: set = None) -> set:
        """Рекурсивно собирает все номера узлов из дерева."""
        if numbers is None:
            numbers = set()

        if 'number' in node and node['number']:
            numbers.add(node['number'])

        if 'children' in node:
            for child in node['children']:
                self._collect_node_numbers(child, numbers)

        return numbers

    async def _generate_unique_copy_name(self, original_name: str) -> str:
        """Генерирует уникальное название для копии акта."""
        match = re.search(r'^(.+?)\s*\(Копия\s*(\d*)\)\s*$', original_name)

        if match:
            base_name = match.group(1)
            existing_num = match.group(2)

            if existing_num:
                next_num = int(existing_num) + 1
            else:
                next_num = 2

            new_name = f"{base_name} (Копия {next_num})"
        else:
            new_name = f"{original_name} (Копия)"

        exists = await self.conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM acts WHERE inspection_name = $1)",
            new_name
        )

        if exists:
            return await self._generate_unique_copy_name(new_name)

        return new_name

    async def duplicate_act(
            self,
            act_id: int,
            username: str
    ) -> ActResponse:
        """Создает полную копию акта со всеми данными."""
        original = await self.get_act_by_id(act_id)

        new_inspection_name = await self._generate_unique_copy_name(
            original.inspection_name
        )

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        new_km_number = f"{original.km_number}_copy_{timestamp}"

        new_act_data = ActCreate(
            km_number=new_km_number,
            part_number=original.part_number,
            total_parts=original.total_parts,
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

        new_act = await self.create_act(new_act_data, username, force_new_part=False)

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

        # Копируем все таблицы
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

        Пересчитывает номера частей для актов с тем же КМ номером.
        """
        # Получаем информацию об удаляемом акте
        act = await self.get_act_by_id(act_id)
        km_number = act.km_number
        part_number = act.part_number

        async with self.conn.transaction():
            # Удаляем акт (каскадно удалятся все связанные данные)
            await self.conn.execute(
                "DELETE FROM acts WHERE id = $1",
                act_id
            )

            # Пересчитываем части для оставшихся актов с тем же КМ
            await self._recalculate_parts_after_delete(km_number, part_number)

            logger.info(
                f"Акт ID={act_id} (КМ={km_number}, часть {part_number}) "
                f"удален со всеми связанными данными"
            )

    async def check_user_access(self, act_id: int, username: str) -> bool:
        """Проверяет имеет ли пользователь доступ к акту."""
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
