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

            // Контент пункта (если есть поле content)
            if (child.content && child.content.trim()) {
                const contentDiv = document.createElement('div');
                contentDiv.className = 'preview-content';
                contentDiv.style.marginBottom = '1rem';
                contentDiv.style.padding = '0.5rem';
                contentDiv.textContent = child.content;
                container.appendChild(contentDiv);
            }

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
        const tableWrapper = document.createElement('div');
        tableWrapper.style.marginBottom = '1.5rem';
        tableWrapper.style.overflowX = 'auto';

        const table = document.createElement('table');
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';
        table.style.marginBottom = '1rem';

        tableData.rows.forEach(row => {
            const tr = document.createElement('tr');
            row.cells.forEach(cell => {
                if (cell.merged) return;

                const cellEl = document.createElement(cell.isHeader ? 'th' : 'td');
                cellEl.textContent = cell.content;
                cellEl.style.border = '1px solid #ddd';
                cellEl.style.padding = '8px';
                cellEl.style.textAlign = 'left';

                if (cell.isHeader) {
                    cellEl.style.backgroundColor = '#f5f5f5';
                    cellEl.style.fontWeight = 'bold';
                }

                if (cell.colspan > 1) cellEl.colSpan = cell.colspan;
                if (cell.rowspan > 1) cellEl.rowSpan = cell.rowspan;

                tr.appendChild(cellEl);
            });
            table.appendChild(tr);
        });

        tableWrapper.appendChild(table);
        return tableWrapper;
    }
}
