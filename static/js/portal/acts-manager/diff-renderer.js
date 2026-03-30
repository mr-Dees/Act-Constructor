/**
 * DOM-рендеринг diff с цветовой подсветкой.
 * Работает на основе результатов DiffEngine.compute().
 */
class DiffRenderer {
    /**
     * Рендерит полный diff в контейнер.
     * @param {HTMLElement} container
     * @param {Object} diffResult — результат DiffEngine.compute()
     * @param {boolean} onlyChanges — true = скрыть unchanged элементы
     */
    static render(container, diffResult, onlyChanges = false) {
        container.innerHTML = '';
        container.classList.toggle('diff-changes-only', onlyChanges);

        const tree = diffResult.tree?.tree;
        if (!tree) {
            container.innerHTML = '<div class="audit-log-empty">Нет данных дерева</div>';
            return;
        }

        this._renderDiffNode(container, tree, diffResult, 0, onlyChanges);

        // Удалённые узлы
        if (diffResult.tree?.removedNodes?.length) {
            for (const node of diffResult.tree.removedNodes) {
                this._renderDiffNode(container, node, diffResult, 0, onlyChanges);
            }
        }
    }

    /**
     * Рекурсивный рендер узла дерева с diff-аннотацией.
     */
    static _renderDiffNode(container, node, diffResult, depth, onlyChanges) {
        if (!node) return;

        const diffStatus = node._diff || 'unchanged';
        const type = node.type || 'item';

        // Определяем, есть ли изменения в содержимом этого узла
        const hasContentChanges = this._nodeHasContentChanges(node, diffResult);
        const effectiveStatus = diffStatus === 'unchanged' && hasContentChanges ? 'modified' : diffStatus;
        const isUnchanged = effectiveStatus === 'unchanged' && !hasContentChanges;

        // Контейнер узла
        const nodeDiv = document.createElement('div');
        nodeDiv.className = `diff-node diff-${effectiveStatus}`;
        if (isUnchanged) nodeDiv.classList.add('diff-unchanged');

        // Заголовок пункта
        if (type === 'item' || !type) {
            const level = Math.min(depth + 1, 5);
            const heading = document.createElement(`h${level}`);
            heading.className = 'version-preview-heading';
            const number = node.number ? `${node.number}. ` : '';
            heading.textContent = `${number}${node.label || ''}`;
            if (effectiveStatus === 'added') heading.textContent += ' (ДОБАВЛЕНО)';
            if (effectiveStatus === 'removed') heading.textContent += ' (УДАЛЕНО)';
            nodeDiv.appendChild(heading);
        }

        // Таблица
        if (type === 'table' && node.tableId) {
            const tableDiff = diffResult.tables[node.tableId];
            if (tableDiff) {
                const label = document.createElement('div');
                label.className = 'version-preview-label';
                label.textContent = node.customLabel || node.label || 'Таблица';
                nodeDiv.appendChild(label);

                if (tableDiff.status !== 'unchanged' || !onlyChanges) {
                    this._renderDiffTable(nodeDiv, tableDiff);
                }
            }
        }

        // Текстблок
        if (type === 'textblock' && node.textBlockId) {
            const tbDiff = diffResult.textblocks[node.textBlockId];
            if (tbDiff) {
                const label = document.createElement('div');
                label.className = 'version-preview-label';
                label.textContent = node.customLabel || node.label || 'Текстовый блок';
                nodeDiv.appendChild(label);

                if (tbDiff.status !== 'unchanged' || !onlyChanges) {
                    this._renderDiffTextBlock(nodeDiv, tbDiff);
                }
            }
        }

        // Нарушение
        if (type === 'violation' && node.violationId) {
            const violDiff = diffResult.violations[node.violationId];
            if (violDiff) {
                const label = document.createElement('div');
                label.className = 'version-preview-label';
                label.textContent = node.customLabel || node.label || 'Нарушение';
                nodeDiv.appendChild(label);

                if (violDiff.status !== 'unchanged' || !onlyChanges) {
                    this._renderDiffViolation(nodeDiv, violDiff);
                }
            }
        }

        container.appendChild(nodeDiv);

        // Рекурсия
        if (node.children) {
            for (const child of node.children) {
                this._renderDiffNode(container, child, diffResult, depth + 1, onlyChanges);
            }
        }
    }

    static _nodeHasContentChanges(node, diffResult) {
        if (node.tableId && diffResult.tables[node.tableId]?.status !== 'unchanged') return true;
        if (node.textBlockId && diffResult.textblocks[node.textBlockId]?.status !== 'unchanged') return true;
        if (node.violationId && diffResult.violations[node.violationId]?.status !== 'unchanged') return true;
        return false;
    }

    /**
     * Рендер таблицы с подсветкой изменённых ячеек.
     */
    static _renderDiffTable(container, tableDiff) {
        const wrapper = document.createElement('div');
        wrapper.className = `diff-table-wrapper diff-${tableDiff.status}`;

        const data = tableDiff.newData || tableDiff.oldData;
        if (!data?.grid) return;

        // Строим set изменённых ячеек
        const changedCells = new Map();
        if (tableDiff.cellDiffs) {
            for (const cd of tableDiff.cellDiffs) {
                changedCells.set(`${cd.row}-${cd.col}`, cd);
            }
        }

        const table = document.createElement('table');
        table.className = 'preview-table';

        for (let r = 0; r < data.grid.length; r++) {
            const tr = document.createElement('tr');
            for (let c = 0; c < data.grid[r].length; c++) {
                const cell = data.grid[r][c];
                if (cell.isSpanned) continue;

                const isHeader = cell.isHeader;
                const td = document.createElement(isHeader ? 'th' : 'td');
                if (cell.colSpan > 1) td.colSpan = cell.colSpan;
                if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;

                const key = `${r}-${c}`;
                const change = changedCells.get(key);

                if (change) {
                    td.className = 'diff-cell-changed';
                    if (change.old) {
                        const oldSpan = document.createElement('span');
                        oldSpan.className = 'diff-cell-old';
                        oldSpan.textContent = change.old;
                        td.appendChild(oldSpan);
                    }
                    if (change.new) {
                        const newSpan = document.createElement('span');
                        newSpan.className = 'diff-cell-new';
                        newSpan.textContent = change.new;
                        td.appendChild(newSpan);
                    }
                    if (!change.old && !change.new) {
                        td.textContent = '—';
                    }
                } else {
                    td.textContent = cell.content || '';
                }

                tr.appendChild(td);
            }
            table.appendChild(tr);
        }

        wrapper.appendChild(table);
        container.appendChild(wrapper);
    }

    /**
     * Рендер текстблока с word-level diff.
     */
    static _renderDiffTextBlock(container, tbDiff) {
        const div = document.createElement('div');
        div.className = `diff-textblock diff-${tbDiff.status}`;

        if (tbDiff.status === 'added') {
            div.innerHTML = tbDiff.newContent || '';
        } else if (tbDiff.status === 'removed') {
            div.innerHTML = tbDiff.oldContent || '';
        } else if (tbDiff.status === 'modified' && tbDiff.wordDiff) {
            div.className += ' diff-text';
            const html = tbDiff.wordDiff.map(part => {
                const escaped = this._escapeHtml(part.text);
                if (part.type === 'insert') return `<ins>${escaped}</ins>`;
                if (part.type === 'delete') return `<del>${escaped}</del>`;
                return escaped;
            }).join(' ');
            div.innerHTML = html;
        } else {
            div.innerHTML = tbDiff.content || tbDiff.newContent || '';
        }

        container.appendChild(div);
    }

    /**
     * Рендер нарушения с подсветкой изменённых полей.
     */
    static _renderDiffViolation(container, violDiff) {
        const div = document.createElement('div');
        div.className = `diff-violation diff-${violDiff.status}`;

        const fieldLabels = {
            violated: 'Нарушено', established: 'Установлено',
            reasons: 'Причины', consequences: 'Последствия',
            responsible: 'Ответственные', recommendations: 'Рекомендации',
        };

        const data = violDiff.newData || violDiff.oldData;
        if (!data) return;

        const fields = ['violated', 'established', 'reasons', 'consequences', 'responsible', 'recommendations'];

        for (const field of fields) {
            const val = this._getViolFieldValue(data, field);
            if (!val && !violDiff.fieldDiffs?.[field]) continue;

            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'diff-violation-field';

            const labelEl = document.createElement('strong');
            labelEl.textContent = `${fieldLabels[field] || field}: `;
            fieldDiv.appendChild(labelEl);

            if (violDiff.fieldDiffs?.[field]?.changed) {
                fieldDiv.classList.add('diff-field-changed');
                const oldVal = violDiff.fieldDiffs[field].old || '';
                const newVal = violDiff.fieldDiffs[field].new || '';
                if (oldVal) {
                    const oldSpan = document.createElement('del');
                    oldSpan.textContent = oldVal;
                    fieldDiv.appendChild(oldSpan);
                    fieldDiv.appendChild(document.createTextNode(' → '));
                }
                const newSpan = document.createElement('ins');
                newSpan.textContent = newVal;
                newSpan.style.textDecoration = 'none';
                newSpan.style.fontWeight = '500';
                fieldDiv.appendChild(newSpan);
            } else {
                fieldDiv.appendChild(document.createTextNode(val));
            }

            div.appendChild(fieldDiv);
        }

        container.appendChild(div);
    }

    static _getViolFieldValue(viol, field) {
        const val = viol[field];
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'object' && 'content' in val) return val.content || '';
        return '';
    }

    static _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

window.DiffRenderer = DiffRenderer;
