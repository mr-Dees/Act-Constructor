/**
 * Безопасная вставка HTML.
 *
 * Использует DOMPurify (static/vendor/dompurify/purify.min.js); если vendor
 * не загружен — fallback на `textContent`, чтобы НИ В КАКОМ случае не
 * вставлять непроверенный HTML. Это закрывает регрессию I-DOM-FB
 * (старый chat-renderer fallback писал raw HTML).
 *
 * Защищает: textblock-editor, preview-violation-renderer, diff-renderer,
 * preview-textblock-renderer, chat-renderer.
 *
 * Singleton-публикация — `window.SafeHTML = ...` (см. CLAUDE.md «Singleton-публикация»).
 */
(function () {
    'use strict';

    const DEFAULT_CONFIG = {
        // Разрешаем стандартный набор inline-форматирования + базовые контейнеры.
        // SVG/MathML отключены (не используются в актах/чате).
        USE_PROFILES: { html: true },
        // Принудительно убираем `<script>` даже если он попадёт через trusted-источник.
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
        // Inline-event-handlers — главный XSS-вектор; всегда вырезаем.
        FORBID_ATTR: [
            'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur',
            'onchange', 'oninput', 'onsubmit', 'onreset', 'onkeydown', 'onkeyup',
            'onkeypress', 'onmousedown', 'onmouseup', 'onmousemove', 'onmouseout',
            'onmouseenter', 'onmouseleave', 'ondblclick', 'oncontextmenu', 'onwheel',
            'onpaste', 'oncopy', 'oncut', 'ondrag', 'ondragstart', 'ondragend',
            'ondragenter', 'ondragleave', 'ondragover', 'ondrop', 'onresize',
            'onscroll', 'onselect', 'ontoggle', 'onanimationstart', 'onanimationend',
            'onanimationiteration', 'ontransitionstart', 'ontransitionend',
            'onbeforeinput', 'onpointerdown', 'onpointerup', 'onpointermove',
            'onpointerover', 'onpointerout', 'onpointerenter', 'onpointerleave',
            'onpointercancel', 'ongotpointercapture', 'onlostpointercapture',
            'ontouchstart', 'ontouchend', 'ontouchmove', 'ontouchcancel',
        ],
    };

    let fallbackWarned = false;

    function warnFallbackOnce() {
        if (fallbackWarned) return;
        fallbackWarned = true;
        console.error(
            'SafeHTML: DOMPurify не загружен (static/vendor/dompurify/purify.min.js). '
            + 'HTML заменяется на текстовое представление. Подключи vendor-файл в шаблоне.'
        );
    }

    /**
     * Sanitize untrusted HTML и вернуть очищенную строку.
     * Если DOMPurify недоступен — возвращает escape'нутый текст (НЕ raw HTML).
     */
    function sanitize(html, extraConfig) {
        if (html == null) return '';
        const str = String(html);
        if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
            const config = extraConfig
                ? Object.assign({}, DEFAULT_CONFIG, extraConfig)
                : DEFAULT_CONFIG;
            return window.DOMPurify.sanitize(str, config);
        }
        warnFallbackOnce();
        return escapeHtml(str);
    }

    /**
     * Set innerHTML безопасно — основной API.
     */
    function set(el, html, extraConfig) {
        if (!el) return;
        if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
            const config = extraConfig
                ? Object.assign({}, DEFAULT_CONFIG, extraConfig)
                : DEFAULT_CONFIG;
            el.innerHTML = window.DOMPurify.sanitize(String(html ?? ''), config);
            return;
        }
        warnFallbackOnce();
        el.textContent = String(html ?? '');
    }

    /**
     * Plain-text escape (минимальный набор для атрибутов и
     * fallback-сценариев без DOMPurify).
     */
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    window.SafeHTML = { set, sanitize, escapeHtml };
})();
