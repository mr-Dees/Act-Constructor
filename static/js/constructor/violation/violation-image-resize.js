/**
 * Клиентский даунскейл картинок перед вставкой в акт (#25).
 *
 * Фото с телефона (5-8 МБ JPEG) раздувают акт и упираются в суммарный лимит
 * (#2). Перед вставкой предлагаем пользователю режим сжатия (диалог качества,
 * Q3) и уменьшаем длинную сторону + перекодируем в JPEG на клиенте.
 *
 * Пережимаем ТОЛЬКО JPEG. GIF (потеряет анимацию) и PNG (потеряет
 * прозрачность и чёткость на тексте/линиях при JPEG-перекодировании) в режимах
 * сжатия отдаём как есть — фактический источник бюджета это фотографии, а они
 * приходят в JPEG. Детекция альфы PNG требует декодирования пикселей и всё
 * равно неточна для палитровых PNG с tRNS, поэтому PNG пропускаем целиком —
 * прагматичный выбор из двух, предложенных в брифе.
 *
 * Чистая логика (resolveResizeMode / shouldDownscale / computeScaledSize) и
 * skip-ветки downscaleImage покрыты node-тестами; сам canvas-конвейер
 * (createImageBitmap / toBlob) исполняется только в браузере — LIVE.
 */

import { readFileAsDataUrl } from './violation-file-reading.js';

/** Пресеты режимов сжатия: длинная сторона (px) и качество JPEG (0..1). */
export const RESIZE_PRESETS = {
    high: { maxDim: 1600, quality: 0.8 },   // «Сжатие» (по умолчанию)
    medium: { maxDim: 1200, quality: 0.7 }, // «Среднее»
};

/**
 * Возвращает пресет режима сжатия либо null для 'original'/неизвестного.
 *
 * @param {string} mode - Режим ('high' | 'medium' | 'original')
 * @returns {{maxDim: number, quality: number} | null}
 */
export function resolveResizeMode(mode) {
    return RESIZE_PRESETS[mode] || null;
}

/**
 * Нужно ли пережимать файл: только JPEG и только в режиме сжатия.
 *
 * @param {string} fileType - MIME-тип файла (file.type)
 * @param {string} mode - Выбранный режим качества
 * @returns {boolean}
 */
export function shouldDownscale(fileType, mode) {
    if (!resolveResizeMode(mode)) return false; // 'original' / неизвестный
    // GIF — анимация, PNG — прозрачность/чёткость: JPEG их портит.
    return fileType === 'image/jpeg';
}

/**
 * Пересчитывает размеры под maxDim по длинной стороне с сохранением аспекта.
 * Апскейл не делаем (мелкие картинки остаются как есть).
 *
 * @param {number} width - Исходная ширина
 * @param {number} height - Исходная высота
 * @param {number} maxDim - Предел длинной стороны
 * @returns {{width: number, height: number}}
 */
export function computeScaledSize(width, height, maxDim) {
    const longSide = Math.max(width, height);
    if (!Number.isFinite(longSide) || longSide <= 0 || longSide <= maxDim) {
        return { width, height };
    }
    const scale = maxDim / longSide;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

/**
 * Читает файл в data-URL, при необходимости пережав его на canvas.
 *
 * Для 'original', GIF и PNG (см. shouldDownscale) возвращает оригинальные
 * байты через обычный readAsDataURL. Для JPEG в режиме сжатия — уменьшает
 * длинную сторону до maxDim и перекодирует в JPEG с заданным quality. Любой
 * сбой canvas/bitmap деградирует к оригиналу (размерный гейт прикроет).
 *
 * @param {File|Blob} file - Исходный файл картинки
 * @param {Object} [options]
 * @param {string} [options.mode='high'] - Режим качества
 * @param {number} [options.maxDim] - Явный предел (по умолчанию из режима)
 * @param {number} [options.quality] - Явное качество (по умолчанию из режима)
 * @param {(f: File|Blob) => Promise<string>} [options.readAsDataUrl] - Чтение (для тестов)
 * @returns {Promise<string>} data-URL (ужатый JPEG или оригинал)
 */
export async function downscaleImage(file, options = {}) {
    const { mode = 'high', readAsDataUrl = readFileAsDataUrl } = options;

    if (!shouldDownscale(file.type, mode)) {
        return readAsDataUrl(file);
    }

    const preset = resolveResizeMode(mode);
    const maxDim = options.maxDim ?? preset.maxDim;
    const quality = options.quality ?? preset.quality;

    try {
        const bitmap = await createImageBitmap(file);
        try {
            const { width, height } = computeScaledSize(bitmap.width, bitmap.height, maxDim);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0, width, height);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
            if (blob) return readAsDataUrl(blob);
        } finally {
            if (typeof bitmap.close === 'function') bitmap.close();
        }
    } catch (_) {
        // Canvas/bitmap недоступны или упали — отдаём оригинал.
    }
    return readAsDataUrl(file);
}

// Window-global для inline-скриптов шаблонов (guarded — модуль тестируется в node).
if (typeof window !== 'undefined') {
    window.ViolationImageResize = {
        downscaleImage,
        resolveResizeMode,
        shouldDownscale,
        computeScaledSize,
    };
}
