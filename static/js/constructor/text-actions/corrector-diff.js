/**
 * Диф для корректора текста.
 *
 * В отличие от портального пословного `DiffEngine._wordDiff` (там знаки препинания
 * «липнут» к слову: «привет» → «привет,» подсвечивается как правка целого слова),
 * здесь текст токенизируется на ТРИ класса раздельно: слова, пунктуация, пробелы.
 * Тогда добавленная запятая показывается именно как вставка знака, а не изменение
 * слова. Пробелы — тоже токены, поэтому конкатенация токенов восстанавливает текст
 * байт-в-байт (рендер склеивает без разделителя).
 */

// Слово (буквы/цифры/подчёркивание, включая кириллицу) | пробелы | пунктуация.
const TOKEN_RE = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]+/gu;

// Порог квадратичной сложности LCS — на гигантских выделениях падаем на грубый диф.
const MAX_LCS_CELLS = 4_000_000;

/**
 * Токенизация: слова / пробелы / пунктуация — раздельными токенами.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
    return (text || '').match(TOKEN_RE) || [];
}

/**
 * LCS-диф по токенам.
 * @param {string} before
 * @param {string} after
 * @returns {{type: 'equal'|'insert'|'delete', text: string}[]} соседние сегменты
 *   одного типа склеены.
 */
export function diffTokens(before, after) {
    const a = tokenize(before);
    const b = tokenize(after);
    const m = a.length;
    const n = b.length;

    if (m * n > MAX_LCS_CELLS) {
        const ops = [];
        if (before) ops.push({ type: 'delete', text: before });
        if (after) ops.push({ type: 'insert', text: after });
        return ops;
    }

    // dp[i][j] = длина LCS суффиксов a[i:], b[j:].
    const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const raw = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        if (a[i] === b[j]) { raw.push({ type: 'equal', text: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { raw.push({ type: 'delete', text: a[i] }); i++; }
        else { raw.push({ type: 'insert', text: b[j] }); j++; }
    }
    while (i < m) { raw.push({ type: 'delete', text: a[i] }); i++; }
    while (j < n) { raw.push({ type: 'insert', text: b[j] }); j++; }

    // Склейка соседних сегментов одного типа.
    const ops = [];
    for (const op of raw) {
        const last = ops[ops.length - 1];
        if (last && last.type === op.type) last.text += op.text;
        else ops.push({ type: op.type, text: op.text });
    }
    return ops;
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Инлайн-диф: одно полотно, вставки `<ins>`, удаления `<del>`. */
export function renderInline(ops) {
    return ops.map((op) => {
        const t = esc(op.text);
        if (op.type === 'insert') return `<ins>${t}</ins>`;
        if (op.type === 'delete') return `<del>${t}</del>`;
        return t;
    }).join('');
}

/** «Было»: исходный текст с подсветкой удалённого (`<del>`), без вставок. */
export function renderBefore(ops) {
    return ops
        .filter((op) => op.type !== 'insert')
        .map((op) => {
            const t = esc(op.text);
            return op.type === 'delete' ? `<del>${t}</del>` : t;
        })
        .join('');
}

/** «Стало»: исправленный текст с подсветкой добавленного (`<ins>`), без удалений. */
export function renderAfter(ops) {
    return ops
        .filter((op) => op.type !== 'delete')
        .map((op) => {
            const t = esc(op.text);
            return op.type === 'insert' ? `<ins>${t}</ins>` : t;
        })
        .join('');
}

/** Плоский экранированный текст (для «было»/«стало» без подсветки в 3-оконном виде). */
export function renderPlain(text) {
    return esc(text);
}

window.CorrectorDiff = { tokenize, diffTokens, renderInline, renderBefore, renderAfter, renderPlain };
