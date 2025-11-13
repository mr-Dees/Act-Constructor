/**
 * Ядро управления состоянием приложения
 *
 * Содержит базовые свойства состояния, инициализацию дерева,
 * методы поиска узлов и экспорта данных.
 * Делегирует специализированные операции модулям StateContent, StateTree и ValidationTree.
 */
const AppState = {
    /**
     * Текущий шаг в процессе конструирования документа
     * 1 - составление структуры, 2 - заполнение данных
     */
    currentStep: 1,

    /**
     * Древовидная структура документа с иерархией пунктов
     */
    treeData: null,

    /**
     * Хранилище таблиц с матричной grid-структурой
     * Ключ: ID таблицы, Значение: объект таблицы
     */
    tables: {},

    /**
     * Хранилище текстовых блоков с HTML-форматированием
     * Ключ: ID текстового блока, Значение: объект блока
     */
    textBlocks: {},

    /**
     * Хранилище нарушений с детальной структурой полей
     * Ключ: ID нарушения, Значение: объект нарушения
     */
    violations: {},

    /**
     * Текущий выбранный узел в дереве документа
     */
    selectedNode: null,

    /**
     * Массив выбранных ячеек таблицы для групповых операций
     */
    selectedCells: [],

    /**
     * Инициализирует базовую структуру дерева с защищенными разделами
     * @returns {Object} Корневой узел дерева документа
     */
    initializeTree() {
        this.treeData = this._createRootStructure();
        this._createInitialTables();
        return this.treeData;
    },

    /**
     * Создает корневую структуру документа
     * @private
     * @returns {Object} Корневой узел с дочерними разделами
     */
    _createRootStructure() {
        const sections = AppConfig.tree.defaultSections.map(section =>
            this._createProtectedSection(section.id, section.label)
        );

        return {
            id: 'root',
            label: 'Акт',
            children: sections
        };
    },

    /**
     * Создает защищенный раздел документа
     * @private
     * @param {string} id - ID раздела
     * @param {string} label - Название раздела
     * @returns {Object} Узел защищенного раздела
     */
    _createProtectedSection(id, label) {
        return {
            id,
            label,
            protected: true,
            deletable: false,
            children: [],
            content: ''
        };
    },

    /**
     * Создает начальные таблицы для предустановленных разделов
     * @private
     */
    _createInitialTables() {
        const presets = AppConfig.content.tablePresets;

        this._createTableFromPreset('2', presets.qualityAssessment, '', true, false);
        this._createTableFromPreset('3', presets.dataTools, presets.dataTools.label, true, false);
        this._createTableFromPreset('3', presets.dataSources, presets.dataSources.label, true, false);
        this._createTableFromPreset('3', presets.repositories, presets.repositories.label, true, false);
    },

    /**
     * Создает таблицу на основе пресета
     * @private
     * @param {string} nodeId - ID узла для добавления таблицы
     * @param {Object} preset - Объект пресета с настройками таблицы
     * @param {string} label - Название таблицы
     * @param {boolean} protected - Защита от перемещения
     * @param {boolean} deletable - Возможность удаления
     * @returns {Object} Результат создания таблицы
     */
    _createTableFromPreset(nodeId, preset, label, protected, deletable) {
        return this._createSimpleTable(
            nodeId,
            preset.rows,
            preset.cols,
            preset.headers,
            protected,
            deletable,
            label
        );
    },

    /**
     * Создает простую таблицу с одной строкой заголовков
     * @private
     * @param {string} nodeId - ID узла для добавления
     * @param {number} rows - Количество строк данных
     * @param {number} cols - Количество колонок
     * @param {Array<string>} headers - Массив заголовков
     * @param {boolean} protected - Защита от перемещения
     * @param {boolean} deletable - Возможность удаления
     * @param {string} label - Название таблицы
     * @returns {Object} Результат создания
     */
    _createSimpleTable(nodeId, rows, cols, headers = [], protected = false, deletable = true, label = '') {
        const node = this.findNodeById(nodeId);
        if (!node) {
            return {
                success: false,
                reason: AppConfig.tree.validation.nodeNotFound
            };
        }

        // Используем валидацию из ValidationTree
        const validation = ValidationTree.canAddContent(node, 'table');
        if (!validation.success) return validation;

        const tableId = this._generateId('table');
        const tableNode = this._createTableNode(nodeId, tableId, label, protected, deletable);

        node.children.push(tableNode);

        const grid = this._createTableGrid(rows, cols, headers);
        const table = this._createTableObject(tableId, tableNode.id, grid, cols, protected, deletable);

        this.tables[tableId] = table;

        return {success: true, table, tableNode};
    },

    /**
     * Создает узел таблицы для дерева
     * @private
     * @param {string} parentId - ID родительского узла
     * @param {string} tableId - ID таблицы
     * @param {string} label - Название таблицы
     * @param {boolean} protected - Защита
     * @param {boolean} deletable - Возможность удаления
     * @returns {Object} Узел таблицы
     */
    _createTableNode(parentId, tableId, label, protected, deletable) {
        const node = {
            id: `${parentId}_table_${Date.now()}`,
            label: label || AppConfig.tree.labels.table,
            type: 'table',
            tableId,
            parentId,
            protected,
            deletable
        };

        if (label === '') {
            node.label = AppConfig.tree.labels.table;
            node.customLabel = '';
        } else if (label) {
            node.customLabel = label;
        }

        return node;
    },

    /**
     * Создает grid-структуру таблицы
     * @private
     * @param {number} rows - Количество строк данных
     * @param {number} cols - Количество колонок
     * @param {Array<string>} headers - Заголовки
     * @returns {Array} Двумерный массив ячеек
     */
    _createTableGrid(rows, cols, headers) {
        const grid = [];

        const headerRow = this._createHeaderRow(cols, headers);
        grid.push(headerRow);

        for (let r = 1; r <= rows; r++) {
            const dataRow = this._createDataRow(r, cols);
            grid.push(dataRow);
        }

        return grid;
    },

    /**
     * Создает строку заголовков
     * @private
     * @param {number} cols - Количество колонок
     * @param {Array<string>} headers - Заголовки
     * @returns {Array} Массив ячеек заголовков
     */
    _createHeaderRow(cols, headers) {
        return Array.from({length: cols}, (_, c) => ({
            content: headers[c] || `Колонка ${c + 1}`,
            isHeader: true,
            colSpan: 1,
            rowSpan: 1,
            originRow: 0,
            originCol: c
        }));
    },

    /**
     * Создает строку данных
     * @private
     * @param {number} rowIndex - Индекс строки
     * @param {number} cols - Количество колонок
     * @returns {Array} Массив пустых ячеек
     */
    _createDataRow(rowIndex, cols) {
        return Array.from({length: cols}, (_, c) => ({
            content: '',
            isHeader: false,
            colSpan: 1,
            rowSpan: 1,
            originRow: rowIndex,
            originCol: c
        }));
    },

    /**
     * Создает объект таблицы
     * @private
     * @param {string} tableId - ID таблицы
     * @param {string} nodeId - ID узла
     * @param {Array} grid - Grid-структура
     * @param {number} cols - Количество колонок
     * @param {boolean} protected - Защита
     * @param {boolean} deletable - Возможность удаления
     * @returns {Object} Объект таблицы
     */
    _createTableObject(tableId, nodeId, grid, cols, protected, deletable) {
        return {
            id: tableId,
            nodeId,
            grid,
            colWidths: new Array(cols).fill(AppConfig.content.defaults.columnWidth),
            protected,
            deletable
        };
    },

    /**
     * Генерирует уникальный ID
     * @private
     * @param {string} prefix - Префикс ID
     * @returns {string} Уникальный ID
     */
    _generateId(prefix) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `${prefix}_${timestamp}_${random}`;
    },

    /**
     * Рекурсивно ищет узел по ID
     * @param {string} id - ID искомого узла
     * @param {Object} [node=this.treeData] - Узел для начала поиска
     * @returns {Object|null} Найденный узел или null
     */
    findNodeById(id, node = this.treeData) {
        if (node.id === id) return node;

        if (!node.children) return null;

        for (const child of node.children) {
            const found = this.findNodeById(id, child);
            if (found) return found;
        }

        return null;
    },

    /**
     * Находит родительский узел
     * @param {string} nodeId - ID дочернего узла
     * @param {Object} [parent=this.treeData] - Узел для начала поиска
     * @returns {Object|null} Родительский узел или null
     */
    findParentNode(nodeId, parent = this.treeData) {
        if (!parent.children) return null;

        for (const child of parent.children) {
            if (child.id === nodeId) return parent;

            const found = this.findParentNode(nodeId, child);
            if (found) return found;
        }

        return null;
    },

    /**
     * Экспортирует состояние для отправки на бэкенд
     * @returns {Object} Сериализованные данные документа
     */
    exportData() {
        return {
            tree: this._serializeTree(this.treeData),
            tables: this._serializeTables(),
            textBlocks: this._serializeTextBlocks(),
            violations: this._serializeViolations()
        };
    },

    /**
     * Рекурсивно сериализует дерево
     * @private
     * @param {Object} node - Узел для сериализации
     * @returns {Object} Сериализованный узел
     */
    _serializeTree(node) {
        const serialized = {
            id: node.id,
            label: node.label,
            type: node.type || 'item',
            protected: node.protected || false
        };

        if (node.type === 'table' && node.tableId) {
            serialized.tableId = node.tableId;
        } else if (node.type === 'textblock' && node.textBlockId) {
            serialized.textBlockId = node.textBlockId;
        } else if (node.type === 'violation' && node.violationId) {
            serialized.violationId = node.violationId;
        } else {
            serialized.content = node.content || '';
        }

        if (node.customLabel) serialized.customLabel = node.customLabel;
        if (node.number) serialized.number = node.number;

        serialized.children = node.children?.map(child => this._serializeTree(child)) || [];

        return serialized;
    },

    /**
     * Сериализует таблицы
     * @private
     * @returns {Object} Сериализованные таблицы
     */
    _serializeTables() {
        const serialized = {};

        for (const [tableId, table] of Object.entries(this.tables)) {
            serialized[tableId] = {
                id: table.id,
                nodeId: table.nodeId,
                grid: table.grid.map(row => row.map(cell => ({
                    content: cell.content || '',
                    isHeader: cell.isHeader || false,
                    colSpan: cell.colSpan || 1,
                    rowSpan: cell.rowSpan || 1,
                    isSpanned: cell.isSpanned || false,
                    spanOrigin: cell.spanOrigin || null,
                    originRow: cell.originRow,
                    originCol: cell.originCol
                }))),
                colWidths: table.colWidths || [],
                protected: table.protected || false
            };
        }

        return serialized;
    },

    /**
     * Сериализует текстовые блоки
     * @private
     * @returns {Object} Сериализованные текстовые блоки
     */
    _serializeTextBlocks() {
        const serialized = {};
        const defaults = AppConfig.content.defaults;

        for (const [blockId, block] of Object.entries(this.textBlocks)) {
            serialized[blockId] = {
                id: block.id,
                nodeId: block.nodeId,
                content: block.content || '',
                formatting: {
                    bold: block.formatting?.bold || defaults.formatting.bold,
                    italic: block.formatting?.italic || defaults.formatting.italic,
                    underline: block.formatting?.underline || defaults.formatting.underline,
                    fontSize: block.formatting?.fontSize || defaults.fontSize,
                    alignment: block.formatting?.alignment || defaults.alignment
                }
            };
        }

        return serialized;
    },

    /**
     * Сериализует нарушения
     * @private
     * @returns {Object} Сериализованные нарушения
     */
    _serializeViolations() {
        const serialized = {};

        for (const [violationId, violation] of Object.entries(this.violations)) {
            serialized[violationId] = {
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
                },
                recommendations: {
                    enabled: violation.recommendations?.enabled || false,
                    content: violation.recommendations?.content || ''
                }
            };
        }

        return serialized;
    }
};
