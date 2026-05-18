"""Подпакет middleware'ов приложения."""

from app.core.middlewares.http_metrics import HttpMetricsMiddleware

__all__ = ["HttpMetricsMiddleware"]
