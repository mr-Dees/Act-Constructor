"""
Pydantic схемы для валидации данных актов.

Определяет структуру данных для всех элементов акта:
таблицы, текстовые блоки, нарушения и древовидную структуру.
"""

from typing import List, Dict, Optional, Any

from pydantic import BaseModel, Field


class TableCellSchema(BaseModel):
    """
    Схема ячейки таблицы с матричной структурой.

    Attributes:
        content: Содержимое ячейки
        isHeader: Является ли ячейка заголовком
        colSpan: Количество объединенных колонок
        rowSpan: Количество объединенных строк
        isSpanned: Является ли ячейка частью объединения
        spanOrigin: Координаты главной ячейки объединения
        originRow: Исходная строка ячейки
        originCol: Исходная колонка ячейки
    """
    content: str = Field(default="", description="Содержимое ячейки")
    isHeader: bool = Field(default=False, description="Заголовок")
    colSpan: int = Field(default=1, description="Colspan")
    rowSpan: int = Field(default=1, description="Rowspan")
    isSpanned: bool = Field(default=False, description="Часть объединения")
    spanOrigin: Optional[Dict[str, int]] = Field(default=None, description="Координаты главной ячейки")
    originRow: Optional[int] = Field(default=None, description="Исходная строка")
    originCol: Optional[int] = Field(default=None, description="Исходная колонка")


class TableSchema(BaseModel):
    """
    Схема таблицы с матричной структурой.

    Attributes:
        id: Уникальный идентификатор таблицы
        nodeId: ID узла дерева
        grid: Матрица ячеек (двумерный массив)
        colWidths: Массив ширин колонок
        protected: Защищена ли таблица от перемещения и изменения структуры
        deletable: Можно ли удалить таблицу (работает независимо от protected)
    """
    id: str = Field(description="ID таблицы")
    nodeId: str = Field(description="ID узла дерева")
    grid: List[List[TableCellSchema]] = Field(
        default_factory=list,
        description="Матрица ячеек"
    )
    colWidths: List[int] = Field(
        default_factory=list,
        description="Ширины колонок"
    )
    protected: bool = Field(
        default=False,
        description="Защита от перемещения и изменения структуры (добавление/удаление строк/колонок)"
    )
    deletable: bool = Field(
        default=True,
        description="Разрешено ли удаление таблицы (true = можно удалить, false = нельзя удалить)"
    )


class TextBlockFormattingSchema(BaseModel):
    """
    Схема форматирования текстового блока.

    Attributes:
        fontSize: Базовый размер шрифта в пикселях
        alignment: Выравнивание текста (left/center/right/justify)
    """
    fontSize: int = Field(default=14, description="Базовый размер шрифта")
    alignment: str = Field(default="left", description="Выравнивание")


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
    """
    Схема списка описаний нарушения.

    Attributes:
        enabled: Включен ли список в документ
        items: Элементы буллитного списка
    """
    enabled: bool = False
    items: List[str] = Field(default_factory=list)


class ViolationOptionalFieldSchema(BaseModel):
    """
    Схема опционального текстового поля нарушения.

    Используется для причин, последствий, рекомендаций, ответственных лиц и др.

    Attributes:
        enabled: Включено ли поле в документ
        content: Текстовое содержимое поля
    """
    enabled: bool = False
    content: str = ""


class ViolationContentItemSchema(BaseModel):
    """
    Универсальный элемент дополнительного контента.

    Attributes:
        id: Уникальный идентификатор элемента
        type: Тип элемента ('case', 'image', 'freeText')
        content: Текстовое содержимое (для case и freeText)
        url: URL изображения (для image)
        caption: Подпись изображения (для image)
        filename: Имя файла (для image)
        order: Порядок отображения
    """
    id: str = Field(description="ID элемента")
    type: str = Field(description="Тип: case, image, freeText")
    content: str = Field(default="", description="Текстовое содержимое")
    url: str = Field(default="", description="URL изображения")
    caption: str = Field(default="", description="Подпись изображения")
    filename: str = Field(default="", description="Имя файла")
    order: int = Field(default=0, description="Порядок")


class ViolationAdditionalContentSchema(BaseModel):
    """
    Коллекция дополнительного контента нарушения.

    Attributes:
        enabled: Включена ли секция
        items: Список всех элементов в порядке добавления
    """
    enabled: bool = False
    items: List[ViolationContentItemSchema] = Field(default_factory=list)


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
        type: Тип узла (item/textblock/violation/table)
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
    """
    id: str
    label: str
    type: str = "item"
    content: Optional[str] = ""
    protected: Optional[bool] = False
    deletable: Optional[bool] = True
    children: List['ActItemSchema'] = Field(default_factory=list)
    tableId: Optional[str] = None
    textBlockId: Optional[str] = None
    violationId: Optional[str] = None
    customLabel: Optional[str] = None
    number: Optional[str] = None
    isMetricsTable: Optional[bool] = False
    isMainMetricsTable: Optional[bool] = False


class ActDataSchema(BaseModel):
    """
    Полная схема данных акта.

    Включает древовидную структуру и все связанные сущности.

    Attributes:
        tree: Корневой узел дерева структуры акта
        tables: Словарь таблиц (ключ: ID таблицы)
        textBlocks: Словарь текстовых блоков (ключ: ID блока)
        violations: Словарь нарушений (ключ: ID нарушения)
    """
    tree: Dict = Field(description="Дерево структуры акта")
    tables: Dict[str, Any] = Field(
        default_factory=dict,
        description="Таблицы"
    )
    textBlocks: Dict[str, TextBlockSchema] = Field(
        default_factory=dict,
        description="Текстовые блоки"
    )
    violations: Dict[str, ViolationSchema] = Field(
        default_factory=dict,
        description="Нарушения"
    )


class ActSaveResponse(BaseModel):
    """
    Ответ API при сохранении акта.

    Attributes:
        status: Статус операции (success/error)
        message: Сообщение о результате
        filename: Имя созданного файла
    """
    status: str
    message: str
    filename: str


# Обновление forward references для рекурсивной схемы
ActItemSchema.model_rebuild()
