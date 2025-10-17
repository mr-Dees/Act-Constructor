class TreeManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.selectedNode = null;

        // Инициализация обработчиков сброса выделения
        this.initDeselectionHandlers();
    }

    // НОВЫЙ МЕТОД: Инициализация обработчиков для сброса выделения
    initDeselectionHandlers() {
        // Обработчик клика вне дерева
        document.addEventListener('click', (e) => {
            // Проверяем, был ли клик внутри контейнера дерева
            if (!this.container.contains(e.target)) {
                this.clearSelection();
            }
        });

        // Обработчик нажатия клавиши ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.clearSelection();
            }
        });
    }

    // НОВЫЙ МЕТОД: Сброс выделения
    clearSelection() {
        // Снимаем все выделения
        this.container.querySelectorAll('.tree-item.selected').forEach(el => {
            el.classList.remove('selected');
        });
        this.container.querySelectorAll('.tree-item.parent-selected').forEach(el => {
            el.classList.remove('parent-selected');
        });

        // Обнуляем состояние
        this.selectedNode = null;
        AppState.selectedNode = null;
    }

    render(node = AppState.treeData) {
        this.container.innerHTML = '';
        const ul = this.createTreeElement(node);
        this.container.appendChild(ul);
    }

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

        // Кнопка раскрытия/скрытия
        const toggle = document.createElement('span');
        toggle.className = 'toggle-icon';
        toggle.textContent = (node.children && node.children.length > 0) ? '▼' : '';
        li.appendChild(toggle);

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            li.classList.toggle('collapsed');
            toggle.textContent = li.classList.contains('collapsed') ? '▶' : '▼';
        });

        // Текст label
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = node.label;
        label.contentEditable = false;
        li.appendChild(label);

        // Иконки для специальных типов
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

        // Проверка возможности редактирования
        const canEdit = (node.type !== 'table' && node.type !== 'textblock' && node.type !== 'violation') && !node.protected;

        // Обработчик одинарного/двойного клика на label
        if (canEdit) {
            let clickCount = 0;
            let clickTimer = null;

            label.addEventListener('click', (e) => {
                e.stopPropagation();
                clickCount++;

                if (clickCount === 1) {
                    clickTimer = setTimeout(() => {
                        clickCount = 0;
                        // Одинарный клик - выделение
                        this.selectNode(li);
                    }, 300);
                } else if (clickCount === 2) {
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    // Двойной клик - редактирование
                    this.startEditing(label, node);
                }
            });
        } else {
            // Для защищенных элементов и специальных типов - только выделение при клике на label
            label.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectNode(li);
            });
        }

        // Обработчик клика на элемент (плашку)
        li.addEventListener('click', (e) => {
            // Если клик был на label, toggle или иконку - игнорируем (они обрабатывают сами)
            if (e.target === label ||
                e.target === toggle ||
                e.target.classList.contains('table-icon') ||
                e.target.classList.contains('textblock-icon') ||
                e.target.classList.contains('violation-icon')) {
                return;
            }

            // Клик по плашке - выделение
            e.stopPropagation();
            this.selectNode(li);
        });

        // Контекстное меню - добавлено выделение при ПКМ
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Выделяем элемент перед открытием контекстного меню
            this.selectNode(li);

            ContextMenuManager.show(e.clientX, e.clientY, node.id, 'tree');
        });

        // Дочерние элементы
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

    // Выделение элемента и родителей с различием текущего и родительских
    selectNode(itemElement) {
        // Снимаем все выделения
        this.container.querySelectorAll('.tree-item.selected').forEach(el => {
            el.classList.remove('selected');
        });
        this.container.querySelectorAll('.tree-item.parent-selected').forEach(el => {
            el.classList.remove('parent-selected');
        });

        // Выделяем текущий элемент
        itemElement.classList.add('selected');
        this.selectedNode = itemElement.dataset.nodeId;
        AppState.selectedNode = this.selectedNode;

        // Выделяем всех родителей до корня
        let currentElement = itemElement.parentElement;
        while (currentElement) {
            // Поднимаемся по DOM-дереву
            if (currentElement.classList && currentElement.classList.contains('tree-children')) {
                // Нашли контейнер children, родитель - это li
                const parentLi = currentElement.parentElement;
                if (parentLi && parentLi.classList.contains('tree-item')) {
                    parentLi.classList.add('parent-selected');
                }
            }
            currentElement = currentElement.parentElement;

            // Прерываем, если достигли контейнера дерева
            if (currentElement && currentElement.id === this.container.id) {
                break;
            }
        }
    }

    startEditing(labelElement, node) {
        const item = labelElement.closest('.tree-item');
        item.classList.add('editing');
        labelElement.contentEditable = true;

        // Для таблиц, текстовых блоков и нарушений показываем customLabel
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

        const finishEditing = () => {
            labelElement.contentEditable = false;
            item.classList.remove('editing');

            const newLabel = labelElement.textContent.trim();

            if (node.type === 'table' || node.type === 'textblock' || node.type === 'violation') {
                // Для специальных типов
                if (newLabel && newLabel !== node.label) {
                    node.customLabel = newLabel;
                    node.label = newLabel;
                } else {
                    // Если пустая строка - восстанавливаем стандартное название
                    delete node.customLabel;
                    node.label = node.number;
                }
                AppState.generateNumbering();
                labelElement.textContent = node.label;
                treeManager.render();
                PreviewManager.update();
            } else if (newLabel && newLabel !== node.label) {
                // Для обычных пунктов
                node.label = newLabel;
                AppState.generateNumbering();
                treeManager.render();
                PreviewManager.update();
            } else if (!newLabel) {
                // Если пустая строка - восстанавливаем
                labelElement.textContent = node.label;
            }
        };

        labelElement.addEventListener('blur', finishEditing, {once: true});
        labelElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                labelElement.blur();
            }
            if (e.key === 'Escape') {
                labelElement.textContent = node.label;
                labelElement.blur();
            }
        }, {once: true});
    }
}

const treeManager = new TreeManager('tree');
