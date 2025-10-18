/**
 * Менеджер дерева элементов акта
 */
class TreeManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.selectedNode = null;
        this.editingElement = null; // Отслеживаем активное редактирование
        this.initDeselectionHandlers();
    }

    /**
     * Инициализация обработчиков для снятия выделения
     */
    initDeselectionHandlers() {
        // Снятие выделения при клике вне дерева
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.clearSelection();
            }
        });

        // Снятие выделения по ESC (только если не редактируем)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.editingElement) {
                this.clearSelection();
            }
        });
    }

    /**
     * Снятие выделения всех узлов
     */
    clearSelection() {
        this.container.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
        this.container.querySelectorAll('.tree-item.parent-selected').forEach(el => el.classList.remove('parent-selected'));
        this.selectedNode = null;
        AppState.selectedNode = null;
    }

    /**
     * Рендеринг дерева
     */
    render(node = AppState.treeData) {
        this.container.innerHTML = '';
        const ul = this.createTreeElement(node);
        this.container.appendChild(ul);
    }

    /**
     * Создание элемента <ul> для дерева
     */
    createTreeElement(node) {
        const ul = document.createElement('ul');
        ul.className = 'tree';

        if (node.children) {
            node.children.forEach(child => {
                const li = this.createNodeElement(child);
                ul.appendChild(li);
            });
        }

        return ul;
    }

    /**
     * Создание элемента узла дерева
     */
    createNodeElement(node) {
        const li = document.createElement('li');
        li.className = 'tree-item';
        li.dataset.nodeId = node.id;

        if (node.protected) {
            li.classList.add('protected');
        }

        if (node.type === 'table') {
            li.classList.add('table-node');
        }

        const toggle = document.createElement('span');
        toggle.className = 'toggle-icon';
        toggle.textContent = (node.children && node.children.length > 0) ? '▼' : '';
        li.appendChild(toggle);

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            li.classList.toggle('collapsed');
            toggle.textContent = li.classList.contains('collapsed') ? '▶' : '▼';
        });

        // Label - всегда можно редактировать (кроме protected)
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = node.label;
        label.contentEditable = false;
        li.appendChild(label);

        // Иконки для разных типов
        if (node.type === 'table') {
            const tableIcon = document.createElement('span');
            tableIcon.className = 'table-icon';
            tableIcon.textContent = '📊';
            tableIcon.style.marginLeft = '5px';
            tableIcon.contentEditable = false;
            li.appendChild(tableIcon);
        } else if (node.type === 'textblock') {
            const textBlockIcon = document.createElement('span');
            textBlockIcon.className = 'textblock-icon';
            textBlockIcon.textContent = '📝';
            textBlockIcon.style.marginLeft = '5px';
            textBlockIcon.contentEditable = false;
            li.classList.add('textblock-node');
            li.appendChild(textBlockIcon);
        } else if (node.type === 'violation') {
            const violationIcon = document.createElement('span');
            violationIcon.className = 'violation-icon';
            violationIcon.textContent = '⚠️';
            violationIcon.style.marginLeft = '5px';
            violationIcon.contentEditable = false;
            li.classList.add('violation-node');
            li.appendChild(violationIcon);
        }

        // ИСПРАВЛЕНИЕ: Разрешаем редактирование для всех типов, кроме protected
        if (!node.protected) {
            let clickCount = 0;
            let clickTimer = null;

            label.addEventListener('click', (e) => {
                e.stopPropagation();
                clickCount++;

                if (clickCount === 1) {
                    clickTimer = setTimeout(() => {
                        clickCount = 0;
                        this.selectNode(li);
                    }, 300);
                } else if (clickCount === 2) {
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    this.startEditing(label, node);
                }
            });

            label.style.cursor = 'pointer';
        } else {
            label.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectNode(li);
            });
        }

        li.addEventListener('click', (e) => {
            if (e.target === label || e.target === toggle ||
                e.target.classList.contains('table-icon') ||
                e.target.classList.contains('textblock-icon') ||
                e.target.classList.contains('violation-icon')) {
                return;
            }
            e.stopPropagation();
            this.selectNode(li);
        });

        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectNode(li);
            ContextMenuManager.show(e.clientX, e.clientY, node.id, 'tree');
        });

        if (node.children && node.children.length > 0) {
            const childrenUl = document.createElement('ul');
            childrenUl.className = 'tree-children';
            node.children.forEach(child => {
                childrenUl.appendChild(this.createNodeElement(child));
            });
            li.appendChild(childrenUl);
        }

        return li;
    }

    /**
     * Выбор узла
     */
    selectNode(itemElement) {
        // Снимаем выделение со всех элементов
        this.container.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
        this.container.querySelectorAll('.tree-item.parent-selected').forEach(el => el.classList.remove('parent-selected'));

        // Выделяем текущий элемент
        itemElement.classList.add('selected');
        this.selectedNode = itemElement.dataset.nodeId;
        AppState.selectedNode = this.selectedNode;

        // Подсвечиваем родительские элементы
        let currentElement = itemElement.parentElement;
        while (currentElement) {
            // Если это ul с классом tree-children, значит его родитель - li
            if (currentElement.classList && currentElement.classList.contains('tree-children')) {
                const parentLi = currentElement.parentElement;
                if (parentLi && parentLi.classList.contains('tree-item')) {
                    parentLi.classList.add('parent-selected');
                }
            }
            currentElement = currentElement.parentElement;

            // Прерываем, если дошли до контейнера
            if (currentElement && currentElement.id === this.container.id) {
                break;
            }
        }
    }

    /**
     * Начало редактирования узла
     */
    startEditing(labelElement, node) {
        const item = labelElement.closest('.tree-item');
        item.classList.add('editing');
        labelElement.contentEditable = true;
        this.editingElement = labelElement;

        const originalLabel = node.label;

        // Для table, textblock, violation показываем customLabel или сгенерированный label
        if (node.type === 'table' || node.type === 'textblock' || node.type === 'violation') {
            const currentLabel = node.customLabel || node.label;
            labelElement.textContent = currentLabel;
        }

        labelElement.focus();
        const range = document.createRange();
        range.selectNodeContents(labelElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        const finishEditing = (cancel = false) => {
            labelElement.contentEditable = false;
            item.classList.remove('editing');
            this.editingElement = null;

            if (cancel) {
                labelElement.textContent = originalLabel;
                return;
            }

            const newLabel = labelElement.textContent.trim();

            // Для table, textblock, violation сохраняем в customLabel
            if (node.type === 'table' || node.type === 'textblock' || node.type === 'violation') {
                if (newLabel && newLabel !== node.label) {
                    node.customLabel = newLabel;
                    node.label = newLabel;
                } else if (!newLabel) {
                    // Если пустое, удаляем customLabel и возвращаем автогенерируемый
                    delete node.customLabel;
                    node.label = node.number || originalLabel;
                    AppState.generateNumbering();
                    labelElement.textContent = node.label;
                }
                treeManager.render();
                PreviewManager.update();
            } else {
                // Для обычных пунктов
                if (newLabel && newLabel !== originalLabel) {
                    node.label = newLabel;
                    AppState.generateNumbering();
                    treeManager.render();
                    PreviewManager.update();
                } else if (!newLabel) {
                    labelElement.textContent = originalLabel;
                } else {
                    labelElement.textContent = node.label;
                }
            }
        };

        const blurHandler = () => finishEditing(false);
        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                labelElement.removeEventListener('blur', blurHandler);
                labelElement.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                labelElement.removeEventListener('blur', blurHandler);
                labelElement.removeEventListener('keydown', keydownHandler);
                finishEditing(true);
            }
        };

        labelElement.addEventListener('blur', blurHandler);
        labelElement.addEventListener('keydown', keydownHandler);
    }
}

// Создаем экземпляр менеджера дерева
const treeManager = new TreeManager('tree');
