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
     * Также создает начальные таблицы для разделов, где они требуются.
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

        // Создаем начальные таблицы для нужных разделов
        this._createInitialTables();

        return this.treeData;
    },

    /**
     * Создает начальные таблицы при инициализации структуры.
     * Таблицы создаются для определенных разделов с предзаданными размерами.
     * @private
     */
    _createInitialTables() {
        // Таблица для пункта 2: Оценка качества
        this._createSimpleTable('2', 2, 4, [
            'Процесс',
            'Количество проверенных экземпляров области проверки процесса, шт',
            'Общее количество отклонений, шт',
            'Уровень отклонений, %'
        ], true);

        // Таблица 1 для пункта 3: Инструменты обработки данных
        this._createSimpleTable('3', 2, 4, [
            'Решаемая задача',
            'Методы/технологии',
            'Среда/инструменты',
            'Tag'
        ], true, 'Инструменты обработки данных');

        // Таблица 2 для пункта 3: Источники данных
        this._createSimpleTable('3', 2, 4, [
            'Автоматизированная система',
            'Источник',
            'База данных',
            'Tag'
        ], true, 'Источники данных');

        // Таблица 3 для пункта 3: Репозитории по процессу
        this._createSimpleTable('3', 2, 6, [
            'Процесс',
            'Ссылка на репозиторий, отвечающий за данный процесс',
            'Ссылка на описание релизов',
            'Ссылка на описание бизнес требований и постановку задач',
            'Контактное лицо по вопросам к коду',
            'Комментарий к коду'
        ], true, 'Репозитории по процессу');

        // Таблица для пункта 4: Объем выявленных отклонений (со сложной шапкой)
        this._createComplexHeaderTable('4', 'Объем выявленных отклонений');
    },

    /**
     * Создает простую таблицу с одной строкой заголовков.
     * @private
     * @param {string} nodeId - ID узла, к которому добавляется таблица
     * @param {number} rows - Количество строк данных (без заголовка)
     * @param {number} cols - Количество колонок
     * @param {Array<string>} headers - Массив названий заголовков колонок
     * @param {boolean} protected - Защищена ли таблица от удаления
     * @param {string} label - Название таблицы (пустая строка = таблица без названия)
     * @returns {Object} Результат с флагом success и созданными объектами
     */
    _createSimpleTable(nodeId, rows, cols, headers = [], protected = false, label = '') {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: 'Узел не найден'};

        // Валидация типа узла
        if (node.type === 'table') return {success: false, reason: 'Нельзя добавить таблицу к таблице'};
        if (node.type === 'textblock') return {success: false, reason: 'Нельзя добавить таблицу к текстовому блоку'};
        if (node.type === 'violation') return {success: false, reason: 'Нельзя добавить таблицу к нарушению'};

        // Проверка лимита таблиц
        if (!node.children) node.children = [];
        const tablesCount = node.children.filter(c => c.type === 'table').length;
        if (tablesCount >= 10) {
            return {success: false, reason: 'Достигнуто максимальное количество таблиц (10) для этого пункта'};
        }

        // Создание узла таблицы в дереве
        const tableId = `table_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const tableNode = {
            id: `${nodeId}_table_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            label: label || 'Таблица',  // Используем переданное название или дефолтное
            type: 'table',
            tableId: tableId,
            parentId: nodeId,
            protected: protected
        };

        // КРИТИЧЕСКИ ВАЖНО: если label пустая строка, устанавливаем customLabel
        if (label === '') {
            tableNode.label = 'Таблица';  // Временное название для нумерации
            tableNode.customLabel = '';   // Пустая кастомная метка = скрыть название
        } else if (label) {
            tableNode.customLabel = label; // Сохраняем кастомное название
        }

        node.children.push(tableNode);

        // Создание матричной структуры таблицы (grid)
        const grid = [];

        // Строка заголовков с пользовательскими или дефолтными названиями
        const headerRow = [];
        for (let c = 0; c < cols; c++) {
            const headerText = headers[c] || `Колонка ${c + 1}`;
            headerRow.push({
                content: headerText,
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                originRow: 0,
                originCol: c
            });
        }
        grid.push(headerRow);

        // Строки с пустыми ячейками данных
        for (let r = 1; r <= rows; r++) {
            const dataRow = [];
            for (let c = 0; c < cols; c++) {
                dataRow.push({
                    content: '',
                    isHeader: false,
                    colSpan: 1,
                    rowSpan: 1,
                    originRow: r,
                    originCol: c
                });
            }
            grid.push(dataRow);
        }

        // Создание объекта таблицы с шириной колонок по умолчанию
        const table = {
            id: tableId,
            nodeId: tableNode.id,
            grid: grid,
            colWidths: new Array(cols).fill(100),
            protected: protected
        };

        this.tables[tableId] = table;
        return {success: true, table: table, tableNode: tableNode};
    },

    /**
     * Создает таблицу со сложной шапкой с объединенными ячейками.
     * Используется для таблицы "Объем выявленных отклонений" в пункте 4.
     * @private
     * @param {string} nodeId - ID узла, к которому добавляется таблица
     * @param {string} label - Название таблицы
     * @returns {Object} Результат с флагом success и созданными объектами
     */
    _createComplexHeaderTable(nodeId, label) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: 'Узел не найден'};

        // Валидация типа узла
        if (node.type === 'table') return {success: false, reason: 'Нельзя добавить таблицу к таблице'};
        if (node.type === 'textblock') return {success: false, reason: 'Нельзя добавить таблицу к текстовому блоку'};
        if (node.type === 'violation') return {success: false, reason: 'Нельзя добавить таблицу к нарушению'};

        // Проверка лимита таблиц
        if (!node.children) node.children = [];
        const tablesCount = node.children.filter(c => c.type === 'table').length;
        if (tablesCount >= 10) {
            return {success: false, reason: 'Достигнуто максимальное количество таблиц (10) для этого пункта'};
        }

        // Создание узла таблицы в дереве
        const tableId = `table_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const tableNode = {
            id: `${nodeId}_table_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            label: label,  // ИСПРАВЛЕНИЕ: используем переданное название
            type: 'table',
            tableId: tableId,
            parentId: nodeId,
            protected: true,
            customLabel: label  // ДОБАВЛЕНО: сохраняем кастомное название
        };

        node.children.push(tableNode);

        // Создание сложной шапки согласно изображению
        const grid = [];

        // Первая строка шапки с объединенными ячейками
        const headerRow1 = [
            {
                content: 'Код метрики',
                isHeader: true,
                colSpan: 1,
                rowSpan: 2,
                originRow: 0,
                originCol: 0
            },
            {
                content: 'Наименование метрики',
                isHeader: true,
                colSpan: 1,
                rowSpan: 2,
                originRow: 0,
                originCol: 1
            },
            {
                content: 'Количество клиентов / элементов, ед.',
                isHeader: true,
                colSpan: 2,
                rowSpan: 1,
                originRow: 0,
                originCol: 2
            },
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 0, col: 2},
                originRow: 0,
                originCol: 3
            },
            {
                content: 'Сумма, руб.',
                isHeader: true,
                colSpan: 1,
                rowSpan: 2,
                originRow: 0,
                originCol: 4
            },
            {
                content: 'Код БП',
                isHeader: true,
                colSpan: 1,
                rowSpan: 2,
                originRow: 0,
                originCol: 5
            },
            {
                content: 'Пункт / подпункт акта',
                isHeader: true,
                colSpan: 1,
                rowSpan: 2,
                originRow: 0,
                originCol: 6
            }
        ];
        grid.push(headerRow1);

        // Вторая строка шапки (для разделения на ФЛ и ЮЛ)
        const headerRow2 = [
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 0, col: 0},
                originRow: 1,
                originCol: 0
            },
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 0, col: 1},
                originRow: 1,
                originCol: 1
            },
            {
                content: 'ФЛ',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                originRow: 1,
                originCol: 2
            },
            {
                content: 'ЮЛ',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                originRow: 1,
                originCol: 3
            },
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 0, col: 4},
                originRow: 1,
                originCol: 4
            },
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 0, col: 5},
                originRow: 1,
                originCol: 5
            },
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 0, col: 6},
                originRow: 1,
                originCol: 6
            }
        ];
        grid.push(headerRow2);

        // Добавляем 2 строки данных
        for (let r = 2; r < 4; r++) {
            const dataRow = [];
            for (let c = 0; c < 7; c++) {
                dataRow.push({
                    content: '',
                    isHeader: false,
                    colSpan: 1,
                    rowSpan: 1,
                    originRow: r,
                    originCol: c
                });
            }
            grid.push(dataRow);
        }

        // Создание объекта таблицы с шириной колонок
        const table = {
            id: tableId,
            nodeId: tableNode.id,
            grid: grid,
            colWidths: [80, 200, 100, 100, 120, 80, 120],
            protected: true
        };

        this.tables[tableId] = table;
        return {success: true, table: table, tableNode: tableNode};
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
                colWidths: table.colWidths || [],
                protected: table.protected || false
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
