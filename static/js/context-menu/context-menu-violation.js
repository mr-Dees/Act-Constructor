/**
 * Расширение ContextMenuManager для операций с нарушениями
 */
class ViolationContextMenu extends ContextMenuManager {
    static show(x, y, options = {}) {
        const {
            violation,
            contentContainer,
            itemId = null,
            insertPosition = 0
        } = options;

        const existingMenu = document.querySelector('.violation-context-menu');
        if (existingMenu) existingMenu.remove();

        const menu = this.createMenu(violation, contentContainer, itemId, insertPosition);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        document.body.appendChild(menu);
        this.positionMenu(menu, x, y);
        this.violationMenu = menu;
    }

    static createMenu(violation, contentContainer, itemId, insertPosition) {
        const menu = document.createElement('div');
        menu.className = 'violation-context-menu';
        menu.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid var(--border, #e0e0e0);
            border-radius: var(--radius, 4px);
            box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.15));
            z-index: 10000;
            min-width: 200px;
            padding: 4px 0;
            font-family: inherit;
        `;

        const addItems = [
            {label: '📝 Добавить кейс', action: 'case'},
            {label: '🖼️ Добавить изображение', action: 'image'},
            {label: '📄 Добавить текст', action: 'text'}
        ];

        addItems.forEach(item => {
            menu.appendChild(this.createMenuItem(item.label, () => {
                this.handleAddContent(violation, item.action, contentContainer, insertPosition);
                menu.remove();
            }));
        });

        if (itemId !== null) {
            menu.appendChild(this.createSeparator());
            menu.appendChild(this.createMenuItem('🗑️ Удалить', () => {
                this.handleDelete(violation, itemId, contentContainer);
                menu.remove();
            }, true));
        }

        return menu;
    }

    static createMenuItem(label, clickHandler, isDanger = false) {
        const item = document.createElement('div');
        item.className = 'violation-context-menu-item';
        item.textContent = label;

        const dangerColor = isDanger ? 'color: var(--danger, #dc3545);' : '';
        item.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            transition: background-color 0.2s;
            font-size: 0.875rem;
            ${dangerColor}
        `;

        item.addEventListener('mouseenter', () => {
            const bgColor = isDanger ? 'rgba(220, 53, 69, 0.1)' : 'var(--primary-subtle, #f0f0f0)';
            item.style.backgroundColor = bgColor;
        });

        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = 'transparent';
        });

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            clickHandler();
        });

        return item;
    }

    static createSeparator() {
        const separator = document.createElement('div');
        separator.style.cssText = 'height: 1px; background-color: var(--border, #e0e0e0); margin: 4px 0;';
        return separator;
    }

    static handleAddContent(violation, action, contentContainer, insertPosition) {
        if (!violation || !contentContainer) return;

        const actions = {
            case: () => violationManager?.addContentItemAtPosition?.(violation, 'case', contentContainer, insertPosition),
            image: () => violationManager?.triggerImageUploadAtPosition?.(violation, contentContainer, insertPosition),
            text: () => violationManager?.addContentItemAtPosition?.(violation, 'freeText', contentContainer, insertPosition)
        };

        actions[action]?.();
    }

    static handleDelete(violation, itemId, contentContainer) {
        if (!violation || !itemId || !contentContainer) return;

        const itemIndex = violation.additionalContent.items.findIndex(item => item.id === itemId);
        if (itemIndex === -1) return;

        violation.additionalContent.items.splice(itemIndex, 1);
        violation.additionalContent.items.forEach((item, idx) => {
            item.order = idx;
        });

        const itemsContainer = contentContainer.querySelector('.additional-content-items');
        if (itemsContainer && violationManager?.renderContentItems) {
            violationManager.renderContentItems(violation, itemsContainer);
        }

        PreviewManager?.update?.();
    }
}
