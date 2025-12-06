# app/db/service.py
"""
Сервис бизнес-логики для работы с актами в PostgreSQL.
"""

import json
import logging
import re
from datetime import datetime
from typing import Optional

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

    # -------------------------------------------------------------------------
    # ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    # -------------------------------------------------------------------------

    @staticmethod
    def _extract_km_digits(km_number: str) -> str:
        """
        Извлекает только цифры из КМ номера.

        Args:
            km_number: КМ в формате КМ-XX-XXXX

        Returns:
            Строка из 6 цифр (например, "759475")
        """
        digits = re.sub(r'[^0-9]', '', km_number)

        if len(digits) != 6:
            raise ValueError(
                f'КМ номер должен содержать ровно 6 цифр, получено: {len(digits)} ({km_number})'
            )

        return digits

    @staticmethod
    def _extract_service_note_suffix(service_note: str) -> Optional[str]:
        """
        Извлекает 4 цифры после "/" из служебной записки.

        Args:
            service_note: Служебная записка в формате Текст/XXXX

        Returns:
            Строка из 4 цифр или None
        """
        if not service_note:
            return None

        parts = service_note.rsplit('/', 1)
        if len(parts) == 2:
            return parts[1]
        return None

    async def check_km_exists(self, km_number: str) -> dict:
        """
        Проверяет существование актов с данным КМ номером.

        Args:
            km_number: КМ номер в формате КМ-XX-XXXX

        Returns:
            Словарь с информацией:
            - exists: bool - существуют ли акты с таким КМ
            - total_parts: int - общее количество актов (всех типов)
            - current_parts: int - то же самое, что total_parts (для обратной совместимости API)
            - next_part_no_sn: int - следующий номер части для акта без СЗ
            - has_service_notes: bool - есть ли акты с служебными записками
        """
        km_digit = self._extract_km_digits(km_number)

        row = await self.conn.fetchrow(
            """
            SELECT 
                COUNT(*) as total_count,
                MAX(CASE WHEN service_note IS NULL THEN part_number ELSE 0 END) as max_part_no_sn,
                COUNT(CASE WHEN service_note IS NOT NULL THEN 1 END) as with_service_notes
            FROM acts 
            WHERE km_number_digit = $1
            """,
            km_digit
        )

        total_count = row['total_count'] or 0
        exists = total_count > 0
        has_service_notes = row['with_service_notes'] > 0

        # Следующий номер части для акта БЕЗ СЗ
        max_part_no_sn = row['max_part_no_sn'] or 0
        next_part_no_sn = max_part_no_sn + 1 if max_part_no_sn > 0 else 1

        # Для совместимости со старым кодом API, который ожидает current_parts
        return {
            'exists': exists,
            'total_parts': total_count,
            'current_parts': total_count,  # важно для acts.py
            'next_part_no_sn': next_part_no_sn,
            'next_part': next_part_no_sn,  # если где-то использовался старый ключ
            'has_service_notes': has_service_notes
        }

    async def _update_total_parts_for_km(self, km_digit: str) -> None:
        """
        Обновляет total_parts для всех актов с данным КМ номером.

        total_parts = реальное количество актов (независимо от типа).

        Args:
            km_digit: КМ номер (только цифры)
        """
        total_count = await self.conn.fetchval(
            """
            SELECT COUNT(*) 
            FROM acts 
            WHERE km_number_digit = $1
            """,
            km_digit
        )

        await self.conn.execute(
            """
            UPDATE acts 
            SET total_parts = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE km_number_digit = $2
            """,
            total_count,
            km_digit
        )

        logger.info(
            f"Обновлено total_parts={total_count} для всех актов КМ (цифры)={km_digit}"
        )

    # -------------------------------------------------------------------------
    # СОЗДАНИЕ АКТА
    # -------------------------------------------------------------------------

    async def create_act(
            self,
            act_data: ActCreate,
            username: str,
            force_new_part: bool = False
    ) -> ActResponse:
        """
        Создает новый акт с метаданными, аудиторской группой и поручениями.

        Логика нумерации:
        - Если указана service_note: part_number берется из последних 4 цифр СЗ
        - Если service_note не указана: part_number = MAX(part_number для актов без СЗ) + 1

        Args:
            act_data: Валидированные данные для создания акта
            username: Имя пользователя-создателя
            force_new_part: Если True, создает новую часть существующего КМ

        Returns:
            Полная информация о созданном акте
        """
        async with self.conn.transaction():
            km_digit = self._extract_km_digits(act_data.km_number)
            km_info = await self.check_km_exists(act_data.km_number)

            # Определяем номер части
            if act_data.service_note:
                # Часть определяется последними 4 цифрами СЗ
                service_note_suffix = self._extract_service_note_suffix(
                    act_data.service_note
                )
                if not service_note_suffix or not service_note_suffix.isdigit():
                    raise ValueError(
                        f"Некорректный формат служебной записки: {act_data.service_note}"
                    )

                part_number = int(service_note_suffix)

                # Проверяем, что такая комбинация km_digit + part еще не существует
                exists = await self.conn.fetchval(
                    """
                    SELECT EXISTS(
                        SELECT 1 FROM acts 
                        WHERE km_number_digit = $1 AND part_number = $2
                    )
                    """,
                    km_digit,
                    part_number
                )

                if exists:
                    raise ValueError(
                        f'Акт с КМ (цифры) {km_digit} и частью {part_number} уже существует'
                    )
            else:
                # Автоматическая нумерация для актов без СЗ
                if km_info['exists'] and force_new_part:
                    part_number = km_info['next_part_no_sn']
                elif km_info['exists'] and not force_new_part:
                    # Здесь backend генерирует 409 и отдает km_info в detail,
                    # acts.py опирается на current_parts и next_part
                    raise ValueError(
                        f"Акт с КМ '{act_data.km_number}' уже существует. "
                        f"Используйте force_new_part=True для создания новой части."
                    )
                else:
                    part_number = 1

            # total_parts будет обновлен после создания акта для всех записей
            total_parts = km_info['total_parts'] + 1

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
                    km_number, km_number_digit, part_number, total_parts, 
                    inspection_name, city, created_date,
                    order_number, order_date, is_process_based,
                    service_note, service_note_date,
                    created_by, inspection_start_date, inspection_end_date,
                    last_edited_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
                RETURNING id
                """,
                act_data.km_number,
                km_digit,
                part_number,
                total_parts,
                act_data.inspection_name,
                act_data.city,
                act_data.created_date,
                act_data.order_number,
                act_data.order_date,
                act_data.is_process_based,
                act_data.service_note,
                act_data.service_note_date,
                username,
                act_data.inspection_start_date,
                act_data.inspection_end_date
            )

            # Добавляем членов аудиторской группы
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

            # Создаем пустое дерево структуры
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

            # Обновляем total_parts для всех актов с этим КМ
            await self._update_total_parts_for_km(km_digit)

            logger.info(
                f"Создан акт ID={act_id}, КМ={act_data.km_number}, "
                f"часть {part_number}/{total_parts}, СЗ={act_data.service_note}"
            )

            return await self.get_act_by_id(act_id)

    # -------------------------------------------------------------------------
    # ЧТЕНИЕ
    # -------------------------------------------------------------------------

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
                a.service_note,
                atm.role as user_role
            FROM acts a
            INNER JOIN audit_team_members atm ON a.id = atm.act_id
            WHERE atm.username = $1
            GROUP BY a.id, a.km_number, a.part_number, a.total_parts,
                     a.inspection_name, a.order_number,
                     a.inspection_start_date, a.inspection_end_date,
                     a.last_edited_at, a.service_note, atm.role
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
                user_role=row['user_role'],
                service_note=row['service_note']
            )
            for row in rows
        ]

    async def get_act_by_id(self, act_id: int) -> ActResponse:
        """Получает полную информацию об акте по его ID."""
        act_row = await self.conn.fetchrow(
            """
            SELECT 
                id, km_number, part_number, total_parts,
                inspection_name, city, created_date,
                order_number, order_date, is_process_based,
                service_note, service_note_date,
                inspection_start_date, inspection_end_date,
                needs_created_date, needs_directive_number, 
                needs_invoice_check, needs_service_note,
                created_at, updated_at, created_by,
                last_edited_by, last_edited_at
            FROM acts 
            WHERE id = $1
            """,
            act_id
        )

        if not act_row:
            raise ValueError(f"Акт ID={act_id} не найден")

        # Аудиторская группа
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

        # Поручения
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
            part_number=act_row['part_number'],
            total_parts=act_row['total_parts'],
            inspection_name=act_row['inspection_name'],
            city=act_row['city'],
            created_date=act_row['created_date'],
            order_number=act_row['order_number'],
            order_date=act_row['order_date'],
            is_process_based=act_row['is_process_based'],
            service_note=act_row['service_note'],
            service_note_date=act_row['service_note_date'],
            inspection_start_date=act_row['inspection_start_date'],
            inspection_end_date=act_row['inspection_end_date'],
            audit_team=audit_team,
            directives=directives,
            needs_created_date=act_row['needs_created_date'],
            needs_directive_number=act_row['needs_directive_number'],
            needs_invoice_check=act_row['needs_invoice_check'],
            needs_service_note=act_row['needs_service_note'],
            created_at=act_row['created_at'],
            updated_at=act_row['updated_at'],
            created_by=act_row['created_by'],
            last_edited_by=act_row['last_edited_by'],
            last_edited_at=act_row['last_edited_at']
        )

    # -------------------------------------------------------------------------
    # ОБНОВЛЕНИЕ МЕТАДАННЫХ
    # -------------------------------------------------------------------------

    async def update_act_metadata(
            self,
            act_id: int,
            act_update: ActUpdate,
            username: str
    ) -> ActResponse:
        """
        Обновляет метаданные акта (частичное обновление).

        Упрощенная логика:
        - Не пересчитываем номера частей других актов
        - Только обновляем total_parts при изменении КМ
        - При добавлении/удалении СЗ следим только за уникальностью (km_digit, part_number)
        """
        async with self.conn.transaction():
            current_act = await self.get_act_by_id(act_id)
            old_km_number = current_act.km_number
            old_km_digit = self._extract_km_digits(old_km_number)
            old_service_note = current_act.service_note

            # Валидация поручений
            if act_update.directives is not None:
                await self._validate_directives_points(act_id, act_update.directives)

            # Определяем изменения
            km_changed = (
                    act_update.km_number is not None and
                    act_update.km_number != old_km_number
            )

            service_note_changed = (
                    act_update.service_note is not None and
                    act_update.service_note != old_service_note
            )

            service_note_removed = (
                    old_service_note is not None and
                    act_update.service_note == ''
            )

            # Обработка изменения служебной записки
            if service_note_changed or service_note_removed:
                if act_update.service_note and act_update.service_note != '':
                    # Добавили СЗ - меняем часть на суффикс из СЗ
                    service_note_suffix = self._extract_service_note_suffix(
                        act_update.service_note
                    )
                    if not service_note_suffix or not service_note_suffix.isdigit():
                        raise ValueError(
                            f"Некорректный формат служебной записки: {act_update.service_note}"
                        )

                    new_part_number = int(service_note_suffix)

                    km_digit = (
                        self._extract_km_digits(act_update.km_number)
                        if act_update.km_number
                        else old_km_digit
                    )

                    exists = await self.conn.fetchval(
                        """
                        SELECT EXISTS(
                            SELECT 1 FROM acts 
                            WHERE km_number_digit = $1 
                              AND part_number = $2 
                              AND id != $3
                        )
                        """,
                        km_digit,
                        new_part_number,
                        act_id
                    )

                    if exists:
                        raise ValueError(
                            f'Акт с КМ (цифры) {km_digit} и частью '
                            f'{new_part_number} уже существует'
                        )

                    act_update.part_number = new_part_number
                else:
                    # Убрали СЗ - назначаем следующий свободный номер для акта без СЗ
                    km_digit = (
                        self._extract_km_digits(act_update.km_number)
                        if act_update.km_number
                        else old_km_digit
                    )

                    next_part = await self.conn.fetchval(
                        """
                        SELECT COALESCE(
                            MAX(CASE WHEN service_note IS NULL THEN part_number ELSE 0 END),
                            0
                        ) + 1
                        FROM acts
                        WHERE km_number_digit = $1 
                          AND id != $2
                        """,
                        km_digit,
                        act_id
                    )

                    act_update.part_number = next_part
                    act_update.service_note = None
                    act_update.service_note_date = None

            # Обработка изменения КМ
            if km_changed:
                new_km_digit = self._extract_km_digits(act_update.km_number)
                km_info = await self.check_km_exists(act_update.km_number)

                if current_act.service_note or act_update.service_note:
                    # Для актов с СЗ просто проверяем уникальность
                    part_to_check = (
                        act_update.part_number
                        if act_update.part_number is not None
                        else current_act.part_number
                    )

                    exists = await self.conn.fetchval(
                        """
                        SELECT EXISTS(
                            SELECT 1 FROM acts 
                            WHERE km_number_digit = $1 
                              AND part_number = $2
                              AND id != $3
                        )
                        """,
                        new_km_digit,
                        part_to_check,
                        act_id
                    )

                    if exists:
                        raise ValueError(
                            f'Акт с КМ (цифры) {new_km_digit} и частью '
                            f'{part_to_check} уже существует'
                        )
                else:
                    # Для актов без СЗ назначаем следующий номер
                    new_part = km_info['next_part_no_sn']
                    act_update.part_number = new_part

                logger.info(
                    f"Акт ID={act_id} изменяет КМ: "
                    f"{old_km_number}(часть {current_act.part_number}) -> "
                    f"{act_update.km_number}(часть {act_update.part_number})"
                )

            # Строим динамический SQL для UPDATE
            updates = []
            values = []
            param_idx = 1

            # КМ и km_number_digit
            if act_update.km_number is not None:
                updates.append(f"km_number = ${param_idx}")
                values.append(act_update.km_number)
                param_idx += 1

                updates.append(f"km_number_digit = ${param_idx}")
                values.append(self._extract_km_digits(act_update.km_number))
                param_idx += 1

            if act_update.part_number is not None:
                updates.append(f"part_number = ${param_idx}")
                values.append(act_update.part_number)
                param_idx += 1

            # НЕ обновляем total_parts здесь - обновим отдельным запросом

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

            # Служебная записка
            if service_note_changed or service_note_removed:
                updates.append(f"service_note = ${param_idx}")
                values.append(
                    act_update.service_note if act_update.service_note else None
                )
                param_idx += 1

            if act_update.service_note_date is not None:
                updates.append(f"service_note_date = ${param_idx}")
                values.append(act_update.service_note_date)
                param_idx += 1

            # Информация о редактировании
            updates.append(f"last_edited_by = ${param_idx}")
            values.append(username)
            param_idx += 1

            updates.append("last_edited_at = CURRENT_TIMESTAMP")

            # Выполняем UPDATE
            if updates:
                values.append(act_id)

                await self.conn.execute(
                    f"""
                    UPDATE acts
                    SET {', '.join(updates)}
                    WHERE id = ${param_idx}
                    """,
                    *values
                )

            # Аудиторская группа
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

            # Поручения
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

            # Обновляем total_parts для старого КМ (если КМ изменился)
            if km_changed:
                await self._update_total_parts_for_km(old_km_digit)
                logger.info(
                    f"Обновлен total_parts для старого КМ (цифры)={old_km_digit}"
                )

            # Обновляем total_parts для текущего/нового КМ
            current_km_digit = (
                self._extract_km_digits(act_update.km_number)
                if act_update.km_number
                else old_km_digit
            )
            await self._update_total_parts_for_km(current_km_digit)

            logger.info(f"Обновлены метаданные акта ID={act_id}")

            return await self.get_act_by_id(act_id)

    # -------------------------------------------------------------------------
    # ВАЛИДАЦИЯ ПОРУЧЕНИЙ
    # -------------------------------------------------------------------------

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

        # Проверяем тип и парсим JSON если нужно
        if isinstance(tree_data, str):
            tree_data = json.loads(tree_data)

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

    def _collect_node_numbers(self, node, numbers: set = None) -> set:
        """Рекурсивно собирает все номера узлов из дерева."""
        if numbers is None:
            numbers = set()

        if not isinstance(node, dict):
            logger.warning(f"Узел не является dict: {type(node)}, значение: {node}")
            return numbers

        if 'number' in node and node['number']:
            numbers.add(node['number'])

        if 'children' in node and isinstance(node['children'], list):
            for child in node['children']:
                self._collect_node_numbers(child, numbers)

        return numbers

    # -------------------------------------------------------------------------
    # ДУБЛИРОВАНИЕ И УДАЛЕНИЕ
    # -------------------------------------------------------------------------

    async def _generate_unique_copy_name(self, original_name: str) -> str:
        """
        Генерирует уникальное название для копии акта.

        Логика:
        - "Название" → "Название (Копия)"
        - "Название (Копия)" → "Название (Копия 2)"
        - "Название (Копия 2)" → "Название (Копия 3)"
        """
        # Проверяем есть ли уже "(Копия ...)" в конце
        match = re.search(r'^(.+?)\s*\(Копия\s*(\d*)\)\s*$', original_name)

        if match:
            base_name = match.group(1).strip()
            existing_num = match.group(2)

            if existing_num:
                next_num = int(existing_num) + 1
            else:
                next_num = 2
        else:
            base_name = original_name.strip()
            next_num = None  # Первая копия без номера

        # Генерируем название и проверяем уникальность
        attempt = 0
        max_attempts = 100  # Защита от бесконечного цикла

        while attempt < max_attempts:
            if next_num is None:
                new_name = f"{base_name} (Копия)"
            else:
                new_name = f"{base_name} (Копия {next_num})"

            # Проверяем существование
            exists = await self.conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM acts WHERE inspection_name = $1)",
                new_name
            )

            if not exists:
                return new_name

            # Если существует, увеличиваем счётчик
            if next_num is None:
                next_num = 2
            else:
                next_num += 1

            attempt += 1

        # Если не смогли найти уникальное имя, добавляем timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"{base_name} (Копия {timestamp})"

    async def duplicate_act(
            self,
            act_id: int,
            username: str
    ) -> ActResponse:
        """
        Создает дубликат акта.

        Логика дублирования:
        - Генерируется уникальное название (Копия, Копия 2, ...)
        - КМ берётся из оригинала БЕЗ изменений
        - Создаётся как новая часть существующего КМ (force_new_part=True)
        - Служебная записка НЕ копируется (акт без СЗ)
        """
        original = await self.get_act_by_id(act_id)
        km_digit = self._extract_km_digits(original.km_number)

        new_inspection_name = await self._generate_unique_copy_name(
            original.inspection_name
        )

        # Создаём дубликат БЕЗ служебной записки и с тем же КМ
        new_act_data = ActCreate(
            km_number=original.km_number,  # КМ без изменений
            part_number=1,  # Будет пересчитан автоматически
            total_parts=1,  # Будет пересчитан автоматически
            inspection_name=new_inspection_name,
            city=original.city,
            created_date=original.created_date,
            order_number=original.order_number,
            order_date=original.order_date,
            audit_team=original.audit_team,
            inspection_start_date=original.inspection_start_date,
            inspection_end_date=original.inspection_end_date,
            is_process_based=original.is_process_based,
            directives=original.directives,
            service_note=None,  # НЕ копируем СЗ
            service_note_date=None
        )

        # Создаём как новую часть существующего КМ
        new_act = await self.create_act(new_act_data, username, force_new_part=True)

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

        # Явно обновляем total_parts для всей группы КМ
        await self._update_total_parts_for_km(km_digit)

        logger.info(
            f"Создан дубликат акта: ID={act_id} -> ID={new_act.id}, "
            f"КМ={original.km_number} (цифры={km_digit}), "
            f"название='{new_inspection_name}'"
        )

        # Перезагружаем акт чтобы получить актуальный total_parts
        return await self.get_act_by_id(new_act.id)

    async def delete_act(self, act_id: int) -> None:
        """
        Удаляет акт и все связанные данные.

        Упрощенная логика:
        - НЕ пересчитываем номера частей других актов
        - Только обновляем total_parts
        """
        act = await self.get_act_by_id(act_id)
        km_digit = self._extract_km_digits(act.km_number)

        async with self.conn.transaction():
            await self.conn.execute(
                "DELETE FROM acts WHERE id = $1",
                act_id
            )

            await self._update_total_parts_for_km(km_digit)

            logger.info(
                f"Акт ID={act_id} (КМ={act.km_number}, часть {act.part_number}, "
                f"СЗ={act.service_note}) удален со всеми связанными данными. "
                f"Обновлен total_parts для КМ (цифры)={km_digit}"
            )

    # -------------------------------------------------------------------------
    # ДОСТУП
    # -------------------------------------------------------------------------

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
