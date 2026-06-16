"""Эмиссия персистентных уведомлений из домена актов.

Домен acts — продьюсер событий для центра уведомлений (домен notifications).
Связь — через реестр фабрик (``notifications.push``), БЕЗ прямого импорта
notifications-домена: так acts не зависит от наличия notifications в сборке.

Контракт:
- эмитим ТОЛЬКО после успеха основной операции (экспорт/создание акта);
- любой сбой или отсутствие фабрики НЕ должен ломать основную операцию —
  вся эмиссия обёрнута в try/except с логированием;
- ``has_factory``-guard: если домен notifications не зарегистрирован,
  эмиссия молча пропускается (важно для юнит-тестов acts, где notifications
  не поднимается — никакой регрессии).
"""

async def emit_act_notification(
    *,
    title: str,
    body: str | None = None,
    severity: str = "info",
    link: str | None = None,
    recipient_user_id: str | None = None,
) -> None:
    """Мягко эмитит уведомление о событии акта через фабрику notifications.

    Импорт ``has_factory``/``get_factory`` — локальный (внутри функции), чтобы
    не плодить import-циклы и чтобы тесты могли патчить реестр фабрик.

    Args:
        title: заголовок уведомления (пользовательский текст).
        body: подробности (например, список конкретных замечаний акта).
        severity: важность ('info'/'success'/'warning'/'error').
        link: proxy-safe относительный путь к акту (например
            ``/constructor?act_id=42``).
        recipient_user_id: адресат; ``None`` — broadcast всем (использовать
            осознанно).
    """
    # Делегируем единому ядерному хелперу (резолв фабрики + мягкий try/except).
    # Локальный импорт — без жёсткой зависимости на module-level.
    from app.core.notifications_emit import push_notification

    await push_notification(
        source="acts",
        title=title,
        body=body,
        severity=severity,
        link=link,
        recipient_user_id=recipient_user_id,
    )
