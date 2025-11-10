/**
 * Модуль управления контентом документа.
 * Управляет созданием и добавлением таблиц, текстовых блоков и нарушений к узлам дерева.
 */

// Расширение AppState методами работы с контентом
Object.assign(AppState, {
    /**
     * Добавляет таблицу к узлу дерева с матричной grid-структурой.
     * Создает таблицу с заголовками и пустыми ячейками данных.
     * Ограничение: максимум 10 таблиц на один пункт.
     * @param {string} nodeId - ID узла, к которому добавляется таблица
     * @param {number} rows - Количество строк данных (без заголовка)
     * @param {number} cols - Количество колонок
     * @returns {Object} Результат с флагом success и созданными объектами
     */
    addTableToNode(nodeId, rows = 3, cols = 3) {
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
        const tableId = `table_${Date.now()}`;
        const tableNode = {
            id: `${nodeId}_table_${Date.now()}`,
            label: 'Таблица',
            type: 'table',
            tableId: tableId,
            parentId: nodeId,
            protected: false
        };

        node.children.push(tableNode);

        // Создание матричной структуры таблицы (grid)
        const grid = [];

        // Строка заголовков с дефолтными названиями колонок
        const headerRow = [];
        for (let c = 0; c < cols; c++) {
            headerRow.push({
                content: `Колонка ${c + 1}`,
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
            protected: false
        };

        this.tables[tableId] = table;
        this.generateNumbering();
        return {success: true, table: table, tableNode: tableNode};
    },

    /**
     * Удаляет таблицу из узла дерева.
     * Проверяет защищенность перед удалением.
     * @param {string} tableNodeId - ID узла таблицы
     * @returns {Object} Результат с флагом success
     */
    removeTable(tableNodeId) {
        const tableNode = this.findNodeById(tableNodeId);
        if (!tableNode || tableNode.type !== 'table') {
            return {success: false, reason: 'Таблица не найдена'};
        }

        // Проверка на защищенность
        if (tableNode.protected) {
            return {success: false, reason: 'Эта таблица защищена от удаления'};
        }

        const table = this.tables[tableNode.tableId];
        if (table && table.protected) {
            return {success: false, reason: 'Эта таблица защищена от удаления'};
        }

        const parent = this.findParentNode(tableNodeId);
        if (!parent) return {success: false, reason: 'Родительский узел не найден'};

        // Удаляем узел из дерева
        parent.children = parent.children.filter(child => child.id !== tableNodeId);

        // Удаляем таблицу из хранилища
        if (tableNode.tableId && this.tables[tableNode.tableId]) {
            delete this.tables[tableNode.tableId];
        }

        this.generateNumbering();
        return {success: true};
    },

    /**
     * Добавляет текстовый блок к узлу дерева с поддержкой форматирования.
     * Ограничение: максимум 10 текстовых блоков на один пункт.
     * @param {string} nodeId - ID узла, к которому добавляется текстовый блок
     * @returns {Object} Результат с флагом success и созданными объектами
     */
    addTextBlockToNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: 'Узел не найден'};

        // Валидация типа узла
        if (node.type === 'table') return {success: false, reason: 'Нельзя добавить текстовый блок к таблице'};
        if (node.type === 'textblock') return {
            success: false,
            reason: 'Нельзя добавить текстовый блок к текстовому блоку'
        };
        if (node.type === 'violation') return {success: false, reason: 'Нельзя добавить текстовый блок к нарушению'};

        // Проверка лимита текстовых блоков
        if (!node.children) node.children = [];
        const textBlocksCount = node.children.filter(c => c.type === 'textblock').length;
        if (textBlocksCount >= 10) {
            return {
                success: false,
                reason: 'Достигнуто максимальное количество текстовых блоков (10) для этого пункта'
            };
        }

        // Создание узла текстового блока в дереве
        const textBlockId = `textblock_${Date.now()}`;
        const textBlockNode = {
            id: `${nodeId}_textblock_${Date.now()}`,
            label: 'Текстовый блок',
            type: 'textblock',
            textBlockId: textBlockId,
            parentId: nodeId
        };

        node.children.push(textBlockNode);

        // Создание объекта текстового блока с дефолтным форматированием
        const textBlock = {
            id: textBlockId,
            nodeId: textBlockNode.id,
            content: '',
            formatting: {
                bold: false,
                italic: false,
                underline: false,
                fontSize: 14,
                alignment: 'left'
            }
        };

        this.textBlocks[textBlockId] = textBlock;
        this.generateNumbering();
        return {success: true, textBlock: textBlock, textBlockNode: textBlockNode};
    },

    /**
     * Добавляет нарушение к узлу дерева с полной структурой полей.
     * Поддерживает описание нарушения, дополнительный контент (кейсы, изображения, текст),
     * причины, последствия, рекомендации и ответственное лицо.
     * Ограничение: максимум 10 нарушений на один пункт.
     * @param {string} nodeId - ID узла, к которому добавляется нарушение
     * @returns {Object} Результат с флагом success и созданными объектами
     */
    addViolationToNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: 'Узел не найден'};

        // Валидация типа узла
        if (node.type === 'table') return {success: false, reason: 'Нельзя добавить нарушение к таблице'};
        if (node.type === 'textblock') return {success: false, reason: 'Нельзя добавить нарушение к текстовому блоку'};
        if (node.type === 'violation') return {success: false, reason: 'Нельзя добавить нарушение к нарушению'};

        // Проверка лимита нарушений
        if (!node.children) node.children = [];
        const violationsCount = node.children.filter(c => c.type === 'violation').length;
        if (violationsCount >= 10) {
            return {
                success: false,
                reason: 'Достигнуто максимальное количество нарушений (10) для этого пункта'
            };
        }

        // Создание узла нарушения в дереве
        const violationId = `violation_${Date.now()}`;
        const violationNode = {
            id: `${nodeId}_violation_${Date.now()}`,
            label: 'Нарушение',
            type: 'violation',
            violationId: violationId,
            parentId: nodeId
        };

        node.children.push(violationNode);

        // Создание объекта нарушения с полной структурой опциональных полей
        const violation = {
            id: violationId,
            nodeId: violationNode.id,
            violated: '',                    // Поле "Нарушено"
            established: '',                 // Поле "Установлено"
            descriptionList: {               // Список описаний (метрики)
                enabled: false,
                items: []
            },
            additionalContent: {             // Дополнительный контент (кейсы, изображения, текст)
                enabled: false,
                items: []
            },
            reasons: {                       // Причины нарушения
                enabled: false,
                content: ''
            },
            consequences: {                  // Последствия нарушения
                enabled: false,
                content: ''
            },
            responsible: {                   // Ответственное лицо
                enabled: false,
                content: ''
            },
            recommendations: {               // Рекомендации
                enabled: false,
                content: ''
            }
        };

        this.violations[violationId] = violation;
        this.generateNumbering();
        return {success: true, violation: violation, violationNode: violationNode};
    }
});
