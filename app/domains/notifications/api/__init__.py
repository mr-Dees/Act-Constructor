"""API роутеры домена центра уведомлений."""


def get_api_routers():
    """Возвращает список API роутеров домена центра уведомлений."""
    from app.domains.notifications.api.notifications import router as notif_router

    return [
        (notif_router, "/notifications", ["Уведомления"]),
    ]
