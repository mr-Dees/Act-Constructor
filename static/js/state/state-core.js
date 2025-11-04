/**
 * Ядро управления состоянием приложения.
 * Содержит базовые свойства состояния, инициализацию и методы поиска узлов.
 * Делегирует специализированные операции соответствующим модулям.
 */
const AppState = {
    // Текущий шаг в процессе конструирования документа
    currentStep: 1,
    // Древовидная структура документа с иерархией пунктов
    treeData: null,
    // Хранилище таблиц с матричной структурой, индексированное по ID
    tables: {},
    // Хранилище текстовых блоков с форматированием, индексированное по ID
    textBlocks: {},
    // Хранилище нарушений (Нарушено/Установлено), индексированное по ID
    violations: {},
    // Текущий выбранный узел в дереве документа
    selectedNode: null,
    // Массив выбранных ячеек таблицы для операций объединения/разделения
    selectedCells: [],

    /**
     * Инициализирует базовую структуру дерева документа с защищенными разделами.
     * Создает стандартные разделы акта: информация о процессе, оценка качества,
     * технологии, выводы и результаты проверки.
     * @returns {Object} Корневой узел дерева документа
     */
    initializeTree() {
        this.treeData = {
            id: 'root',
            label: 'Акт',
            children: [
                {
                    id: '1',
                    label: 'Информация о процессе, клиентском пути',
                    protected: true,
                    children: [],
                    content: ''
                },
                {
                    id: '2',
                    label: 'Оценка качества проверенного процесса / сценария процесса / потока работ',
                    protected: true,
                    children: [],
                    content: ''
                },
                {
                    id: '3',
                    label: 'Примененные технологии',
                    protected: true,
                    children: [],
                    content: ''
                },
                {
                    id: '4',
                    label: 'Основные выводы',
                    protected: true,
                    children: [],
                    content: ''
                },
                {
                    id: '5',
                    label: 'Результаты проверки',
                    protected: true,
                    children: [],
                    content: ''
                }
            ]
        };
        return this.treeData;
    },

    /**
     * Рекурсивно ищет узел по ID в дереве.
     * @param {string} id - ID искомого узла
     * @param {Object} node - Узел для начала поиска (по умолчанию корень)
     * @returns {Object|null} Найденный узел или null
     */
    findNodeById(id, node = this.treeData) {
        if (node.id === id) return node;
        if (node.children) {
            for (let child of node.children) {
                const found = this.findNodeById(id, child);
                if (found) return found;
            }
        }
        return null;
    },

    /**
     * Находит родительский узел для указанного узла.
     * @param {string} nodeId - ID узла, родителя которого нужно найти
     * @param {Object} parent - Узел для начала поиска (по умолчанию корень)
     * @returns {Object|null} Родительский узел или null
     */
    findParentNode(nodeId, parent = this.treeData) {
        if (parent.children) {
            for (let child of parent.children) {
                if (child.id === nodeId) return parent;
                const found = this.findParentNode(nodeId, child);
                if (found) return found;
            }
        }
        return null;
    },

    /**
     * Экспортирует полное состояние приложения для отправки на бэкенд.
     * Сериализует дерево документа, таблицы, текстовые блоки и нарушения
     * в JSON-совместимую структуру с сохранением всех связей и форматирования.
     * @returns {Object} Сериализованные данные документа
     */
    exportData() {
        /**
         * Рекурсивно сериализует узел дерева со всеми дочерними элементами.
         * @param {Object} node - Узел для сериализации
         * @returns {Object} Сериализованный узел
         */
        const serializeNode = (node) => {
            const serialized = {
                id: node.id,
                label: node.label,
                type: node.type || 'item',
                protected: node.protected || false
            };

            // Добавляем специфичные для типа поля
            if (node.type === 'table' && node.tableId) {
                serialized.tableId = node.tableId;
            } else if (node.type === 'textblock' && node.textBlockId) {
                serialized.textBlockId = node.textBlockId;
            } else if (node.type === 'violation' && node.violationId) {
                serialized.violationId = node.violationId;
            } else {
                serialized.content = node.content || '';
            }

            // Сохраняем пользовательские метки и номера
            if (node.customLabel) {
                serialized.customLabel = node.customLabel;
            }

            if (node.number) {
                serialized.number = node.number;
            }

            // Рекурсивно обрабатываем дочерние элементы
            if (node.children && node.children.length > 0) {
                serialized.children = node.children.map(child => serializeNode(child));
            } else {
                serialized.children = [];
            }

            return serialized;
        };

        // Сериализация таблиц с полной матричной структурой
        const serializedTables = {};
        for (const tableId in this.tables) {
            const table = this.tables[tableId];
            serializedTables[tableId] = {
                id: table.id,
                nodeId: table.nodeId,
                grid: table.grid.map(row =>
                    row.map(cell => ({
                        content: cell.content || '',
                        isHeader: cell.isHeader || false,
                        colSpan: cell.colSpan || 1,
                        rowSpan: cell.rowSpan || 1,
                        isSpanned: cell.isSpanned || false,
                        spanOrigin: cell.spanOrigin || null,
                        originRow: cell.originRow,
                        originCol: cell.originCol
                    }))
                ),
                colWidths: table.colWidths || []
            };
        }

        // Сериализация текстовых блоков с настройками форматирования
        const serializedTextBlocks = {};
        for (const textBlockId in this.textBlocks) {
            const textBlock = this.textBlocks[textBlockId];
            serializedTextBlocks[textBlockId] = {
                id: textBlock.id,
                nodeId: textBlock.nodeId,
                content: textBlock.content || '',
                formatting: {
                    bold: textBlock.formatting?.bold || false,
                    italic: textBlock.formatting?.italic || false,
                    underline: textBlock.formatting?.underline || false,
                    fontSize: textBlock.formatting?.fontSize || 14,
                    alignment: textBlock.formatting?.alignment || 'left'
                }
            };
        }

        // Сериализация нарушений со всеми опциональными полями
        const serializedViolations = {};
        for (const violationId in this.violations) {
            const violation = this.violations[violationId];
            serializedViolations[violationId] = {
                id: violation.id,
                nodeId: violation.nodeId,
                violated: violation.violated || '',
                established: violation.established || '',
                descriptionList: {
                    enabled: violation.descriptionList?.enabled || false,
                    items: violation.descriptionList?.items || []
                },
                additionalContent: {
                    enabled: violation.additionalContent?.enabled || false,
                    items: violation.additionalContent?.items || []
                },
                reasons: {
                    enabled: violation.reasons?.enabled || false,
                    content: violation.reasons?.content || ''
                },
                consequences: {
                    enabled: violation.consequences?.enabled || false,
                    content: violation.consequences?.content || ''
                },
                responsible: {
                    enabled: violation.responsible?.enabled || false,
                    content: violation.responsible?.content || ''
                }
            };
        }

        // Возвращаем полную структуру данных для экспорта
        return {
            tree: serializeNode(this.treeData),
            tables: serializedTables,
            textBlocks: serializedTextBlocks,
            violations: serializedViolations
        };
    }
};
