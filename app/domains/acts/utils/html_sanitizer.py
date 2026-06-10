"""
Санитизация HTML-контента пользовательских полей акта.

Защищает от XSS: textBlock.content, violation.violated/established,
violation.descriptionList.items[], violation.additionalContent.items[]
(.content как HTML; .caption/.filename как plain), violation.{reasons,
consequences, responsible, recommendations}.content и узлы дерева.

Whitelist тегов/атрибутов согласован с фронтовым рендерингом через
innerHTML. Опасные теги (script/iframe/svg/object) и on*-обработчики
выкусываются, javascript:-схемы протокол-фильтр блокирует.
"""

from __future__ import annotations

import bleach
from bleach.css_sanitizer import CSSSanitizer


ALLOWED_TAGS = [
    "p", "br", "b", "strong", "i", "em", "u", "span", "a",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "div",
]

ALLOWED_ATTRS = {
    "a": ["href", "title"],
    # data-footnote-* / data-link-* несут текст сноски и URL ссылки —
    # без них DOCX-экспорт теряет содержимое при сохранении контента.
    # Значения безопасны: фронт рендерит их через textContent/escapeHtml,
    # а экспорт фильтрует протокол ссылки (см. inline.py).
    "span": [
        "class", "style",
        "data-footnote-id", "data-footnote-text",
        "data-link-id", "data-link-url",
    ],
    "div": ["class"],
    "*": ["class"],
}

ALLOWED_PROTOCOLS = ["http", "https", "mailto"]

# Whitelist CSS-свойств для inline-style. Соответствует тому, что реально
# эмитит/читает редактор текстблоков (textblock-toolbar.js: span.style.fontSize
# + execCommand bold/italic/underline/strikeThrough; textblock-formatting.js:
# parent.style.{fontSize,fontWeight,fontStyle,textDecoration,color,backgroundColor}).
# Всё прочее (position, behavior, url(...) и т.п.) CSSSanitizer вырежет.
ALLOWED_CSS_PROPERTIES = [
    "font-size",
    "color",
    "background-color",
    "font-weight",
    "font-style",
    "text-decoration",
]

# Модульный синглтон: без него bleach 6.x вырезает значение style целиком
# и сыпет NoCssSanitizerWarning на каждый clean().
css_sanitizer = CSSSanitizer(allowed_css_properties=ALLOWED_CSS_PROPERTIES)


def sanitize_html(html: str | None) -> str:
    """
    Чистит произвольный HTML до безопасного подмножества.

    Возвращает пустую строку для None/пустых значений. Не-строковые
    значения приводятся к str(): защитный fallback для случаев, когда
    Pydantic пропустил неожиданный тип.
    """
    if html is None:
        return ""
    if not isinstance(html, str):
        html = str(html)
    if not html:
        return ""
    return bleach.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=ALLOWED_PROTOCOLS,
        css_sanitizer=css_sanitizer,
        strip=True,
    )


def sanitize_plain_text(text: str | None) -> str:
    """
    Чистит plain-текстовое поле: вырезает ВСЕ теги (пустой whitelist).

    Для полей, которые по контракту — просто текст (строки descriptionList,
    подпись/имя файла картинки): HTML-теги в них не легитимны, поэтому
    выкусываются целиком, остаточные спецсимволы bleach экранирует.
    """
    if text is None:
        return ""
    if not isinstance(text, str):
        text = str(text)
    if not text:
        return ""
    return bleach.clean(text, tags=[], attributes={}, strip=True)


def sanitize_tree_nodes(node: dict) -> None:
    """Рекурсивно чистит content в узлах дерева (узлы хранятся как dict)."""
    if not isinstance(node, dict):
        return
    if "content" in node and node["content"] is not None:
        node["content"] = sanitize_html(node["content"])
    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            sanitize_tree_nodes(child)


def sanitize_act_data(data) -> None:
    """
    Чистит все HTML-поля ActDataSchema до безопасного подмножества.

    Изменяет объект на месте. Покрывает:
    - textBlocks[*].content
    - violations[*].violated / established
    - violations[*].descriptionList.items[*] (plain: теги выкусываются)
    - violations[*].additionalContent.items[*].content
    - violations[*].additionalContent.items[*].caption / filename (plain)
    - violations[*].{reasons, consequences, responsible, recommendations}.content
    - tree nodes[*].content (рекурсивно — узлы могут содержать HTML)

    url элементов additionalContent СОЗНАТЕЛЬНО не чистится bleach'ем:
    его формат (data:image-whitelist + лимит длины) валидирует
    ViolationContentItemSchema, а bleach исказил бы base64-данные.
    """
    for block in data.textBlocks.values():
        block.content = sanitize_html(block.content)

    for violation in data.violations.values():
        violation.violated = sanitize_html(violation.violated)
        violation.established = sanitize_html(violation.established)
        violation.descriptionList.items = [
            sanitize_plain_text(item) for item in violation.descriptionList.items
        ]
        for item in violation.additionalContent.items:
            item.content = sanitize_html(item.content)
            item.caption = sanitize_plain_text(item.caption)
            item.filename = sanitize_plain_text(item.filename)
        for field_name in ("reasons", "consequences", "responsible", "recommendations"):
            field = getattr(violation, field_name)
            field.content = sanitize_html(field.content)

    sanitize_tree_nodes(data.tree)


def sanitize_act_content_dict(content: dict) -> None:
    """
    Чистит HTML/plain-поля контента в dict-форме {tree, textBlocks, violations}.

    Зеркало sanitize_act_data для контента, загруженного из БД как plain-dict
    (pre-snapshot в AuditLogService.restore_version, pbe-6): состав очищаемых
    полей тот же. Таблицы НЕ трогаются — ячейки хранятся дословно (инвариант
    «всё на текст», см. TestSaveContentTableCellsStoredVerbatim). Изменяет
    dict на месте; отсутствующие ключи пропускает, новых не добавляет.
    """
    if not isinstance(content, dict):
        return

    for block in (content.get("textBlocks") or {}).values():
        if isinstance(block, dict) and "content" in block:
            block["content"] = sanitize_html(block["content"])

    for violation in (content.get("violations") or {}).values():
        if not isinstance(violation, dict):
            continue
        for html_field in ("violated", "established"):
            if html_field in violation:
                violation[html_field] = sanitize_html(violation[html_field])
        dl = violation.get("descriptionList")
        if isinstance(dl, dict) and isinstance(dl.get("items"), list):
            dl["items"] = [sanitize_plain_text(item) for item in dl["items"]]
        ac = violation.get("additionalContent")
        if isinstance(ac, dict) and isinstance(ac.get("items"), list):
            for item in ac["items"]:
                if not isinstance(item, dict):
                    continue
                if "content" in item:
                    item["content"] = sanitize_html(item["content"])
                if "caption" in item:
                    item["caption"] = sanitize_plain_text(item["caption"])
                if "filename" in item:
                    item["filename"] = sanitize_plain_text(item["filename"])
        for field_name in ("reasons", "consequences", "responsible", "recommendations"):
            field = violation.get(field_name)
            if isinstance(field, dict) and "content" in field:
                field["content"] = sanitize_html(field["content"])

    tree = content.get("tree")
    if isinstance(tree, dict):
        sanitize_tree_nodes(tree)
