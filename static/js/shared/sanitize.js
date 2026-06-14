/**
 * Безопасная вставка HTML.
 *
 * Использует DOMPurify (static/vendor/dompurify/purify.min.js); если vendor
 * не загружен — fallback на `textContent`, чтобы НИ В КАКОМ случае не
 * вставлять непроверенный HTML.
 *
 * Защищает: textblock-editor, preview-violation-renderer, diff-renderer,
 * preview-textblock-renderer, chat-renderer.
 *
 * Профили (5.2.3):
 * - 'acts' — строгий allowlist, СИНХРОННЫЙ с бэк-whitelist
 *   app/domains/acts/utils/html_sanitizer.py (ALLOWED_TAGS/ALLOWED_ATTRS,
 *   включая s/strike/del из M.19 и data-атрибуты ссылок/сносок). Inline-style
 *   дополнительно фильтруется до ALLOWED_CSS_PROPERTIES бэка (ACTS_CSS_PROPERTIES)
 *   хуком afterSanitizeAttributes — превью совпадает с сохранённым/экспортом.
 *   Используется рендерами контента актов (preview-textblock-renderer).
 * - default — прежний blocklist-конфиг: его используют чат (markdown →
 *   strong/em/code/br) и diff-renderer (ins/del) — менять без аудита
 *   потребителей нельзя (shared-модуль).
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

// Allowlist CSS-свойств для inline-style профиля 'acts' — зеркало бэкового
// ALLOWED_CSS_PROPERTIES (app/domains/acts/utils/html_sanitizer.py). JS не
// импортирует Python — СИНХРОНИЗИРОВАТЬ ВРУЧНУЮ (страж: sanitize-profiles.test.mjs).
export const ACTS_CSS_PROPERTIES = [
    'font-size', 'color', 'background-color',
    'font-weight', 'font-style', 'text-decoration', 'text-decoration-line',
];

// Allowlist контента актов — зеркало ALLOWED_TAGS/ALLOWED_ATTRS бэка
// (app/domains/acts/utils/html_sanitizer.py). При изменении бэк-whitelist —
// менять синхронно (страж: tests/js/sanitize-profiles.test.mjs).
const ACTS_CONFIG = {
    ALLOWED_TAGS: [
        'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
        'span', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div',
    ],
    // DOMPurify не разделяет атрибуты по тегам — объединение бэковых
    // a[href,title] + span[class,style,data-*] + *[class].
    ALLOWED_ATTR: [
        'href', 'title', 'class', 'style',
        'data-footnote-id', 'data-footnote-text',
        'data-link-id', 'data-link-url',
    ],
    // Кастомный ключ (DOMPurify его игнорирует): allowlist CSS-свойств для
    // хука afterSanitizeAttributes. Только профиль 'acts' его несёт — default
    // (чат/diff) хук пропускает, его inline-style не трогается.
    __cssAllowlist: ACTS_CSS_PROPERTIES,
};

export const SAFE_HTML_PROFILES = {
    acts: ACTS_CONFIG,
};

// Активный CSS-allowlist на время одного синхронного вызова DOMPurify.sanitize.
// sanitize синхронен → переинициализации/реентрантности нет; хук читает эту
// переменную и фильтрует node.style до разрешённых свойств (для профиля acts).
let _activeCssAllowlist = null;
let _cssHookRegistered = false;

function ensureCssAllowlistHook() {
    if (_cssHookRegistered) return;
    const DP = window.DOMPurify;
    if (!DP || typeof DP.addHook !== 'function') return;
    DP.addHook('afterSanitizeAttributes', (node) => {
        if (!_activeCssAllowlist) return;
        if (!node || !node.style || typeof node.hasAttribute !== 'function') return;
        if (!node.hasAttribute('style')) return;
        const kept = [];
        for (let i = node.style.length - 1; i >= 0; i--) {
            const prop = node.style[i]; // уже kebab-case
            if (_activeCssAllowlist.includes(prop)) {
                kept.push(`${prop}:${node.style.getPropertyValue(prop)};`);
            }
        }
        if (kept.length) node.setAttribute('style', kept.join(''));
        else node.removeAttribute('style');
    });
    _cssHookRegistered = true;
}

function resolveConfig(extraConfig) {
    if (!extraConfig) return DEFAULT_CONFIG;
    if (typeof extraConfig === 'string') {
        return SAFE_HTML_PROFILES[extraConfig] || DEFAULT_CONFIG;
    }
    return Object.assign({}, DEFAULT_CONFIG, extraConfig);
}

let fallbackWarned = false;

function warnFallbackOnce() {
    if (fallbackWarned) return;
    fallbackWarned = true;
    console.error(
        'SafeHTML: DOMPurify не загружен (static/vendor/dompurify/purify.min.js). '
        + 'HTML заменяется на текстовое представление. Подключи vendor-файл в шаблоне.'
    );
}

function _purify(str, extraConfig) {
    ensureCssAllowlistHook();
    const cfg = resolveConfig(extraConfig);
    _activeCssAllowlist = cfg.__cssAllowlist || null;
    try {
        return window.DOMPurify.sanitize(str, cfg);
    } finally {
        _activeCssAllowlist = null;
    }
}

function sanitize(html, extraConfig) {
    if (html == null) return '';
    const str = String(html);
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
        return _purify(str, extraConfig);
    }
    warnFallbackOnce();
    return escapeHtml(str);
}

function set(el, html, extraConfig) {
    if (!el) return;
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
        el.innerHTML = _purify(String(html ?? ''), extraConfig);
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
