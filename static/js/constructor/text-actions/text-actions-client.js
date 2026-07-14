/**
 * Клиент text-actions: обёртка над эндпоинтом корректора.
 * Все URL — через AppConfig.api.getUrl (JupyterHub-proxy).
 */
import { AppConfig } from '../../shared/app-config.js';

/**
 * Исправить орфографию/пунктуацию текста.
 * @param {string} text — исходный текст выделения.
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<string>} исправленный текст.
 */
export async function correctText(text, { signal } = {}) {
    const res = await fetch(AppConfig.api.getUrl('/api/v1/chat/text-actions/correct'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal,
    });
    if (!res.ok) {
        let detail = 'Не удалось обработать текст';
        try {
            const data = await res.json();
            if (data && data.detail) detail = data.detail;
        } catch (_) { /* тело не JSON — оставляем дефолт */ }
        const err = new Error(detail);
        err.status = res.status;
        throw err;
    }
    const data = await res.json();
    return data.corrected_text;
}

window.correctText = correctText;
