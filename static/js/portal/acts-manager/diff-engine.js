/**
 * Вычисление структурного diff между двумя снэпшотами содержимого.
 * Чистый utility-класс без DOM-зависимостей.
 */
class DiffEngine {
    /**
     * Полный diff двух снэпшотов.
     * @param {Object} oldData - {tree_data, tables_data, textblocks_data, violations_data}
     * @param {Object} newData - {tree, tables, textBlocks, violations}
     * @returns {Object} {tree, tables, textblocks, violations, hasChanges}
     */
    static compute(oldData, newData) {
        const treeDiff = this._diffTree(oldData.tree_data, newData.tree);
        const tablesDiff = this._diffTables(oldData.tables_data || {}, newData.tables || {});
        const textblocksDiff = this._diffTextBlocks(oldData.textblocks_data || {}, newData.textBlocks || {});
        const violationsDiff = this._diffViolations(oldData.violations_data || {}, newData.violations || {});

        const hasChanges = treeDiff.hasChanges
            || Object.values(tablesDiff).some(t => t.status !== 'unchanged')
            || Object.values(textblocksDiff).some(t => t.status !== 'unchanged')
            || Object.values(violationsDiff).some(v => v.status !== 'unchanged');

        return { tree: treeDiff, tables: tablesDiff, textblocks: textblocksDiff, violations: violationsDiff, hasChanges };
    }

    /**
     * Diff дерева. Возвращает объединённое дерево с аннотациями _diff на каждом узле.
     */
    static _diffTree(oldTree, newTree) {
        const oldMap = {};
        const newMap = {};
        this._flattenTree(oldTree, oldMap);
        this._flattenTree(newTree, newMap);

        let hasChanges = false;

        // Аннотируем новое дерево
        const annotated = newTree ? JSON.parse(JSON.stringify(newTree)) : null;
        if (annotated) {
            this._annotateTree(annotated, oldMap, (node) => {
                if (!oldMap[node.id]) {
                    hasChanges = true;
                    return 'added';
                }
                const oldNode = oldMap[node.id];
                if (oldNode.label !== node.label || oldNode.type !== node.type) {
                    hasChanges = true;
                    return 'modified';
                }
                return 'unchanged';
            });
        }

        // Проверяем удалённые узлы
        const removedNodes = [];
        for (const id of Object.keys(oldMap)) {
            if (!newMap[id]) {
                hasChanges = true;
                removedNodes.push({ ...oldMap[id], _diff: 'removed', children: [] });
            }
        }

        return { tree: annotated, removedNodes, hasChanges };
    }

    static _flattenTree(node, map) {
        if (!node) return;
        map[node.id] = node;
        if (node.children) {
            for (const child of node.children) {
                this._flattenTree(child, map);
            }
        }
    }

    static _annotateTree(node, oldMap, getStatus) {
        if (!node) return;
        node._diff = getStatus(node);
        if (node.children) {
            for (const child of node.children) {
                this._annotateTree(child, oldMap, getStatus);
            }
        }
    }

    /**
     * Diff таблиц. Возвращает {tableId: {status, cellDiffs, oldData, newData}}
     */
    static _diffTables(oldTables, newTables) {
        const result = {};
        const allKeys = new Set([...Object.keys(oldTables), ...Object.keys(newTables)]);

        for (const id of allKeys) {
            const oldT = oldTables[id];
            const newT = newTables[id];

            if (!oldT) {
                result[id] = { status: 'added', newData: newT, cellDiffs: [] };
                continue;
            }
            if (!newT) {
                result[id] = { status: 'removed', oldData: oldT, cellDiffs: [] };
                continue;
            }

            // Сравниваем ячейки
            const oldGrid = oldT.grid || [];
            const newGrid = newT.grid || [];
            const cellDiffs = [];
            const maxRows = Math.max(oldGrid.length, newGrid.length);
            const maxCols = Math.max(
                oldGrid.length ? Math.max(...oldGrid.map(r => r.length)) : 0,
                newGrid.length ? Math.max(...newGrid.map(r => r.length)) : 0,
            );

            for (let r = 0; r < maxRows; r++) {
                for (let c = 0; c < maxCols; c++) {
                    const oldCell = oldGrid[r]?.[c];
                    const newCell = newGrid[r]?.[c];
                    const oldContent = oldCell?.content ?? '';
                    const newContent = newCell?.content ?? '';
                    if (oldContent !== newContent) {
                        cellDiffs.push({ row: r, col: c, old: oldContent, new: newContent });
                    }
                }
            }

            result[id] = {
                status: cellDiffs.length > 0 ? 'modified' : 'unchanged',
                cellDiffs,
                oldData: oldT,
                newData: newT,
            };
        }

        return result;
    }

    /**
     * Diff текстблоков. Возвращает {tbId: {status, oldContent, newContent, wordDiff}}
     */
    static _diffTextBlocks(oldTBs, newTBs) {
        const result = {};
        const allKeys = new Set([...Object.keys(oldTBs), ...Object.keys(newTBs)]);

        for (const id of allKeys) {
            const oldTB = oldTBs[id];
            const newTB = newTBs[id];

            if (!oldTB) {
                result[id] = { status: 'added', newContent: newTB?.content || '' };
                continue;
            }
            if (!newTB) {
                result[id] = { status: 'removed', oldContent: oldTB?.content || '' };
                continue;
            }

            const oldContent = oldTB.content || '';
            const newContent = newTB.content || '';
            if (oldContent === newContent) {
                result[id] = { status: 'unchanged', content: oldContent };
            } else {
                result[id] = {
                    status: 'modified',
                    oldContent,
                    newContent,
                    wordDiff: this._wordDiff(this._stripHtml(oldContent), this._stripHtml(newContent)),
                };
            }
        }

        return result;
    }

    /**
     * Diff нарушений. Возвращает {vId: {status, fieldDiffs}}
     */
    static _diffViolations(oldViols, newViols) {
        const result = {};
        const allKeys = new Set([...Object.keys(oldViols), ...Object.keys(newViols)]);
        const fields = ['violated', 'established', 'reasons', 'consequences', 'responsible', 'recommendations'];

        for (const id of allKeys) {
            const oldV = oldViols[id];
            const newV = newViols[id];

            if (!oldV) {
                result[id] = { status: 'added', newData: newV };
                continue;
            }
            if (!newV) {
                result[id] = { status: 'removed', oldData: oldV };
                continue;
            }

            const fieldDiffs = {};
            let hasFieldChanges = false;
            for (const field of fields) {
                const oldVal = this._getViolationFieldValue(oldV, field);
                const newVal = this._getViolationFieldValue(newV, field);
                if (oldVal !== newVal) {
                    fieldDiffs[field] = { old: oldVal, new: newVal, changed: true };
                    hasFieldChanges = true;
                }
            }

            result[id] = {
                status: hasFieldChanges ? 'modified' : 'unchanged',
                fieldDiffs,
                oldData: oldV,
                newData: newV,
            };
        }

        return result;
    }

    static _getViolationFieldValue(viol, field) {
        const val = viol[field];
        if (val === null || val === undefined) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'object' && 'content' in val) return val.content || '';
        return String(val);
    }

    /**
     * Word-level diff двух строк.
     * @returns [{type: 'equal'|'insert'|'delete', text}]
     */
    static _wordDiff(oldText, newText) {
        const oldWords = oldText.split(/\s+/).filter(Boolean);
        const newWords = newText.split(/\s+/).filter(Boolean);

        if (oldWords.length === 0 && newWords.length === 0) return [];
        if (oldWords.length === 0) return [{ type: 'insert', text: newWords.join(' ') }];
        if (newWords.length === 0) return [{ type: 'delete', text: oldWords.join(' ') }];

        // LCS
        const m = oldWords.length;
        const n = newWords.length;

        // Ограничение: для слишком длинных текстов — упрощённый diff
        if (m * n > 250000) {
            return [
                { type: 'delete', text: oldWords.join(' ') },
                { type: 'insert', text: newWords.join(' ') },
            ];
        }

        const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldWords[i - 1] === newWords[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack
        const ops = [];
        let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
                ops.push({ type: 'equal', text: oldWords[i - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                ops.push({ type: 'insert', text: newWords[j - 1] });
                j--;
            } else {
                ops.push({ type: 'delete', text: oldWords[i - 1] });
                i--;
            }
        }

        ops.reverse();

        // Группируем последовательные одинаковые операции
        const grouped = [];
        for (const op of ops) {
            const last = grouped[grouped.length - 1];
            if (last && last.type === op.type) {
                last.text += ' ' + op.text;
            } else {
                grouped.push({ ...op });
            }
        }

        return grouped;
    }

    static _stripHtml(html) {
        if (!html) return '';
        return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }
}

window.DiffEngine = DiffEngine;
