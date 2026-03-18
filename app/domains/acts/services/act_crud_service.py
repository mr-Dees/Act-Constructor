"""
Сервис CRUD операций с актами.

Создание, чтение, обновление, удаление, дублирование актов.
"""

import logging
import re
from datetime import datetime

import asyncpg

from app.core.config import Settings
from app.domains.acts.exceptions import (
    ActLockError,
    ActValidationError,
    KmConflictError,
)
from app.domains.acts.utils import KMUtils, ActDirectivesValidator
from app.domains.acts.schemas.act_metadata import (
    ActCreate,
    ActListItem,
    ActResponse,
    ActUpdate,
    AuditTeamMember,
)
from app.services.audit_id_service import AuditIdService
from app.domains.acts.repositories.act_crud import ActCrudRepository
from app.domains.acts.repositories.act_lock import ActLockRepository
from app.domains.acts.repositories.act_access import ActAccessRepository
from app.domains.acts.repositories.act_audit_log import ActAuditLogRepository
from app.domains.acts.services.access_guard import AccessGuard

logger = logging.getLogger("act_constructor.service.acts.crud")

PLACEHOLDER_USERNAME = "00000000"
PLACEHOLDER_FULL_NAME = "Требуется назначить"


class ActCrudService:
    """CRUD операции с актами."""

    def __init__(
        self,
        conn: asyncpg.Connection,
        settings: Settings,
        *,
        crud: ActCrudRepository | None = None,
        lock: ActLockRepository | None = None,
        access: ActAccessRepository | None = None,
    ):
        self.conn = conn
        self.settings = settings
        self._crud = crud or ActCrudRepository(conn)
        self._lock = lock or ActLockRepository(conn)
        self._access = access or ActAccessRepository(conn)
        self.guard = AccessGuard(self._access, self._lock)
        self._audit = ActAuditLogRepository(conn)

    # -------------------------------------------------------------------------
    # SIMPLE CRUD
    # -------------------------------------------------------------------------

    async def list_acts(self, username: str) -> list[ActListItem]:
        """Получает список актов пользователя."""
        acts = await self._crud.get_user_acts(username)
        logger.info(f"Получен список актов для {username}: {len(acts)} шт.")
        return acts

    async def get_act(self, act_id: int, username: str) -> ActResponse:
        """Получает полную информацию об акте."""
        await self.guard.require_access(act_id, username)
        return await self._crud.get_act_by_id(act_id)

    async def delete_act(self, act_id: int, username: str) -> dict:
        """Удаляет акт и все связанные данные."""
        await self.guard.require_edit_permission(act_id, username)

        async with self.conn.transaction():
            act = await self._crud.get_act_by_id(act_id)

            # Проверяем что акт не заблокирован другим пользователем
            lock_info = await self._lock.get_lock_info(act_id)
            if (
                lock_info
                and lock_info["locked_by"]
                and lock_info["locked_by"] != username
            ):
                raise ActLockError(
                    f"Акт заблокирован пользователем {lock_info['locked_by']}",
                    locked_by=lock_info["locked_by"],
                    locked_until=str(lock_info["lock_expires_at"]),
                )

            km_digit = KMUtils.extract_km_digits(act.km_number)

            await self._audit.log("delete", username, act_id, {
                "km_number": act.km_number,
                "part_number": act.part_number,
            })

            await self._crud.delete_by_id(act_id)
            await self._crud.update_total_parts_for_km(km_digit)

            logger.info(
                f"Удален акт ID={act_id} (КМ={act.km_number}, "
                f"часть {act.part_number}) пользователем {username}"
            )

        return {"success": True, "message": "Акт успешно удален"}

    async def check_km_exists(self, km_number: str) -> dict[str, object]:
        """Проверяет существование актов с данным КМ номером."""
        return await self._crud.check_km_exists(km_number)

    async def generate_audit_point_ids(
        self, act_id: int, node_ids: list[str], username: str,
    ) -> dict[str, str]:
        """Генерирует audit_point_id для списка узлов дерева акта."""
        await self.guard.require_access(act_id, username)
        return await AuditIdService.generate_audit_point_ids(node_ids)

    # -------------------------------------------------------------------------
    # CREATE ACT
    # -------------------------------------------------------------------------

    async def create_act(
        self, act_data: ActCreate, username: str, force_new_part: bool = False,
    ) -> ActResponse:
        """Создает новый акт с метаданными, аудиторской группой и поручениями."""
        async with self.conn.transaction():
            km_digit = KMUtils.extract_km_digits(act_data.km_number)
            km_info = await self._crud.check_km_exists(act_data.km_number)

            if act_data.service_note:
                suffix = KMUtils.extract_service_note_suffix(act_data.service_note)
                if not suffix or not suffix.isdigit():
                    raise ActValidationError(
                        f"Некорректный формат служебной записки: {act_data.service_note}"
                    )
                part_number = int(suffix)

                is_unique = await self._crud.check_km_part_uniqueness(km_digit, part_number)
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

            try:
                act_id = await self._crud.insert_act(
                    km_number=act_data.km_number,
                    km_digit=km_digit,
                    part_number=part_number,
                    total_parts=total_parts,
                    inspection_name=act_data.inspection_name,
                    city=act_data.city,
                    created_date=act_data.created_date,
                    order_number=act_data.order_number,
                    order_date=act_data.order_date,
                    is_process_based=act_data.is_process_based,
                    service_note=act_data.service_note,
                    service_note_date=act_data.service_note_date,
                    audit_act_id=audit_act_id,
                    created_by=username,
                    inspection_start_date=act_data.inspection_start_date,
                    inspection_end_date=act_data.inspection_end_date,
                )
            except asyncpg.UniqueViolationError:
                raise KmConflictError(
                    f"Акт с КМ (цифры) {km_digit} и частью {part_number} уже существует "
                    f"(параллельное создание)",
                    km_number=act_data.km_number,
                    current_parts=km_info["current_parts"],
                    next_part=part_number,
                )

            await self._crud.insert_team_members_batch(
                act_id, audit_act_id, act_data.audit_team
            )
            await self._crud.insert_directives_batch(
                act_id, audit_act_id, act_data.directives
            )

            default_tree = {
                "id": "root",
                "label": act_data.inspection_name or "Акт",
                "children": [],
            }
            await self._crud.insert_default_tree(act_id, default_tree)

            await self._crud.update_total_parts_for_km(km_digit)

            logger.info(
                f"Создан акт ID={act_id}, КМ={act_data.km_number}, "
                f"часть {part_number}/{total_parts}, СЗ={act_data.service_note}"
            )

            await self._audit.log("create", username, act_id, {
                "km_number": act_data.km_number,
                "part_number": part_number,
            })

            return await self._crud.get_act_by_id(act_id)

    # -------------------------------------------------------------------------
    # UPDATE METADATA
    # -------------------------------------------------------------------------

    async def update_act_metadata(
        self, act_id: int, act_update: ActUpdate, username: str,
    ) -> ActResponse:
        """Обновляет метаданные акта (частичное обновление)."""
        await self.guard.require_edit_permission(act_id, username)

        sent_fields = act_update.model_fields_set

        async with self.conn.transaction():
            current_act = await self._crud.get_act_by_id_for_update(act_id)
            old_km_number = current_act.km_number
            old_km_digit = KMUtils.extract_km_digits(old_km_number)
            old_service_note = current_act.service_note
            old_part_number = current_act.part_number

            cur_audit_act_id = await self._crud.get_audit_act_id(act_id)

            tree_data = None
            if act_update.directives is not None:
                tree_data = await self._crud.validate_directives_points(
                    act_id, act_update.directives
                )

            km_changed = (
                "km_number" in sent_fields
                and act_update.km_number is not None
                and act_update.km_number != old_km_number
            )
            service_note_changed = (
                "service_note" in sent_fields
                and act_update.service_note is not None
                and act_update.service_note != old_service_note
            )
            service_note_removed = (
                "service_note" in sent_fields
                and act_update.service_note is None
                and old_service_note is not None
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
                        raise ActValidationError(
                            f"Некорректный формат служебной записки: {act_update.service_note}"
                        )
                    new_part_number = int(suffix)
                else:
                    new_part_number = await self._crud.find_free_part_number(
                        new_km_digit, act_id
                    )
                    act_update.service_note = None
                    act_update.service_note_date = None

            if km_changed and not (service_note_changed or service_note_removed):
                if current_act.service_note or act_update.service_note:
                    if act_update.part_number is not None:
                        new_part_number = act_update.part_number
                else:
                    new_part_number = await self._crud.find_free_part_number(
                        new_km_digit, act_id
                    )

            if (
                km_changed
                or service_note_changed
                or service_note_removed
                or (act_update.part_number is not None)
            ):
                is_unique = await self._crud.check_km_part_uniqueness(
                    new_km_digit, new_part_number, exclude_act_id=act_id
                )
                if not is_unique:
                    raise KmConflictError(
                        f"Акт с КМ (цифры) {new_km_digit} и частью {new_part_number} уже существует",
                        km_number=act_update.km_number or current_act.km_number,
                    )

            # Формируем динамический UPDATE
            updates: list[str] = []
            values: list = []
            param_idx = 1

            def _add(col, val):
                nonlocal param_idx
                updates.append(f"{col} = ${param_idx}")
                values.append(val)
                param_idx += 1

            if "km_number" in sent_fields and act_update.km_number is not None:
                _add("km_number", act_update.km_number)
                _add("km_number_digit", new_km_digit)
            if new_part_number != old_part_number:
                _add("part_number", new_part_number)
            if "inspection_name" in sent_fields and act_update.inspection_name is not None:
                _add("inspection_name", act_update.inspection_name)
            if "city" in sent_fields and act_update.city is not None:
                _add("city", act_update.city)
            if "created_date" in sent_fields:
                _add("created_date", act_update.created_date)
            if "order_number" in sent_fields and act_update.order_number is not None:
                _add("order_number", act_update.order_number)
            if "order_date" in sent_fields and act_update.order_date is not None:
                _add("order_date", act_update.order_date)
            if "inspection_start_date" in sent_fields and act_update.inspection_start_date is not None:
                _add("inspection_start_date", act_update.inspection_start_date)
            if "inspection_end_date" in sent_fields and act_update.inspection_end_date is not None:
                _add("inspection_end_date", act_update.inspection_end_date)
            if "is_process_based" in sent_fields and act_update.is_process_based is not None:
                _add("is_process_based", act_update.is_process_based)
            if service_note_changed or service_note_removed:
                _add("service_note", act_update.service_note)
                _add("service_note_date", act_update.service_note_date)

            # Авто-сброс служебных флагов
            needs_created_date = current_act.needs_created_date
            needs_directive_number = current_act.needs_directive_number
            needs_service_note = current_act.needs_service_note

            if needs_created_date and "created_date" in sent_fields and act_update.created_date is not None:
                needs_created_date = False
            if (
                needs_directive_number
                and act_update.directives is not None
                and len(act_update.directives) > 0
            ):
                all_have_numbers = all(
                    d.directive_number and d.directive_number.strip()
                    for d in act_update.directives
                )
                if all_have_numbers:
                    needs_directive_number = False
            if needs_service_note and "service_note" in sent_fields and act_update.service_note is not None:
                if act_update.service_note.strip():
                    needs_service_note = False

            if needs_created_date != current_act.needs_created_date:
                _add("needs_created_date", needs_created_date)
            if needs_directive_number != current_act.needs_directive_number:
                _add("needs_directive_number", needs_directive_number)
            if needs_service_note != current_act.needs_service_note:
                _add("needs_service_note", needs_service_note)

            _add("last_edited_by", username)
            updates.append("last_edited_at = CURRENT_TIMESTAMP")

            await self._crud.execute_update(act_id, updates, values)

            if act_update.audit_team is not None:
                await self._crud.replace_team_members(
                    act_id, cur_audit_act_id, act_update.audit_team
                )

            if act_update.directives is not None:
                audit_point_map = (
                    ActDirectivesValidator.build_audit_point_map(tree_data)
                    if tree_data
                    else {}
                )
                await self._crud.replace_directives(
                    act_id, cur_audit_act_id, act_update.directives, audit_point_map
                )

            if km_changed:
                await self._crud.update_total_parts_for_km(old_km_digit)
            await self._crud.update_total_parts_for_km(new_km_digit)

            logger.info(f"Обновлены метаданные акта ID={act_id}")

            await self._audit.log("update", username, act_id, {
                "fields": list(sent_fields),
            })

            return await self._crud.get_act_by_id(act_id)

    # -------------------------------------------------------------------------
    # DUPLICATE ACT
    # -------------------------------------------------------------------------

    async def _generate_unique_copy_name(self, original_name: str) -> str:
        """Генерирует уникальное название для копии акта."""
        match = re.search(r"^(.+?)\s*\(Копия\s*(\d*)\)\s*$", original_name)

        if match:
            base_name = match.group(1).strip()
            existing_num = match.group(2)
            next_num = int(existing_num) + 1 if existing_num else 2
        else:
            base_name = original_name.strip()
            next_num = None

        for _ in range(100):
            if next_num is None:
                new_name = f"{base_name} (Копия)"
            else:
                new_name = f"{base_name} (Копия {next_num})"

            if not await self._crud.check_name_exists(new_name):
                return new_name

            next_num = 2 if next_num is None else next_num + 1

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"{base_name} (Копия {timestamp})"

    @staticmethod
    def _build_duplicate_team(
        original_team: list[AuditTeamMember], username: str,
    ) -> list[AuditTeamMember]:
        """Формирует команду для дубликата акта."""
        user_original_role = None
        user_full_name = username
        user_position = "Аудитор"

        for member in original_team:
            if member.username == username:
                user_original_role = member.role
                user_full_name = member.full_name
                user_position = member.position
                break

        placeholder = AuditTeamMember(
            username=PLACEHOLDER_USERNAME, role="Участник", full_name=PLACEHOLDER_FULL_NAME, position="—"
        )
        new_team: list[AuditTeamMember] = []

        if user_original_role == "Куратор":
            new_team.append(AuditTeamMember(
                username=username, role="Куратор",
                full_name=user_full_name, position=user_position,
            ))
        else:
            new_team.append(placeholder.model_copy(update={"role": "Куратор"}))

        if user_original_role == "Руководитель":
            new_team.append(AuditTeamMember(
                username=username, role="Руководитель",
                full_name=user_full_name, position=user_position,
            ))
        else:
            new_team.append(placeholder.model_copy(update={"role": "Руководитель"}))

        if user_original_role not in ("Куратор", "Руководитель"):
            new_team.append(AuditTeamMember(
                username=username, role="Редактор",
                full_name=user_full_name, position=user_position,
            ))

        return new_team

    async def duplicate_act(self, act_id: int, username: str) -> ActResponse:
        """Создает дубликат акта."""
        await self.guard.require_access(act_id, username)

        async with self.conn.transaction():
            original = await self._crud.get_act_by_id(act_id)
            km_digit = KMUtils.extract_km_digits(original.km_number)

            new_inspection_name = await self._generate_unique_copy_name(
                original.inspection_name
            )
            new_team = self._build_duplicate_team(original.audit_team, username)

            km_info = await self._crud.check_km_exists(original.km_number)
            part_number = km_info["next_part_no_sn"]
            total_parts = km_info["total_parts"] + 1

            audit_act_id = await AuditIdService.generate_audit_act_id()

            new_act_id = await self._crud.insert_act(
                km_number=original.km_number,
                km_digit=km_digit,
                part_number=part_number,
                total_parts=total_parts,
                inspection_name=new_inspection_name,
                city=original.city,
                created_date=original.created_date,
                order_number=original.order_number,
                order_date=original.order_date,
                is_process_based=original.is_process_based,
                service_note=None,
                service_note_date=None,
                audit_act_id=audit_act_id,
                created_by=username,
                inspection_start_date=original.inspection_start_date,
                inspection_end_date=original.inspection_end_date,
            )

            await self._crud.insert_team_members_batch(
                new_act_id, audit_act_id, new_team
            )

            # Копируем содержимое (без предварительного insert_default_tree)
            await self._crud.copy_tree(act_id, new_act_id)
            await self._crud.copy_tables(act_id, new_act_id)
            await self._crud.copy_textblocks(act_id, new_act_id)
            await self._crud.copy_violations(act_id, new_act_id)

            await self._crud.update_total_parts_for_km(km_digit)

            logger.info(
                f"Создан дубликат акта: ID={act_id} -> ID={new_act_id}, "
                f"КМ={original.km_number} (цифры={km_digit}), "
                f"название='{new_inspection_name}'"
            )

            await self._audit.log("duplicate", username, new_act_id, {
                "source_act_id": act_id,
                "km_number": original.km_number,
            })

            return await self._crud.get_act_by_id(new_act_id)
