/**
 * Core менеджер контекстных меню
 * Координирует работу специфичных менеджеров
 */
class ContextMenuManager {
    static menu = null;
    static cellMenu = null;
    static currentNodeId = null;
    static activeMenuType = null;
    static isInitialized = false;

    // Регистрируем обработчики для каждого типа меню
    static handlers = {
        tree: null,
        cell: null,
        violation: null
    };

    static init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.menu = document.getElementById('contextMenu');
        this.cellMenu = document.getElementById('cellContextMenu');

        this.attachGlobalClickHandler();
        this.initializeMenuHandlers();
    }

    static attachGlobalClickHandler() {
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu') &&
                !e.target.closest('.violation-context-menu')) {
                this.hide();
            }
        });
    }

    static initializeMenuHandlers() {
        if (this.menu) {
            this.handlers.tree = new TreeContextMenu(this.menu);
        }
        if (this.cellMenu) {
            this.handlers.cell = new CellContextMenu(this.cellMenu);
        }
        this.handlers.violation = new ViolationContextMenu();
    }

    static show(x, y, nodeId, type, options = {}) {
        // В режиме только чтения показываем предупреждение вместо меню
        if (AppConfig.readOnlyMode?.isReadOnly) {
            Notifications.warning(AppConfig.readOnlyMode.messages.cannotEdit);
            return;
        }

        this.hide();
        this.currentNodeId = nodeId;
        this.activeMenuType = type;

        const handler = this.handlers[type];
        if (handler) {
            // Все обработчики получают одинаковые параметры
            handler.show(x, y, {nodeId, ...options});
        }
    }

    static positionMenu(menu, x, y) {
        if (!menu) return;

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.classList.remove('hidden');

        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

            let finalX = x;
            let finalY = y;

            if (finalX + menuRect.width > viewportWidth) {
                finalX = x - menuRect.width;
            }
            if (finalX < 0) finalX = 10;

            if (finalY + menuRect.height > viewportHeight) {
                finalY = y - menuRect.height;
            }
            if (finalY < 0) finalY = 10;

            menu.style.left = `${finalX}px`;
            menu.style.top = `${finalY}px`;
        });
    }

    static hide() {
        if (this.menu) this.menu.classList.add('hidden');
        if (this.cellMenu) this.cellMenu.classList.add('hidden');
        if (this.handlers.violation) {
            this.handlers.violation.removeExistingMenu();
        }

        this.activeMenuType = null;
    }
}
