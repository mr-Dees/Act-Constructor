// Управление предпросмотром
class PreviewManager {
    static update(options = {}) {
        const {previewTrim = 30} = options;
        const preview = document.getElementById('preview');
        if (!preview) return;

        preview.innerHTML = '';

        // Заголовок документа
        const title = document.createElement('h1');
        title.textContent = 'АКТ';
        preview.appendChild(title);

        // Рендер дерева
        this.renderNode(AppState.treeData, preview, 1, previewTrim);
    }

    static renderNode(node, container, level, previewTrim) {
        if (!node.children) return;

        node.children.forEach(child => {
            // Если это таблица
            if (child.type === 'table') {
                const tableTitle = document.createElement('h4');
                tableTitle.textContent = child.label;
                tableTitle.style.fontWeight = 'bold';
                tableTitle.style.marginTop = '1rem';
                tableTitle.style.marginBottom = '0.5rem';
                container.appendChild(tableTitle);

                if (AppState.tables[child.tableId]) {
                    const table = this.createPreviewTable(AppState.tables[child.tableId], previewTrim);
                    container.appendChild(table);
                }
                return;
            }

            // Заголовок пункта
            const heading = document.createElement(`h${Math.min(level + 1, 4)}`);
            heading.textContent = child.label;
            container.appendChild(heading);

            // Контент пункта (если есть поле content) — обрезаем первые previewTrim символов
            if (child.content && child.content.trim()) {
                const contentDiv = document.createElement('div');
                contentDiv.className = 'preview-content';
                contentDiv.style.marginBottom = '1rem';
                contentDiv.style.padding = '0.5rem';
                const text = child.content.toString();
                const trimmed = text.length > previewTrim ? text.slice(0, previewTrim) + '…' : text;
                contentDiv.textContent = trimmed;
                container.appendChild(contentDiv);
            }

            // Рекурсивно для детей (включая таблицы)
            if (child.children && child.children.length > 0) {
                this.renderNode(child, container, level + 1, previewTrim);
            }
        });
    }

    static createPreviewTable(tableData, previewTrim) {
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
                const text = (cell.content || '').toString();
                const trimmed = text.length > previewTrim ? text.slice(0, previewTrim) + '…' : text;
                cellEl.textContent = trimmed;
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
