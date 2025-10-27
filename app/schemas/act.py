"""
Pydantic схемы для валидации данных актов.

Определяет структуру данных для всех элементов акта:
таблицы, текстовые блоки, нарушения и древовидную структуру.
"""

from typing import List, Dict, Optional

from pydantic import BaseModel, Field


class MergedCell(BaseModel):
    """
    Информация об объединенной ячейке таблицы.

    Attributes:
        rowspan: Количество объединенных строк
        colspan: Количество объединенных столбцов
    """
    rowspan: int = 1
    colspan: int = 1


class TableSchema(BaseModel):
    """
    Схема таблицы с заголовками и данными.

    Attributes:
        rows: Количество строк (должно быть положительным)
        cols: Количество колонок (должно быть положительным)
        headers: Список заголовков колонок
        data: Двумерный массив данных таблицы
        mergedCells: Словарь объединенных ячеек (ключ: 'row-col')
    """
    rows: int = Field(gt=0, description="Количество строк")
    cols: int = Field(gt=0, description="Количество колонок")
    headers: List[str] = Field(
        default_factory=list,
        description="Заголовки колонок"
    )
    data: List[List[str]] = Field(
        default_factory=list,
        description="Данные таблицы"
    )
    mergedCells: Dict[str, MergedCell] = Field(
        default_factory=dict,
        description="Объединенные ячейки (ключ: 'row-col')"
    )


class TextBlockFormattingSchema(BaseModel):
    """
    Схема форматирования текстового блока.

    Attributes:
        bold: Применить жирное начертание
        italic: Применить курсивное начертание
        underline: Применить подчеркивание
        fontSize: Размер шрифта в пунктах
        alignment: Выравнивание текста (left/center/right/justify)
    """
    bold: bool = False
    italic: bool = False
    underline: bool = False
    fontSize: int = 14
    alignment: str = "left"


class TextBlockSchema(BaseModel):
    """
    Схема текстового блока с форматированием.

    Attributes:
        id: Уникальный идентификатор текстового блока
        nodeId: ID узла дерева, к которому привязан блок
        content: Содержимое блока (может содержать HTML)
        formatting: Параметры форматирования текста
    """
    id: str = Field(description="ID текстового блока")
    nodeId: str = Field(description="ID узла дерева")
    content: str = Field(default="", description="Содержимое текстового блока")
    formatting: TextBlockFormattingSchema = Field(
        default_factory=TextBlockFormattingSchema,
        description="Форматирование текста"
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

    Используется для причин, последствий, ответственных лиц и др.

    Attributes:
        enabled: Включено ли поле в документ
        content: Текстовое содержимое поля
    """
    enabled: bool = False
    content: str = ""


class ViolationSchema(BaseModel):
    """
    Схема нарушения со всеми полями.

    Attributes:
        id: Уникальный идентификатор нарушения
        nodeId: ID узла дерева, к которому привязано нарушение
        violated: Текст для секции 'Нарушено'
        established: Текст для секции 'Установлено'
        descriptionList: Список описаний нарушения
        additionalText: Дополнительный текст
        reasons: Причины нарушения
        consequences: Последствия нарушения
        responsible: Ответственные лица
    """
    id: str = Field(description="ID нарушения")
    nodeId: str = Field(description="ID узла дерева")
    violated: str = Field(default="", description="Текст для 'Нарушено'")
    established: str = Field(default="", description="Текст для 'Установлено'")
    descriptionList: ViolationDescriptionListSchema = Field(
        default_factory=ViolationDescriptionListSchema,
        description="Список описаний"
    )
    additionalText: ViolationOptionalFieldSchema = Field(
        default_factory=ViolationOptionalFieldSchema,
        description="Дополнительный текст"
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
        protected: Защищен ли узел от удаления
        children: Список дочерних узлов
        tableId: ID привязанной таблицы
        textBlockId: ID привязанного текстового блока
        violationId: ID привязанного нарушения
    """
    id: str
    label: str
    type: str = "item"
    content: Optional[str] = ""
    protected: Optional[bool] = False
    children: List['ActItemSchema'] = Field(default_factory=list)
    tableId: Optional[str] = None
    textBlockId: Optional[str] = None
    violationId: Optional[str] = None


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
    tables: Dict[str, Dict] = Field(
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
