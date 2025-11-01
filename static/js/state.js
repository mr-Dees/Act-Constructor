/**
 * Глобальное состояние приложения.
 * Централизованное хранилище всей информации о структуре акта, включая
 * древовидную иерархию пунктов, таблицы, текстовые блоки и нарушения.
 * Обеспечивает CRUD-операции и валидацию структуры документа.
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
        return this.treeData;
    },

    /**
     * Генерирует иерархическую нумерацию для всех узлов дерева.
     * Обрабатывает разные типы узлов: обычные пункты (1.1, 1.2.3), таблицы,
     * текстовые блоки и нарушения. Поддерживает пользовательские метки.
     * @param {Object} node - Узел для обработки (по умолчанию корень)
     * @param {string} prefix - Префикс нумерации для текущего уровня
     */
    generateNumbering(node = this.treeData, prefix = '') {
        if (!node.children) return;

        node.children.forEach((child, index) => {
            // Нумерация таблиц в рамках родительского узла
            if (child.type === 'table') {
                const parentTables = node.children.filter(c => c.type === 'table');
                const tableIndex = parentTables.indexOf(child) + 1;
                child.number = `Таблица ${tableIndex}`;
                // Используем пользовательскую метку, если она задана
                if (!child.customLabel) {
                    child.label = child.number;
                } else {
                    child.label = child.customLabel;
                }
                return;
            }

            // Нумерация текстовых блоков в рамках родительского узла
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

            // Нумерация нарушений в рамках родительского узла
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

            // Нумерация обычных пунктов с иерархической структурой (1, 1.1, 1.1.1)
            const itemChildren = node.children.filter(c => !c.type || c.type === 'item');
            const itemIndex = itemChildren.indexOf(child);
            if (itemIndex === -1) return;

            // Формируем номер: для корневого уровня "1", для вложенных "1.1"
            const number = prefix ? `${prefix}.${itemIndex + 1}` : `${itemIndex + 1}`;
            // Извлекаем базовую метку без старой нумерации
            const baseLabelMatch = child.label.match(/^[\d.]+\s*(.*)$/);
            const baseLabel = baseLabelMatch ? baseLabelMatch[1] : child.label;

            child.number = number;
            child.label = `${number}. ${baseLabel}`;

            // Рекурсивно обрабатываем дочерние узлы
            if (child.children && child.children.length > 0) {
                this.generateNumbering(child, number);
            }
        });
    },

    /**
     * Вычисляет глубину узла в дереве (расстояние от корня).
     * @param {string} nodeId - ID искомого узла
     * @param {Object} node - Узел для начала поиска (по умолчанию корень)
     * @param {number} depth - Текущая глубина
     * @returns {number} Глубина узла или -1 если не найден
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
     * Проверяет возможность добавления дочернего узла с учетом ограничения вложенности.
     * Максимальная глубина: 4 уровня (*.*.*.*)
     * @param {string} parentId - ID родительского узла
     * @returns {Object} Объект с флагом allowed и причиной отказа
     */
    canAddChild(parentId) {
        const depth = this.getNodeDepth(parentId);
        if (depth >= 4) {
            return {allowed: false, reason: 'Достигнута максимальная вложенность (4 уровня: *.*.*.*)'};
        }
        return {allowed: true};
    },

    /**
     * Проверяет возможность добавления соседнего узла (sibling).
     * Для первого уровня разрешен только один дополнительный пункт (6-й) в конце списка.
     * @param {string} nodeId - ID узла, после которого добавляется новый
     * @returns {Object} Объект с флагом allowed и причиной отказа
     */
    canAddSibling(nodeId) {
        const parent = this.findParentNode(nodeId);

        // Специальная логика для первого уровня (дети root)
        if (parent && parent.id === 'root') {
            // Проверяем наличие пользовательского пункта 6
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

            // Новый пункт можно добавить только в конец
            const nodeIndex = parent.children.findIndex(n => n.id === nodeId);
            if (nodeIndex !== parent.children.length - 1) {
                return {allowed: false, reason: 'Новый пункт первого уровня можно добавить только в конец списка'};
            }

            return {allowed: true};
        }

        return {allowed: true};
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
     * Добавляет новый узел в дерево как дочерний или соседний элемент.
     * Выполняет валидацию ограничений вложенности и обновляет нумерацию.
     * @param {string} parentId - ID родительского узла (для дочернего) или узла-соседа
     * @param {string} label - Метка нового узла
     * @param {boolean} isChild - true для дочернего узла, false для соседнего
     * @returns {Object} Результат операции с success и причиной отказа
     */
    addNode(parentId, label, isChild = true) {
        const parent = this.findNodeById(parentId);
        if (!parent) return {success: false, reason: 'Родительский узел не найден'};

        // Проверка ограничений перед добавлением
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

        // Создаем новый узел с уникальным ID на основе timestamp
        const newId = Date.now().toString();
        const newNode = {
            id: newId,
            label: label || 'Новый пункт',
            children: [],
            content: '',
            type: 'item'
        };

        // Вставка в дерево
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
     * Удаляет узел из дерева и все связанные данные (таблицы, текстовые блоки, нарушения).
     * Рекурсивно очищает дочерние элементы и обновляет нумерацию.
     * @param {string} nodeId - ID удаляемого узла
     * @returns {boolean} true при успешном удалении
     */
    deleteNode(nodeId) {
        const parent = this.findParentNode(nodeId);
        if (parent && parent.children) {
            const node = this.findNodeById(nodeId);

            // Рекурсивная очистка данных для обычных пунктов
            if (node && node.type === 'item' && node.children) {
                // Удаляем все таблицы из дочерних элементов
                node.children.filter(c => c.type === 'table').forEach(tableNode => {
                    delete this.tables[tableNode.tableId];
                });
                // Удаляем все текстовые блоки из дочерних элементов
                node.children.filter(c => c.type === 'textblock').forEach(textBlockNode => {
                    delete this.textBlocks[textBlockNode.textBlockId];
                });
                // Удаляем все нарушения из дочерних элементов
                node.children.filter(c => c.type === 'violation').forEach(violationNode => {
                    delete this.violations[violationNode.violationId];
                });
            }

            // Удаление таблицы из хранилища
            if (node && node.type === 'table' && node.tableId) {
                delete this.tables[node.tableId];
            }

            // Удаление текстового блока из хранилища
            if (node && node.type === 'textblock' && node.textBlockId) {
                delete this.textBlocks[node.textBlockId];
            }

            // Удаление нарушения из хранилища
            if (node && node.type === 'violation' && node.violationId) {
                delete this.violations[node.violationId];
            }

            // Удаляем узел из дерева
            parent.children = parent.children.filter(n => n.id !== nodeId);
            this.generateNumbering();
            return true;
        }

        return false;
    },

    /**
     * Вычисляет максимальную глубину поддерева от узла (учитываются только пункты, не информационные элементы)
     * @param {Object} node - Узел для проверки
     * @returns {number} Максимальная глубина поддерева
     */
    getSubtreeDepth(node) {
        if (!node.children || node.children.length === 0) {
            return 0;
        }

        let maxDepth = 0;
        for (const child of node.children) {
            // Игнорируем информационные элементы при подсчете глубины
            if (child.type === 'table' || child.type === 'textblock' || child.type === 'violation') {
                continue;
            }

            const childDepth = this.getSubtreeDepth(child);
            maxDepth = Math.max(maxDepth, childDepth + 1);
        }

        return maxDepth;
    },

    /**
     * Перемещает узел в дереве на новую позицию.
     * @param {string} draggedNodeId - ID перемещаемого узла
     * @param {string} targetNodeId - ID целевого узла
     * @param {string} position - Позиция вставки: 'before', 'after', 'child'
     * @returns {Object} Результат операции с флагом success и причиной отказа
     */
    moveNode(draggedNodeId, targetNodeId, position) {
        if (draggedNodeId === targetNodeId) {
            return {success: false, reason: 'Нельзя переместить узел в самого себя'};
        }

        const draggedNode = this.findNodeById(draggedNodeId);
        const targetNode = this.findNodeById(targetNodeId);
        const draggedParent = this.findParentNode(draggedNodeId);

        if (!draggedNode || !targetNode || !draggedParent) {
            return {success: false, reason: 'Узел не найден'};
        }

        if (draggedNode.protected) {
            return {success: false, reason: 'Нельзя перемещать защищенный элемент'};
        }

        if (this.isDescendant(targetNode, draggedNode)) {
            return {success: false, reason: 'Нельзя переместить узел внутрь своего потомка'};
        }

        // Проверка глубины вложенности только для обычных пунктов
        const isDraggedInformational = draggedNode.type === 'table' ||
            draggedNode.type === 'textblock' ||
            draggedNode.type === 'violation';

        if (!isDraggedInformational) {
            let targetDepth;

            if (position === 'child') {
                // При вставке как child - глубина целевого узла + 1
                targetDepth = this.getNodeDepth(targetNodeId);
            } else {
                // При вставке before/after - глубина родителя целевого узла
                const targetParent = this.findParentNode(targetNodeId);
                if (targetParent) {
                    targetDepth = this.getNodeDepth(targetParent.id);
                } else {
                    targetDepth = 0;
                }
            }

            const draggedSubtreeDepth = this.getSubtreeDepth(draggedNode);
            const resultingDepth = targetDepth + 1 + draggedSubtreeDepth;

            if (resultingDepth > 4) {
                return {
                    success: false,
                    reason: `Перемещение приведет к превышению максимальной вложенности (${resultingDepth} > 4 уровней)`
                };
            }
        }

        // Проверка для первого уровня
        const targetParent = this.findParentNode(targetNodeId);
        if (position !== 'child' && targetParent && targetParent.id === 'root') {
            if (draggedParent.id !== 'root') {
                const hasCustomFirstLevel = targetParent.children.some(child => {
                    const num = child.label.match(/^(\d+)\./);
                    return num && parseInt(num[1]) === 6;
                });

                if (hasCustomFirstLevel) {
                    return {
                        success: false,
                        reason: 'На первом уровне уже есть дополнительный пункт (6)'
                    };
                }
            }
        }

        // Удаляем узел из старого родителя
        draggedParent.children = draggedParent.children.filter(n => n.id !== draggedNodeId);

        // Вставляем узел на новое место
        let newParent;
        let insertIndex;

        if (position === 'child') {
            newParent = targetNode;
            if (!newParent.children) newParent.children = [];
            newParent.children.push(draggedNode);
        } else if (position === 'before') {
            newParent = targetParent;
            insertIndex = newParent.children.findIndex(n => n.id === targetNodeId);
            newParent.children.splice(insertIndex, 0, draggedNode);
        } else if (position === 'after') {
            newParent = targetParent;
            insertIndex = newParent.children.findIndex(n => n.id === targetNodeId);
            newParent.children.splice(insertIndex + 1, 0, draggedNode);
        }

        if (draggedNode.parentId) {
            draggedNode.parentId = newParent.id;
        }

        this.generateNumbering();

        return {success: true, node: draggedNode};
    },

    /**
     * Проверяет, является ли node потомком possibleAncestor.
     * @param {Object} node - Проверяемый узел
     * @param {Object} possibleAncestor - Возможный предок
     * @returns {boolean} true, если node является потомком possibleAncestor
     */
    isDescendant(node, possibleAncestor) {
        if (!possibleAncestor.children || possibleAncestor.children.length === 0) {
            return false;
        }

        for (const child of possibleAncestor.children) {
            if (child.id === node.id) {
                return true;
            }
            if (this.isDescendant(node, child)) {
                return true;
            }
        }

        return false;
    },

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
            parentId: nodeId
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
            colWidths: new Array(cols).fill(100)
        };

        this.tables[tableId] = table;
        this.generateNumbering();
        return {success: true, table: table, tableNode: tableNode};
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
     * причины, последствия и ответственное лицо.
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
            }
        };

        this.violations[violationId] = violation;
        this.generateNumbering();
        return {success: true, violation: violation, violationNode: violationNode};
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
                colWidths: table.colWidths || []
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
