"""Публичный API DOCX-форматера."""
from app.domains.acts.formatters.docx.context import ExportContext
from app.domains.acts.formatters.docx.formatter import DocxFormatter

__all__ = ["DocxFormatter", "ExportContext"]
