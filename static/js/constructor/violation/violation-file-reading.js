/**
 * Чтение файла в data-URL и распознавание типа картинки по сигнатуре.
 *
 * Модуль без импортов приложения — тестируется под node:test
 * (readFile внедряется параметром).
 */

/**
 * Читает один файл в data-URL.
 *
 * @param {File} file - Файл для чтения
 * @returns {Promise<string>} data-URL содержимого
 */
export function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = () => reject(
            reader.error || new Error(`Не удалось прочитать файл ${file.name}`),
        );
        reader.readAsDataURL(file);
    });
}

/** Разрешённые по умолчанию типы картинок (зеркало DEFAULT_IMAGE_LIMITS). */
const DEFAULT_ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif'];

/** Магические сигнатуры первых байтов файла → MIME. */
const IMAGE_MAGIC_SIGNATURES = [
    { mime: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47] },
    { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
    { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF87a / GIF89a
];

/**
 * Определяет MIME картинки по первым байтам (магическая сигнатура).
 *
 * @param {Uint8Array|number[]} bytes - Первые байты файла
 * @returns {string|null} MIME ('image/png'|'image/jpeg'|'image/gif') или null
 */
export function detectImageMagic(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    for (const sig of IMAGE_MAGIC_SIGNATURES) {
        if (sig.bytes.every((b, i) => arr[i] === b)) return sig.mime;
    }
    return null;
}

/**
 * Проверяет, что содержимое файла — картинка разрешённого типа (#26).
 * Читает первые 12 байт и матчит сигнатуру; отсекает мусор и переименованные
 * не-картинки (напр. PDF/EXE с расширением .png) ДО чтения/ресайза.
 *
 * @param {File|Blob} file - Проверяемый файл
 * @param {string[]} [allowedMimeTypes] - Разрешённые типы (из getImageLimits())
 * @returns {Promise<boolean>} true, если сигнатура — картинка из allowed-списка
 */
export async function sniffImageMagic(file, allowedMimeTypes = DEFAULT_ALLOWED_IMAGE_MIME) {
    try {
        const buffer = await file.slice(0, 12).arrayBuffer();
        const detected = detectImageMagic(new Uint8Array(buffer));
        return detected !== null && allowedMimeTypes.includes(detected);
    } catch (_) {
        return false;
    }
}
