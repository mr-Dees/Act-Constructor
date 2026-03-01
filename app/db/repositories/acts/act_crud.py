"""
Репозиторий CRUD операций с актами.
"""

import json
import logging
from datetime import datetime

import asyncpg

from app.core.exceptions import ActNotFoundError, ActValidationError, KmConflictError
from app.db.repositories.base import BaseRepository
from app.db.utils import KMUtils, JSONDBUtils, ActDirectivesValidator
from app.services.audit_id_service import AuditIdService
from app.schemas.acts.act_metadata import (
    ActCreate,
    ActUpdate,
    ActListItem,
    ActResponse,
    AuditTeamMember,
    ActDirective,
)

logger = logging.getLogger("act_constructor.db.repository.crud")


class ActCrudRepository(BaseRepository):
    """CRUD операции с актами и их связанными сущностями."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
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

        Returns:
            Словарь с информацией:
            - exists: bool
            - total_parts: int
            - current_parts: int (backward compat)
            - next_part_no_sn: int
            - has_service_notes: bool
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

        max_part_no_sn = row["max_part_no_sn"] or 0
        next_part_no_sn = max_part_no_sn + 1 if max_part_no_sn > 0 else 1

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
        """Обновляет total_parts для всех актов с данным КМ номером."""
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
        """Находит первый свободный номер части для актов."""
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
    ) -> dict | None:
        """Проверяет что все пункты поручений существуют в структуре акта."""
        if not directives:
            return None

        tree_row = await self.conn.fetchrow(
            f"SELECT tree_data FROM {self.tree} WHERE act_id = $1",
            act_id,
        )

        if not tree_row:
            raise ActNotFoundError("Структура акта не найдена")

        tree_data = JSONDBUtils.ensure_dict(tree_row["tree_data"])
        if tree_data is None:
            raise ActValidationError("Структура акта имеет некорректный формат (ожидался JSON-объект)")

        existing_points = ActDirectivesValidator.collect_node_numbers(tree_data)
        ActDirectivesValidator.validate_directives_points(
            directives,
            existing_points,
        )

        return tree_data

    # -------------------------------------------------------------------------
    # СОЗДАНИЕ АКТА
    # -------------------------------------------------------------------------

    async def create_act(
            self,
            act_data: ActCreate,
            username: str,
            force_new_part: bool = False,
    ) -> ActResponse:
        """Создает новый акт с метаданными, аудиторской группой и поручениями."""
        async with self.conn.transaction():
            km_digit = KMUtils.extract_km_digits(act_data.km_number)
            km_info = await self.check_km_exists(act_data.km_number)

            if act_data.service_note:
                suffix = KMUtils.extract_service_note_suffix(act_data.service_note)
                if not suffix or not suffix.isdigit():
                    raise ActValidationError(f"Некорректный формат служебной записки: {act_data.service_note}")

                part_number = int(suffix)

                is_unique = await self._check_km_part_uniqueness(km_digit, part_number)
                if not is_unique:
                    raise KmConflictError(
                        f"Акт с КМ (цифры) {km_digit} и частью {part_number} уже существует",
                        km_number=act_data.km_number,
                        current_parts=km_info["current_parts"],
                        next_part=part_number,
                    )
            else:
                if km_info["exists"] and force_new_part:
                    part_number = km_info["next_part_no_sn"]
                elif km_info["exists"] and not force_new_part:
                    raise KmConflictError(
                        f"Акт с КМ '{act_data.km_number}' уже существует",
                        km_number=act_data.km_number,
                        current_parts=km_info["current_parts"],
                        next_part=km_info["next_part"],
                    )
                else:
                    part_number = 1

            total_parts = km_info["total_parts"] + 1

            user_in_team = any(
                member.username == username for member in act_data.audit_team
            )
            if not user_in_team:
                raise ActValidationError("Пользователь должен быть членом аудиторской группы")

            audit_act_id = await AuditIdService.generate_audit_act_id()

            act_id = await self.conn.fetchval(
                f"""
                INSERT INTO {self.acts} (
                    km_number, km_number_digit, part_number, total_parts,
                    inspection_name, city, created_date,
                    order_number, order_date, is_process_based,
                    service_note, service_note_date,
                    audit_act_id,
                    created_by, inspection_start_date, inspection_end_date,
                    last_edited_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    $8, $9, $10,
                    $11, $12,
                    $13,
                    $14, $15, $16,
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
                audit_act_id,
                username,
                act_data.inspection_start_date,
                act_data.inspection_end_date,
            )

            for idx, member in enumerate(act_data.audit_team):
                await self.conn.execute(
                    f"""
                    INSERT INTO {self.audit_team} (
                        act_id, audit_act_id, role, full_name, position, username, order_index
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    """,
                    act_id,
                    audit_act_id,
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
                        act_id, audit_act_id, point_number, node_id,
                        directive_number, order_index
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    act_id,
                    audit_act_id,
                    directive.point_number,
                    directive.node_id,
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
                a.audit_act_id,
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
                a.audit_act_id,
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
                audit_act_id=row["audit_act_id"],
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
                audit_act_id,
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
            raise ActNotFoundError(f"Акт ID={act_id} не найден")

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
            SELECT point_number, node_id, directive_number
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
                node_id=row["node_id"],
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
            audit_act_id=act_row["audit_act_id"],
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
        """Обновляет метаданные акта (частичное обновление)."""
        async with self.conn.transaction():
            current_act = await self.get_act_by_id(act_id)
            old_km_number = current_act.km_number
            old_km_digit = KMUtils.extract_km_digits(old_km_number)
            old_service_note = current_act.service_note
            old_part_number = current_act.part_number

            cur_audit_act_id = await self.conn.fetchval(
                f"SELECT audit_act_id FROM {self.acts} WHERE id = $1",
                act_id,
            )

            tree_data = None
            if act_update.directives is not None:
                tree_data = await self._validate_directives_points(act_id, act_update.directives)

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

            new_km_digit = (
                KMUtils.extract_km_digits(act_update.km_number)
                if act_update.km_number
                else old_km_digit
            )

            new_part_number = old_part_number

            if service_note_changed or service_note_removed:
                if act_update.service_note:
                    suffix = KMUtils.extract_service_note_suffix(act_update.service_note)
                    if not suffix or not suffix.isdigit():
                        raise ActValidationError(f"Некорректный формат служебной записки: {act_update.service_note}")
                    new_part_number = int(suffix)
                else:
                    new_part_number = await self._find_free_part_number(new_km_digit, act_id)
                    act_update.service_note = None
                    act_update.service_note_date = None

            if km_changed and not (service_note_changed or service_note_removed):
                if current_act.service_note or act_update.service_note:
                    if act_update.part_number is not None:
                        new_part_number = act_update.part_number
                else:
                    new_part_number = await self._find_free_part_number(new_km_digit, act_id)

            if km_changed or service_note_changed or service_note_removed or (act_update.part_number is not None):
                is_unique = await self._check_km_part_uniqueness(
                    new_km_digit,
                    new_part_number,
                    exclude_act_id=act_id
                )

                if not is_unique:
                    raise KmConflictError(
                        f"Акт с КМ (цифры) {new_km_digit} и частью {new_part_number} уже существует",
                        km_number=act_update.km_number or current_act.km_number,
                    )

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

            if act_update.audit_team is not None:
                await self.conn.execute(
                    f"DELETE FROM {self.audit_team} WHERE act_id = $1",
                    act_id,
                )

                for idx, member in enumerate(act_update.audit_team):
                    await self.conn.execute(
                        f"""
                        INSERT INTO {self.audit_team} (
                            act_id, audit_act_id, role, full_name, position, username, order_index
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        """,
                        act_id,
                        cur_audit_act_id,
                        member.role,
                        member.full_name,
                        member.position,
                        member.username,
                        idx,
                    )

            if act_update.directives is not None:
                await self.conn.execute(
                    f"DELETE FROM {self.directives} WHERE act_id = $1",
                    act_id,
                )

                audit_point_map = (
                    ActDirectivesValidator.build_audit_point_map(tree_data)
                    if tree_data else {}
                )

                for idx, directive in enumerate(act_update.directives):
                    audit_point_id = (
                        audit_point_map.get(directive.node_id)
                        if directive.node_id else None
                    )
                    await self.conn.execute(
                        f"""
                        INSERT INTO {self.directives} (
                            act_id, audit_act_id, audit_point_id,
                            point_number, node_id, directive_number, order_index
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        """,
                        act_id,
                        cur_audit_act_id,
                        audit_point_id,
                        directive.point_number,
                        directive.node_id,
                        directive.directive_number,
                        idx,
                    )

            if km_changed:
                await self._update_total_parts_for_km(old_km_digit)

            await self._update_total_parts_for_km(new_km_digit)

            logger.info(f"Обновлены метаданные акта ID={act_id}")

            return await self.get_act_by_id(act_id)

    # -------------------------------------------------------------------------
    # ДУБЛИРОВАНИЕ И УДАЛЕНИЕ
    # -------------------------------------------------------------------------

    async def _generate_unique_copy_name(self, original_name: str) -> str:
        """Генерирует уникальное название для копии акта."""
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
        """Создает дубликат акта."""
        original = await self.get_act_by_id(act_id)
        km_digit = KMUtils.extract_km_digits(original.km_number)

        new_inspection_name = await self._generate_unique_copy_name(
            original.inspection_name
        )

        new_team = []

        user_original_role = None
        user_full_name = username
        user_position = "Аудитор"

        for member in original.audit_team:
            if member.username == username:
                user_original_role = member.role
                user_full_name = member.full_name
                user_position = member.position
                break

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
            audit_team=new_team,
            inspection_start_date=original.inspection_start_date,
            inspection_end_date=original.inspection_end_date,
            is_process_based=original.is_process_based,
            directives=[],
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
        """Удаляет акт и все связанные данные."""
        act = await self.get_act_by_id(act_id)
        km_digit = KMUtils.extract_km_digits(act.km_number)

        async with self.conn.transaction():
            await self.adapter.delete_act_cascade(self.conn, act_id)

            await self._update_total_parts_for_km(km_digit)

            logger.info(
                f"Акт ID={act_id} (КМ={act.km_number}, часть {act.part_number}, "
                f"СЗ={act.service_note}) удален через {self.adapter.__class__.__name__}"
            )
