// Главный файл приложения

class App {
    static init() {
        // Инициализация состояния
        AppState.initializeTree();

        // Генерировать нумерацию при инициализации
        AppState.generateNumbering();

        // Рендер дерева
        treeManager.render();

        // Обновить предпросмотр
        PreviewManager.update();

        // Навигация между шагами
        this.setupNavigation();

        // Контекстное меню
        ContextMenuManager.init();
    }

    static setupNavigation() {
        const nextBtn = document.getElementById('nextBtn');
        const backBtn = document.getElementById('backBtn');
        const generateBtn = document.getElementById('generateBtn');

        nextBtn.addEventListener('click', () => {
            this.goToStep(2);
        });

        backBtn.addEventListener('click', () => {
            this.goToStep(1);
        });

        generateBtn.addEventListener('click', async () => {
            generateBtn.disabled = true;
            generateBtn.textContent = '⏳ Генерация...';
            const success = await APIClient.generateAct();
            generateBtn.disabled = false;
            generateBtn.textContent = '🚀 Сформировать акт';
            if (success) {
                alert('✅ Акт успешно сформирован!');
            }
        });

        // Клик по шагам в заголовке
        document.querySelectorAll('.step').forEach(step => {
            step.addEventListener('click', () => {
                const stepNum = parseInt(step.dataset.step);
                this.goToStep(stepNum);
            });
        });
    }

    static goToStep(stepNum) {
        AppState.currentStep = stepNum;

        // Обновить активный шаг в заголовке
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
            if (parseInt(step.dataset.step) === stepNum) {
                step.classList.add('active');
            }
        });

        // Показать нужный контент
        document.querySelectorAll('.step-content').forEach(content => {
            content.classList.add('hidden');
        });

        const currentContent = document.getElementById(`step${stepNum}`);
        if (currentContent) {
            currentContent.classList.remove('hidden');
        }

        // Если переходим на шаг 2, отрендерить таблицы
        if (stepNum === 2) {
            tableManager.renderAll();
        }

        // Обновить предпросмотр
        if (stepNum === 1) {
            PreviewManager.update();
        }
    }
}

// Контекстное меню
class ContextMenuManager {
    static menu = null;
    static cellMenu = null;
    static currentNodeId = null;

    static init() {
        this.menu = document.getElementById('contextMenu');
        this.cellMenu = document.getElementById('cellContextMenu');

        // Закрытие при клике вне меню
        document.addEventListener('click', () => {
            this.hide();
        });

        // Обработчики для пунктов меню дерева
        this.menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.handleTreeAction(action);
                this.hide();
            });
        });

        // Обработчики для пунктов меню ячеек
        this.cellMenu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;

                // Проверить, не заблокирован ли пункт
                if (item.classList.contains('disabled')) {
                    return;
                }

                this.handleCellAction(action);
                this.hide();
            });
        });
    }

    static show(x, y, nodeId, type) {
        this.hide();
        const menu = type === 'cell' ? this.cellMenu : this.menu;
        this.currentNodeId = nodeId;

        // Для контекстного меню ячеек - управление доступностью пунктов
        if (type === 'cell') {
            const selectedCellsCount = tableManager.selectedCells.length;

            const mergeCellsItem = this.cellMenu.querySelector('[data-action="merge-cells"]');
            const unmergeCellItem = this.cellMenu.querySelector('[data-action="unmerge-cell"]');

            if (mergeCellsItem) {
                if (selectedCellsCount < 2) {
                    mergeCellsItem.classList.add('disabled');
                } else {
                    mergeCellsItem.classList.remove('disabled');
                }
            }

            if (unmergeCellItem) {
                if (selectedCellsCount === 1) {
                    const cell = tableManager.selectedCells[0];
                    const isMerged = cell.colSpan > 1 || cell.rowSpan > 1;

                    if (isMerged) {
                        unmergeCellItem.classList.remove('disabled');
                    } else {
                        unmergeCellItem.classList.add('disabled');
                    }
                } else {
                    unmergeCellItem.classList.add('disabled');
                }
            }
        }

        // Показать меню временно за пределами экрана для измерения
        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
        menu.classList.remove('hidden');

        // Получить размеры после рендера
        setTimeout(() => {
            const menuRect = menu.getBoundingClientRect();
            const menuWidth = menuRect.width;
            const menuHeight = menuRect.height;

            // Размеры окна
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

            let finalX = x;
            let finalY = y;

            // Проверка по горизонтали
            if (finalX + menuWidth > viewportWidth) {
                // Не влезает справа - показать слева от курсора
                finalX = x - menuWidth;
            }

            // Если все равно выходит за левый край
            if (finalX < 0) {
                finalX = 10;
            }

            // Проверка по вертикали
            if (finalY + menuHeight > viewportHeight) {
                // Не влезает снизу - показать сверху от курсора
                finalY = y - menuHeight;
            }

            // Если все равно выходит за верхний край
            if (finalY < 0) {
                // В крайнем случае прижать к верхнему краю
                finalY = 10;
            }

            // Установить финальную позицию
            menu.style.left = finalX + 'px';
            menu.style.top = finalY + 'px';
        }, 1);
    }

    static hide() {
        if (this.menu) this.menu.classList.add('hidden');
        if (this.cellMenu) this.cellMenu.classList.add('hidden');
    }

    static handleTreeAction(action) {
        const nodeId = this.currentNodeId;
        if (!nodeId) return;

        const node = AppState.findNodeById(nodeId);
        if (!node) return;

        switch (action) {
            case 'add-child':
                const childResult = AppState.addNode(nodeId, 'Новый подпункт', true);
                if (childResult.success) {
                    treeManager.render();
                    PreviewManager.update();
                } else {
                    alert('❌ ' + childResult.reason);
                }
                break;

            case 'add-sibling':
                const siblingResult = AppState.addNode(nodeId, 'Новый пункт', false);
                if (siblingResult.success) {
                    treeManager.render();
                    PreviewManager.update();
                } else {
                    alert('❌ ' + siblingResult.reason);
                }
                break;

            case 'add-table':
                const tableResult = AppState.addTableToNode(nodeId);
                if (tableResult.success) {
                    treeManager.render();
                    PreviewManager.update();
                } else {
                    alert('❌ ' + tableResult.reason);
                }
                break;

            case 'delete':
                if (node.protected) {
                    alert('❌ Этот пункт защищен от удаления');
                    return;
                }
                if (confirm('Удалить этот пункт?')) {
                    AppState.deleteNode(nodeId);
                    treeManager.render();
                    PreviewManager.update();
                }
                break;
        }
    }

    static handleCellAction(action) {
        switch (action) {
            case 'merge-cells':
                tableManager.mergeCells();
                tableManager.renderAll();
                PreviewManager.update();
                break;
            case 'unmerge-cell':
                tableManager.unmergeCells();
                tableManager.renderAll();
                PreviewManager.update();
                break;
        }
    }
}

// Запуск приложения при загрузке
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
