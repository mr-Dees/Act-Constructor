// Глобальное состояние приложения

const AppState = {
    currentStep: 1,
    treeData: null,
    tables: {},
    textBlocks: {}, // Новое хранилище текстовых блоков
    selectedNode: null,
    selectedCells: [],

    // Инициализация базовой структуры
    initializeTree() {
        this.treeData = {
            id: 'root',
            label: 'Акт',
            children: [
                {id: '1', label: 'Основание для составления акта', protected: true, children: [], content: ''},
                {id: '2', label: 'Сведения о земельном участке', protected: true, children: [], content: ''},
                {
                    id: '3',
                    label: 'Сведения об объекте капитального строительства',
                    protected: true,
                    children: [],
                    content: ''
                },
                {id: '4', label: 'Сведения о лицах', protected: true, children: [], content: ''},
                {id: '5', label: 'Сведения о результатах', protected: true, children: [], content: ''}
            ]
        };
        return this.treeData;
    },

    // Генерация автоматической нумерации
    generateNumbering(node = this.treeData, prefix = '') {
        if (!node.children) return;

        node.children.forEach((child, index) => {
            // Пропускаем таблицы и текстовые блоки при нумерации основных пунктов
            if (child.type === 'table') {
                const parentTables = node.children.filter(c => c.type === 'table');
                const tableIndex = parentTables.indexOf(child) + 1;
                child.number = `Таблица ${tableIndex}`;

                if (!child.customLabel) {
                    child.label = child.number;
                } else {
                    child.label = child.customLabel;
                }
                return;
            }

            // Обработка текстовых блоков
            if (child.type === 'textblock') {
                const parentTextBlocks = node.children.filter(c => c.type === 'textblock');
                const textBlockIndex = parentTextBlocks.indexOf(child) + 1;
                child.number = `Текстовый блок ${textBlockIndex}`;

                if (!child.customLabel) {
                    child.label = child.number;
                } else {
                    child.label = child.customLabel;
                }
                return;
            }

            const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
            const baseLabelMatch = child.label.match(/^[\d.]+\s+(.+)$/);
            const baseLabel = baseLabelMatch ? baseLabelMatch[1] : child.label;

            child.number = number;
            child.label = `${number}. ${baseLabel}`;

            if (child.children && child.children.length > 0) {
                this.generateNumbering(child, number);
            }
        });
    },

    // Получить глубину узла в дереве
    getNodeDepth(nodeId, node = this.treeData, depth = 0) {
        if (node.id === nodeId) return depth;
        if (node.children) {
            for (let child of node.children) {
                const found = this.getNodeDepth(nodeId, child, depth + 1);
                if (found !== -1) return found;
            }
        }
        return -1;
    },

    // Проверить, можно ли добавить дочерний элемент
    canAddChild(parentId) {
        const depth = this.getNodeDepth(parentId);
        if (depth >= 4) {
            return {allowed: false, reason: 'Достигнута максимальная вложенность (4 уровня: *.*.*.*)'};
        }
        return {allowed: true};
    },

    // Проверить, можно ли добавить соседний элемент первого уровня
    canAddSibling(nodeId) {
        const parent = this.findParentNode(nodeId);
        if (parent && parent.id === 'root') {
            const hasCustomFirstLevel = parent.children.some(child => {
                const num = child.label.match(/^(\d+)\./);
                return num && parseInt(num[1]) === 6;
            });

            if (hasCustomFirstLevel) {
                return {
                    allowed: false,
                    reason: 'Можно добавить только один дополнительный пункт первого уровня (пункт 6)'
                };
            }

            const nodeIndex = parent.children.findIndex(n => n.id === nodeId);
            if (nodeIndex !== parent.children.length - 1) {
                return {allowed: false, reason: 'Новый пункт первого уровня можно добавить только в конец списка'};
            }
            return {allowed: true};
        }
        return {allowed: true};
    },

    // Методы работы с деревом
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

    addNode(parentId, label, isChild = true) {
        const parent = this.findNodeById(parentId);
        if (!parent) return {success: false, reason: 'Родительский узел не найден'};

        // Проверка ограничений
        if (isChild) {
            const canAdd = this.canAddChild(parentId);
            if (!canAdd.allowed) {
                return {success: false, reason: canAdd.reason};
            }
        } else {
            const canAdd = this.canAddSibling(parentId);
            if (!canAdd.allowed) {
                return {success: false, reason: canAdd.reason};
            }
        }

        const newId = Date.now().toString();
        const newNode = {
            id: newId,
            label: label,
            children: [],
            content: '',
            type: 'item' // Обычный пункт
        };

        if (isChild) {
            if (!parent.children) parent.children = [];
            parent.children.push(newNode);
        } else {
            const grandParent = this.findParentNode(parentId);
            if (grandParent && grandParent.children) {
                const index = grandParent.children.findIndex(n => n.id === parentId);
                grandParent.children.splice(index + 1, 0, newNode);
            }
        }

        this.generateNumbering();
        return {success: true, node: newNode};
    },

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

    deleteNode(nodeId) {
        const parent = this.findParentNode(nodeId);
        if (parent && parent.children) {
            const node = this.findNodeById(nodeId);

            // Если удаляется пункт с таблицами, удаляем и таблицы
            if (node && node.type === 'item' && node.children) {
                node.children.filter(c => c.type === 'table').forEach(tableNode => {
                    delete this.tables[tableNode.tableId];
                });
                // Удаление текстовых блоков
                node.children.filter(c => c.type === 'textblock').forEach(textBlockNode => {
                    delete this.textBlocks[textBlockNode.textBlockId];
                });
            }

            // Если удаляется таблица
            if (node && node.type === 'table' && node.tableId) {
                delete this.tables[node.tableId];
            }

            // Если удаляется текстовый блок
            if (node && node.type === 'textblock' && node.textBlockId) {
                delete this.textBlocks[node.textBlockId];
            }

            parent.children = parent.children.filter(n => n.id !== nodeId);
            this.generateNumbering();
            return true;
        }
        return false;
    },

    updateNodeLabel(nodeId, newLabel) {
        const node = this.findNodeById(nodeId);
        if (node) {
            node.label = newLabel;
            this.generateNumbering();
            return true;
        }
        return false;
    },

    addTableToNode(nodeId, rows = 3, cols = 3) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: 'Узел не найден'};
        if (node.type === 'table') return {success: false, reason: 'Нельзя добавить таблицу к таблице'};
        if (node.type === 'textblock') return {success: false, reason: 'Нельзя добавить таблицу к текстовому блоку'};

        // Проверка ограничения (максимум 10 таблиц)
        if (!node.children) node.children = [];
        const tablesCount = node.children.filter(c => c.type === 'table').length;
        if (tablesCount >= 10) {
            return {success: false, reason: 'Достигнуто максимальное количество таблиц (10) для этого пункта'};
        }

        const tableId = `table_${Date.now()}`;

        // Создание узла таблицы
        const tableNode = {
            id: `${nodeId}_table_${Date.now()}`,
            label: 'Таблица',
            type: 'table',
            tableId: tableId,
            parentId: nodeId
        };

        node.children.push(tableNode);

        // Создание структуры таблицы
        const table = {
            id: tableId,
            nodeId: tableNode.id,
            rows: [],
            colWidths: new Array(cols).fill(100)
        };

        // Заголовки
        const headerRow = {cells: []};
        for (let i = 0; i < cols; i++) {
            headerRow.cells.push({
                content: `Колонка ${i + 1}`,
                isHeader: true,
                colspan: 1,
                rowspan: 1
            });
        }
        table.rows.push(headerRow);

        // Данные
        for (let r = 0; r < rows; r++) {
            const row = {cells: []};
            for (let c = 0; c < cols; c++) {
                row.cells.push({
                    content: '',
                    isHeader: false,
                    colspan: 1,
                    rowspan: 1
                });
            }
            table.rows.push(row);
        }

        this.tables[tableId] = table;
        this.generateNumbering();
        return {success: true, table: table, tableNode: tableNode};
    },

    // Добавление текстового блока к узлу
    addTextBlockToNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: 'Узел не найден'};
        if (node.type === 'table') return {success: false, reason: 'Нельзя добавить текстовый блок к таблице'};
        if (node.type === 'textblock') return {
            success: false,
            reason: 'Нельзя добавить текстовый блок к текстовому блоку'
        };

        // Проверка ограничения (максимум 10 текстовых блоков)
        if (!node.children) node.children = [];
        const textBlocksCount = node.children.filter(c => c.type === 'textblock').length;
        if (textBlocksCount >= 10) {
            return {
                success: false,
                reason: 'Достигнуто максимальное количество текстовых блоков (10) для этого пункта'
            };
        }

        const textBlockId = `textblock_${Date.now()}`;

        // Создание узла текстового блока
        const textBlockNode = {
            id: `${nodeId}_textblock_${Date.now()}`,
            label: 'Текстовый блок',
            type: 'textblock',
            textBlockId: textBlockId,
            parentId: nodeId
        };

        node.children.push(textBlockNode);

        // Создание структуры текстового блока
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

    // Экспорт данных для API
    exportData() {
        return {
            tree: this.treeData,
            tables: this.tables,
            textBlocks: this.textBlocks
        };
    }
};
