/**
 * Модуль управления контентом документа
 *
 * Управляет созданием и удалением таблиц, текстовых блоков и нарушений.
 * Обрабатывает специальные типы таблиц: метрики, регулярные и операционные риски.
 * Делегирует валидацию модулю ValidationTree.
 */

Object.assign(AppState, {
    /**
     * Добавляет таблицу к узлу дерева
     * @param {string} nodeId - ID узла для добавления
     * @param {number} [rows=3] - Количество строк данных (без заголовка)
     * @param {number} [cols=3] - Количество колонок
     * @returns {Object} Результат создания таблицы с полями valid, message
     */
    addTableToNode(nodeId, rows = 3, cols = 3) {
        const node = this.findNodeById(nodeId);

        const validation = ValidationTree.canAddContent(node, AppConfig.nodeTypes.TABLE);
        if (!validation.valid) return validation;

        const tableId = this._generateId('table');
        const tableNode = this._createContentNode(nodeId, tableId, 'table', '', false, true);

        node.children.push(tableNode);

        const headers = this._generateDefaultHeaders(cols);
        const grid = this._createTableGrid(rows, cols, headers);
        const table = this._createTableObject(tableId, tableNode.id, grid, cols, false, true);

        this.tables[tableId] = table;
        this.generateNumbering();

        return ValidationCore.success();
    },

    /**
     * Генерирует заголовки колонок по умолчанию
     * @private
     * @param {number} cols - Количество колонок
     * @returns {string[]} Массив заголовков
     */
    _generateDefaultHeaders(cols) {
        return Array.from({length: cols}, (_, i) => `Колонка ${i + 1}`);
    },

    /**
     * Удаляет таблицу из узла дерева
     * @param {string} tableNodeId - ID узла таблицы
     * @returns {Object} Результат удаления с полями valid, message
     */
    removeTable(tableNodeId) {
        const tableNode = this.findNodeById(tableNodeId);
        if (!tableNode || tableNode.type !== 'table') {
            return ValidationCore.failure(AppConfig.content.errors.notFound('Таблица'));
        }

        if (tableNode.protected) {
            return ValidationCore.failure(AppConfig.content.errors.protectedFromDeletion);
        }

        const table = this.tables[tableNode.tableId];
        if (table?.protected) {
            return ValidationCore.failure(AppConfig.content.errors.protectedFromDeletion);
        }

        const parent = this.findParentNode(tableNodeId);
        if (!parent) {
            return ValidationCore.failure(AppConfig.tree.validation.parentNotFound);
        }

        const isRiskTable = table && (table.isRegularRiskTable || table.isOperationalRiskTable);

        // Удаляем узел из дерева
        parent.children = parent.children.filter(child => child.id !== tableNodeId);

        // Удаляем данные таблицы
        if (tableNode.tableId && this.tables[tableNode.tableId]) {
            delete this.tables[tableNode.tableId];
        }

        this.generateNumbering();

        // Обновляем таблицы метрик если удалили таблицу рисков
        if (isRiskTable) {
            this._cleanupMetricsTablesAfterRiskTableDeleted(tableNodeId);
        }

        return ValidationCore.success();
    },

    /**
     * Добавляет текстовый блок к узлу
     * @param {string} nodeId - ID узла для добавления
     * @returns {Object} Результат создания с полями valid, message
     */
    addTextBlockToNode(nodeId) {
        const node = this.findNodeById(nodeId);

        const validation = ValidationTree.canAddContent(node, AppConfig.nodeTypes.TEXTBLOCK);
        if (!validation.valid) return validation;

        const textBlockId = this._generateId('textblock');
        const textBlockNode = this._createContentNode(nodeId, textBlockId, 'textblock');

        node.children.push(textBlockNode);

        const textBlock = this._createTextBlockObject(textBlockId, textBlockNode.id);

        this.textBlocks[textBlockId] = textBlock;
        this.generateNumbering();

        return ValidationCore.success();
    },

    /**
     * Добавляет нарушение к узлу
     * @param {string} nodeId - ID узла для добавления
     * @returns {Object} Результат создания с полями valid, message
     */
    addViolationToNode(nodeId) {
        const node = this.findNodeById(nodeId);

        const validation = ValidationTree.canAddContent(node, AppConfig.nodeTypes.VIOLATION);
        if (!validation.valid) return validation;

        const violationId = this._generateId('violation');
        const violationNode = this._createContentNode(nodeId, violationId, 'violation');

        node.children.push(violationNode);

        const violation = this._createViolationObject(violationId, violationNode.id);

        this.violations[violationId] = violation;
        this.generateNumbering();

        return ValidationCore.success();
    },

    /**
     * Создает узел контента (таблица, текстовый блок, нарушение)
     * @private
     * @param {string} parentId - ID родительского узла
     * @param {string} contentId - ID контента
     * @param {'table'|'textblock'|'violation'} type - Тип контента
     * @param {string} [label=''] - Название узла
     * @param {boolean} [protected=false] - Защита от изменений
     * @param {boolean} [deletable=true] - Возможность удаления
     * @returns {Object} Узел контента
     */
    _createContentNode(parentId, contentId, type, label = '', protected = false, deletable = true) {
        const defaultLabels = {
            table: AppConfig.tree.labels.table,
            textblock: AppConfig.tree.labels.textBlock,
            violation: AppConfig.tree.labels.violation
        };

        const idProps = {
            table: 'tableId',
            textblock: 'textBlockId',
            violation: 'violationId'
        };

        const node = {
            id: `${parentId}_${type}_${Date.now()}`,
            label: label || defaultLabels[type],
            type,
            [idProps[type]]: contentId,
            parentId,
            protected,
            deletable
        };

        if (label === '') {
            node.customLabel = '';
        } else if (label) {
            node.customLabel = label;
        }

        return node;
    },

    /**
     * Создает объект текстового блока с дефолтными настройками
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
     * Создает объект нарушения с дефолтными настройками
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
     * Создает таблицу метрик для пункта под разделом 5
     * @private
     * @param {string} nodeId - ID узла
     * @param {string} nodeNumber - Номер узла для подписи
     * @returns {Object} Результат создания
     */
    _createMetricsTable(nodeId, nodeNumber) {
        const node = this.findNodeById(nodeId);

        const validation = ValidationTree.canAddContent(node, AppConfig.nodeTypes.TABLE);
        if (!validation.valid) return validation;

        const tableId = this._generateId('table');
        const tableLabel = `Объем выявленных отклонений (В метриках) по ${nodeNumber}`;

        const tableNode = this._createContentNode(nodeId, tableId, 'table', tableLabel, true, true);
        tableNode.isMetricsTable = true;

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
        return ValidationCore.success();
    },

    /**
     * Создает сетку таблицы метрик с объединенными ячейками
     * @private
     * @returns {Array<Array>} Сетка ячеек
     */
    _createMetricsGrid() {
        const grid = [];

        // Первая строка заголовков с объединением
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

        // Вторая строка заголовков
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

        // Строки данных
        for (let r = 2; r < 4; r++) {
            grid.push(this._createDataRow(r, 7));
        }

        return grid;
    },

    /**
     * Создает главную таблицу метрик в разделе 5
     * @private
     * @returns {Object} Результат создания
     */
    _createMainMetricsTable() {
        const node5 = this.findNodeById('5');
        if (!node5) {
            return ValidationCore.failure(AppConfig.tree.validation.nodeNotFound);
        }

        const existingTable = node5.children?.find(
            child => child.type === 'table' && child.isMainMetricsTable === true
        );

        if (existingTable) {
            return ValidationCore.success('Таблица уже существует');
        }

        if (!node5.children) node5.children = [];

        const tableId = this._generateId('table');
        const tableLabel = 'Объем выявленных отклонений';

        const tableNode = this._createContentNode('5', tableId, 'table', tableLabel, true, true);
        tableNode.isMainMetricsTable = true;

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
        return ValidationCore.success();
    },

    /**
     * Находит все таблицы рисков в поддереве
     * @private
     * @param {Object} node - Корневой узел поддерева
     * @returns {Array<Object>} Массив узлов таблиц рисков
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
     * Обновляет таблицы метрик после создания таблицы рисков
     * @private
     * @param {string} nodeId - ID узла с новой таблицей рисков
     */
    _updateMetricsTablesAfterRiskTableCreated(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return;

        // Находим узел первого уровня под пунктом 5
        let ancestorNode = node;
        let parentNode = this.findParentNode(ancestorNode.id);

        while (parentNode && parentNode.id !== '5') {
            ancestorNode = parentNode;
            parentNode = this.findParentNode(ancestorNode.id);
        }

        // Создаем таблицу метрик для узла первого уровня
        if (parentNode?.id === '5' && ancestorNode.number?.match(/^5\.\d+$/)) {
            const hasMetricsTable = ancestorNode.children?.some(
                child => child.type === 'table' && child.isMetricsTable === true
            );

            if (!hasMetricsTable) {
                this._createMetricsTable(ancestorNode.id, ancestorNode.number);
            }
        }

        // Создаем главную таблицу метрик
        this._createMainMetricsTable();
        this.generateNumbering();
    },

    /**
     * Удаляет таблицы метрик после удаления таблицы рисков
     * @private
     * @param {string} deletedNodeId - ID удаленного узла
     */
    _cleanupMetricsTablesAfterRiskTableDeleted(deletedNodeId) {
        const node5 = this.findNodeById('5');
        if (!node5?.children) return;

        const firstLevelNodes = node5.children.filter(child =>
            child.type === 'item' && child.number?.match(/^5\.\d+$/)
        );

        // Проверяем каждый узел первого уровня
        for (const firstLevelNode of firstLevelNodes) {
            const riskTables = this._findRiskTablesInSubtree(firstLevelNode);

            // Если нет таблиц рисков, удаляем таблицу метрик
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

        // Проверяем необходимость главной таблицы метрик
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
     * Создает таблицу регулярных рисков
     * @private
     * @param {string} nodeId - ID узла для добавления
     * @returns {Object} Результат создания
     */
    _createRegularRiskTable(nodeId) {
        const node = this.findNodeById(nodeId);

        const validation = ValidationTree.canAddContent(node, AppConfig.nodeTypes.TABLE);
        if (!validation.valid) return validation;

        const preset = AppConfig.content.tablePresets.regularRisk;
        const tableId = this._generateId('table');

        const tableNode = this._createContentNode(nodeId, tableId, 'table', preset.label, true, true);

        node.children.push(tableNode);

        const grid = this._createTableGrid(preset.rows, preset.headers.length, preset.headers);

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
        return ValidationCore.success();
    },

    /**
     * Создает таблицу операционных рисков
     * @private
     * @param {string} nodeId - ID узла для добавления
     * @returns {Object} Результат создания
     */
    _createOperationalRiskTable(nodeId) {
        const node = this.findNodeById(nodeId);

        const validation = ValidationTree.canAddContent(node, AppConfig.nodeTypes.TABLE);
        if (!validation.valid) return validation;

        const preset = AppConfig.content.tablePresets.operationalRisk;
        const tableId = this._generateId('table');

        const tableNode = this._createContentNode(nodeId, tableId, 'table', preset.label, true, true);

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
        return ValidationCore.success();
    },

    /**
     * Создает сетку таблицы операционных рисков с объединенными ячейками
     * @private
     * @returns {Array<Array>} Сетка ячеек
     */
    _createOperationalRiskGrid() {
        const grid = [];

        // Первая строка заголовков
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

        // Вторая строка заголовков
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

        // Строки данных
        for (let r = 2; r < 4; r++) {
            grid.push(this._createDataRow(r, 6));
        }

        return grid;
    }
});
