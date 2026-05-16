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
CHECK_CONSTRAINT_MESSAGES: dict[str, str] = {
    "check_inspection_dates": "Дата окончания проверки не может быть раньше даты начала",
    "check_km_number_format": "КМ номер должен быть в формате КМ-XX-XXXXX",
    "check_km_number_digit_length": "Цифровая часть КМ номера должна содержать 7 цифр",
    "check_part_number_positive": "Номер части должен быть положительным числом",
    "check_total_parts_positive": "Общее количество частей должно быть положительным числом",
    "check_service_note_format": "Служебная записка должна быть в формате Текст/XXXX",
    "check_service_note_consistency": (
        "Служебная записка и дата должны быть указаны вместе или отсутствовать вместе"
    ),
    "agent_requests_status_check": "Недопустимый статус запроса к ИИ-агенту.",
    "agent_response_events_event_type_check": "Недопустимый тип события агента.",
    "agent_responses_finish_reason_check": "Недопустимый код завершения ответа агента.",
}
