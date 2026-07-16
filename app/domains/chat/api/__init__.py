"""API роутеры домена чата."""


def get_api_routers():
    """Возвращает список API роутеров домена чата."""
    from app.domains.chat.api.admin_analytics import router as admin_analytics_router
    from app.domains.chat.api.conversations import router as conv_router
    from app.domains.chat.api.feedback import router as feedback_router
    from app.domains.chat.api.files import router as files_router
    from app.domains.chat.api.messages import router as msg_router
    from app.domains.chat.api.text_actions import router as text_actions_router

    return [
        (conv_router, "/chat", ["Чат: беседы"]),
        (msg_router, "/chat", ["Чат: сообщения"]),
        (feedback_router, "/chat", ["Чат: обратная связь"]),
        (admin_analytics_router, "/chat", ["Чат: аналитика (админ)"]),
        (files_router, "/chat", ["Чат: файлы"]),
        (text_actions_router, "/chat", ["Чат: корректор текста"]),
    ]
