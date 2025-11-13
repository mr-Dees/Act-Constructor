/**
 * Модуль управления контентом документа
 *
 * Управляет созданием и удалением таблиц, текстовых блоков и нарушений.
 * Обрабатывает специальные типы таблиц: метрики, регулярные и операционные риски.
 */

Object.assign(AppState, {
    /**
     * Добавляет таблицу к узлу дерева
     * @param {string} nodeId - ID узла для добавления
     * @param {number} rows - Количество строк данных (без заголовка)
     * @param {number} cols - Количество колонок
     * @returns {Object} Результат создания таблицы
     */
    addTableToNode(nodeId, rows = 3, cols = 3) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: AppConfig.tree.validation.nodeNotFound};

        const validation = this._validateTableAddition(node);
        if (!validation.success) return validation;

        const tableId = this._generateId('table');
        const tableNode = this._createTableNode(nodeId, tableId, '', false, true);

        node.children.push(tableNode);

        const headers = this._generateDefaultHeaders(cols);
        const grid = this._createTableGrid(rows, cols, headers);
        const table = this._createTableObject(tableId, tableNode.id, grid, cols, false, true);

        this.tables[tableId] = table;
        this.generateNumbering();

        return {success: true, table, tableNode};
    },

    /**
     * Генерирует заголовки по умолчанию
     * @private
     * @param {number} cols - Количество колонок
     * @returns {Array<string>} Массив заголовков
     */
    _generateDefaultHeaders(cols) {
        return Array.from({length: cols}, (_, i) => `Колонка ${i + 1}`);
    },

    /**
     * Удаляет таблицу из узла дерева
     * @param {string} tableNodeId - ID узла таблицы
     * @returns {Object} Результат удаления
     */
    removeTable(tableNodeId) {
        const tableNode = this.findNodeById(tableNodeId);
        if (!tableNode || tableNode.type !== 'table') {
            return {
                success: false,
                reason: AppConfig.content.errors.notFound('Таблица')
            };
        }

        if (tableNode.protected) {
            return {
                success: false,
                reason: AppConfig.content.errors.protectedFromDeletion
            };
        }

        const table = this.tables[tableNode.tableId];
        if (table?.protected) {
            return {
                success: false,
                reason: AppConfig.content.errors.protectedFromDeletion
            };
        }

        const parent = this.findParentNode(tableNodeId);
        if (!parent) return {
            success: false,
            reason: AppConfig.tree.validation.parentNotFound
        };

        const isRiskTable = table && (table.isRegularRiskTable || table.isOperationalRiskTable);

        parent.children = parent.children.filter(child => child.id !== tableNodeId);

        if (tableNode.tableId && this.tables[tableNode.tableId]) {
            delete this.tables[tableNode.tableId];
        }

        this.generateNumbering();

        if (isRiskTable) {
            this._cleanupMetricsTablesAfterRiskTableDeleted(tableNodeId);
        }

        return {success: true};
    },

    /**
     * Добавляет текстовый блок к узлу
     * @param {string} nodeId - ID узла для добавления
     * @returns {Object} Результат создания текстового блока
     */
    addTextBlockToNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: AppConfig.tree.validation.nodeNotFound};

        const validation = this._validateTextBlockAddition(node);
        if (!validation.success) return validation;

        const textBlockId = this._generateId('textblock');
        const textBlockNode = this._createTextBlockNode(nodeId, textBlockId);

        node.children.push(textBlockNode);

        const textBlock = this._createTextBlockObject(textBlockId, textBlockNode.id);

        this.textBlocks[textBlockId] = textBlock;
        this.generateNumbering();

        return {success: true, textBlock, textBlockNode};
    },

    /**
     * Валидирует возможность добавления текстового блока
     * @private
     * @param {Object} node - Проверяемый узел
     * @returns {Object} Результат валидации
     */
    _validateTextBlockAddition(node) {
        const errors = AppConfig.content.errors;

        if (node.type === 'table') {
            return {success: false, reason: errors.cannotAddToTable.replace('{type}', 'текстовый блок')};
        }
        if (node.type === 'textblock') {
            return {success: false, reason: errors.cannotAddToTextBlock.replace('{type}', 'текстовый блок')};
        }
        if (node.type === 'violation') {
            return {success: false, reason: errors.cannotAddToViolation.replace('{type}', 'текстовый блок')};
        }

        if (!node.children) node.children = [];

        const textBlocksCount = node.children.filter(c => c.type === 'textblock').length;
        const limit = AppConfig.content.limits.textBlocksPerNode;

        if (textBlocksCount >= limit) {
            return {
                success: false,
                reason: errors.limitReached('текстовых блоков', limit)
            };
        }

        return {success: true};
    },

    /**
     * Создает узел текстового блока
     * @private
     * @param {string} parentId - ID родителя
     * @param {string} textBlockId - ID текстового блока
     * @returns {Object} Узел текстового блока
     */
    _createTextBlockNode(parentId, textBlockId) {
        return {
            id: `${parentId}_textblock_${Date.now()}`,
            label: AppConfig.tree.labels.textBlock,
            type: 'textblock',
            textBlockId,
            parentId
        };
    },

    /**
     * Создает объект текстового блока
     * @private
     * @param {string} textBlockId - ID текстового блока
     * @param {string} nodeId - ID узла
     * @returns {Object} Объект текстового блока
     */
    _createTextBlockObject(textBlockId, nodeId) {
        const defaults = AppConfig.content.defaults;

        return {
            id: textBlockId,
            nodeId,
            content: '',
            formatting: {
                bold: defaults.formatting.bold,
                italic: defaults.formatting.italic,
                underline: defaults.formatting.underline,
                fontSize: defaults.fontSize,
                alignment: defaults.alignment
            }
        };
    },

    /**
     * Добавляет нарушение к узлу
     * @param {string} nodeId - ID узла для добавления
     * @returns {Object} Результат создания нарушения
     */
    addViolationToNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: AppConfig.tree.validation.nodeNotFound};

        const validation = this._validateViolationAddition(node);
        if (!validation.success) return validation;

        const violationId = this._generateId('violation');
        const violationNode = this._createViolationNode(nodeId, violationId);

        node.children.push(violationNode);

        const violation = this._createViolationObject(violationId, violationNode.id);

        this.violations[violationId] = violation;
        this.generateNumbering();

        return {success: true, violation, violationNode};
    },

    /**
     * Валидирует возможность добавления нарушения
     * @private
     * @param {Object} node - Проверяемый узел
     * @returns {Object} Результат валидации
     */
    _validateViolationAddition(node) {
        const errors = AppConfig.content.errors;

        if (node.type === 'table') {
            return {success: false, reason: errors.cannotAddToTable.replace('{type}', 'нарушение')};
        }
        if (node.type === 'textblock') {
            return {success: false, reason: errors.cannotAddToTextBlock.replace('{type}', 'нарушение')};
        }
        if (node.type === 'violation') {
            return {success: false, reason: errors.cannotAddToViolation.replace('{type}', 'нарушение')};
        }

        if (!node.children) node.children = [];

        const violationsCount = node.children.filter(c => c.type === 'violation').length;
        const limit = AppConfig.content.limits.violationsPerNode;

        if (violationsCount >= limit) {
            return {
                success: false,
                reason: errors.limitReached('нарушений', limit)
            };
        }

        return {success: true};
    },

    /**
     * Создает узел нарушения
     * @private
     * @param {string} parentId - ID родителя
     * @param {string} violationId - ID нарушения
     * @returns {Object} Узел нарушения
     */
    _createViolationNode(parentId, violationId) {
        return {
            id: `${parentId}_violation_${Date.now()}`,
            label: AppConfig.tree.labels.violation,
            type: 'violation',
            violationId,
            parentId
        };
    },

    /**
     * Создает объект нарушения с полной структурой
     * @private
     * @param {string} violationId - ID нарушения
     * @param {string} nodeId - ID узла
     * @returns {Object} Объект нарушения
     */
    _createViolationObject(violationId, nodeId) {
        return {
            id: violationId,
            nodeId,
            violated: '',
            established: '',
            descriptionList: {
                enabled: false,
                items: []
            },
            additionalContent: {
                enabled: false,
                items: []
            },
            reasons: {
                enabled: false,
                content: ''
            },
            consequences: {
                enabled: false,
                content: ''
            },
            responsible: {
                enabled: false,
                content: ''
            },
            recommendations: {
                enabled: false,
                content: ''
            }
        };
    },

    /**
     * Создает таблицу метрик для пункта 5.*
     * @private
     * @param {string} nodeId - ID узла
     * @param {string} nodeNumber - Номер узла
     * @returns {Object} Результат создания
     */
    _createMetricsTable(nodeId, nodeNumber) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: AppConfig.tree.validation.nodeNotFound};

        const validation = this._validateTableAddition(node);
        if (!validation.success) return validation;

        const tableId = this._generateId('table');
        const tableLabel = `Объем выявленных отклонений (В метриках) по ${nodeNumber}`;

        const tableNode = {
            id: `${nodeId}_table_${Date.now()}`,
            label: tableLabel,
            type: 'table',
            tableId,
            parentId: nodeId,
            protected: true,
            deletable: true,
            customLabel: tableLabel,
            isMetricsTable: true
        };

        node.children.unshift(tableNode);

        const grid = this._createMetricsGrid();
        const preset = AppConfig.content.tablePresets.metrics;

        const table = {
            id: tableId,
            nodeId: tableNode.id,
            grid,
            colWidths: preset.colWidths,
            protected: true,
            deletable: true,
            isMetricsTable: true
        };

        this.tables[tableId] = table;
        return {success: true, table, tableNode};
    },

    /**
     * Создает grid для таблицы метрик
     * @private
     * @returns {Array} Grid-структура
     */
    _createMetricsGrid() {
        const grid = [];

        const headerRow1 = [
            {content: 'Код метрики', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 0},
            {content: 'Наименование метрики', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 1},
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
            {content: 'Сумма, руб.', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 4},
            {content: 'Код БП', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 5},
            {content: 'Пункт / подпункт акта', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 6}
        ];
        grid.push(headerRow1);

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
            {content: 'ФЛ', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 2},
            {content: 'ЮЛ', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 3},
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

        for (let r = 2; r < 4; r++) {
            const dataRow = this._createDataRow(r, 7);
            grid.push(dataRow);
        }

        return grid;
    },

    /**
     * Создает главную таблицу метрик для пункта 5
     * @private
     * @returns {Object} Результат создания
     */
    _createMainMetricsTable() {
        const node5 = this.findNodeById('5');
        if (!node5) return {success: false, reason: AppConfig.tree.validation.nodeNotFound};

        const existingTable = node5.children?.find(
            child => child.type === 'table' && child.isMainMetricsTable === true
        );

        if (existingTable) {
            return {success: true, message: 'Таблица уже существует'};
        }

        if (!node5.children) node5.children = [];

        const tableId = this._generateId('table');
        const tableLabel = 'Объем выявленных отклонений';

        const tableNode = {
            id: `5_table_${Date.now()}`,
            label: tableLabel,
            type: 'table',
            tableId,
            parentId: '5',
            protected: true,
            deletable: true,
            customLabel: tableLabel,
            isMainMetricsTable: true
        };

        node5.children.unshift(tableNode);

        const grid = this._createMetricsGrid();
        const preset = AppConfig.content.tablePresets.metrics;

        const table = {
            id: tableId,
            nodeId: tableNode.id,
            grid,
            colWidths: preset.colWidths,
            protected: true,
            deletable: true,
            isMainMetricsTable: true
        };

        this.tables[tableId] = table;
        return {success: true, table, tableNode};
    },

    /**
     * Находит все таблицы рисков в поддереве
     * @private
     * @param {Object} node - Корневой узел
     * @returns {Array} Массив узлов таблиц рисков
     */
    _findRiskTablesInSubtree(node) {
        let riskTables = [];

        if (node.children) {
            for (const child of node.children) {
                if (child.type === 'table' && child.tableId) {
                    const table = this.tables[child.tableId];
                    if (table && (table.isRegularRiskTable || table.isOperationalRiskTable)) {
                        riskTables.push(child);
                    }
                }
                riskTables = riskTables.concat(this._findRiskTablesInSubtree(child));
            }
        }

        return riskTables;
    },

    /**
     * Обновляет таблицы метрик после создания таблицы риска
     * @private
     * @param {string} nodeId - ID узла с таблицей риска
     */
    _updateMetricsTablesAfterRiskTableCreated(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return;

        let ancestorNode = node;
        let parentNode = this.findParentNode(ancestorNode.id);

        while (parentNode && parentNode.id !== '5') {
            ancestorNode = parentNode;
            parentNode = this.findParentNode(ancestorNode.id);
        }

        if (parentNode?.id === '5' && ancestorNode.number?.match(/^5\.\d+$/)) {
            const hasMetricsTable = ancestorNode.children?.some(
                child => child.type === 'table' && child.isMetricsTable === true
            );

            if (!hasMetricsTable) {
                this._createMetricsTable(ancestorNode.id, ancestorNode.number);
            }
        }

        this._createMainMetricsTable();
        this.generateNumbering();
    },

    /**
     * Очищает таблицы метрик после удаления таблицы риска
     * @private
     * @param {string} deletedNodeId - ID удаленного узла
     */
    _cleanupMetricsTablesAfterRiskTableDeleted(deletedNodeId) {
        const node5 = this.findNodeById('5');
        if (!node5?.children) return;

        const firstLevelNodes = node5.children.filter(child =>
            child.type === 'item' && child.number?.match(/^5\.\d+$/)
        );

        for (const firstLevelNode of firstLevelNodes) {
            const riskTables = this._findRiskTablesInSubtree(firstLevelNode);

            if (riskTables.length === 0) {
                const metricsTableNode = firstLevelNode.children?.find(
                    child => child.type === 'table' && child.isMetricsTable === true
                );

                if (metricsTableNode) {
                    delete this.tables[metricsTableNode.tableId];
                    firstLevelNode.children = firstLevelNode.children.filter(
                        child => child.id !== metricsTableNode.id
                    );
                }
            }
        }

        const allRiskTables = this._findRiskTablesInSubtree(node5);

        if (allRiskTables.length === 0) {
            const mainMetricsTableNode = node5.children?.find(
                child => child.type === 'table' && child.isMainMetricsTable === true
            );

            if (mainMetricsTableNode) {
                delete this.tables[mainMetricsTableNode.tableId];
                node5.children = node5.children.filter(
                    child => child.id !== mainMetricsTableNode.id
                );
            }
        }

        this.generateNumbering();
    },

    /**
     * Создает таблицу регулярного риска
     * @private
     * @param {string} nodeId - ID узла
     * @returns {Object} Результат создания
     */
    _createRegularRiskTable(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: AppConfig.tree.validation.nodeNotFound};

        const validation = this._validateTableAddition(node);
        if (!validation.success) return validation;

        const preset = AppConfig.content.tablePresets.regularRisk;
        const tableId = this._generateId('table');

        const tableNode = {
            id: `${nodeId}_table_${Date.now()}`,
            label: preset.label,
            type: 'table',
            tableId,
            parentId: nodeId,
            protected: true,
            deletable: true,
            customLabel: preset.label
        };

        node.children.push(tableNode);

        const grid = this._createTableGrid(preset.rows, preset.cols, preset.headers);

        const table = {
            id: tableId,
            nodeId: tableNode.id,
            grid,
            colWidths: preset.colWidths,
            protected: true,
            deletable: true,
            isRegularRiskTable: true
        };

        this.tables[tableId] = table;
        return {success: true, table, tableNode};
    },

    /**
     * Создает таблицу операционного риска
     * @private
     * @param {string} nodeId - ID узла
     * @returns {Object} Результат создания
     */
    _createOperationalRiskTable(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: AppConfig.tree.validation.nodeNotFound};

        const validation = this._validateTableAddition(node);
        if (!validation.success) return validation;

        const preset = AppConfig.content.tablePresets.operationalRisk;
        const tableId = this._generateId('table');

        const tableNode = {
            id: `${nodeId}_table_${Date.now()}`,
            label: preset.label,
            type: 'table',
            tableId,
            parentId: nodeId,
            protected: true,
            deletable: true,
            customLabel: preset.label
        };

        node.children.push(tableNode);

        const grid = this._createOperationalRiskGrid();

        const table = {
            id: tableId,
            nodeId: tableNode.id,
            grid,
            colWidths: preset.colWidths,
            protected: true,
            deletable: true,
            isOperationalRiskTable: true
        };

        this.tables[tableId] = table;
        return {success: true, table, tableNode};
    },

    /**
     * Создает grid для таблицы операционного риска
     * @private
     * @returns {Array} Grid-структура
     */
    _createOperationalRiskGrid() {
        const grid = [];

        const headerRow1 = [
            {content: 'ОР', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0},
            {
                content: 'Отклонения с признаками операционного риска (далее - ОР)',
                isHeader: true,
                colSpan: 5,
                rowSpan: 1,
                originRow: 0,
                originCol: 1
            },
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 0, col: 1},
                originRow: 0,
                originCol: 2
            },
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 0, col: 1},
                originRow: 0,
                originCol: 3
            },
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 0, col: 1},
                originRow: 0,
                originCol: 4
            },
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 0, col: 1},
                originRow: 0,
                originCol: 5
            }
        ];
        grid.push(headerRow1);

        const headerRow2 = [
            {content: 'Код процесса', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 0},
            {content: 'Блок - владелец процесса', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 1},
            {
                content: 'Тип рискового события (уровень 2)',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                originRow: 1,
                originCol: 2
            },
            {content: 'Оценка суммы события, руб', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 3},
            {content: 'Подтип и сумма последствия', isHeader: true, colSpan: 2, rowSpan: 1, originRow: 1, originCol: 4},
            {
                content: '',
                isHeader: true,
                colSpan: 1,
                rowSpan: 1,
                isSpanned: true,
                spanOrigin: {row: 1, col: 4},
                originRow: 1,
                originCol: 5
            }
        ];
        grid.push(headerRow2);

        for (let r = 2; r < 4; r++) {
            const dataRow = this._createDataRow(r, 6);
            grid.push(dataRow);
        }

        return grid;
    }
});
