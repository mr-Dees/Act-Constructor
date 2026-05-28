/**
 * Формирование title новой беседы по первому пользовательскому сообщению.
 *
 * Модуль без зависимостей: используется в ChatContext._createConversation
 * (через ChatHistory.createConversation), чтобы беседа сразу появилась
 * в сайдбаре с осмысленным названием.
 */
export const ChatTitle = {

    /** Максимальная длина title до обрезки. */
    MAX_LENGTH: 40,

    /**
     * Возвращает title для беседы.
     *
     *  - `text` тримим; если ≤ MAX_LENGTH — возвращаем как есть.
     *  - иначе берём первые MAX_LENGTH символов, ищем последний пробел
     *    и режем по нему (word boundary). Если пробела нет — hard cut.
     *    В конец дописываем `…` (U+2026).
     *  - если text пустой / только пробелы и есть файлы — `Файлы: <имя первого>`.
     *  - если ни текста, ни файлов — `Новая беседа`.
     *
     * @param {string} text — текст первого сообщения пользователя
     * @param {Array<{name?: string}>} [files] — список прикреплённых файлов
     * @returns {string}
     */
    derive(text, files) {
        const trimmed = (text || '').trim();
        const fileList = Array.isArray(files) ? files : [];

        if (!trimmed) {
            if (fileList.length > 0) {
                const first = fileList[0];
                const name = (first && first.name) ? first.name : 'без имени';
                return `Файлы: ${name}`;
            }
            return 'Новая беседа';
        }

        if (trimmed.length <= this.MAX_LENGTH) {
            return trimmed;
        }

        const head = trimmed.slice(0, this.MAX_LENGTH);
        const lastSpace = head.lastIndexOf(' ');
        const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head;
        return cut + '…';
    },
};

window.ChatTitle = ChatTitle;
