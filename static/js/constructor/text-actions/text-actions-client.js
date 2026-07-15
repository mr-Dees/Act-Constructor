/**
 * Клиент text-actions: обёртка над эндпоинтом корректора.
 * Все URL — через AppConfig.api.getUrl (JupyterHub-proxy).
 */
import { AppConfig } from '../../shared/app-config.js';

/**
 * Обработать текст: орфография/пунктуация (`fix`) или улучшение читаемости (`readability`).
 * @param {string} text — исходный текст выделения.
 * @param {{signal?: AbortSignal, mode?: 'fix'|'readability'}} [opts]
 * @returns {Promise<string>} обработанный текст.
 */
export async function correctText(text, { signal, mode = 'fix' } = {}) {
    const res = await fetch(AppConfig.api.getUrl('/api/v1/chat/text-actions/correct'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode }),
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

/**
 * Формализовать нарушение: разложить свободный текст по полям карточки.
 * @param {string} text — свободный текст нарушения.
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{violated:string, established:string, reasons:string,
 *   measures:string, responsible:string, consequences:string}>} извлечённые поля
 *   (пустые — что LLM не нашла; `measures` — «Принятые меры», поле карточки под «Причинами»).
 */
export async function formalizeViolation(text, { signal } = {}) {
    const res = await fetch(
        AppConfig.api.getUrl('/api/v1/chat/text-actions/formalize-violation'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal,
        });
    if (!res.ok) {
        let detail = 'Не удалось формализовать текст';
        try {
            const data = await res.json();
            if (data && data.detail) detail = data.detail;
        } catch (_) { /* тело не JSON — оставляем дефолт */ }
        const err = new Error(detail);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

window.formalizeViolation = formalizeViolation;
