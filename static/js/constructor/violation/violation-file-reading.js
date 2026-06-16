/**
 * Детерминированное чтение пачки файлов в data-URL.
 *
 * FileReader-колбэки завершаются вразнобой, поэтому вставка картинок «по мере
 * готовности» ломала порядок выбора файлов (находка аудита violation-4).
 * readFilesInOrder читает файлы параллельно, но возвращает результаты строго
 * в порядке исходного списка.
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

/**
 * Читает файлы параллельно, сохраняя порядок результатов.
 *
 * @param {File[]} files - Файлы в порядке выбора пользователем
 * @param {(file: File) => Promise<string>} [readFile] - Чтение одного файла
 * @returns {Promise<Array<{ok: true, file: File, url: string} |
 *          {ok: false, file: File, error: unknown}>>} Результаты в порядке files
 */
export async function readFilesInOrder(files, readFile = readFileAsDataUrl) {
    const settled = await Promise.allSettled(files.map((file) => readFile(file)));
    return settled.map((result, i) => (
        result.status === 'fulfilled'
            ? { ok: true, file: files[i], url: result.value }
            : { ok: false, file: files[i], error: result.reason }
    ));
}
