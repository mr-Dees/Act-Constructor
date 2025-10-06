// Управление предпросмотром

class PreviewManager {
    static update() {
        const preview = document.getElementById('preview');
        if (!preview) return;

        preview.innerHTML = '';

        // Заголовок документа
        const title = document.createElement('h1');
        title.textContent = 'АКТ';
        preview.appendChild(title);

        // Рендер дерева
        this.renderNode(AppState.treeData, preview, 1);
    }

    static renderNode(node, container, level) {
        if (!node.children) return;

        node.children.forEach(child => {
            // Заголовок пункта
            const heading = document.createElement(`h${Math.min(level + 1, 4)}`);
            heading.textContent = child.label;
            container.appendChild(heading);

            // Таблицы, если есть
            if (child.tableIds && child.tableIds.length > 0) {
                child.tableIds.forEach(tableId => {
                    if (AppState.tables[tableId]) {
                        const table = this.createPreviewTable(AppState.tables[tableId]);
                        container.appendChild(table);
                    }
                });
            }

            // Рекурсивно для детей
            if (child.children && child.children.length > 0) {
                this.renderNode(child, container, level + 1);
            }
        });
    }

    static createPreviewTable(tableData) {
        const table = document.createElement('table');
        tableData.rows.forEach(row => {
            const tr = document.createElement('tr');
            row.cells.forEach(cell => {
                if (cell.merged) return;
                const cellEl = document.createElement(cell.isHeader ? 'th' : 'td');
                cellEl.textContent = cell.content;
                if (cell.colspan > 1) cellEl.colSpan = cell.colspan;
                if (cell.rowspan > 1) cellEl.rowSpan = cell.rowspan;
                tr.appendChild(cellEl);
            });
            table.appendChild(tr);
        });
        return table;
    }
}
