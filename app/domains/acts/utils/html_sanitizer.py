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

import re
from functools import lru_cache

import bleach
from bleach.css_sanitizer import CSSSanitizer
from bleach.html5lib_shim import Filter
from bleach.sanitizer import Cleaner


# Фолбэк-дефолты allowlist'а (импорт-тайм/тесты, пока реестр настроек пуст).
# ИСТОЧНИК ИСТИНЫ в рантайме — ACTS__SANITIZER__* (settings.py:SanitizerSettings);
# bleach-конфиг собирается из настроек в каждом sanitize_html (см. _sanitizer_cfg).
# Дефолты SanitizerSettings обязаны совпадать с этими константами.
_FALLBACK_TAGS = [
    "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "del", "span", "a",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "div",
]

# Whitelist CSS-свойств для inline-style. Соответствует тому, что реально
# эмитит/читает редактор текстблоков (textblock-toolbar.js: span.style.fontSize
# + execCommand bold/italic/underline/strikeThrough; textblock-formatting.js:
# parent.style.{fontSize,fontWeight,fontStyle,textDecoration,color,backgroundColor}).
# Всё прочее (position, behavior, url(...) и т.п.) CSSSanitizer вырежет.
_FALLBACK_CSS = [
    "font-size",
    "color",
    "background-color",
    "font-weight",
    "font-style",
    "text-decoration",
    # Внешний контент шлёт зачёркивание и так: без него DOCX-парсер
    # (inline.py _STRIKE_RE) ловит line-through, но bleach срезал бы свойство.
    "text-decoration-line",
    # TB-1: per-line выравнивание — execCommand justify* пишет text-align в
    # style блочных элементов; без свойства центрирование пропадало на PUT.
    "text-align",
]

# data-footnote-* / data-link-* несут текст сноски и URL ссылки — без них
# DOCX-экспорт теряет содержимое при сохранении контента. Значения безопасны:
# фронт рендерит их через textContent/escapeHtml, экспорт фильтрует протокол
# ссылки (см. inline.py).
_FALLBACK_DATA_ATTRS = [
    "data-footnote-id", "data-footnote-text",
    "data-link-id", "data-link-url",
]

ALLOWED_PROTOCOLS = ["http", "https", "mailto"]

# Единый источник состава очищаемых HTML-полей нарушения. Обе точки очистки
# (sanitize_act_data для Pydantic и sanitize_act_content_dict для dict-пути
# восстановления версий) читают эти кортежи — список полей не разъезжается
# (пин — тест паритета test_sanitizer_field_parity).
_VIOLATION_HTML_FIELDS = ("violated", "established")
_VIOLATION_OPTIONAL_HTML_FIELDS = ("reasons", "consequences", "responsible", "recommendations")


def _acts_settings():
    """ActsSettings из реестра; на старте/в тестах (реестр пуст) — дефолты.

    Ленивый импорт: модуль импортируется задолго до discover_domains, а реестр
    заполняется на старте. Санитизация зовётся на save-пути (реестр уже жив),
    поэтому читать настройки внутри безопасно.
    """
    try:
        from app.core.settings_registry import get as _get
        from app.domains.acts import DOMAIN_NAME
        from app.domains.acts.settings import ActsSettings
        return _get(DOMAIN_NAME, ActsSettings)
    except Exception:
        from app.domains.acts.settings import ActsSettings
        return ActsSettings()


def _sanitizer_cfg():
    """Текущий allowlist санитайзера (теги/css/data-атрибуты) из настроек."""
    return _acts_settings().sanitizer


@lru_cache(maxsize=8)
def _css_sanitizer_for(props: tuple[str, ...]) -> CSSSanitizer:
    """CSSSanitizer для текущего набора CSS-свойств (кэш по кортежу).

    Без css_sanitizer bleach 6.x вырезает значение style целиком и сыпет
    NoCssSanitizerWarning на каждый clean(); пересоздавать его на каждый clean
    дорого. Свойства теперь из настроек, поэтому кэшируем по кортежу свойств.
    """
    return CSSSanitizer(allowed_css_properties=list(props))


# TB-1 (per-tag политика): блочные теги несут ТОЛЬКО text-align с
# enum-значением — зеркало фактического контракта редактора: font-size
# эмитится на span (Range-хирургия), text-align — на блоках (execCommand
# justify*). div-level font-size отрисовался бы превью, но DOCX его
# игнорирует (_extract_size_pt читается только у span) — был бы новый шов
# превью↔экспорт. Зеркало фронта — BLOCK_STYLE_TAGS в sanitize.js.
_BLOCK_STYLE_TAGS = frozenset({"div", "p"})
# Значение — строго enum: мусор (inherit/start/left-x) срезает style целиком.
_BLOCK_TEXT_ALIGN_RE = re.compile(
    r"(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)",
    re.IGNORECASE,
)


class _BlockStyleFilter(Filter):
    """Пост-фильтр токенов bleach: у div/p оставляет в style только text-align.

    CSSSanitizer per-tag не умеет (режет по общему allowlist до этого шага) —
    фильтр идёт по уже санитизированному токен-потоку перед сериализацией и
    перезаписывает style блочных тегов; без валидного text-align атрибут
    снимается целиком.
    """

    def __iter__(self):
        for token in super().__iter__():
            if (
                token.get("type") in ("StartTag", "EmptyTag")
                and token.get("name") in _BLOCK_STYLE_TAGS
            ):
                data = token.get("data") or {}
                key = (None, "style")
                if key in data:
                    match = _BLOCK_TEXT_ALIGN_RE.search(data[key] or "")
                    if match:
                        data[key] = f"text-align: {match.group(1).lower()}"
                    else:
                        del data[key]
            yield token


# TB-6: мягкий кламп font-size к [min,max] из настроек. Только px (редактор
# эмитит именно px; em/%/pt оставляем как есть). Значение в диапазоне остаётся
# дословным — паритетные фикстуры (font-size: 20px) не переформатируются.
_FONT_SIZE_PX_RE = re.compile(
    r"font-size\s*:\s*(\d+(?:\.\d+)?)\s*px",
    re.IGNORECASE,
)


def _clamp_font_size_px(style: str, min_px: int, max_px: int) -> str:
    """Зажимает каждое font-size:<N>px в style-строке к [min_px, max_px].

    В диапазоне — возвращает исходное совпадение без изменений (не
    переформатирует). Вне — переписывает границей (целое из настроек).
    """

    def _repl(match: re.Match) -> str:
        value = float(match.group(1))
        clamped = min(float(max_px), max(float(min_px), value))
        if clamped == value:
            return match.group(0)
        num = int(clamped) if clamped == int(clamped) else clamped
        return f"font-size: {num}px"

    return _FONT_SIZE_PX_RE.sub(_repl, style)


class _FontSizeClampFilter(Filter):
    """Пост-фильтр токенов bleach: мягко зажимает font-size в inline-style к
    границам [font_size_min, font_size_max] из настроек (TB-6).

    Числовой проход после bleach/CSSSanitizer: легаси-контент, прямой API или
    внешняя вставка могли принести размер вне диапазона редактора — санитайзер
    приводит его к границе, а НЕ отвергает акт (после вырезания formatting-
    объекта серверная схема размер не валидирует). Границы читаются из настроек
    на каждый clean (реестр уже жив на save-пути; в тестах — дефолты 8/72).
    div/p сюда доходят уже без font-size (его снял _BlockStyleFilter), поэтому
    практически затрагивает span.
    """

    def __iter__(self):
        tb = _acts_settings().textblocks
        min_px, max_px = tb.font_size_min, tb.font_size_max
        for token in super().__iter__():
            if token.get("type") in ("StartTag", "EmptyTag"):
                data = token.get("data") or {}
                key = (None, "style")
                style = data.get(key)
                if style and "font-size" in style.lower():
                    data[key] = _clamp_font_size_px(style, min_px, max_px)
            yield token


def sanitize_html(html: str | None) -> str:
    """
    Чистит произвольный HTML до безопасного подмножества.

    Возвращает пустую строку для None/пустых значений. Не-строковые
    значения приводятся к str(): защитный fallback для случаев, когда
    Pydantic пропустил неожиданный тип.

    Теги/CSS-свойства/data-атрибуты берутся из настроек ACTS__SANITIZER__*
    в рантайме (единый источник с фронтом, B-5).
    """
    if html is None:
        return ""
    if not isinstance(html, str):
        html = str(html)
    if not html:
        return ""
    cfg = _sanitizer_cfg()
    attributes = {
        "a": ["href", "title"],
        "span": ["class", "style", *cfg.allowed_data_attrs],
        # TB-1: style на блочных тегах несёт per-line text-align; состав
        # свойств режет до единственного text-align пост-фильтр
        # _BlockStyleFilter (CSSSanitizer до него — по общему allowlist).
        "div": ["class", "style"],
        "p": ["class", "style"],
        "*": ["class"],
    }
    # Cleaner вместо bleach.clean ради filters= (bleach.clean собирает такой
    # же Cleaner на каждый вызов — по цене эквивалентно).
    cleaner = Cleaner(
        tags=cfg.allowed_tags,
        attributes=attributes,
        protocols=ALLOWED_PROTOCOLS,
        css_sanitizer=_css_sanitizer_for(tuple(cfg.allowed_css_properties)),
        strip=True,
        # _BlockStyleFilter первым (снимает font-size с div/p), затем кламп
        # оставшихся (на span) к границам настроек — TB-6.
        filters=[_BlockStyleFilter, _FontSizeClampFilter],
    )
    return cleaner.clean(html)


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


def _sanitize_content_item_dict(item: dict) -> None:
    """Чистит одну запись additionalContent.items[] в dict-форме (с guard'ами).

    Общая для dict-пути восстановления версий (sanitize_act_content_dict).
    content — HTML, caption/filename — plain. url СОЗНАТЕЛЬНО не трогаем
    (data:image-whitelist валидирует схема, bleach исказил бы base64).
    """
    if "content" in item:
        item["content"] = sanitize_html(item["content"])
    if "caption" in item:
        item["caption"] = sanitize_plain_text(item["caption"])
    if "filename" in item:
        item["filename"] = sanitize_plain_text(item["filename"])


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
        for html_field in _VIOLATION_HTML_FIELDS:
            setattr(violation, html_field, sanitize_html(getattr(violation, html_field)))
        violation.descriptionList.items = [
            sanitize_plain_text(item) for item in violation.descriptionList.items
        ]
        for item in violation.additionalContent.items:
            item.content = sanitize_html(item.content)
            item.caption = sanitize_plain_text(item.caption)
            item.filename = sanitize_plain_text(item.filename)
        for field_name in _VIOLATION_OPTIONAL_HTML_FIELDS:
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
        for html_field in _VIOLATION_HTML_FIELDS:
            if html_field in violation:
                violation[html_field] = sanitize_html(violation[html_field])
        dl = violation.get("descriptionList")
        if isinstance(dl, dict) and isinstance(dl.get("items"), list):
            dl["items"] = [sanitize_plain_text(item) for item in dl["items"]]
        ac = violation.get("additionalContent")
        if isinstance(ac, dict) and isinstance(ac.get("items"), list):
            for item in ac["items"]:
                if isinstance(item, dict):
                    _sanitize_content_item_dict(item)
        for field_name in _VIOLATION_OPTIONAL_HTML_FIELDS:
            field = violation.get(field_name)
            if isinstance(field, dict) and "content" in field:
                field["content"] = sanitize_html(field["content"])

    tree = content.get("tree")
    if isinstance(tree, dict):
        sanitize_tree_nodes(tree)
