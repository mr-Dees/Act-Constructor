// Глобальное состояние приложения

const AppState = {
    currentStep: 1,
    treeData: null,
    tables: {},
    textBlocks: {},
    violations: {}, // НОВОЕ: хранилище для "Нарушено/Установлено"
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
            // Для таблиц - нумеровать только среди таблиц
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

            // Для текстовых блоков - нумеровать только среди текстовых блоков
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

            // Для нарушений - нумеровать только среди нарушений
            if (child.type === 'violation') {
                const parentViolations = node.children.filter(c => c.type === 'violation');
                const violationIndex = parentViolations.indexOf(child) + 1;
                child.number = `Нарушение ${violationIndex}`;
                if (!child.customLabel) {
                    child.label = child.number;
                } else {
                    child.label = child.customLabel;
                }
                return;
            }

            // Для обычных пунктов (type === 'item' или undefined) - считать только item-элементы
            const itemChildren = node.children.filter(c => !c.type || c.type === 'item');
            const itemIndex = itemChildren.indexOf(child);

            if (itemIndex === -1) return; // Если не найден в списке item-элементов, пропустить

            const number = prefix ? `${prefix}.${itemIndex + 1}` : `${itemIndex + 1}`;
            const baseLabelMatch = child.label.match(/^[\d.]+\s*(.*)$/);
            const baseLabel = baseLabelMatch ? baseLabelMatch[1] : child.label;

            child.number = number;
            child.label = `${number}. ${baseLabel}`;

            // Рекурсивно обрабатываем детей
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
            label: label || 'Новый пункт',
            children: [],
            content: '',
            type: 'item'
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

                // НОВОЕ: Удаление нарушений
                node.children.filter(c => c.type === 'violation').forEach(violationNode => {
                    delete this.violations[violationNode.violationId];
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

            // НОВОЕ: Если удаляется нарушение
            if (node && node.type === 'violation' && node.violationId) {
                delete this.violations[node.violationId];
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
        if (node.type === 'violation') return {success: false, reason: 'Нельзя добавить таблицу к нарушению'};

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
        if (node.type === 'violation') return {success: false, reason: 'Нельзя добавить текстовый блок к нарушению'};

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

    // НОВОЕ: Добавление нарушения к узлу
    addViolationToNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: 'Узел не найден'};
        if (node.type === 'table') return {success: false, reason: 'Нельзя добавить нарушение к таблице'};
        if (node.type === 'textblock') return {success: false, reason: 'Нельзя добавить нарушение к текстовому блоку'};
        if (node.type === 'violation') return {success: false, reason: 'Нельзя добавить нарушение к нарушению'};

        // Проверка ограничения (максимум 10 нарушений)
        if (!node.children) node.children = [];
        const violationsCount = node.children.filter(c => c.type === 'violation').length;
        if (violationsCount >= 10) {
            return {
                success: false,
                reason: 'Достигнуто максимальное количество нарушений (10) для этого пункта'
            };
        }

        const violationId = `violation_${Date.now()}`;

        // Создание узла нарушения
        const violationNode = {
            id: `${nodeId}_violation_${Date.now()}`,
            label: 'Нарушение',
            type: 'violation',
            violationId: violationId,
            parentId: nodeId
        };

        node.children.push(violationNode);

        // Создание структуры нарушения
        const violation = {
            id: violationId,
            nodeId: violationNode.id,
            violated: '', // Текст для "Нарушено"
            established: '', // Текст для "Установлено"
            descriptionList: {
                enabled: false,
                items: [] // массив строк
            },
            additionalText: {
                enabled: false,
                content: ''
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
            }
        };

        this.violations[violationId] = violation;
        this.generateNumbering();
        return {success: true, violation: violation, violationNode: violationNode};
    },

    // Экспортирует данные для отправки на бэкенд (Формат Pydantic схемы)
    exportData() {
        // Рекурсивно обходим дерево и сериализуем узлы
        const serializeNode = (node) => {
            const serialized = {
                id: node.id,
                label: node.label,
                type: node.type || 'item',
                protected: node.protected || false
            };

            // Добавляем специфичные поля для разных типов
            if (node.type === 'table' && node.tableId) {
                serialized.tableId = node.tableId;
            } else if (node.type === 'textblock' && node.textBlockId) {
                serialized.textBlockId = node.textBlockId;
            } else if (node.type === 'violation' && node.violationId) {
                serialized.violationId = node.violationId;
            } else {
                // Для обычных пунктов добавляем content
                serialized.content = node.content || '';
            }

            // Добавляем кастомные поля
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

        // Сериализуем таблицы
        const serializedTables = {};
        for (const tableId in this.tables) {
            const table = this.tables[tableId];
            serializedTables[tableId] = {
                id: table.id,
                nodeId: table.nodeId,
                rows: table.rows.map(row => ({
                    cells: row.cells.map(cell => ({
                        content: cell.content || '',
                        isHeader: cell.isHeader || false,
                        colspan: cell.colspan || 1,
                        rowspan: cell.rowspan || 1,
                        merged: cell.merged || false
                    }))
                })),
                colWidths: table.colWidths || []
            };
        }

        // Сериализуем текстовые блоки
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

        // Сериализуем нарушения
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
                additionalText: {
                    enabled: violation.additionalText?.enabled || false,
                    content: violation.additionalText?.content || ''
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

        // Формируем итоговую структуру
        return {
            tree: serializeNode(this.treeData),
            tables: serializedTables,
            textBlocks: serializedTextBlocks,
            violations: serializedViolations
        };
    }
};
