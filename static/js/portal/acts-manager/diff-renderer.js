/**
 * DOM-рендеринг diff с цветовой подсветкой.
 * Работает на основе результатов DiffEngine.compute().
 */
import { SafeHTML, renderActContent } from '../../shared/sanitize.js';
import { iterateVisibleCells } from '../../constructor/table/grid-merges.js';
import { CASE_LABEL_TEMPLATE, FREE_TEXT_LABEL } from '../../constructor/violation/violation-fields.js';
import { computeAdditionalContentNumbers } from '../../constructor/violation/violation-numbering.js';
import { CONTENT_TYPE_CASE, CONTENT_TYPE_IMAGE } from '../../constructor/violation/violation-content-item.js';
import { renderImageWithFallback, buildImagePlaceholder } from '../../constructor/violation/violation-image-render.js';

export class DiffRenderer {
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
            // Единый обход видимых (не поглощённых) ячеек строки — общий helper.
            iterateVisibleCells([data.grid[r]], (cell, _r, c) => {
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
            });
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
            renderActContent(div, tbDiff.newContent || '');
        } else if (tbDiff.status === 'removed') {
            renderActContent(div, tbDiff.oldContent || '');
        } else if (tbDiff.status === 'modified' && tbDiff.wordDiff) {
            div.className += ' diff-text';
            // Профиль по умолчанию (НЕ 'acts'): здесь рендерится diff-разметка
            // <ins>/<del> поверх уже pre-stripped plain text (_stripHtml в
            // diff-engine.js), а не исходный HTML текстблока. <ins> вне
            // acts-allowlist (ACTS_TAGS_FALLBACK в sanitize.js) — переключение
            // на renderActContent срезало бы всю подсветку вставок.
            // _escapeHtml уже экранирует payload, но обёртки <ins>/<del> должны
            // проходить через DOMPurify — иначе вектор «текст содержит </ins><script>»
            // мог бы сломать конструкцию. SafeHTML.set sanitize всю итоговую строку.
            const html = tbDiff.wordDiff.map(part => {
                const escaped = this._escapeHtml(part.text);
                if (part.type === 'insert') return `<ins>${escaped}</ins>`;
                if (part.type === 'delete') return `<del>${escaped}</del>`;
                return escaped;
            }).join(' ');
            SafeHTML.set(div, html);
        } else {
            renderActContent(div, tbDiff.content || tbDiff.newContent || '');
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

        // Список описаний (descriptionList) — структурный под-дифф движка.
        const dlDiff = violDiff.fieldDiffs?.descriptionList;
        if (dlDiff?.changed) {
            this._renderDescriptionListDiff(div, dlDiff);
        }

        // Доп.контент (additionalContent) — структурный под-дифф движка.
        const acDiff = violDiff.fieldDiffs?.additionalContent;
        if (acDiff?.changed) {
            this._renderAdditionalContentDiff(
                div, acDiff,
                violDiff.oldData?.additionalContent?.items || [],
                violDiff.newData?.additionalContent?.items || [],
            );
        }

        container.appendChild(div);
    }

    static _getViolFieldValue(viol, field) {
        const val = viol[field];
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'object' && 'content' in val) {
            // Мируем движок: выключенное опц.поле не показываем (пропало из акта).
            if ('enabled' in val && !val.enabled) return '';
            return val.content || '';
        }
        return '';
    }

    /**
     * Строка diff-разметки из word-diff (ДЕФОЛТНЫЙ профиль SafeHTML.set):
     * _escapeHtml + обёртки <ins>/<del>, как в word-diff-ветке текстблока.
     * Профиль acts срезал бы <ins>/<del> (вне acts-allowlist) — см. тех-долг
     * diff-renderer-textblock-profile.test.mjs.
     */
    static _wordDiffToHtml(wordDiff) {
        return (wordDiff || []).map((part) => {
            const escaped = this._escapeHtml(part.text);
            if (part.type === 'insert') return `<ins>${escaped}</ins>`;
            if (part.type === 'delete') return `<del>${escaped}</del>`;
            return escaped;
        }).join(' ');
    }

    /**
     * Рендер диффа списка описаний: <ul> с пер-элементной подсветкой
     * added/removed/modified. Заголовка нет (паритет с collectViolationLines —
     * descriptionList без метки, решение #12).
     */
    static _renderDescriptionListDiff(container, dlDiff) {
        const ul = document.createElement('ul');
        ul.className = 'diff-desclist';
        for (const item of dlDiff.items || []) {
            const li = document.createElement('li');
            li.className = `diff-desclist-item diff-${item.status}`;
            if (item.status === 'added') {
                const ins = document.createElement('ins');
                ins.textContent = item.new || '';
                li.appendChild(ins);
            } else if (item.status === 'removed') {
                const del = document.createElement('del');
                del.textContent = item.old || '';
                li.appendChild(del);
            } else if (item.status === 'modified') {
                SafeHTML.set(li, this._wordDiffToHtml(item.wordDiff));
            } else {
                li.textContent = item.new ?? item.old ?? '';
            }
            ul.appendChild(li);
        }
        container.appendChild(ul);
    }

    /**
     * Рендер диффа доп.контента. Метки/нумерация — зеркало collectViolationLines:
     * «Кейс N» через computeAdditionalContentNumbers, свободный текст без метки,
     * картинки — превью с подписью. Номер кейса берётся из новой версии (для
     * удалённых — из старой).
     */
    static _renderAdditionalContentDiff(container, acDiff, oldItems, newItems) {
        const newNums = computeAdditionalContentNumbers(newItems);
        const oldNums = computeAdditionalContentNumbers(oldItems);
        const newNumById = new Map();
        newItems.forEach((it, i) => { if (it && it.id != null) newNumById.set(it.id, newNums[i]?.number); });
        const oldNumById = new Map();
        oldItems.forEach((it, i) => { if (it && it.id != null) oldNumById.set(it.id, oldNums[i]?.number); });

        for (const entry of acDiff.entries || []) {
            const caseNumber = entry.newItem
                ? newNumById.get(entry.newItem.id)
                : oldNumById.get(entry.oldItem?.id);
            this._renderContentEntry(container, entry, caseNumber);
        }
    }

    /** Рендер одного элемента доп.контента (кейс / свободный текст / картинка). */
    static _renderContentEntry(container, entry, caseNumber) {
        const item = entry.newItem || entry.oldItem;
        if (!item) return;

        const itemDiv = document.createElement('div');
        itemDiv.className = `diff-violation-item diff-${entry.status}`;

        if (item.type === CONTENT_TYPE_IMAGE) {
            this._appendContentHeader(itemDiv, '', entry);
            this._renderImageEntry(itemDiv, entry);
            container.appendChild(itemDiv);
            return;
        }

        const baseLabel = item.type === CONTENT_TYPE_CASE
            ? CASE_LABEL_TEMPLATE.replace('{n}', caseNumber != null ? caseNumber : '')
            : FREE_TEXT_LABEL;
        this._appendContentHeader(itemDiv, baseLabel, entry);

        const body = document.createElement('div');
        body.className = 'diff-violation-item-body';
        if (entry.status === 'added') {
            const ins = document.createElement('ins');
            ins.textContent = entry.newItem?.content || '';
            body.appendChild(ins);
        } else if (entry.status === 'removed') {
            const del = document.createElement('del');
            del.textContent = entry.oldItem?.content || '';
            body.appendChild(del);
        } else if (entry.status === 'modified' && entry.wordDiff) {
            SafeHTML.set(body, this._wordDiffToHtml(entry.wordDiff));
        } else {
            body.textContent = (entry.newItem || entry.oldItem)?.content || '';
        }
        itemDiv.appendChild(body);
        container.appendChild(itemDiv);
    }

    /** Метка элемента доп.контента + маркер добавления/удаления/перестановки. */
    static _appendContentHeader(itemDiv, baseLabel, entry) {
        let marker = '';
        if (entry.status === 'added') marker = ' (ДОБАВЛЕНО)';
        else if (entry.status === 'removed') marker = ' (УДАЛЕНО)';
        else if (entry.reordered) marker = ' (порядок изменён)';
        if (!baseLabel && !marker) return;
        const el = document.createElement('strong');
        el.className = 'diff-violation-item-label';
        el.textContent = baseLabel ? `${baseLabel}${marker}: ` : `${marker.trim()} `;
        itemDiv.appendChild(el);
    }

    /** Рендер картинки-элемента: превью старой/новой + текст изменённых атрибутов. */
    static _renderImageEntry(itemDiv, entry) {
        if (entry.status === 'added') {
            this._appendImagePreview(itemDiv, entry.newItem);
            return;
        }
        if (entry.status === 'removed') {
            this._appendImagePreview(itemDiv, entry.oldItem);
            return;
        }

        const fields = entry.fields || {};
        if (fields.url) {
            this._appendSublabel(itemDiv, 'Было:');
            this._appendImagePreview(itemDiv, entry.oldItem);
            this._appendSublabel(itemDiv, 'Стало:');
            this._appendImagePreview(itemDiv, entry.newItem);
        } else {
            this._appendImagePreview(itemDiv, entry.newItem || entry.oldItem);
        }

        const attrLabels = { caption: 'Подпись', filename: 'Файл', width: 'Ширина' };
        for (const key of ['caption', 'filename', 'width']) {
            if (!fields[key]) continue;
            const line = document.createElement('div');
            line.className = 'diff-violation-field diff-field-changed';
            const strong = document.createElement('strong');
            strong.textContent = `${attrLabels[key]}: `;
            line.appendChild(strong);
            const del = document.createElement('del');
            del.textContent = String(fields[key].old ?? '');
            line.appendChild(del);
            line.appendChild(document.createTextNode(' → '));
            const ins = document.createElement('ins');
            ins.textContent = String(fields[key].new ?? '');
            line.appendChild(ins);
            itemDiv.appendChild(line);
        }
    }

    static _appendSublabel(container, text) {
        const el = document.createElement('div');
        el.className = 'diff-violation-sublabel';
        el.textContent = text;
        container.appendChild(el);
    }

    /**
     * Превью картинки нарушения с fallback на текстовый плейсхолдер (общее ядро
     * с превью/редактором — violation-image-render.js). Пустой url → плейсхолдер.
     */
    static _appendImagePreview(container, item) {
        const wrap = document.createElement('div');
        wrap.className = 'diff-violation-image';
        const placeholderText = `Изображение: ${(item && item.filename) || ''}`;
        const placeholderClassName = 'diff-violation-image-placeholder';
        if (!item || !item.url) {
            wrap.appendChild(buildImagePlaceholder(placeholderText, placeholderClassName));
        } else {
            renderImageWithFallback(wrap, {
                src: item.url,
                alt: item.caption || item.filename || '',
                imgClassName: 'diff-violation-image-img',
                placeholderText,
                placeholderClassName,
            });
        }
        container.appendChild(wrap);
        if (item && item.caption) {
            const cap = document.createElement('div');
            cap.className = 'diff-violation-caption';
            cap.textContent = item.caption;
            container.appendChild(cap);
        }
    }

    static _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

window.DiffRenderer = DiffRenderer;
