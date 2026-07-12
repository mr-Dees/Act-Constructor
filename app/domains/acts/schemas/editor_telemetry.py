"""
Схемы телеметрии здоровья редактора (§6.8).

Фронт присылает батч агрегированных счётчиков событий редактора
(self-heal observer'а, починки капсул, ошибки сохранения, пустой paste).
Никакого пользовательского контента — только тип события, id акта и счётчик.
"""

from typing import Literal

from pydantic import BaseModel, Field

# Допустимые типы событий телеметрии. Синхронизированы с CHECK-констрейнтом
# check_editor_telemetry_event_type_values (обе schema.sql) и фронт-модулем
# static/js/constructor/services/editor-telemetry.js (KNOWN_EVENTS).
EditorTelemetryEventType = Literal[
    "observer_heal",
    "capsule_repair",
    "dup_id_fix",
    "save_failure",
    "empty_paste",
    "word_paste",
]


class EditorTelemetryEvent(BaseModel):
    """Один агрегированный счётчик: тип события + акт + число вхождений."""

    event_type: EditorTelemetryEventType
    act_id: int
    # Верхняя граница обязательна: без неё аномально большой счётчик пролезал бы
    # мимо валидации и падал переполнением INTEGER-колонки event_count уже на
    # INSERT — голый 500 вместо чистого 422. Порог с большим запасом над штатным
    # окном агрегации, но заведомо ниже предела INT32.
    count: int = Field(gt=0, le=1_000_000)


class EditorTelemetryBatch(BaseModel):
    """Батч счётчиков за окно накопления фронта.

    Лимит РАЗМЕРА батча проверяется в эндпоинте явным ``len()``, а не
    ограничением поля — чтобы kill-switch (204) отрабатывал раньше 422 при
    выключенной телеметрии. Частоту запросов ограничивает глобальный
    RateLimitMiddleware, а не этот лимит.
    """

    events: list[EditorTelemetryEvent]
