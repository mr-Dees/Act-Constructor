// Глобальное состояние приложения

const AppState = {
    currentStep: 1,
    treeData: null,
    tables: {},
    selectedNode: null,
    selectedCells: [],

    // Инициализация базовой структуры
    initializeTree() {
        this.treeData = {
            id: 'root',
            label: 'Акт',
            children: [
                { id: '1', label: 'Основание для составления акта', protected: true, children: [], tableIds: [] },
                { id: '2', label: 'Сведения о земельном участке', protected: true, children: [], tableIds: [] },
                { id: '3', label: 'Сведения об объекте капитального строительства', protected: true, children: [], tableIds: [] },
                { id: '4', label: 'Сведения о лицах', protected: true, children: [], tableIds: [] },
                { id: '5', label: 'Сведения о результатах', protected: true, children: [], tableIds: [] }
            ]
        };
        return this.treeData;
    },

    // Генерация автоматической нумерации
    generateNumbering(node = this.treeData, prefix = '') {
        if (!node.children) return;

        node.children.forEach((child, index) => {
            const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;

            // Обновить метку с номером (сохранить базовое название без старого номера)
            const baseLabelMatch = child.label.match(/^[\d.]+\s+(.+)$/);
            const baseLabel = baseLabelMatch ? baseLabelMatch[1] : child.label;

            child.number = number;
            child.label = `${number}. ${baseLabel}`;

            // Рекурсивно для детей
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
            return { allowed: false, reason: 'Достигнута максимальная вложенность (4 уровня: *.*.*.*)' };
        }
        return { allowed: true };
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
                return { allowed: false, reason: 'Можно добавить только один дополнительный пункт первого уровня (пункт 6)' };
            }

            const nodeIndex = parent.children.findIndex(n => n.id === nodeId);
            if (nodeIndex !== parent.children.length - 1) {
                return { allowed: false, reason: 'Новый пункт первого уровня можно добавить только в конец списка' };
            }
        }

        return { allowed: true };
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
        if (!parent) return { success: false, reason: 'Родительский узел не найден' };

        // Проверка ограничений
        if (isChild) {
            const canAdd = this.canAddChild(parentId);
            if (!canAdd.allowed) {
                return { success: false, reason: canAdd.reason };
            }
        } else {
            const canAdd = this.canAddSibling(parentId);
            if (!canAdd.allowed) {
                return { success: false, reason: canAdd.reason };
            }
        }

        const newId = Date.now().toString();
        const newNode = {
            id: newId,
            label: label,
            children: [],
            tableIds: [] // Массив для хранения ID таблиц
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
        return { success: true, node: newNode };
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
        if (!node) return { success: false, reason: 'Узел не найден' };

        // Проверка ограничения (максимум 10 таблиц)
        if (!node.tableIds) node.tableIds = [];
        if (node.tableIds.length >= 10) {
            return { success: false, reason: 'Достигнуто максимальное количество таблиц (10) для этого пункта' };
        }

        const tableId = `table_${Date.now()}`;
        node.tableIds.push(tableId);

        // Создание структуры таблицы
        const table = {
            id: tableId,
            nodeId: nodeId,
            rows: [],
            colWidths: new Array(cols).fill(100)
        };

        // Заголовки
        const headerRow = { cells: [] };
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
            const row = { cells: [] };
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
        return { success: true, table: table };
    },

    // Экспорт данных для API
    exportData() {
        return {
            tree: this.treeData,
            tables: this.tables
        };
    }
};
