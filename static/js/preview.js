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

            // Обработка текстовых блоков с заголовком в превью
            if (node.type === 'textblock') {
                const textBlock = AppState.textBlocks[node.textBlockId];
                if (textBlock) {
                    parts.push(`<div class="preview-textblock-title">${node.label}</div>`);

                    // Извлечь текст без HTML тегов
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = textBlock.content || '';
                    let textContent = tempDiv.textContent || tempDiv.innerText || '';

                    if (previewTrim && textContent.length > previewTrim) {
                        textContent = textContent.substring(0, previewTrim) + '...';
                    }

                    if (textContent) {
                        parts.push(`<div class="preview-textblock-content">${textContent}</div>`);
                    } else {
                        parts.push(`<div class="preview-textblock-content"><em>Пустой блок</em></div>`);
                    }
                }
                return parts.join('');
            }

            // Обработка нарушений - ТЕКСТОВЫЙ ФОРМАТ
            if (child.type === 'violation') {
                const violation = AppState.violations[child.violationId];
                if (violation) {
                    const violationDiv = document.createElement('div');
                    violationDiv.className = 'preview-violation';

                    // Функция для усечения текста
                    const truncate = (text, maxLength = 15) => {
                        if (!text) return '—';
                        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
                    };

                    // Нарушено
                    const violatedLine = document.createElement('div');
                    violatedLine.className = 'preview-violation-line';
                    violatedLine.innerHTML = `<strong>Нарушено:</strong> <span>${truncate(violation.violated)}</span>`;
                    violationDiv.appendChild(violatedLine);

                    // Установлено
                    const establishedLine = document.createElement('div');
                    establishedLine.className = 'preview-violation-line';
                    establishedLine.innerHTML = `<strong>Установлено:</strong> <span>${truncate(violation.established)}</span>`;
                    violationDiv.appendChild(establishedLine);

                    // Список описаний - только количество
                    if (violation.descriptionList.enabled && violation.descriptionList.items.length > 0) {
                        const itemsCount = violation.descriptionList.items.filter(item => item.trim()).length;
                        if (itemsCount > 0) {
                            const listLine = document.createElement('div');
                            listLine.className = 'preview-violation-line';
                            listLine.innerHTML = `<strong>В том числе:</strong> <span>${itemsCount} ${itemsCount === 1 ? 'метрика' : itemsCount < 5 ? 'метрики' : 'метрик'}</span>`;
                            violationDiv.appendChild(listLine);
                        }
                    }

                    // Дополнительный текст (Пометка)
                    if (violation.additionalText.enabled && violation.additionalText.content) {
                        const additionalLine = document.createElement('div');
                        additionalLine.className = 'preview-violation-line';
                        additionalLine.innerHTML = `<strong>Пометка:</strong> <span>${truncate(violation.additionalText.content)}</span>`;
                        violationDiv.appendChild(additionalLine);
                    }

                    // Причины
                    if (violation.reasons.enabled && violation.reasons.content) {
                        const reasonsLine = document.createElement('div');
                        reasonsLine.className = 'preview-violation-line';
                        reasonsLine.innerHTML = `<strong>Причины:</strong> <span>${truncate(violation.reasons.content)}</span>`;
                        violationDiv.appendChild(reasonsLine);
                    }

                    // Последствия
                    if (violation.consequences.enabled && violation.consequences.content) {
                        const consequencesLine = document.createElement('div');
                        consequencesLine.className = 'preview-violation-line';
                        consequencesLine.innerHTML = `<strong>Последствия:</strong> <span>${truncate(violation.consequences.content)}</span>`;
                        violationDiv.appendChild(consequencesLine);
                    }

                    // Ответственный
                    if (violation.responsible.enabled && violation.responsible.content) {
                        const responsibleLine = document.createElement('div');
                        responsibleLine.className = 'preview-violation-line';
                        responsibleLine.innerHTML = `<strong>Ответственный за решение проблем:</strong> <span>${truncate(violation.responsible.content)}</span>`;
                        violationDiv.appendChild(responsibleLine);
                    }

                    container.appendChild(violationDiv);
                }
                return;
            }

            // // Обработка нарушений - КОМПАКТНЫЙ ВИД
            // if (child.type === 'violation') {
            //     const violation = AppState.violations[child.violationId];
            //     if (violation) {
            //         const violationDiv = document.createElement('div');
            //         violationDiv.className = 'preview-violation';
            //
            //         // Компактное отображение - только первые 15 символов
            //         const compactDiv = document.createElement('div');
            //         compactDiv.className = 'preview-violation-compact';
            //
            //         // Иконка
            //         const icon = document.createElement('div');
            //         icon.className = 'preview-violation-icon';
            //         icon.textContent = '⚠️';
            //         compactDiv.appendChild(icon);
            //
            //         // Нарушено - первые 15 символов
            //         const violatedItem = document.createElement('div');
            //         violatedItem.className = 'preview-violation-item';
            //         const violatedLabel = document.createElement('div');
            //         violatedLabel.className = 'preview-violation-item-label';
            //         violatedLabel.textContent = 'Нарушено';
            //         const violatedText = document.createElement('div');
            //         violatedText.className = 'preview-violation-item-text';
            //         const violatedContent = violation.violated || '';
            //         violatedText.textContent = violatedContent.length > 15
            //             ? violatedContent.substring(0, 15) + '...'
            //             : violatedContent;
            //         violatedItem.appendChild(violatedLabel);
            //         violatedItem.appendChild(violatedText);
            //         compactDiv.appendChild(violatedItem);
            //
            //         // Установлено - первые 15 символов
            //         const establishedItem = document.createElement('div');
            //         establishedItem.className = 'preview-violation-item';
            //         const establishedLabel = document.createElement('div');
            //         establishedLabel.className = 'preview-violation-item-label';
            //         establishedLabel.textContent = 'Установлено';
            //         const establishedText = document.createElement('div');
            //         establishedText.className = 'preview-violation-item-text';
            //         const establishedContent = violation.established || '';
            //         establishedText.textContent = establishedContent.length > 15
            //             ? establishedContent.substring(0, 15) + '...'
            //             : establishedContent;
            //         establishedItem.appendChild(establishedLabel);
            //         establishedItem.appendChild(establishedText);
            //         compactDiv.appendChild(establishedItem);
            //
            //         violationDiv.appendChild(compactDiv);
            //         container.appendChild(violationDiv);
            //     }
            //     return;
            // }

            // // Обработка нарушений
            // if (child.type === 'violation') {
            //     const violation = AppState.violations[child.violationId];
            //     if (violation) {
            //         const violationDiv = document.createElement('div');
            //         violationDiv.className = 'preview-violation';
            //
            //         // Колонки Нарушено/Установлено
            //         const columnsDiv = document.createElement('div');
            //         columnsDiv.className = 'preview-violation-columns';
            //
            //         const violatedCol = document.createElement('div');
            //         violatedCol.className = 'preview-violation-column';
            //         const violatedLabel = document.createElement('div');
            //         violatedLabel.className = 'preview-violation-label';
            //         violatedLabel.textContent = 'Нарушено';
            //         const violatedText = document.createElement('div');
            //         violatedText.className = 'preview-violation-text';
            //         violatedText.textContent = violation.violated || '';
            //         violatedCol.appendChild(violatedLabel);
            //         violatedCol.appendChild(violatedText);
            //
            //         const establishedCol = document.createElement('div');
            //         establishedCol.className = 'preview-violation-column';
            //         const establishedLabel = document.createElement('div');
            //         establishedLabel.className = 'preview-violation-label';
            //         establishedLabel.textContent = 'Установлено';
            //         const establishedText = document.createElement('div');
            //         establishedText.className = 'preview-violation-text';
            //         establishedText.textContent = violation.established || '';
            //         establishedCol.appendChild(establishedLabel);
            //         establishedCol.appendChild(establishedText);
            //
            //         columnsDiv.appendChild(violatedCol);
            //         columnsDiv.appendChild(establishedCol);
            //         violationDiv.appendChild(columnsDiv);
            //
            //         // Опциональные поля
            //         if (violation.descriptionList.enabled && violation.descriptionList.items.length > 0) {
            //             const fieldDiv = document.createElement('div');
            //             fieldDiv.className = 'preview-violation-field';
            //             const ul = document.createElement('ul');
            //             violation.descriptionList.items.forEach(item => {
            //                 if (item.trim()) {
            //                     const li = document.createElement('li');
            //                     li.textContent = item;
            //                     ul.appendChild(li);
            //                 }
            //             });
            //             fieldDiv.appendChild(ul);
            //             violationDiv.appendChild(fieldDiv);
            //         }
            //
            //         if (violation.additionalText.enabled && violation.additionalText.content) {
            //             const fieldDiv = document.createElement('div');
            //             fieldDiv.className = 'preview-violation-field';
            //             fieldDiv.textContent = violation.additionalText.content;
            //             violationDiv.appendChild(fieldDiv);
            //         }
            //
            //         if (violation.reasons.enabled && violation.reasons.content) {
            //             const fieldDiv = document.createElement('div');
            //             fieldDiv.className = 'preview-violation-field';
            //             const label = document.createElement('div');
            //             label.className = 'preview-violation-field-label';
            //             label.textContent = 'Причины';
            //             fieldDiv.appendChild(label);
            //             const text = document.createElement('div');
            //             text.textContent = violation.reasons.content;
            //             fieldDiv.appendChild(text);
            //             violationDiv.appendChild(fieldDiv);
            //         }
            //
            //         if (violation.consequences.enabled && violation.consequences.content) {
            //             const fieldDiv = document.createElement('div');
            //             fieldDiv.className = 'preview-violation-field';
            //             const label = document.createElement('div');
            //             label.className = 'preview-violation-field-label';
            //             label.textContent = 'Последствия';
            //             fieldDiv.appendChild(label);
            //             const text = document.createElement('div');
            //             text.textContent = violation.consequences.content;
            //             fieldDiv.appendChild(text);
            //             violationDiv.appendChild(fieldDiv);
            //         }
            //
            //         if (violation.responsible.enabled && violation.responsible.content) {
            //             const fieldDiv = document.createElement('div');
            //             fieldDiv.className = 'preview-violation-field';
            //             const label = document.createElement('div');
            //             label.className = 'preview-violation-field-label';
            //             label.textContent = 'Ответственный за решение проблем';
            //             fieldDiv.appendChild(label);
            //             const text = document.createElement('div');
            //             text.textContent = violation.responsible.content;
            //             fieldDiv.appendChild(text);
            //             violationDiv.appendChild(fieldDiv);
            //         }
            //
            //         container.appendChild(violationDiv);
            //     }
            //     return;
            // }

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
