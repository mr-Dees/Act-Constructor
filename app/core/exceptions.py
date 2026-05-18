"""Базовые исключения приложения."""


class AppError(Exception):
    """Базовый класс всех доменных исключений. Несёт HTTP-статус и detail."""
    status_code: int = 500

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)

    def to_detail(self) -> dict:
        return {"detail": self.message}


# Маппинг имён CHECK-ограничений БД → понятные сообщения для пользователя.
# Используется глобальным обработчиком CheckViolationError в main.py.
# ВАЖНО: при добавлении нового CHECK constraint в schema.sql — обязательно
# добавить маппинг здесь. CI-тест test_check_constraints_complete проверяет
# полноту маппинга и упадёт, если появится constraint без записи.
CHECK_CONSTRAINT_MESSAGES: dict[str, str] = {
    # ── acts: основная таблица актов ─────────────────────────────────────────
    "check_km_number_format": "КМ-номер должен быть в формате КМ-XX-XXXXX",
    "check_km_number_digit_length": "Цифровая часть КМ-номера должна содержать 7 цифр",
    "check_part_number_positive": "Номер части должен быть положительным числом",
    "check_total_parts_positive": "Общее количество частей должно быть положительным числом",
    "check_inspection_dates": "Дата окончания проверки не может быть раньше даты начала",
    "check_service_note_format": "Служебная записка должна быть в формате Текст/XXXX",
    "check_service_note_consistency": (
        "Служебная записка и дата должны быть указаны вместе или отсутствовать вместе"
    ),
    # ── acts: audit_team_members ─────────────────────────────────────────────
    # PG-имя (явное)
    "check_audit_team_role_values": (
        "Недопустимая роль участника аудиторской группы. "
        "Допустимые значения: Куратор, Руководитель, Редактор, Участник"
    ),
    # GP-имя (уже было явным)
    "check_role_values": (
        "Недопустимая роль участника аудиторской группы. "
        "Допустимые значения: Куратор, Руководитель, Редактор, Участник"
    ),
    "check_order_index_non_negative": "Порядковый индекс не может быть отрицательным",
    # ── acts: act_directives ─────────────────────────────────────────────────
    "check_point_number_format": (
        "Неверный формат номера пункта поручения: ожидается 5.X или 5.X.Y и т.д."
    ),
    # ── acts: act_tree ───────────────────────────────────────────────────────
    "check_tree_data_not_empty": "Данные дерева акта должны быть объектом JSON",
    # ── acts: act_tables ─────────────────────────────────────────────────────
    "check_grid_data_is_array": "Данные таблицы (grid_data) должны быть массивом JSON",
    "check_col_widths_is_array": "Ширины столбцов (col_widths) должны быть массивом JSON",
    # ── acts: act_textblocks ─────────────────────────────────────────────────
    "check_formatting_is_object": "Данные форматирования должны быть объектом JSON",
    # ── acts: act_violations ─────────────────────────────────────────────────
    "check_description_list_is_object_or_null": (
        "Поле description_list должно быть объектом JSON или отсутствовать"
    ),
    "check_additional_content_is_object_or_null": (
        "Поле additional_content должно быть объектом JSON или отсутствовать"
    ),
    "check_reasons_is_object_or_null": (
        "Поле reasons должно быть объектом JSON с полями enabled и content, или отсутствовать"
    ),
    "check_consequences_is_object_or_null": (
        "Поле consequences должно быть объектом JSON с полями enabled и content, или отсутствовать"
    ),
    "check_responsible_is_object_or_null": (
        "Поле responsible должно быть объектом JSON с полями enabled и content, или отсутствовать"
    ),
    "check_recommendations_is_object_or_null": (
        "Поле recommendations должно быть объектом JSON с полями enabled и content, или отсутствовать"
    ),
    # ── acts: act_invoices ───────────────────────────────────────────────────
    # PG-имена (явные, добавлены при заполнении)
    "check_act_invoices_db_type_values": (
        "Недопустимый тип базы данных фактуры. Допустимые значения: hive, greenplum"
    ),
    "check_act_invoices_verification_status_values": (
        "Недопустимый статус верификации фактуры. "
        "Допустимые значения: pending, verified, rejected"
    ),
    # GP-имена (уже были явными)
    "check_db_type_values": (
        "Недопустимый тип базы данных фактуры. Допустимые значения: hive, greenplum"
    ),
    "check_verification_status_values": (
        "Недопустимый статус верификации фактуры. "
        "Допустимые значения: pending, verified, rejected"
    ),
    "check_metrics_is_array": "Поле metrics должно быть массивом JSON",
    # ── chat: chat_files ─────────────────────────────────────────────────────
    "check_chat_files_file_size_positive": "Размер файла должен быть больше нуля",
    # ── chat: agent_requests ─────────────────────────────────────────────────
    "check_agent_requests_status_values": (
        "Недопустимый статус запроса к ИИ-агенту. "
        "Допустимые значения: pending, dispatched, in_progress, done, error, timeout"
    ),
    # ── chat: agent_response_events ──────────────────────────────────────────
    "check_agent_response_events_event_type_values": (
        "Недопустимый тип события агента. Допустимые значения: reasoning, status, error"
    ),
    # ── chat: agent_responses ────────────────────────────────────────────────
    "check_agent_responses_finish_reason_values": (
        "Недопустимый код завершения ответа агента. "
        "Допустимые значения: stop, length, content_filter, error"
    ),
}
