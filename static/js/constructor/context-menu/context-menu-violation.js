/**
 * Обработчик контекстного меню для нарушений
 */
import { ContextMenuManager } from './context-menu-core.js';
import {
    CONTENT_TYPE_CASE,
    CONTENT_TYPE_FREE_TEXT,
    CONTENT_TYPE_IMAGE,
} from '../violation/violation-content-item.js';
import { getImageLimits } from '../violation/violation-image-validator.js';

export class ViolationContextMenu {
    constructor() {
        this.currentMenu = null;
    }

    show(x, y, params = {}) {
        const {
            violation,
            contentContainer,
            itemId = null,
            insertPosition = 0
        } = params;

        // Добавляем проверку на обязательные параметры
        if (!violation || !contentContainer) {
            console.error('ViolationContextMenu: violation и contentContainer обязательны');
            return;
        }

        this.removeExistingMenu();

        this.currentMenu = this.createMenu(violation, contentContainer, itemId, insertPosition);
        this.currentMenu.style.left = `${x}px`;
        this.currentMenu.style.top = `${y}px`;

        document.body.appendChild(this.currentMenu);
        ContextMenuManager.positionMenu(this.currentMenu, x, y);
    }

    createMenu(violation, contentContainer, itemId, insertPosition) {
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

        // action — тип элемента из violation-content-item.js (один источник,
        // без ручного маппинга 'text' → 'freeText').
        const addItems = [
            {label: '📝 Добавить кейс', action: CONTENT_TYPE_CASE},
            {label: '🖼️ Добавить изображение', action: CONTENT_TYPE_IMAGE},
            {label: '📄 Добавить текст', action: CONTENT_TYPE_FREE_TEXT}
        ];

        // Единый гейт лимита (#4): при достижении лимита пункты добавления
        // строятся в disabled-виде — реальный отказ всё равно проверяется
        // в addContentItemAtPosition, здесь только UX-подсказка заранее.
        const itemsCount = violation.additionalContent?.items?.length || 0;
        const limitReached = itemsCount >= getImageLimits().maxItemsPerViolation;

        addItems.forEach(item => {
            menu.appendChild(this.createMenuItem(item.label, () => {
                this.handleAddContent(violation, item.action, contentContainer, insertPosition);
                this.removeExistingMenu();
                ContextMenuManager.hide();
            }, false, limitReached));
        });

        if (itemId !== null) {
            menu.appendChild(this.createSeparator());
            menu.appendChild(this.createMenuItem('🗑️ Удалить', () => {
                this.handleDelete(violation, itemId, contentContainer);
                this.removeExistingMenu();
                ContextMenuManager.hide();
            }, true));
        }

        return menu;
    }

    createMenuItem(label, clickHandler, isDanger = false, disabled = false) {
        const item = document.createElement('div');
        item.className = 'violation-context-menu-item';
        item.textContent = label;

        if (disabled) {
            item.setAttribute('aria-disabled', 'true');
            item.style.cssText = `
                padding: 8px 16px;
                cursor: default;
                font-size: 0.875rem;
                user-select: none;
                color: var(--text-disabled, #999);
            `;
            return item;
        }

        const dangerColor = isDanger ? 'color: var(--danger, #dc3545);' : '';
        item.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            transition: background-color 0.2s;
            font-size: 0.875rem;
            user-select: none;
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

    createSeparator() {
        const separator = document.createElement('div');
        separator.style.cssText = 'height: 1px; background-color: var(--border, #e0e0e0); margin: 4px 0;';
        return separator;
    }

    handleAddContent(violation, action, contentContainer, insertPosition) {
        if (!violation || !contentContainer) return;

        const actions = {
            [CONTENT_TYPE_CASE]: () => {
                violationManager?.addContentItemAtPosition?.(
                    violation,
                    CONTENT_TYPE_CASE,
                    contentContainer,
                    insertPosition
                );
            },
            [CONTENT_TYPE_IMAGE]: () => {
                violationManager?.triggerImageUploadAtPosition?.(
                    violation,
                    contentContainer,
                    insertPosition
                );
            },
            [CONTENT_TYPE_FREE_TEXT]: () => {
                violationManager?.addContentItemAtPosition?.(
                    violation,
                    CONTENT_TYPE_FREE_TEXT,
                    contentContainer,
                    insertPosition
                );
            }
        };

        actions[action]?.();
    }

    handleDelete(violation, itemId, contentContainer) {
        if (!violation || !itemId || !contentContainer) return;

        // Гейт read-only (#11) — внутри removeContentItem, тем же
        // guard'ом, что и остальные мутации нарушения.
        violationManager?.removeContentItem?.(violation, itemId, contentContainer);
    }

    removeExistingMenu() {
        if (this.currentMenu) {
            this.currentMenu.remove();
            this.currentMenu = null;
        }
    }
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.ViolationContextMenu = ViolationContextMenu;
