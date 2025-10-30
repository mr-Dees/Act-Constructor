/**
 * Модуль контекстного меню для дополнительного контента
 * Добавление и удаление элементов
 */

// Расширение ViolationManager
Object.assign(ViolationManager.prototype, {
    /**
     * Показывает универсальное контекстное меню
     * @param {Event} event - Событие контекстного меню
     * @param {Object} violation - Объект нарушения
     * @param {HTMLElement} contentContainer - Контейнер содержимого
     * @param {string|null} itemId - ID элемента для удаления (null если клик по пустой области)
     * @param {number} insertPosition - Позиция для вставки новых элементов
     */
    showContextMenu(event, violation, contentContainer, itemId, insertPosition) {
        // Удаляем существующее меню, если оно есть
        const existingMenu = document.querySelector('.violation-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'violation-context-menu';

        menu.style.cssText = `
            position: fixed;
            left: ${event.clientX}px;
            top: ${event.clientY}px;
            background: white;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            box-shadow: var(--shadow-lg);
            z-index: 10000;
            min-width: 200px;
            padding: 4px 0;
        `;

        const itemsContainer = contentContainer.querySelector('.additional-content-items');

        // Пункты меню для добавления
        const addMenuItems = [
            {label: '📝 Добавить кейс', action: 'case', type: 'add'},
            {label: '🖼️ Добавить изображение', action: 'image', type: 'add'},
            {label: '📄 Добавить текст', action: 'text', type: 'add'}
        ];

        // Добавляем пункты для добавления
        addMenuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'violation-context-menu-item';
            menuItem.textContent = item.label;

            menuItem.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                transition: background-color 0.2s;
                font-size: 0.875rem;
            `;

            menuItem.addEventListener('mouseenter', () => {
                menuItem.style.backgroundColor = 'var(--primary-subtle)';
            });

            menuItem.addEventListener('mouseleave', () => {
                menuItem.style.backgroundColor = 'transparent';
            });

            menuItem.addEventListener('click', () => {
                this.handleContentItemAdd(violation, item.action, contentContainer, insertPosition);
                menu.remove();
            });

            menu.appendChild(menuItem);
        });

        // Если клик был по элементу, добавляем разделитель и опцию удаления
        if (itemId !== null) {
            // Разделитель
            const separator = document.createElement('div');
            separator.style.cssText = `
                height: 1px;
                background-color: var(--border);
                margin: 4px 0;
            `;
            menu.appendChild(separator);

            // Пункт удаления
            const deleteItem = document.createElement('div');
            deleteItem.className = 'violation-context-menu-item delete';
            deleteItem.textContent = '🗑️ Удалить';

            deleteItem.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                color: var(--danger, #dc3545);
                transition: background-color 0.2s;
                font-size: 0.875rem;
            `;

            deleteItem.addEventListener('mouseenter', () => {
                deleteItem.style.backgroundColor = 'rgba(220, 53, 69, 0.1)';
            });

            deleteItem.addEventListener('mouseleave', () => {
                deleteItem.style.backgroundColor = 'transparent';
            });

            deleteItem.addEventListener('click', () => {
                // Находим элемент по ID и удаляем его
                const itemIndex = violation.additionalContent.items.findIndex(item => item.id === itemId);

                if (itemIndex !== -1) {
                    violation.additionalContent.items.splice(itemIndex, 1);

                    // Обновляем order для всех оставшихся элементов
                    violation.additionalContent.items.forEach((item, idx) => {
                        item.order = idx;
                    });

                    this.renderContentItems(violation, itemsContainer);
                    PreviewManager.update();
                }

                menu.remove();
            });

            menu.appendChild(deleteItem);
        }

        document.body.appendChild(menu);

        // Закрытие меню при клике вне его
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    },

    /**
     * Обрабатывает действие добавления элемента с указанной позицией
     * @param {Object} violation - Объект нарушения
     * @param {string} action - Тип действия ('case', 'image', 'text')
     * @param {HTMLElement} contentContainer - Контейнер содержимого
     * @param {number} insertIndex - Позиция для вставки
     */
    handleContentItemAdd(violation, action, contentContainer, insertIndex) {
        switch (action) {
            case 'case':
                this.addContentItemAtPosition(violation, 'case', contentContainer, insertIndex);
                break;
            case 'image':
                this.triggerImageUploadAtPosition(violation, contentContainer, insertIndex);
                break;
            case 'text':
                this.addContentItemAtPosition(violation, 'freeText', contentContainer, insertIndex);
                break;
        }
    }
});
