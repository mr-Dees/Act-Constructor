"""
Pydantic схемы для валидации данных актов.

Определяет структуру данных для всех элементов акта:
таблицы, текстовые блоки, нарушения и древовидную структуру.
"""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Жёсткие границы таблиц и шрифта текстблоков — единый источник для
# Field-констрейнтов схем ниже и эндпоинта GET /acts/limits (api/limits.py).
TABLE_MAX_ROWS = 64
TABLE_MAX_COLS = 16
FONT_SIZE_MIN = 8
FONT_SIZE_MAX = 72

# Лимиты картинок нарушений (4.3.M.2 + 5.2.2). Лимит длины url — константа:
# схема статична и не может читать настройки. Инвариант согласованности:
# константа обязана быть заведомо выше ACTS__IMAGES__MAX_FILE_SIZE с учётом
# base64-оверхеда (×4/3 + префикс data:image/...;base64,): 10 МБ файла
# ≈ 14 млн символов data-URL < 15 млн. Пин — тест
# test_url_max_length_covers_max_file_size_in_base64.
VIOLATION_IMAGE_URL_MAX_LENGTH = 15_000_000
VIOLATION_CONTENT_ITEMS_MAX = 50

# Whitelist data-URL картинок: только растровые форматы (без SVG — XSS).
# Согласован с ACTS__IMAGES__ALLOWED_MIME_TYPES (пин — тест
# test_mime_whitelist_matches_schema_url_whitelist).
_IMAGE_DATA_URL_RE = re.compile(r"^data:image/(png|jpe?g|gif|webp);base64,")


class TableCellSchema(BaseModel):
    """
    Схема ячейки таблицы с матричной структурой.

    M.20: extra='forbid' — состав полей зеркалит фронтовый
    _serializeTables (state-core.js); неизвестное поле = рассинхрон
    контракта и отбивается 422, а не теряется молча.

    Attributes:
        content: Содержимое ячейки
        isHeader: Является ли ячейка заголовком
        colSpan: Количество объединенных колонок (минимум 1)
        rowSpan: Количество объединенных строк (минимум 1)
        isSpanned: Является ли ячейка частью объединения
        spanOrigin: Координаты главной ячейки объединения
        originRow: Исходная строка ячейки
        originCol: Исходная колонка ячейки
    """
    model_config = ConfigDict(extra="forbid")

    content: str = Field(default="", description="Содержимое ячейки")
    isHeader: bool = Field(default=False, description="Заголовок")
    colSpan: int = Field(
        default=1, ge=1, le=TABLE_MAX_COLS,
        description="Число объединённых колонок (1..16, по лимиту колонок таблицы)"
    )
    rowSpan: int = Field(
        default=1, ge=1, le=TABLE_MAX_ROWS,
        description="Число объединённых строк (1..64, по лимиту строк таблицы)"
    )
    isSpanned: bool = Field(default=False, description="Часть объединения")
    spanOrigin: dict[str, int] | None = Field(default=None, description="Координаты главной ячейки")
    originRow: int | None = Field(default=None, ge=0, description="Исходная строка")
    originCol: int | None = Field(default=None, ge=0, description="Исходная колонка")


class TableSchema(BaseModel):
    """
    Схема таблицы с матричной структурой.

    Добавлены лимиты на размер grid (макс 64 строки, 16 колонок)
    для защиты от исчерпания памяти.

    Attributes:
        id: Уникальный идентификатор таблицы
        nodeId: ID узла дерева
        grid: Матрица ячеек (двумерный массив, макс 64×16)
        colWidths: Массив относительных весов ширины колонок (целые > 0; нормируются по сумме)
        protected: Защищена ли таблица от перемещения и изменения структуры
        deletable: Можно ли удалить таблицу (работает независимо от protected)
        isMetricsTable: Является ли таблицей метрик для пункта под разделом 5
        isMainMetricsTable: Является ли главной таблицей метрик раздела 5
        isRegularRiskTable: Является ли таблицей регулярных рисков
        isOperationalRiskTable: Является ли таблицей операционных рисков
        isTaxRiskTable: Является ли таблицей налоговых рисков
        isOtherRiskTable: Является ли таблицей прочих рисков
    """
    model_config = ConfigDict(extra="forbid")

    id: str = Field(description="ID таблицы")
    nodeId: str = Field(description="ID узла дерева")
    grid: list[list[TableCellSchema]] = Field(
        default_factory=list,
        description="Матрица ячеек",
        max_length=TABLE_MAX_ROWS
    )
    colWidths: list[int] = Field(
        default_factory=list,
        description="Относительные веса ширины колонок (целые > 0; нормируются по сумме)",
        max_length=TABLE_MAX_COLS
    )
    protected: bool = Field(
        default=False,
        description="Защита от перемещения и изменения структуры"
    )
    deletable: bool = Field(
        default=True,
        description="Разрешено ли удаление таблицы"
    )

    # Флаги специальных таблиц
    isMetricsTable: bool | None = Field(
        default=False,
        description="Таблица метрик для пункта под разделом 5"
    )
    isMainMetricsTable: bool | None = Field(
        default=False,
        description="Главная таблица метрик раздела 5"
    )
    isRegularRiskTable: bool | None = Field(
        default=False,
        description="Таблица регулярных рисков"
    )
    isOperationalRiskTable: bool | None = Field(
        default=False,
        description="Таблица операционных рисков"
    )
    isTaxRiskTable: bool | None = Field(
        default=False,
        description="Таблица налоговых рисков"
    )
    isOtherRiskTable: bool | None = Field(
        default=False,
        description="Таблица прочих рисков"
    )

    @field_validator("grid")
    @classmethod
    def validate_grid_dimensions(cls, v: list[list[TableCellSchema]]) -> list[list[TableCellSchema]]:
        """
        Проверяет размеры матрицы (макс 64 строки × 16 колонок).

        Args:
            v: Матрица для валидации

        Returns:
            Валидированная матрица

        Raises:
            ValueError: Если превышен лимит колонок
        """
        if not v:
            return v

        for row_idx, row in enumerate(v):
            if len(row) > TABLE_MAX_COLS:
                raise ValueError(
                    f"Строка {row_idx} содержит {len(row)} колонок, "
                    f"максимум допустимо {TABLE_MAX_COLS}"
                )

        return v

    @field_validator("colWidths")
    @classmethod
    def validate_col_widths(cls, v: list[int]) -> list[int]:
        """
        Проверяет что все ширины положительные.

        Args:
            v: Список ширин для валидации

        Returns:
            Валидированный список

        Raises:
            ValueError: Если есть неположительные ширины
        """
        if any(width <= 0 for width in v):
            raise ValueError("Ширины колонок должны быть положительными")
        return v

    @model_validator(mode="after")
    def validate_structure(self) -> "TableSchema":
        """
        Проверяет структурную целостность таблицы (A2, A3, R6).

        Сообщения на русском и указывают КУДА смотреть пользователю:
        1. прямоугольность матрицы (все строки одной длины);
        2. число ширин колонок: при несовпадении с числом колонок длина
           colWidths НОРМАЛИЗУЕТСЯ (усечение/добивка весом 100, а не
           отклоняется) — билдер делит ширину по весам;
        3. объединения ячеек не выходят за границы матрицы (закрывает
           IndexError в DOCX-builder'е);
        4. объединения не пересекаются — покрытия двух origin-ячеек не
           накладываются (закрывает крэш DOCX-builder'а на наложении merge);
        5. взаимоисключение флагов подвида таблицы (не более одного типа).

        СОЗНАТЕЛЬНО НЕ проверяется когерентность spanOrigin и пометка
        поглощённых ячеек isSpanned: легаси-операции вставки/удаления колонок
        и строк оставляют инертный устаревший spanOrigin, который и билдер
        (читает только isSpanned), и сервер игнорируют. Проверять его — ложная
        тревога.

        Returns:
            Сам объект (валидация after-режима; длина colWidths может быть
            нормализована под число колонок).

        Raises:
            ValueError: При нарушении любого инварианта (→ HTTP 422).
        """
        rows = len(self.grid)
        cols = len(self.grid[0]) if rows else 0

        # 1. Прямоугольность: все строки одной длины (пустую матрицу пропускаем).
        if rows:
            for i, row in enumerate(self.grid):
                if len(row) != cols:
                    raise ValueError(
                        f"Строки таблицы имеют разную длину: строка {i} содержит "
                        f"{len(row)} ячеек вместо {cols}"
                    )

        # 2. Число ширин = число колонок. При несовпадении нормализуем длину
        #    (усечение/добивка дефолтным весом 100), сохраняя префикс заданных
        #    пользователем пропорций; билдер делит ширину по весам.
        if self.colWidths and rows and len(self.colWidths) != cols:
            if len(self.colWidths) > cols:
                self.colWidths = self.colWidths[:cols]
            else:
                self.colWidths = self.colWidths + [100] * (cols - len(self.colWidths))

        # 3. Объединения в пределах границ матрицы.
        for r, row in enumerate(self.grid):
            for c, cell in enumerate(row):
                if cell.colSpan > 1 or cell.rowSpan > 1:
                    if r + cell.rowSpan > rows or c + cell.colSpan > cols:
                        raise ValueError(
                            f"Объединение ячейки ({r},{c}) выходит за границы таблицы"
                        )

        # 4. Объединения не пересекаются. Строим coverage-матрицу из покрытий
        #    origin-ячеек (не isSpanned, со span>1); пересечение покрытий двух
        #    origin-ов роняет DOCX-builder. spanOrigin поглощённых НЕ читаем.
        coverage: list[list[tuple[int, int] | None]] = [
            [None] * cols for _ in range(rows)
        ]
        for r, row in enumerate(self.grid):
            for c, cell in enumerate(row):
                if cell.isSpanned:
                    continue
                if cell.colSpan == 1 and cell.rowSpan == 1:
                    continue
                for rr in range(r, r + cell.rowSpan):
                    for cc in range(c, c + cell.colSpan):
                        if coverage[rr][cc] is not None:
                            raise ValueError(
                                f"Объединения пересекаются в ячейке ({rr},{cc})"
                            )
                        coverage[rr][cc] = (r, c)

        # 5. Взаимоисключение флагов подвида таблицы.
        type_flags = {
            "isMetricsTable": self.isMetricsTable,
            "isMainMetricsTable": self.isMainMetricsTable,
            "isRegularRiskTable": self.isRegularRiskTable,
            "isOperationalRiskTable": self.isOperationalRiskTable,
            "isTaxRiskTable": self.isTaxRiskTable,
            "isOtherRiskTable": self.isOtherRiskTable,
        }
        active = [name for name, value in type_flags.items() if value]
        if len(active) > 1:
            raise ValueError(
                f"Таблица не может одновременно иметь несколько типов: "
                f"{', '.join(active)}"
            )

        return self


class TextBlockFormattingSchema(BaseModel):
    """
    Схема форматирования текстового блока.

    Attributes:
        fontSize: Базовый размер шрифта в пикселях (8-72)
        alignment: Выравнивание текста
        bold: Жирный шрифт
        italic: Курсив
        underline: Подчеркивание
    """
    model_config = ConfigDict(extra="forbid")

    fontSize: int = Field(
        default=14,
        ge=FONT_SIZE_MIN,
        le=FONT_SIZE_MAX,
        description="Базовый размер шрифта"
    )
    alignment: Literal["left", "center", "right", "justify"] = Field(
        default="left",
        description="Выравнивание"
    )
    bold: bool = Field(default=False, description="Жирный")
    italic: bool = Field(default=False, description="Курсив")
    underline: bool = Field(default=False, description="Подчеркивание")


class TextBlockSchema(BaseModel):
    """
    Схема текстового блока с форматированием.

    Attributes:
        id: Уникальный идентификатор текстового блока
        nodeId: ID узла дерева, к которому привязан блок
        content: HTML-содержимое блока с inline-форматированием
        formatting: Базовые параметры форматирования текста
    """
    model_config = ConfigDict(extra="forbid")

    id: str = Field(description="ID текстового блока")
    nodeId: str = Field(description="ID узла дерева")
    content: str = Field(default="", description="HTML-содержимое")
    formatting: TextBlockFormattingSchema = Field(
        default_factory=TextBlockFormattingSchema,
        description="Базовое форматирование"
    )


class ViolationDescriptionListSchema(BaseModel):
    """Схема списка описаний нарушения."""
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    items: list[str] = Field(default_factory=list)


class ViolationOptionalFieldSchema(BaseModel):
    """
    Схема опционального текстового поля нарушения.

    Используется для причин, последствий, рекомендаций,
    ответственных лиц и др.
    """
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    content: str = ""


class ViolationContentItemSchema(BaseModel):
    """
    Универсальный элемент дополнительного контента.

    Attributes:
        id: Уникальный идентификатор элемента
        type: Тип элемента
        content: Текстовое содержимое (для case и freeText)
        url: URL изображения (для image)
        caption: Подпись изображения (для image)
        filename: Имя файла (для image)
        order: Порядок отображения
        width: Ширина изображения в процентах полезной ширины страницы
    """
    model_config = ConfigDict(extra="forbid")

    id: str = Field(description="ID элемента")
    type: Literal["case", "image", "freeText"] = Field(description="Тип элемента")
    content: str = Field(default="", description="Текстовое содержимое")
    url: str = Field(default="", description="URL изображения")
    caption: str = Field(default="", description="Подпись изображения")
    filename: str = Field(default="", description="Имя файла")
    order: int = Field(default=0, ge=0, description="Порядок")
    width: int = Field(
        default=0, ge=0, le=100,
        description="Ширина изображения, % полезной ширины страницы (0 — авто)",
    )

    @model_validator(mode="after")
    def validate_image_url(self) -> "ViolationContentItemSchema":
        """
        Валидирует url картинки (4.3.M.2 + 5.2.2).

        Для type='image' непустой url обязан быть data:image-URL разрешённого
        растрового формата (png/jpeg/gif/webp, base64) — отсекает
        javascript:/data:text-схемы (XSS) и не-картинки. Пустая строка
        допустима (черновик без содержимого). Лимит длины защищает БД и
        снимки версий от многомегабайтных payload'ов.
        """
        if len(self.url) > VIOLATION_IMAGE_URL_MAX_LENGTH:
            raise ValueError(
                f"Размер изображения превышает допустимый лимит "
                f"({VIOLATION_IMAGE_URL_MAX_LENGTH} символов data-URL). "
                f"Уменьшите изображение."
            )
        if self.type == "image" and self.url and not _IMAGE_DATA_URL_RE.match(self.url):
            raise ValueError(
                "Изображение нарушения должно быть встроенным data:image-URL "
                "формата png, jpeg, gif или webp (base64)."
            )
        return self


class ViolationAdditionalContentSchema(BaseModel):
    """Коллекция дополнительного контента нарушения."""
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    items: list[ViolationContentItemSchema] = Field(default_factory=list)

    @field_validator("items")
    @classmethod
    def validate_items_count(
        cls, v: list[ViolationContentItemSchema],
    ) -> list[ViolationContentItemSchema]:
        """Ограничивает число элементов дополнительного контента."""
        if len(v) > VIOLATION_CONTENT_ITEMS_MAX:
            raise ValueError(
                f"Слишком много элементов дополнительного контента: {len(v)}. "
                f"Максимум — {VIOLATION_CONTENT_ITEMS_MAX} элементов на нарушение."
            )
        return v


class ViolationSchema(BaseModel):
    """
    Схема нарушения со всеми полями.

    Attributes:
        id: Уникальный идентификатор нарушения
        nodeId: ID узла дерева, к которому привязано нарушение
        violated: Текст для секции 'Нарушено'
        established: Текст для секции 'Установлено'
        descriptionList: Список описаний нарушения
        additionalContent: Дополнительный контент
        reasons: Причины нарушения
        consequences: Последствия нарушения
        responsible: Ответственные лица
        recommendations: Рекомендации по устранению
    """
    model_config = ConfigDict(extra="forbid")

    id: str = Field(description="ID нарушения")
    nodeId: str = Field(description="ID узла дерева")
    violated: str = Field(default="", description="Текст для 'Нарушено'")
    established: str = Field(default="", description="Текст для 'Установлено'")
    descriptionList: ViolationDescriptionListSchema = Field(
        default_factory=ViolationDescriptionListSchema,
        description="Список описаний"
    )
    additionalContent: ViolationAdditionalContentSchema = Field(
        default_factory=ViolationAdditionalContentSchema,
        description="Дополнительный контент"
    )
    reasons: ViolationOptionalFieldSchema = Field(
        default_factory=ViolationOptionalFieldSchema,
        description="Причины"
    )
    consequences: ViolationOptionalFieldSchema = Field(
        default_factory=ViolationOptionalFieldSchema,
        description="Последствия"
    )
    responsible: ViolationOptionalFieldSchema = Field(
        default_factory=ViolationOptionalFieldSchema,
        description="Ответственные"
    )
    recommendations: ViolationOptionalFieldSchema = Field(
        default_factory=ViolationOptionalFieldSchema,
        description="Рекомендации"
    )


class ActItemSchema(BaseModel):
    """
    Схема пункта акта (рекурсивная структура).

    Представляет узел дерева структуры акта с возможностью
    вложенности и привязки таблиц, текстовых блоков, нарушений.

    Attributes:
        id: Уникальный идентификатор узла
        label: Отображаемый текст узла (номер пункта + название)
        type: Тип узла
        content: Текстовое содержимое пункта
        protected: Защищен ли узел от удаления и перемещения
        deletable: Можно ли удалить узел (работает независимо от protected)
        children: Список дочерних узлов
        tableId: ID привязанной таблицы
        textBlockId: ID привязанного текстового блока
        violationId: ID привязанного нарушения
        customLabel: Пользовательская метка узла
        number: Номер узла в иерархии
        isMetricsTable: Является ли узел таблицей метрик
        isMainMetricsTable: Является ли узел главной таблицей метрик
        isRegularRiskTable: Является ли узел таблицей регулярных рисков
        isOperationalRiskTable: Является ли узел таблицей операционных рисков
        isTaxRiskTable: Является ли узел таблицей налоговых рисков
        isOtherRiskTable: Является ли узел таблицей прочих рисков
    """
    # M.21: политика extra='ignore' задана ЯВНО и сознательно (не forbid):
    # незадекларированные поля узла отбрасываются нормализацией
    # (validate_tree_structure хранит model_dump()), а не отбиваются 422.
    # Forbid ломал бы restore исторических снимков и серверные узлы
    # перестройки разделов (qa-узел несёт runtime-поле parentId,
    # которое фронтовый exportData не сериализует — известный мусор).
    model_config = ConfigDict(extra="ignore")

    id: str
    # label у корневого узла исторически мог отсутствовать (снимки версий до
    # введения метки). Поле опционально, чтобы валидатор дерева (C4) не
    # отбраковывал легитимные сохранённые снимки; id остаётся обязательным.
    label: str | None = ""
    type: Literal["item", "textblock", "violation", "table"] = "item"
    content: str | None = ""
    protected: bool | None = False
    deletable: bool | None = True
    children: list['ActItemSchema'] = Field(default_factory=list)
    tableId: str | None = None
    textBlockId: str | None = None
    violationId: str | None = None
    customLabel: str | None = None
    number: str | None = None
    isMetricsTable: bool | None = False
    isMainMetricsTable: bool | None = False
    isRegularRiskTable: bool | None = False
    isOperationalRiskTable: bool | None = False
    isTaxRiskTable: bool | None = False
    isOtherRiskTable: bool | None = False
    tb: list[str] | None = None
    auditPointId: str | None = None


class ActDataSchema(BaseModel):
    """
    Полная схема данных акта.

    Включает древовидную структуру и все связанные сущности
    (таблицы, текстовые блоки, нарушения).

    Attributes:
        tree: Корневой узел дерева структуры акта
        tables: Словарь таблиц (ключ: ID таблицы)
        textBlocks: Словарь текстовых блоков (ключ: ID блока)
        violations: Словарь нарушений (ключ: ID нарушения)
        saveType: Тип сохранения (manual, periodic, auto)
    """
    model_config = ConfigDict(extra="forbid")

    tree: dict = Field(description="Дерево структуры акта")
    tables: dict[str, TableSchema] = Field(
        default_factory=dict,
        description="Таблицы"
    )
    textBlocks: dict[str, TextBlockSchema] = Field(
        default_factory=dict,
        description="Текстовые блоки"
    )
    violations: dict[str, ViolationSchema] = Field(
        default_factory=dict,
        description="Нарушения"
    )
    invoiceNodeIds: list[str] = Field(
        default_factory=list,
        description="ID узлов, у которых есть прикреплённая фактура"
    )
    changelog: list[dict] = Field(
        default_factory=list,
        description="Гранулярный лог локальных изменений"
    )
    saveType: str = Field(
        default="auto",
        pattern=r"^(manual|periodic|auto)$",
        description="Тип сохранения: manual (Ctrl+S), periodic (2мин), auto (debounced)"
    )

    @field_validator("tree")
    @classmethod
    def validate_tree_structure(cls, v: dict) -> dict:
        """
        Валидирует дерево через ActItemSchema и хранит НОРМАЛИЗОВАННЫЙ результат.

        C4/M.21: downstream-консьюмеры (build_audit_point_map, _build_node_map,
        json.dumps(tree), extract_node_number, sanitize_tree_nodes, аудит-лог)
        читают дерево как dict — поэтому тип хранения остаётся dict, но это
        model_dump() от провалидированной ActItemSchema, а не исходный сырой
        dict. Незадекларированные поля узлов при этом отбрасываются (политика
        extra='ignore' схемы узла) — устранена асимметрия со словарями, где
        неизвестные поля терялись через model_dump, а в дереве персистились.
        Битая структура (узел без id и т.п.) поднимает ValueError → HTTP 422.
        """
        return ActItemSchema.model_validate(v).model_dump()

    @model_validator(mode="after")
    def validate_tree_dict_refs(self) -> "ActDataSchema":
        """
        Кросс-валидатор дерево ↔ словари (M.13).

        Каждая ссылка узла (tableId/textBlockId/violationId) обязана указывать
        на существующую запись словаря — висячая ссылка означает потерянный
        контент и отбивается 422 с указанием узла и недостающей записи.

        Обратное направление НЕ проверяется: запись словаря без узла в дереве —
        не ошибка запроса, такие сироты отбрасывает orphan-фильтр репозитория
        при сохранении (pbe-4).
        """
        ref_checks = (
            ("tableId", self.tables, "несуществующую таблицу"),
            ("textBlockId", self.textBlocks, "несуществующий текстовый блок"),
            ("violationId", self.violations, "несуществующее нарушение"),
        )
        stack = [self.tree] if self.tree else []
        while stack:
            node = stack.pop()
            for ref_field, registry, target_name in ref_checks:
                ref = node.get(ref_field)
                if ref and ref not in registry:
                    raise ValueError(
                        f"Узел {node.get('id')} ссылается на {target_name} {ref}"
                    )
            stack.extend(node.get("children") or [])
        return self


class ActSaveResponse(BaseModel):
    """
    Ответ API при сохранении акта.

    Attributes:
        status: Статус операции
        message: Сообщение о результате
        filename: Имя созданного файла
    """
    status: Literal["success", "error"]
    message: str
    filename: str


# Обновление forward references для рекурсивной схемы
ActItemSchema.model_rebuild()
