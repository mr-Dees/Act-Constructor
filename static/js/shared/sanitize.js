/**
 * Безопасная вставка HTML.
 *
 * Использует DOMPurify (static/vendor/dompurify/purify.min.js); если vendor
 * не загружен — fallback на `textContent`, чтобы НИ В КАКОМ случае не
 * вставлять непроверенный HTML.
 *
 * Защищает: textblock-editor, preview-violation-renderer, diff-renderer,
 * preview-textblock-renderer, chat-renderer.
 */

const DEFAULT_CONFIG = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
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

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export const SafeHTML = { set, sanitize, escapeHtml };
window.SafeHTML = SafeHTML;
