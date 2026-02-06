"""
Сервис бизнес-логики для работы с актами в PostgreSQL/Greenplum.
"""

import json
import logging
from datetime import datetime, timedelta

import asyncpg

from app.db.connection import get_adapter
from app.db.utils import KMUtils, JSONDBUtils, ActDirectivesValidator
from app.schemas.act_metadata import (
    ActCreate,
    ActUpdate,
    ActListItem,
    ActResponse,
    AuditTeamMember,
    ActDirective,
)

logger = logging.getLogger("act_constructor.db.repository")


class ActDBService:
    """Сервис для работы с актами и их связанными сущностями в базе данных."""

    def __init__(self, conn: asyncpg.Connection):
        """Инициализирует сервис с подключением к БД."""
        self.conn = conn
        self.adapter = get_adapter()

        # Кэшируем имена таблиц для удобства
        self.acts = self.adapter.get_table_name("acts")
        self.audit_team = self.adapter.get_table_name("audit_team_members")
        self.directives = self.adapter.get_table_name("act_directives")
        self.tree = self.adapter.get_table_name("act_tree")
        self.tables = self.adapter.get_table_name("act_tables")
        self.textblocks = self.adapter.get_table_name("act_textblocks")
        self.violations = self.adapter.get_table_name("act_violations")

    # -------------------------------------------------------------------------
    # ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    # -------------------------------------------------------------------------

    async def check_km_exists(self, km_number: str) -> dict:
        """
        Проверяет существование актов с данным КМ номером.

        Args:
            km_number: КМ номер в формате КМ-XX-XXXXX

        Returns:
            Словарь с информацией:
            - exists: bool - существуют ли акты с таким КМ
            - total_parts: int - общее количество актов (всех типов)
            - current_parts: int - то же самое, что total_parts (для обратной совместимости API)
            - next_part_no_sn: int - следующий номер части для акта без СЗ
            - has_service_notes: bool - есть ли акты с служебными записками
        """
        km_digit = KMUtils.extract_km_digits(km_number)

        row = await self.conn.fetchrow(
            f"""
            SELECT 
                COUNT(*) as total_count,
                MAX(
                    CASE 
                        WHEN service_note IS NULL THEN part_number 
                        ELSE 0 
                    END
                ) as max_part_no_sn,
                COUNT(
                    CASE 
                        WHEN service_note IS NOT NULL THEN 1 
                    END
                ) as with_service_notes
            FROM {self.acts}
            WHERE km_number_digit = $1
            """,
            km_digit,
        )

        total_count = row["total_count"] or 0
        exists = total_count > 0
        has_service_notes = row["with_service_notes"] > 0

        # Следующий номер части для акта БЕЗ СЗ
        max_part_no_sn = row["max_part_no_sn"] or 0
        next_part_no_sn = max_part_no_sn + 1 if max_part_no_sn > 0 else 1

        # Для совместимости со старым кодом API, который ожидает current_parts
        return {
            "exists": exists,
            "total_parts": total_count,
            "current_parts": total_count,
            "next_part_no_sn": next_part_no_sn,
            "next_part": next_part_no_sn,
            "has_service_notes": has_service_notes,
        }

    async def _check_km_part_uniqueness(
            self,
            km_digit: int,
            part_number: int,
            exclude_act_id: int | None = None
    ) -> bool:
        """
        Проверяет уникальность пары (km_number_digit, part_number).

        Args:
            km_digit: КМ номер (только цифры)
            part_number: Номер части
            exclude_act_id: ID акта для исключения (при UPDATE)

        Returns:
            True если пара уникальна, False если уже существует
        """
        if exclude_act_id:
            exists = await self.conn.fetchval(
                f"""
                SELECT EXISTS(
                    SELECT 1 FROM {self.acts}
                    WHERE km_number_digit = $1 
                      AND part_number = $2
                      AND id != $3
                )
                """,
                km_digit,
                part_number,
                exclude_act_id
            )
        else:
            exists = await self.conn.fetchval(
                f"""
                SELECT EXISTS(
                    SELECT 1 FROM {self.acts}
                    WHERE km_number_digit = $1 
                      AND part_number = $2
                )
                """,
                km_digit,
                part_number
            )

        return not exists

    async def _update_total_parts_for_km(self, km_digit: int) -> None:
        """
        Обновляет total_parts для всех актов с данным КМ номером.

        total_parts = реальное количество актов (независимо от типа).

        Args:
            km_digit: КМ номер (только цифры)
        """
        total_count = await self.conn.fetchval(
            f"""
            SELECT COUNT(*) 
            FROM {self.acts}
            WHERE km_number_digit = $1
            """,
            km_digit,
        )

        await self.conn.execute(
            f"""
            UPDATE {self.acts}
            SET total_parts = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE km_number_digit = $2
            """,
            total_count,
            km_digit,
        )

        logger.info(
            f"Обновлено total_parts={total_count} для всех актов КМ (цифры)={km_digit}"
        )

    async def _find_free_part_number(
            self,
            km_digit: int,
            exclude_act_id: int | None = None,
    ) -> int:
        """
        Находит первый свободный номер части для актов (включая с СЗ и без).

        Логика:
        1. Получаем все занятые номера частей
        2. Ищем минимальный свободный номер начиная с 1
        3. Возвращаем первый найденный свободный номер
        """
        if exclude_act_id:
            rows = await self.conn.fetch(
                f"""
                SELECT part_number 
                FROM {self.acts}
                WHERE km_number_digit = $1 
                  AND id != $2
                ORDER BY part_number
                """,
                km_digit,
                exclude_act_id,
            )
        else:
            rows = await self.conn.fetch(
                f"""
                SELECT part_number 
                FROM {self.acts}
                WHERE km_number_digit = $1
                ORDER BY part_number
                """,
                km_digit,
            )

        occupied_numbers = {row["part_number"] for row in rows}

        part_number = 1
        while part_number in occupied_numbers:
            part_number += 1

        logger.info(
            f"Найден свободный номер части {part_number} для КМ (цифры)={km_digit}. "
            f"Занятые номера: {sorted(occupied_numbers)}"
        )

        return part_number

    async def _validate_directives_points(
            self,
            act_id: int,
            directives: list[ActDirective],
    ) -> None:
        """Проверяет что все пункты поручений существуют в структуре акта."""
        if not directives:
            return

        tree_row = await self.conn.fetchrow(
            f"SELECT tree_data FROM {self.tree} WHERE act_id = $1",
            act_id,
        )

        if not tree_row:
            raise ValueError("Структура акта не найдена")

        tree_data = JSONDBUtils.ensure_dict(tree_row["tree_data"])
        if tree_data is None:
            raise ValueError(
                "Структура акта имеет некорректный формат (ожидался JSON-объект)"
            )

        existing_points = ActDirectivesValidator.collect_node_numbers(tree_data)
        ActDirectivesValidator.validate_directives_points(
            directives,
            existing_points,
        )

    async def lock_act(
            self,
            act_id: int,
            username: str,
            duration_minutes: int | None = None
    ) -> dict:
        """
        Блокирует акт для редактирования.

        Returns:
            dict с информацией о блокировке

        Raises:
            ValueError: если акт уже заблокирован другим пользователем
        """
        # Если duration не передан - берём из конфига
        if duration_minutes is None:
            from app.core.config import get_settings
            settings = get_settings()
            duration_minutes = settings.act_lock_duration_minutes

        # Проверяем текущую блокировку
        lock_info = await self.conn.fetchrow(
            f"""
            SELECT locked_by, locked_at, lock_expires_at
            FROM {self.acts}
            WHERE id = $1
            """,
            act_id
        )

        now = datetime.now()

        if lock_info['locked_by']:
            # Акт заблокирован
            if lock_info['locked_by'] == username:
                # Заблокирован текущим пользователем - продлеваем
                lock_expires = now + timedelta(minutes=duration_minutes)

                await self.conn.execute(
                    f"""
                    UPDATE {self.acts}
                    SET lock_expires_at = $1
                    WHERE id = $2
                    """,
                    lock_expires,
                    act_id
                )

                logger.info(f"Блокировка акта ID={act_id} продлена для {username}")

                return {
                    "success": True,
                    "locked_until": lock_expires.isoformat(),
                    "message": "Блокировка продлена"
                }
            else:
                # Заблокирован другим пользователем
                if lock_info['lock_expires_at'] and lock_info['lock_expires_at'] > now:
                    # Блокировка еще активна - НЕ показываем время
                    raise ValueError(
                        f"Акт редактируется пользователем {lock_info['locked_by']}. "
                        f"Попробуйте открыть его позже."
                    )
                # Блокировка истекла - снимаем и блокируем заново

        # Устанавливаем новую блокировку
        lock_expires = now + timedelta(minutes=duration_minutes)

        await self.conn.execute(
            f"""
            UPDATE {self.acts}
            SET locked_by = $1,
                locked_at = $2,
                lock_expires_at = $3
            WHERE id = $4
            """,
            username,
            now,
            lock_expires,
            act_id
        )

        logger.info(f"Акт ID={act_id} заблокирован пользователем {username} до {lock_expires}")

        return {
            "success": True,
            "locked_until": lock_expires.isoformat(),
            "message": "Акт заблокирован для редактирования"
        }

    async def unlock_act(self, act_id: int, username: str) -> None:
        """Снимает блокировку с акта."""
        result = await self.conn.execute(
            f"""
            UPDATE {self.acts}
            SET locked_by = NULL,
                locked_at = NULL,
                lock_expires_at = NULL
            WHERE id = $1 AND locked_by = $2
            """,
            act_id,
            username
        )

        if result == "UPDATE 0":
            logger.warning(
                f"Попытка снять блокировку с акта ID={act_id} "
                f"пользователем {username}, который не владеет блокировкой"
            )
        else:
            logger.info(f"Блокировка снята с акта ID={act_id} пользователем {username}")

    async def extend_lock(
            self,
            act_id: int,
            username: str,
            duration_minutes: int | None = None
    ) -> dict:
        """
        Продлевает блокировку акта.

        Raises:
            ValueError: если пользователь не владеет блокировкой
        """
        # Если duration не передан - берём из конфига
        if duration_minutes is None:
            from app.core.config import get_settings
            settings = get_settings()
            duration_minutes = settings.act_lock_duration_minutes

        lock_info = await self.conn.fetchrow(
            f"""
            SELECT locked_by, lock_expires_at
            FROM {self.acts}
            WHERE id = $1
            """,
            act_id
        )

        if not lock_info['locked_by']:
            raise ValueError("Акт не заблокирован")

        if lock_info['locked_by'] != username:
            raise ValueError("Вы не владеете блокировкой этого акта")

        lock_expires = datetime.now() + timedelta(minutes=duration_minutes)

        await self.conn.execute(
            f"""
            UPDATE {self.acts}
            SET lock_expires_at = $1
            WHERE id = $2
            """,
            lock_expires,
            act_id
        )

        logger.info(f"Блокировка акта ID={act_id} продлена до {lock_expires}")

        return {
            "success": True,
            "locked_until": lock_expires.isoformat(),
            "message": "Блокировка продлена"
        }

    # -------------------------------------------------------------------------
    # СОЗДАНИЕ АКТА
    # -------------------------------------------------------------------------

    async def create_act(
            self,
            act_data: ActCreate,
            username: str,
            force_new_part: bool = False,
    ) -> ActResponse:
        """
        Создает новый акт с метаданными, аудиторской группой и поручениями.
        """
        async with self.conn.transaction():
            km_digit = KMUtils.extract_km_digits(act_data.km_number)
            km_info = await self.check_km_exists(act_data.km_number)

            # Определяем номер части
            if act_data.service_note:
                suffix = KMUtils.extract_service_note_suffix(act_data.service_note)
                if not suffix or not suffix.isdigit():
                    raise ValueError(
                        f"Некорректный формат служебной записки: {act_data.service_note}"
                    )

                part_number = int(suffix)

                # РУЧНАЯ ПРОВЕРКА УНИКАЛЬНОСТИ
                is_unique = await self._check_km_part_uniqueness(km_digit, part_number)
                if not is_unique:
                    raise ValueError(
                        f"Акт с КМ (цифры) {km_digit} и частью {part_number} уже существует"
                    )
            else:
                if km_info["exists"] and force_new_part:
                    part_number = km_info["next_part_no_sn"]
                elif km_info["exists"] and not force_new_part:
                    raise ValueError(
                        f"Акт с КМ '{act_data.km_number}' уже существует. "
                        f"Используйте force_new_part=True для создания новой части."
                    )
                else:
                    part_number = 1

            total_parts = km_info["total_parts"] + 1

            user_in_team = any(
                member.username == username for member in act_data.audit_team
            )
            if not user_in_team:
                raise ValueError("Пользователь должен быть членом аудиторской группы")

            act_id = await self.conn.fetchval(
                f"""
                INSERT INTO {self.acts} (
                    km_number, km_number_digit, part_number, total_parts, 
                    inspection_name, city, created_date,
                    order_number, order_date, is_process_based,
                    service_note, service_note_date,
                    created_by, inspection_start_date, inspection_end_date,
                    last_edited_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    $8, $9, $10,
                    $11, $12,
                    $13, $14, $15,
                    CURRENT_TIMESTAMP
                )
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
                act_data.inspection_end_date,
            )

            for idx, member in enumerate(act_data.audit_team):
                await self.conn.execute(
                    f"""
                    INSERT INTO {self.audit_team} (
                        act_id, role, full_name, position, username, order_index
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    act_id,
                    member.role,
                    member.full_name,
                    member.position,
                    member.username,
                    idx,
                )

            for idx, directive in enumerate(act_data.directives):
                await self.conn.execute(
                    f"""
                    INSERT INTO {self.directives} (
                        act_id, point_number, directive_number, order_index
                    )
                    VALUES ($1, $2, $3, $4)
                    """,
                    act_id,
                    directive.point_number,
                    directive.directive_number,
                    idx,
                )

            default_tree = {
                "id": "root",
                "label": act_data.inspection_name or "Акт",
                "children": [],
            }

            await self.conn.execute(
                f"""
                INSERT INTO {self.tree} (act_id, tree_data)
                VALUES ($1, $2)
                """,
                act_id,
                json.dumps(default_tree),
            )

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
            f"""
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
                a.created_at,
                a.service_note,
                MIN(atm.role) as user_role,
                a.locked_by,
                a.lock_expires_at,
                a.needs_created_date,
                a.needs_directive_number,
                a.needs_invoice_check,
                a.needs_service_note
            FROM {self.acts} a
            INNER JOIN {self.audit_team} atm ON a.id = atm.act_id
            WHERE atm.username = $1
            GROUP BY 
                a.id, 
                a.km_number, 
                a.part_number, 
                a.total_parts,
                a.inspection_name, 
                a.order_number,
                a.inspection_start_date, 
                a.inspection_end_date,
                a.last_edited_at,
                a.created_at,
                a.service_note,
                a.locked_by, 
                a.lock_expires_at,
                a.needs_created_date, 
                a.needs_directive_number,
                a.needs_invoice_check, 
                a.needs_service_note
            ORDER BY 
                COALESCE(a.last_edited_at, a.created_at) DESC,
                a.created_at DESC
            """,
            username,
        )

        now = datetime.now()

        return [
            ActListItem(
                id=row["id"],
                km_number=row["km_number"],
                part_number=row["part_number"],
                total_parts=row["total_parts"],
                inspection_name=row["inspection_name"],
                order_number=row["order_number"],
                inspection_start_date=row["inspection_start_date"],
                inspection_end_date=row["inspection_end_date"],
                last_edited_at=row["last_edited_at"],
                user_role=row["user_role"],
                service_note=row["service_note"],
                locked_by=row["locked_by"],
                is_locked=(
                        row["locked_by"] is not None and
                        row["lock_expires_at"] is not None and
                        row["lock_expires_at"] > now
                ),
                needs_created_date=row["needs_created_date"],
                needs_directive_number=row["needs_directive_number"],
                needs_invoice_check=row["needs_invoice_check"],
                needs_service_note=row["needs_service_note"],
            )
            for row in rows
        ]

    async def get_act_by_id(self, act_id: int) -> ActResponse:
        """Получает полную информацию об акте по его ID."""
        act_row = await self.conn.fetchrow(
            f"""
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
            FROM {self.acts}
            WHERE id = $1
            """,
            act_id,
        )

        if not act_row:
            raise ValueError(f"Акт ID={act_id} не найден")

        team_rows = await self.conn.fetch(
            f"""
            SELECT role, full_name, position, username
            FROM {self.audit_team}
            WHERE act_id = $1
            ORDER BY order_index
            """,
            act_id,
        )

        audit_team = [
            AuditTeamMember(
                role=row["role"],
                full_name=row["full_name"],
                position=row["position"],
                username=row["username"],
            )
            for row in team_rows
        ]

        directive_rows = await self.conn.fetch(
            f"""
            SELECT point_number, directive_number
            FROM {self.directives}
            WHERE act_id = $1
            ORDER BY order_index
            """,
            act_id,
        )

        directives = [
            ActDirective(
                point_number=row["point_number"],
                directive_number=row["directive_number"],
            )
            for row in directive_rows
        ]

        return ActResponse(
            id=act_row["id"],
            km_number=act_row["km_number"],
            part_number=act_row["part_number"],
            total_parts=act_row["total_parts"],
            inspection_name=act_row["inspection_name"],
            city=act_row["city"],
            created_date=act_row["created_date"],
            order_number=act_row["order_number"],
            order_date=act_row["order_date"],
            is_process_based=act_row["is_process_based"],
            service_note=act_row["service_note"],
            service_note_date=act_row["service_note_date"],
            inspection_start_date=act_row["inspection_start_date"],
            inspection_end_date=act_row["inspection_end_date"],
            audit_team=audit_team,
            directives=directives,
            needs_created_date=act_row["needs_created_date"],
            needs_directive_number=act_row["needs_directive_number"],
            needs_invoice_check=act_row["needs_invoice_check"],
            needs_service_note=act_row["needs_service_note"],
            created_at=act_row["created_at"],
            updated_at=act_row["updated_at"],
            created_by=act_row["created_by"],
            last_edited_by=act_row["last_edited_by"],
            last_edited_at=act_row["last_edited_at"],
        )

    # -------------------------------------------------------------------------
    # ОБНОВЛЕНИЕ МЕТАДАННЫХ
    # -------------------------------------------------------------------------

    async def update_act_metadata(
            self,
            act_id: int,
            act_update: ActUpdate,
            username: str,
    ) -> ActResponse:
        """
        Обновляет метаданные акта (частичное обновление).
        """
        async with self.conn.transaction():
            current_act = await self.get_act_by_id(act_id)
            old_km_number = current_act.km_number
            old_km_digit = KMUtils.extract_km_digits(old_km_number)
            old_service_note = current_act.service_note
            old_part_number = current_act.part_number

            if act_update.directives is not None:
                await self._validate_directives_points(act_id, act_update.directives)

            km_changed = (
                    act_update.km_number is not None
                    and act_update.km_number != old_km_number
            )

            service_note_changed = (
                    act_update.service_note is not None
                    and act_update.service_note != old_service_note
            )

            service_note_removed = (
                    old_service_note is not None and act_update.service_note is None
            )

            # Определяем новые значения КМ и части
            new_km_digit = (
                KMUtils.extract_km_digits(act_update.km_number)
                if act_update.km_number
                else old_km_digit
            )

            new_part_number = old_part_number

            # ЛОГИКА СЛУЖЕБКИ / ЧАСТИ
            if service_note_changed or service_note_removed:
                if act_update.service_note:
                    suffix = KMUtils.extract_service_note_suffix(act_update.service_note)
                    if not suffix or not suffix.isdigit():
                        raise ValueError(
                            f"Некорректный формат служебной записки: {act_update.service_note}"
                        )
                    new_part_number = int(suffix)
                else:
                    # СЗ удалена - ищем свободный номер
                    new_part_number = await self._find_free_part_number(new_km_digit, act_id)
                    act_update.service_note = None
                    act_update.service_note_date = None

            if km_changed and not (service_note_changed or service_note_removed):
                # КМ изменился, но СЗ не трогали
                if current_act.service_note or act_update.service_note:
                    # Есть СЗ - часть из неё
                    if act_update.part_number is not None:
                        new_part_number = act_update.part_number
                else:
                    # Нет СЗ - ищем свободный номер
                    new_part_number = await self._find_free_part_number(new_km_digit, act_id)

            # ПРОВЕРКА УНИКАЛЬНОСТИ пары (km_digit, part_number)
            if km_changed or service_note_changed or service_note_removed or (act_update.part_number is not None):
                is_unique = await self._check_km_part_uniqueness(
                    new_km_digit,
                    new_part_number,
                    exclude_act_id=act_id
                )

                if not is_unique:
                    raise ValueError(
                        f"Акт с КМ (цифры) {new_km_digit} и частью {new_part_number} уже существует"
                    )

            # ОБЫЧНЫЙ UPDATE - все колонки можно обновлять
            updates: list[str] = []
            values: list[object] = []
            param_idx = 1

            if act_update.km_number is not None:
                updates.append(f"km_number = ${param_idx}")
                values.append(act_update.km_number)
                param_idx += 1

                updates.append(f"km_number_digit = ${param_idx}")
                values.append(new_km_digit)
                param_idx += 1

            if new_part_number != old_part_number:
                updates.append(f"part_number = ${param_idx}")
                values.append(new_part_number)
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

            if service_note_changed or service_note_removed:
                updates.append(f"service_note = ${param_idx}")
                values.append(act_update.service_note)
                param_idx += 1

                updates.append(f"service_note_date = ${param_idx}")
                values.append(act_update.service_note_date)
                param_idx += 1

            # АВТО-СБРОС СЛУЖЕБНЫХ ФЛАГОВ
            needs_created_date = getattr(current_act, "needs_created_date", None)
            needs_directive_number = getattr(current_act, "needs_directive_number", None)
            needs_service_note = getattr(current_act, "needs_service_note", None)

            if needs_created_date and act_update.created_date is not None:
                needs_created_date = False

            if needs_directive_number and act_update.directives is not None and len(act_update.directives) > 0:
                all_have_numbers = all(
                    d.directive_number and d.directive_number.strip()
                    for d in act_update.directives
                )
                if all_have_numbers:
                    needs_directive_number = False

            if needs_service_note and act_update.service_note is not None:
                if act_update.service_note.strip():
                    needs_service_note = False

            if needs_created_date is not None and needs_created_date != current_act.needs_created_date:
                updates.append(f"needs_created_date = ${param_idx}")
                values.append(needs_created_date)
                param_idx += 1

            if needs_directive_number is not None and needs_directive_number != current_act.needs_directive_number:
                updates.append(f"needs_directive_number = ${param_idx}")
                values.append(needs_directive_number)
                param_idx += 1

            if needs_service_note is not None and needs_service_note != current_act.needs_service_note:
                updates.append(f"needs_service_note = ${param_idx}")
                values.append(needs_service_note)
                param_idx += 1

            # Служебные поля
            updates.append(f"last_edited_by = ${param_idx}")
            values.append(username)
            param_idx += 1

            updates.append("last_edited_at = CURRENT_TIMESTAMP")

            if updates:
                values.append(act_id)

                await self.conn.execute(
                    f"""
                    UPDATE {self.acts}
                    SET {', '.join(updates)}
                    WHERE id = ${param_idx}
                    """,
                    *values,
                )

            # Аудиторская группа
            if act_update.audit_team is not None:
                await self.conn.execute(
                    f"DELETE FROM {self.audit_team} WHERE act_id = $1",
                    act_id,
                )

                for idx, member in enumerate(act_update.audit_team):
                    await self.conn.execute(
                        f"""
                        INSERT INTO {self.audit_team} (
                            act_id, role, full_name, position, username, order_index
                        )
                        VALUES ($1, $2, $3, $4, $5, $6)
                        """,
                        act_id,
                        member.role,
                        member.full_name,
                        member.position,
                        member.username,
                        idx,
                    )

            # Поручения
            if act_update.directives is not None:
                await self.conn.execute(
                    f"DELETE FROM {self.directives} WHERE act_id = $1",
                    act_id,
                )

                for idx, directive in enumerate(act_update.directives):
                    await self.conn.execute(
                        f"""
                        INSERT INTO {self.directives} (
                            act_id, point_number, directive_number, order_index
                        )
                        VALUES ($1, $2, $3, $4)
                        """,
                        act_id,
                        directive.point_number,
                        directive.directive_number,
                        idx,
                    )

            # Обновление total_parts
            if km_changed:
                await self._update_total_parts_for_km(old_km_digit)

            await self._update_total_parts_for_km(new_km_digit)

            logger.info(f"Обновлены метаданные акта ID={act_id}")

            return await self.get_act_by_id(act_id)

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
        import re as _re

        match = _re.search(r"^(.+?)\s*\(Копия\s*(\d*)\)\s*$", original_name)

        if match:
            base_name = match.group(1).strip()
            existing_num = match.group(2)

            if existing_num:
                next_num = int(existing_num) + 1
            else:
                next_num = 2
        else:
            base_name = original_name.strip()
            next_num = None

        attempt = 0
        max_attempts = 100

        while attempt < max_attempts:
            if next_num is None:
                new_name = f"{base_name} (Копия)"
            else:
                new_name = f"{base_name} (Копия {next_num})"

            exists = await self.conn.fetchval(
                f"SELECT EXISTS(SELECT 1 FROM {self.acts} WHERE inspection_name = $1)",
                new_name,
            )

            if not exists:
                return new_name

            if next_num is None:
                next_num = 2
            else:
                next_num += 1

            attempt += 1

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"{base_name} (Копия {timestamp})"

    async def duplicate_act(
            self,
            act_id: int,
            username: str,
    ) -> ActResponse:
        """
        Создает дубликат акта.

        Логика дублирования:
        - Генерируется уникальное название (Копия, Копия 2, ...)
        - КМ берётся из оригинала БЕЗ изменений
        - Создаётся как новая часть существующего КМ (force_new_part=True)
        - Служебная записка НЕ копируется (акт без СЗ)
        - Команда НЕ копируется - создаётся новая с пользователем как Редактором
        - Поручения НЕ копируются
        """
        original = await self.get_act_by_id(act_id)
        km_digit = KMUtils.extract_km_digits(original.km_number)

        new_inspection_name = await self._generate_unique_copy_name(
            original.inspection_name
        )

        # Формируем команду для нового акта
        # Порядок: Куратор, Руководитель, Редактор (при необходимости)
        new_team = []

        # Находим роль текущего пользователя в оригинале
        user_original_role = None
        user_full_name = username  # По умолчанию используем username
        user_position = "Аудитор"  # По умолчанию

        for member in original.audit_team:
            if member.username == username:
                user_original_role = member.role
                user_full_name = member.full_name
                user_position = member.position
                break

        # 1. Куратор: пользователь или заглушка
        if user_original_role == "Куратор":
            new_team.append(AuditTeamMember(
                username=username,
                role="Куратор",
                full_name=user_full_name,
                position=user_position
            ))
        else:
            new_team.append(AuditTeamMember(
                username="00000000",
                role="Куратор",
                full_name="Требуется назначить",
                position="—"
            ))

        # 2. Руководитель: пользователь или заглушка
        if user_original_role == "Руководитель":
            new_team.append(AuditTeamMember(
                username=username,
                role="Руководитель",
                full_name=user_full_name,
                position=user_position
            ))
        else:
            new_team.append(AuditTeamMember(
                username="00000000",
                role="Руководитель",
                full_name="Требуется назначить",
                position="—"
            ))

        # 3. Редактор: добавляем если пользователь не Куратор и не Руководитель
        if user_original_role not in ("Куратор", "Руководитель"):
            new_team.append(AuditTeamMember(
                username=username,
                role="Редактор",
                full_name=user_full_name,
                position=user_position
            ))

        new_act_data = ActCreate(
            km_number=original.km_number,
            part_number=1,
            total_parts=1,
            inspection_name=new_inspection_name,
            city=original.city,
            created_date=original.created_date,
            order_number=original.order_number,
            order_date=original.order_date,
            audit_team=new_team,  # Пользователь + заглушки для обязательных ролей
            inspection_start_date=original.inspection_start_date,
            inspection_end_date=original.inspection_end_date,
            is_process_based=original.is_process_based,
            directives=[],  # Поручения НЕ копируются
            service_note=None,
            service_note_date=None,
        )

        new_act = await self.create_act(new_act_data, username, force_new_part=True)

        tree_row = await self.conn.fetchrow(
            f"SELECT tree_data FROM {self.tree} WHERE act_id = $1",
            act_id,
        )

        if tree_row:
            await self.conn.execute(
                f"""
                UPDATE {self.tree}
                SET tree_data = $1
                WHERE act_id = $2
                """,
                tree_row["tree_data"],
                new_act.id,
            )

        tables = await self.conn.fetch(
            f"SELECT * FROM {self.tables} WHERE act_id = $1",
            act_id,
        )

        for table in tables:
            await self.conn.execute(
                f"""
                INSERT INTO {self.tables} (
                    act_id, table_id, node_id, node_number, table_label,
                    grid_data, col_widths, is_protected, is_deletable,
                    is_metrics_table, is_main_metrics_table,
                    is_regular_risk_table, is_operational_risk_table
                )
                VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9,
                    $10, $11,
                    $12, $13
                )
                """,
                new_act.id,
                table["table_id"],
                table["node_id"],
                table["node_number"],
                table["table_label"],
                table["grid_data"],
                table["col_widths"],
                table["is_protected"],
                table["is_deletable"],
                table["is_metrics_table"],
                table["is_main_metrics_table"],
                table["is_regular_risk_table"],
                table["is_operational_risk_table"],
            )

        textblocks = await self.conn.fetch(
            f"SELECT * FROM {self.textblocks} WHERE act_id = $1",
            act_id,
        )

        for tb in textblocks:
            await self.conn.execute(
                f"""
                INSERT INTO {self.textblocks} (
                    act_id, textblock_id, node_id, node_number, content, formatting
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                new_act.id,
                tb["textblock_id"],
                tb["node_id"],
                tb["node_number"],
                tb["content"],
                tb["formatting"],
            )

        violations = await self.conn.fetch(
            f"SELECT * FROM {self.violations} WHERE act_id = $1",
            act_id,
        )

        for v in violations:
            await self.conn.execute(
                f"""
                INSERT INTO {self.violations} (
                    act_id, violation_id, node_id, node_number, violated, established,
                    description_list, additional_content, reasons, consequences,
                    responsible, recommendations
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10,
                    $11, $12
                )
                """,
                new_act.id,
                v["violation_id"],
                v["node_id"],
                v["node_number"],
                v["violated"],
                v["established"],
                v["description_list"],
                v["additional_content"],
                v["reasons"],
                v["consequences"],
                v["responsible"],
                v["recommendations"],
            )

        await self._update_total_parts_for_km(km_digit)

        logger.info(
            f"Создан дубликат акта: ID={act_id} -> ID={new_act.id}, "
            f"КМ={original.km_number} (цифры={km_digit}), "
            f"название='{new_inspection_name}'"
        )

        return await self.get_act_by_id(new_act.id)

    async def delete_act(self, act_id: int) -> None:
        """
        Удаляет акт и все связанные данные.

        Использует метод адаптера для корректного удаления
        в зависимости от типа СУБД.
        """
        act = await self.get_act_by_id(act_id)
        km_digit = KMUtils.extract_km_digits(act.km_number)

        async with self.conn.transaction():
            # Используем адаптер для удаления
            await self.adapter.delete_act_cascade(self.conn, act_id)

            # Обновляем total_parts
            await self._update_total_parts_for_km(km_digit)

            logger.info(
                f"Акт ID={act_id} (КМ={act.km_number}, часть {act.part_number}, "
                f"СЗ={act.service_note}) удален через {self.adapter.__class__.__name__}"
            )

    # -------------------------------------------------------------------------
    # ДОСТУП
    # -------------------------------------------------------------------------

    async def check_user_access(self, act_id: int, username: str) -> bool:
        """Проверяет имеет ли пользователь доступ к акту."""
        result = await self.conn.fetchval(
            f"""
            SELECT EXISTS(
                SELECT 1
                FROM {self.audit_team}
                WHERE act_id = $1 AND username = $2
            )
            """,
            act_id,
            username,
        )

        return bool(result)

    async def get_user_edit_permission(self, act_id: int, username: str) -> dict:
        """
        Проверяет права пользователя на редактирование акта.

        Роли с правом редактирования: Куратор, Руководитель, Редактор
        Роль только для просмотра: Участник

        Args:
            act_id: ID акта
            username: Имя пользователя

        Returns:
            dict с полями:
                - has_access: есть ли доступ к акту
                - can_edit: может ли редактировать
                - role: роль пользователя в команде
        """
        row = await self.conn.fetchrow(
            f"""
            SELECT role FROM {self.audit_team}
            WHERE act_id = $1 AND username = $2
            """,
            act_id,
            username,
        )

        if not row:
            return {"has_access": False, "can_edit": False, "role": None}

        role = row["role"]
        can_edit = role in ("Куратор", "Руководитель", "Редактор")
        return {"has_access": True, "can_edit": can_edit, "role": role}
