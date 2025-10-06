// Управление деревом структуры

class TreeManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.selectedNode = null;
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

        // Иконка сворачивания
        const toggle = document.createElement('span');
        toggle.className = 'toggle-icon';
        toggle.textContent = node.children && node.children.length > 0 ? '▼' : '▪';
        li.appendChild(toggle);

        // Обработчик сворачивания/разворачивания
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            li.classList.toggle('collapsed');
            toggle.textContent = li.classList.contains('collapsed') ? '▶' : '▼';
        });

        // Текст узла
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = node.label;
        label.contentEditable = false;
        li.appendChild(label);

        // Индикатор таблиц с счетчиком
        if (node.tableIds && node.tableIds.length > 0) {
            const tableIndicator = document.createElement('span');
            tableIndicator.className = 'table-indicator';
            tableIndicator.textContent = `📊 ${node.tableIds.length}`;
            tableIndicator.title = `Таблиц: ${node.tableIds.length}`;
            li.appendChild(tableIndicator);
        }

        // Двойной клик для редактирования
        label.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.startEditing(label, node);
        });

        // Клик для выбора
        li.addEventListener('click', (e) => {
            if (e.target.classList.contains('tree-label')) return;
            this.selectNode(li);
        });

        // Правый клик для контекстного меню
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            ContextMenuManager.show(e.clientX, e.clientY, node.id, 'tree');
        });

        // Дочерние элементы (рекурсивно)
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

    selectNode(itemElement) {
        // Снять выделение с предыдущего
        this.container.querySelectorAll('.tree-item.selected')
            .forEach(el => el.classList.remove('selected'));

        // Выделить текущий
        itemElement.classList.add('selected');
        this.selectedNode = itemElement.dataset.nodeId;
        AppState.selectedNode = this.selectedNode;
    }

    startEditing(labelElement, node) {
        const item = labelElement.closest('.tree-item');
        if (node.protected) return;

        item.classList.add('editing');
        labelElement.contentEditable = true;
        labelElement.focus();

        // Выделить текст
        const range = document.createRange();
        range.selectNodeContents(labelElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        const finishEditing = () => {
            labelElement.contentEditable = false;
            item.classList.remove('editing');
            const newLabel = labelElement.textContent.trim();
            if (newLabel) {
                AppState.updateNodeLabel(node.id, newLabel);
                PreviewManager.update();
            }
        };

        labelElement.addEventListener('blur', finishEditing, { once: true });

        labelElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                labelElement.blur();
            }
            if (e.key === 'Escape') {
                labelElement.textContent = node.label;
                labelElement.blur();
            }
        }, { once: true });
    }
}

// Инициализация
const treeManager = new TreeManager('tree');
