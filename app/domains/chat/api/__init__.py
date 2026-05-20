"""API роутеры домена чата."""


def get_api_routers():
    """Возвращает список API роутеров домена чата."""
    from app.domains.chat.api.conversations import router as conv_router
    from app.domains.chat.api.files import router as files_router
    from app.domains.chat.api.forward_resume import router as forward_resume_router
    from app.domains.chat.api.messages import router as msg_router

    return [
        (conv_router, "/chat", ["Чат: беседы"]),
        (msg_router, "/chat", ["Чат: сообщения"]),
        (files_router, "/chat", ["Чат: файлы"]),
        (forward_resume_router, "/chat", ["Чат: resume forward'а"]),
    ]
