"""
Pydantic схемы для валидации данных актов.

Определяет структуру данных для всех элементов акта:
таблицы, текстовые блоки, нарушения и древовидную структуру.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class TableCellSchema(BaseModel):
    """
    Схема ячейки таблицы с матричной структурой.

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
    content: str = Field(default="", description="Содержимое ячейки")
    isHeader: bool = Field(default=False, description="Заголовок")
    colSpan: int = Field(
        default=1, ge=1, le=16,
        description="Число объединённых колонок (1..16, по лимиту колонок таблицы)"
    )
    rowSpan: int = Field(
        default=1, ge=1, le=64,
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
    id: str = Field(description="ID таблицы")
    nodeId: str = Field(description="ID узла дерева")
    grid: list[list[TableCellSchema]] = Field(
        default_factory=list,
        description="Матрица ячеек",
        max_length=64
    )
    colWidths: list[int] = Field(
        default_factory=list,
        description="Относительные веса ширины колонок (целые > 0; нормируются по сумме)",
        max_length=16
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
            if len(row) > 16:
                raise ValueError(
                    f"Строка {row_idx} содержит {len(row)} колонок, "
                    f"максимум допустимо 16"
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
        2. совпадение числа ширин колонок с числом колонок;
        3. объединения ячеек не выходят за границы матрицы (закрывает
           IndexError в DOCX-builder'е);
        4. взаимоисключение флагов подвида таблицы (не более одного типа).

        Returns:
            Сам объект (валидация after-режима).

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

        # 2. Число ширин = число колонок (пустой colWidths допустим — DOCX делит
        #    ширину поровну).
        if self.colWidths and rows and len(self.colWidths) != cols:
            raise ValueError(
                f"Число ширин колонок ({len(self.colWidths)}) не совпадает с "
                f"числом колонок таблицы ({cols})"
            )

        # 3. Объединения в пределах границ матрицы.
        for r, row in enumerate(self.grid):
            for c, cell in enumerate(row):
                if cell.colSpan > 1 or cell.rowSpan > 1:
                    if r + cell.rowSpan > rows or c + cell.colSpan > cols:
                        raise ValueError(
                            f"Объединение ячейки ({r},{c}) выходит за границы таблицы"
                        )

        # 4. Взаимоисключение флагов подвида таблицы.
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
    fontSize: int = Field(
        default=14,
        ge=8,
        le=72,
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
    id: str = Field(description="ID текстового блока")
    nodeId: str = Field(description="ID узла дерева")
    content: str = Field(default="", description="HTML-содержимое")
    formatting: TextBlockFormattingSchema = Field(
        default_factory=TextBlockFormattingSchema,
        description="Базовое форматирование"
    )


class ViolationDescriptionListSchema(BaseModel):
    """Схема списка описаний нарушения."""
    enabled: bool = False
    items: list[str] = Field(default_factory=list)


class ViolationOptionalFieldSchema(BaseModel):
    """
    Схема опционального текстового поля нарушения.

    Используется для причин, последствий, рекомендаций,
    ответственных лиц и др.
    """
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
    """
    id: str = Field(description="ID элемента")
    type: Literal["case", "image", "freeText"] = Field(description="Тип элемента")
    content: str = Field(default="", description="Текстовое содержимое")
    url: str = Field(default="", description="URL изображения")
    caption: str = Field(default="", description="Подпись изображения")
    filename: str = Field(default="", description="Имя файла")
    order: int = Field(default=0, ge=0, description="Порядок")


class ViolationAdditionalContentSchema(BaseModel):
    """Коллекция дополнительного контента нарушения."""
    enabled: bool = False
    items: list[ViolationContentItemSchema] = Field(default_factory=list)


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
        Валидирует структуру дерева через ActItemSchema, не меняя хранимый тип.

        C4: downstream-консьюмеры (build_audit_point_map, _build_node_map,
        json.dumps(tree), extract_node_number, sanitize_tree_nodes, аудит-лог)
        читают дерево как dict. Поэтому tree остаётся dict для хранения, а
        валидатор лишь конструирует ActItemSchema.model_validate(v) для проверки
        формы (поднимает ValueError на битой структуре, в т.ч. на узлах без
        id/label). Так risk-флаги получают схему-описание, не ломая контракт.
        """
        ActItemSchema.model_validate(v)
        return v


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
