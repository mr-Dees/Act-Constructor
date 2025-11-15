/**
 * Ядро управления состоянием приложения
 *
 * Содержит базовые свойства состояния, инициализацию дерева,
 * методы поиска узлов и экспорта данных.
 * Делегирует специализированные операции модулям StateContent, StateTree и ValidationTree.
 */
const AppState = {
    currentStep: 1,
    treeData: null,
    tables: {},
    textBlocks: {},
    violations: {},
    selectedNode: null,
    selectedCells: [],

    /** Инициализирует базовую структуру дерева */
    initializeTree() {
        this.treeData = this._createRootStructure();
        this._createInitialTables();
        return this.treeData;
    },

    /** @private */
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

    /** @private */
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

    /** @private */
    _createInitialTables() {
        const presets = AppConfig.content.tablePresets;

        this._createTableFromPreset('2', presets.qualityAssessment, '', true, false);
        this._createTableFromPreset('3', presets.dataTools, presets.dataTools.label, true, false);
        this._createTableFromPreset('3', presets.dataSources, presets.dataSources.label, true, false);
        this._createTableFromPreset('3', presets.repositories, presets.repositories.label, true, false);
    },

    /** @private */
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

    /** @private */
    _createSimpleTable(nodeId, rows, cols, headers = [], protected = false, deletable = true, label = '') {
        const node = this.findNodeById(nodeId);
        if (!node) {
            return ValidationCore.failure(AppConfig.tree.validation.nodeNotFound);
        }

        const validation = ValidationTree.canAddContent(node, AppConfig.nodeTypes.TABLE);
        if (!validation.valid) return validation;

        const tableId = this._generateId('table');
        const tableNode = this._createTableNode(nodeId, tableId, label, protected, deletable);

        node.children.push(tableNode);

        const grid = this._createTableGrid(rows, cols, headers);
        const table = this._createTableObject(tableId, tableNode.id, grid, cols, protected, deletable);

        this.tables[tableId] = table;

        return ValidationCore.success();
    },

    /** @private */
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

    /** @private */
    _createTableGrid(rows, cols, headers) {
        const grid = [];

        const headerRow = this._createHeaderRow(cols, headers);
        grid.push(headerRow);

        for (let r = 1; r <= rows; r++) {
            grid.push(this._createDataRow(r, cols));
        }

        return grid;
    },

    /** @private */
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

    /** @private */
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

    /** @private */
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

    /** @private */
    _generateId(prefix) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `${prefix}_${timestamp}_${random}`;
    },

    /** Рекурсивно ищет узел по ID */
    findNodeById(id, node = this.treeData) {
        if (node.id === id) return node;
        if (!node.children) return null;

        for (const child of node.children) {
            const found = this.findNodeById(id, child);
            if (found) return found;
        }

        return null;
    },

    /** Находит родительский узел */
    findParentNode(nodeId, parent = this.treeData) {
        if (!parent.children) return null;

        for (const child of parent.children) {
            if (child.id === nodeId) return parent;

            const found = this.findParentNode(nodeId, child);
            if (found) return found;
        }

        return null;
    },

    /** Экспортирует состояние для отправки на бэкенд */
    exportData() {
        return {
            tree: this._serializeTree(this.treeData),
            tables: this._serializeTables(),
            textBlocks: this._serializeTextBlocks(),
            violations: this._serializeViolations()
        };
    },

    /** @private */
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

    /** @private */
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

    /** @private */
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

    /** @private */
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
