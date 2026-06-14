/**
 * Валидатор картинок нарушений (H6).
 *
 * Проверяет файл ДО кодирования в base64 (readAsDataURL) во всех точках
 * приёма: выбор файлов, drag&drop, Ctrl+V. Лимиты подтягиваются один раз
 * с GET /api/v1/acts/limits (паттерн chat-files._loadLimits); до ответа
 * сервера действуют дефолты — зеркало ACTS__IMAGES__* (settings.py),
 * серверная валидация схемы в любом случае прикроет.
 *
 * Тот же единственный GET наполняет и СТРУКТУРНЫЕ лимиты (таблицы/шрифт,
 * секции tables/textblocks ответа) — getStructureLimits() для гейтов
 * таблиц и тулбара шрифта (см. table-cells-operations.js, table-sizes.js).
 */

import { AppConfig } from '../../shared/app-config.js';
import { CONTENT_TYPE_IMAGE } from './violation-content-item.js';

/** Дефолтные лимиты — зеркало ImagesSettings (app/domains/acts/settings.py). */
export const DEFAULT_IMAGE_LIMITS = {
    maxFileSize: 10 * 1024 * 1024,
    maxTotalSizePerAct: 30 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
    maxItemsPerViolation: 50,
    previewMaxHeightPercent: 40,
};

/**
 * Дефолтные структурные лимиты (таблицы/шрифт) — синхронный фолбэк до ответа
 * сервера. Источник истины в рантайме — GET /acts/limits (секции tables /
 * textblocks из настроек ACTS__TABLES__* / ACTS__TEXTBLOCKS__*); до ответа
 * берём AppConfig.limits (зеркало дефолтов схемы).
 */
export const DEFAULT_STRUCTURE_LIMITS = {
    maxRows: AppConfig.limits.table.maxRows,
    maxCols: AppConfig.limits.table.maxCols,
    minColWidthPx: AppConfig.limits.table.minColWidthPx,
    fontSizeMin: AppConfig.limits.textblock.fontSizeMin,
    fontSizeMax: AppConfig.limits.textblock.fontSizeMax,
};

let _limits = { ...DEFAULT_IMAGE_LIMITS };
let _structure = { ...DEFAULT_STRUCTURE_LIMITS };
let _loadPromise = null;

/**
 * Однократно загружает лимиты с сервера. Ошибка сети/прокси тихо
 * игнорируется — остаются дефолты.
 *
 * @returns {Promise<Object>} Актуальные лимиты
 */
export function loadImageLimits() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
        try {
            const resp = await fetch(AppConfig.api.getUrl('/api/v1/acts/limits'), {
                credentials: 'same-origin',
            });
            if (!resp.ok) return _limits;
            const data = await resp.json();
            const img = data && data.images;
            if (img) {
                if (typeof img.max_file_size === 'number') _limits.maxFileSize = img.max_file_size;
                if (typeof img.max_total_size_per_act === 'number') _limits.maxTotalSizePerAct = img.max_total_size_per_act;
                if (Array.isArray(img.allowed_mime_types) && img.allowed_mime_types.length) {
                    _limits.allowedMimeTypes = img.allowed_mime_types;
                }
                if (typeof img.max_items_per_violation === 'number') _limits.maxItemsPerViolation = img.max_items_per_violation;
                if (typeof img.preview_max_height_percent === 'number') _limits.previewMaxHeightPercent = img.preview_max_height_percent;
            }
            const tbl = data && data.tables;
            if (tbl) {
                if (typeof tbl.max_rows === 'number') _structure.maxRows = tbl.max_rows;
                if (typeof tbl.max_cols === 'number') _structure.maxCols = tbl.max_cols;
                if (typeof tbl.min_col_width_px === 'number') _structure.minColWidthPx = tbl.min_col_width_px;
            }
            const tb = data && data.textblocks;
            if (tb) {
                if (typeof tb.font_size_min === 'number') _structure.fontSizeMin = tb.font_size_min;
                if (typeof tb.font_size_max === 'number') _structure.fontSizeMax = tb.font_size_max;
            }
        } catch (_) {
            // Сеть/CORS — дефолты, серверная валидация прикроет.
        }
        return _limits;
    })();
    return _loadPromise;
}

/**
 * Текущие лимиты (дефолты до ответа сервера).
 *
 * @returns {Object} Лимиты картинок
 */
export function getImageLimits() {
    return _limits;
}

/**
 * Текущие структурные лимиты таблиц/шрифта (дефолты до ответа сервера).
 *
 * @returns {{maxRows:number, maxCols:number, minColWidthPx:number,
 *            fontSizeMin:number, fontSizeMax:number}}
 */
export function getStructureLimits() {
    return _structure;
}

/** Сброс к дефолтам — для тестов. */
export function resetImageLimitsForTests() {
    _limits = { ...DEFAULT_IMAGE_LIMITS };
    _structure = { ...DEFAULT_STRUCTURE_LIMITS };
    _loadPromise = null;
}

/**
 * Оценивает размер картинки в байтах по длине base64-payload data-URL
 * (×0.75: 4 символа base64 = 3 байта).
 *
 * @param {string} url - data-URL картинки
 * @returns {number} Приблизительный размер в байтах
 */
export function estimateDataUrlBytes(url) {
    if (typeof url !== 'string' || !url.startsWith('data:')) return 0;
    const comma = url.indexOf(',');
    const payloadLength = comma >= 0 ? url.length - comma - 1 : url.length;
    return Math.round(payloadLength * 0.75);
}

/**
 * Суммарный размер всех картинок акта (по data-URL в additionalContent).
 *
 * @param {Object} violations - Словарь нарушений (AppState.violations)
 * @returns {number} Суммарный размер в байтах
 */
export function estimateActImageBytes(violations) {
    let total = 0;
    for (const violation of Object.values(violations || {})) {
        const items = violation?.additionalContent?.items || [];
        for (const item of items) {
            if (item && item.type === CONTENT_TYPE_IMAGE && item.url) {
                total += estimateDataUrlBytes(item.url);
            }
        }
    }
    return total;
}

/**
 * Валидирует файл картинки до чтения в base64.
 *
 * @param {File} file - Принимаемый файл
 * @param {Object} [context] - Контекст приёма
 * @param {number} [context.existingTotalBytes=0] - Суммарный размер уже
 *        добавленных картинок акта (включая принятые ранее в этой пачке)
 * @param {number} [context.itemsCount=0] - Текущее число элементов
 *        дополнительного контента нарушения
 * @param {Object} [context.limits] - Явные лимиты (для тестов)
 * @returns {{ok: boolean, reason: string}} Результат с причиной отказа
 */
export function validateImageFile(file, { existingTotalBytes = 0, itemsCount = 0, limits = null } = {}) {
    const lim = limits || _limits;
    if (!file) {
        return { ok: false, reason: 'Файл не передан' };
    }
    if (!lim.allowedMimeTypes.includes(file.type)) {
        return {
            ok: false,
            reason: `Недопустимый тип файла «${file.name || ''}» (${file.type || 'неизвестный'}). `
                + 'Разрешены: JPEG, PNG, GIF.',
        };
    }
    if (file.size > lim.maxFileSize) {
        return {
            ok: false,
            reason: `Файл «${file.name || ''}» слишком большой (${_fmtMb(file.size)} МБ). `
                + `Лимит на файл — ${_fmtMb(lim.maxFileSize)} МБ.`,
        };
    }
    if (itemsCount >= lim.maxItemsPerViolation) {
        return {
            ok: false,
            reason: `Достигнут лимит элементов дополнительного контента на нарушение `
                + `(${lim.maxItemsPerViolation}).`,
        };
    }
    if (existingTotalBytes + file.size > lim.maxTotalSizePerAct) {
        return {
            ok: false,
            reason: `Суммарный размер картинок акта превысит лимит ${_fmtMb(lim.maxTotalSizePerAct)} МБ. `
                + `Файл «${file.name || ''}» не добавлен.`,
        };
    }
    return { ok: true, reason: '' };
}

/**
 * Байты → мегабайты одной десятичной цифрой (для сообщений).
 * @private
 */
function _fmtMb(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.ViolationImageValidator = {
    loadImageLimits,
    getImageLimits,
    getStructureLimits,
    validateImageFile,
    estimateDataUrlBytes,
    estimateActImageBytes,
};
