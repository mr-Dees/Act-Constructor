/**
 * Единый предикат и текст заголовка таблицы — общий для DOM-рендерера
 * (items-renderer) и превью (preview). Без него условия показа расходились:
 * рендерер/превью скрывали заголовок при customLabel==='' (дефолт защищённых
 * таблиц из act_crud_service), хотя DOCX-экспорт в этом случае показывает
 * label (см. app/domains/acts/formatters/docx/formatter.py::_add_table_title:
 * `title = customLabel or label; if not title: return`).
 *
 * Эталон — DOCX: заголовок показывается, если есть непустой customLabel ИЛИ
 * label. Фронт дополнительно поддерживает автонумерацию (number) как
 * запасной текст, поэтому в предикат включён и number — это надмножество
 * DOCX, не сужающее показ.
 *
 * Модуль БЕЗ DOM-зависимостей (импортируется и из тестов напрямую).
 */

/**
 * Текст заголовка таблицы: пользовательская метка → автонумерация → label.
 * @param {Object} node Узел-таблица дерева.
 * @returns {string} Текст заголовка ('' если показывать нечего).
 */
export function tableTitleText(node) {
    return node.customLabel || node.number || node.label || '';
}

/**
 * Показывать ли заголовок таблицы. Эталон — DOCX: непустой customLabel/label
 * (+ number как фронтовый fallback). customLabel==='' больше не скрывает
 * заголовок, если есть number/label.
 * @param {Object} node Узел-таблица дерева.
 * @returns {boolean} true если заголовок нужно отрисовать.
 */
export function shouldShowTableTitle(node) {
    return tableTitleText(node) !== '';
}

// Дублируем в window ради inline-скриптов в шаблонах (см. CLAUDE.md).
// Guard: модуль также импортируется в node:test, где window отсутствует.
if (typeof window !== 'undefined') {
    window.tableTitleText = tableTitleText;
    window.shouldShowTableTitle = shouldShowTableTitle;
}
