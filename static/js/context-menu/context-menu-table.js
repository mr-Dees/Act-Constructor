/**
 * Расширение ContextMenuManager для операций с ячейками таблицы
 */
class CellContextMenu extends ContextMenuManager {
    static initHandlers(menu) {
        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.classList.contains('disabled')) return;

                const action = item.dataset.action;
                this.handleAction(action);
                this.hide();
            });
        });
    }

    static show(x, y, nodeId) {
        if (!this.cellMenu) return;

        this.updateMenuState();
        this.positionMenu(this.cellMenu, x, y);
    }

    static updateMenuState() {
        const selectedCount = tableManager.selectedCells.length;
        const mergeItem = this.cellMenu.querySelector('[data-action="merge-cells"]');
        const unmergeItem = this.cellMenu.querySelector('[data-action="unmerge-cell"]');

        if (mergeItem) {
            mergeItem.classList.toggle('disabled', selectedCount < 2);
        }

        if (unmergeItem) {
            if (selectedCount === 1) {
                const cell = tableManager.selectedCells[0];
                const isMerged = cell.colSpan > 1 || cell.rowSpan > 1;
                unmergeItem.classList.toggle('disabled', !isMerged);
            } else {
                unmergeItem.classList.add('disabled');
            }
        }
    }

    static handleAction(action) {
        const tableSizes = this.saveTableSizes();

        switch (action) {
            case 'merge-cells':
                tableManager.mergeCells();
                this.restoreTableSizes(tableSizes);
                break;
            case 'unmerge-cell':
                tableManager.unmergeCells();
                this.restoreTableSizes(tableSizes);
                break;
        }
    }

    static saveTableSizes() {
        if (tableManager.selectedCells.length === 0) return {};

        const table = tableManager.selectedCells[0].closest('table');
        return tableManager.preserveTableSizes(table);
    }

    static restoreTableSizes(tableSizes) {
        if (AppState.currentStep === 2) {
            ItemsRenderer.renderAll();

            setTimeout(() => {
                document.querySelectorAll('.editable-table').forEach(tbl => {
                    tableManager.applyTableSizes(tbl, tableSizes);
                    const section = tbl.closest('.table-section');
                    if (section) {
                        tableManager.persistTableSizes(section.dataset.tableId, tbl);
                    }
                });
            }, 50);
        } else {
            tableManager.renderAll();
            PreviewManager.update('previewTrim', 30);
        }
    }
}
