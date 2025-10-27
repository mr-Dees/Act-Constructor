/**
 * Глобальное состояние приложения
 * Хранит всю информацию о структуре акта, таблицах и текстовых блоках
 */
const AppState = {
    // Текущий шаг конструктора
    currentStep: 1,
    // Дерево структуры документа
    treeData: null,
    // Хранилище таблиц по ID
    tables: {},
    // Хранилище текстовых блоков по ID
    textBlocks: {},
    // Хранилище нарушений (Нарушено/Установлено)
    violations: {},
    // Текущий выбранный узел дерева
    selectedNode: null,
    // Массив выбранных ячеек таблицы
    selectedCells: [],

    /**
     * Инициализирует базовую структуру дерева документа
     * Создаёт корневой элемент с 5 защищёнными разделами первого уровня
     * @returns {Object} Инициализированное дерево документа
     */
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

    /**
     * Генерирует автоматическую нумерацию для всех узлов дерева
     * Обрабатывает разные типы элементов: пункты, таблицы, текстовые блоки и нарушения
     * @param {Object} [node=this.treeData] - Узел для обработки
     * @param {string} [prefix=''] - Префикс нумерации (например, "1.2")
     */
    generateNumbering(node = this.treeData, prefix = '') {
        if (!node.children) return;

        node.children.forEach((child, index) => {
            // Нумерация таблиц - только среди таблиц
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

            // Нумерация текстовых блоков - только среди текстовых блоков
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

            // Нумерация нарушений - только среди нарушений
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

            // Нумерация обычных пунктов (type === 'item' или undefined)
            const itemChildren = node.children.filter(c => !c.type || c.type === 'item');
            const itemIndex = itemChildren.indexOf(child);

            if (itemIndex === -1) return;

            const number = prefix ? `${prefix}.${itemIndex + 1}` : `${itemIndex + 1}`;
            const baseLabelMatch = child.label.match(/^[\d.]+\s*(.*)$/);
            const baseLabel = baseLabelMatch ? baseLabelMatch[1] : child.label;
            child.number = number;
            child.label = `${number}. ${baseLabel}`;

            // Рекурсивная обработка дочерних элементов
            if (child.children && child.children.length > 0) {
                this.generateNumbering(child, number);
            }
        });
    },

    /**
     * Вычисляет глубину узла в дереве
     * @param {string} nodeId - ID узла для проверки
     * @param {Object} [node=this.treeData] - Узел начала поиска
     * @param {number} [depth=0] - Текущая глубина
     * @returns {number} Глубина узла или -1, если узел не найден
     */
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

    /**
     * Проверяет возможность добавления дочернего элемента
     * Максимальная глубина - 4 уровня (*.*.*.*)
     * @param {string} parentId - ID родительского узла
     * @returns {Object} Результат проверки: {allowed: boolean, reason?: string}
     */
    canAddChild(parentId) {
        const depth = this.getNodeDepth(parentId);
        if (depth >= 4) {
            return {allowed: false, reason: 'Достигнута максимальная вложенность (4 уровня: *.*.*.*)'};
        }
        return {allowed: true};
    },

    /**
     * Проверяет возможность добавления соседнего элемента на первом уровне
     * Разрешён только один дополнительный пункт первого уровня (пункт 6)
     * @param {string} nodeId - ID узла, рядом с которым добавляется новый
     * @returns {Object} Результат проверки: {allowed: boolean, reason?: string}
     */
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

    /**
     * Находит узел по его ID в дереве
     * @param {string} id - ID искомого узла
     * @param {Object} [node=this.treeData] - Узел начала поиска
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
     * Добавляет новый узел в дерево
     * @param {string} parentId - ID родительского узла
     * @param {string} label - Название нового узла
     * @param {boolean} [isChild=true] - Добавить как дочерний (true) или соседний (false) элемент
     * @returns {Object} Результат операции: {success: boolean, node?: Object, reason?: string}
     */
    addNode(parentId, label, isChild = true) {
        const parent = this.findNodeById(parentId);
        if (!parent) return {success: false, reason: 'Родительский узел не найден'};

        // Проверка ограничений на добавление
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

    /**
     * Находит родительский узел для заданного узла
     * @param {string} nodeId - ID узла, для которого ищется родитель
     * @param {Object} [parent=this.treeData] - Узел начала поиска
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
     * Удаляет узел из дерева
     * При удалении также удаляются все связанные таблицы, текстовые блоки и нарушения
     * @param {string} nodeId - ID удаляемого узла
     * @returns {boolean} True, если удаление успешно
     */
    deleteNode(nodeId) {
        const parent = this.findParentNode(nodeId);
        if (parent && parent.children) {
            const node = this.findNodeById(nodeId);

            // Удаление связанных данных при удалении пункта с дочерними элементами
            if (node && node.type === 'item' && node.children) {
                node.children.filter(c => c.type === 'table').forEach(tableNode => {
                    delete this.tables[tableNode.tableId];
                });

                node.children.filter(c => c.type === 'textblock').forEach(textBlockNode => {
                    delete this.textBlocks[textBlockNode.textBlockId];
                });

                node.children.filter(c => c.type === 'violation').forEach(violationNode => {
                    delete this.violations[violationNode.violationId];
                });
            }

            // Удаление отдельной таблицы
            if (node && node.type === 'table' && node.tableId) {
                delete this.tables[node.tableId];
            }

            // Удаление отдельного текстового блока
            if (node && node.type === 'textblock' && node.textBlockId) {
                delete this.textBlocks[node.textBlockId];
            }

            // Удаление отдельного нарушения
            if (node && node.type === 'violation' && node.violationId) {
                delete this.violations[node.violationId];
            }

            parent.children = parent.children.filter(n => n.id !== nodeId);
            this.generateNumbering();
            return true;
        }
        return false;
    },

    /**
     * Обновляет название узла
     * @param {string} nodeId - ID узла
     * @param {string} newLabel - Новое название
     * @returns {boolean} True, если обновление успешно
     */
    updateNodeLabel(nodeId, newLabel) {
        const node = this.findNodeById(nodeId);
        if (node) {
            node.label = newLabel;
            this.generateNumbering();
            return true;
        }
        return false;
    },

    /**
     * Добавляет таблицу к узлу дерева
     * @param {string} nodeId - ID узла, к которому добавляется таблица
     * @param {number} [rows=3] - Количество строк данных (без заголовка)
     * @param {number} [cols=3] - Количество колонок
     * @returns {Object} Результат: {success: boolean, table?: Object, tableNode?: Object, reason?: string}
     */
    addTableToNode(nodeId, rows = 3, cols = 3) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: 'Узел не найден'};
        if (node.type === 'table') return {success: false, reason: 'Нельзя добавить таблицу к таблице'};
        if (node.type === 'textblock') return {success: false, reason: 'Нельзя добавить таблицу к текстовому блоку'};
        if (node.type === 'violation') return {success: false, reason: 'Нельзя добавить таблицу к нарушению'};

        // Проверка лимита - максимум 10 таблиц на узел
        if (!node.children) node.children = [];
        const tablesCount = node.children.filter(c => c.type === 'table').length;
        if (tablesCount >= 10) {
            return {success: false, reason: 'Достигнуто максимальное количество таблиц (10) для этого пункта'};
        }

        const tableId = `table_${Date.now()}`;

        // Создание узла таблицы в дереве
        const tableNode = {
            id: `${nodeId}_table_${Date.now()}`,
            label: 'Таблица',
            type: 'table',
            tableId: tableId,
            parentId: nodeId
        };
        node.children.push(tableNode);

        // Создание структуры данных таблицы
        const table = {
            id: tableId,
            nodeId: tableNode.id,
            rows: [],
            colWidths: new Array(cols).fill(100)
        };

        // Строка заголовков
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

        // Строки с данными
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

    /**
     * Добавляет текстовый блок к узлу дерева
     * @param {string} nodeId - ID узла, к которому добавляется текстовый блок
     * @returns {Object} Результат: {success: boolean, textBlock?: Object, textBlockNode?: Object, reason?: string}
     */
    addTextBlockToNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: 'Узел не найден'};
        if (node.type === 'table') return {success: false, reason: 'Нельзя добавить текстовый блок к таблице'};
        if (node.type === 'textblock') return {
            success: false,
            reason: 'Нельзя добавить текстовый блок к текстовому блоку'
        };
        if (node.type === 'violation') return {success: false, reason: 'Нельзя добавить текстовый блок к нарушению'};

        // Проверка лимита - максимум 10 текстовых блоков на узел
        if (!node.children) node.children = [];
        const textBlocksCount = node.children.filter(c => c.type === 'textblock').length;
        if (textBlocksCount >= 10) {
            return {
                success: false,
                reason: 'Достигнуто максимальное количество текстовых блоков (10) для этого пункта'
            };
        }

        const textBlockId = `textblock_${Date.now()}`;

        // Создание узла текстового блока в дереве
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

    /**
     * Добавляет блок нарушения к узлу дерева
     * @param {string} nodeId - ID узла, к которому добавляется нарушение
     * @returns {Object} Результат: {success: boolean, violation?: Object, violationNode?: Object, reason?: string}
     */
    addViolationToNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return {success: false, reason: 'Узел не найден'};
        if (node.type === 'table') return {success: false, reason: 'Нельзя добавить нарушение к таблице'};
        if (node.type === 'textblock') return {success: false, reason: 'Нельзя добавить нарушение к текстовому блоку'};
        if (node.type === 'violation') return {success: false, reason: 'Нельзя добавить нарушение к нарушению'};

        // Проверка лимита - максимум 10 нарушений на узел
        if (!node.children) node.children = [];
        const violationsCount = node.children.filter(c => c.type === 'violation').length;
        if (violationsCount >= 10) {
            return {
                success: false,
                reason: 'Достигнуто максимальное количество нарушений (10) для этого пункта'
            };
        }

        const violationId = `violation_${Date.now()}`;

        // Создание узла нарушения в дереве
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
            violated: '',
            established: '',
            descriptionList: {
                enabled: false,
                items: []
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

    /**
     * Экспортирует данные для отправки на бэкенд
     * Сериализует дерево, таблицы, текстовые блоки и нарушения в формат Pydantic схемы
     * @returns {Object} Полная структура данных документа
     */
    exportData() {
        /**
         * Рекурсивно сериализует узел дерева
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

            // Специфичные поля для разных типов узлов
            if (node.type === 'table' && node.tableId) {
                serialized.tableId = node.tableId;
            } else if (node.type === 'textblock' && node.textBlockId) {
                serialized.textBlockId = node.textBlockId;
            } else if (node.type === 'violation' && node.violationId) {
                serialized.violationId = node.violationId;
            } else {
                serialized.content = node.content || '';
            }

            if (node.customLabel) {
                serialized.customLabel = node.customLabel;
            }

            if (node.number) {
                serialized.number = node.number;
            }

            // Рекурсивная обработка дочерних элементов
            if (node.children && node.children.length > 0) {
                serialized.children = node.children.map(child => serializeNode(child));
            } else {
                serialized.children = [];
            }

            return serialized;
        };

        // Сериализация таблиц
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

        // Сериализация текстовых блоков
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

        // Сериализация нарушений
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

        // Формирование итоговой структуры
        return {
            tree: serializeNode(this.treeData),
            tables: serializedTables,
            textBlocks: serializedTextBlocks,
            violations: serializedViolations
        };
    }
};
