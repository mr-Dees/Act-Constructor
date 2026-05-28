"""Общие фикстуры для тестов docx-форматера."""
import pytest
from docx import Document


@pytest.fixture
def doc():
    """Свежий пустой Document для каждого теста."""
    return Document()
