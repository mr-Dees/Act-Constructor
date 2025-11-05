/**
 * Core менеджер контекстных меню
 * Содержит общую логику и делегирует специфичные операции
 */
class ContextMenuManager {
    static menu = null;
    static cellMenu = null;
    static violationMenu = null;
    static currentNodeId = null;
    static activeMenuType = null;

    static init() {
        this.menu = document.getElementById('contextMenu');
        this.cellMenu = document.getElementById('cellContextMenu');

        // Единый обработчик для закрытия меню
        this.attachGlobalClickHandler();

        // Делегируем инициализацию специфичным менеджерам
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
        // Делегируем инициализацию обработчиков
        if (this.menu) {
            TreeContextMenu.initHandlers(this.menu);
        }
        if (this.cellMenu) {
            CellContextMenu.initHandlers(this.cellMenu);
        }
    }

    static show(x, y, nodeId, type, options = {}) {
        this.hide();
        this.currentNodeId = nodeId;
        this.activeMenuType = type;

        // Делегируем показ нужному менеджеру
        switch (type) {
            case 'tree':
                TreeContextMenu.show(x, y, nodeId);
                break;
            case 'cell':
                CellContextMenu.show(x, y, nodeId);
                break;
            case 'violation':
                ViolationContextMenu.show(x, y, options);
                break;
        }
    }

    static positionMenu(menu, x, y) {
        if (!menu) return;

        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
        menu.classList.remove('hidden');

        setTimeout(() => {
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
        }, 1);
    }

    static hide() {
        if (this.menu) this.menu.classList.add('hidden');
        if (this.cellMenu) this.cellMenu.classList.add('hidden');

        document.querySelectorAll('.violation-context-menu').forEach(m => m.remove());

        this.violationMenu = null;
        this.activeMenuType = null;
    }
}
