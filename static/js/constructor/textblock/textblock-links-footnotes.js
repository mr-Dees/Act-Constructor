/**
 * Расширение TextBlockManager для работы с гиперссылками и сносками
 */

import { LinkFootnoteContextMenu } from '../context-menu/context-menu-links-footnotes.js';
import { TextBlockManager } from './textblock-core.js';
// Ниже на module-level оборачивается handleEditorFocus — базовый метод должен
// быть уже навешен на прототип (textblock-editor.js), независимо от того,
// кто импортировал этот модуль первым (entry или, например, acts-menu).
import './textblock-editor.js';

// Создаем глобальный экземпляр менеджера контекстного меню
export const linkFootnoteContextMenu = new LinkFootnoteContextMenu();

Object.assign(TextBlockManager.prototype, {
    /**
     * Текущий активный tooltip
     */
    currentTooltip: null,
    tooltipTimeout: null,

    /**
     * Инициализирует менеджер
     */
    initLinkFootnoteManager() {
        linkFootnoteContextMenu.init(this);
    },

    /**
     * Создает или редактирует гиперссылку
     */
    createOrEditLink() {
        this._createOrEditInlineMarker({
            find: (node) => this.findParentLink(node),
            valueAttr: 'data-link-url',
            idAttr: 'data-link-id',
            idPrefix: 'link_',
            className: 'text-link',
            promptLabel: 'Введите URL гиперссылки:',
            selectAlert: 'Выделите текст для создания гиперссылки',
            spacesAlert: 'Текст ссылки не может состоять только из пробелов',
        });
    },

    /**
     * Создает или редактирует сноску
     */
    createOrEditFootnote() {
        this._createOrEditInlineMarker({
            find: (node) => this.findParentFootnote(node),
            valueAttr: 'data-footnote-text',
            idAttr: 'data-footnote-id',
            idPrefix: 'footnote_',
            className: 'text-footnote',
            promptLabel: 'Введите текст сноски:',
            selectAlert: 'Выделите текст для создания сноски',
            spacesAlert: 'Текст сноски не может состоять только из пробелов',
        });
    },

    /**
     * Публичная фабрика inline-маркера ссылки (для paste-потока 4г, контракт C5).
     * Создаёт detached span.text-link с уникальным id; НЕ вставляет в DOM и НЕ
     * навешивает обработчики (их навесит attachLinkFootnoteHandlers при фокусе/
     * после вставки) — маркер неотличим от созданного вручную.
     * @param {string} text Видимый текст ссылки
     * @param {string} url URL (вызывающий гарантирует валидную схему)
     * @returns {HTMLSpanElement}
     */
    createLinkMarker(text, url) {
        const markerId = 'link_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const span = document.createElement('span');
        span.className = 'text-link';
        span.setAttribute('data-link-id', markerId);
        span.setAttribute('data-link-url', url);
        span.contentEditable = 'false';
        span.textContent = text;
        return span;
    },

    /**
     * Общий поток создания/редактирования inline-маркера (ссылка/сноска):
     * поиск существующего маркера в выделении → prompt значения → обновление
     * атрибута существующего ЛИБО вставка нового span с наследованием
     * форматирования и пробелом-разделителем после маркера.
     * @private
     * @param {Object} cfg Конфигурация разновидности маркера
     * @param {function(Node): (HTMLElement|null)} cfg.find Поиск существующего маркера от узла выделения
     * @param {string} cfg.valueAttr Атрибут значения (URL / текст сноски)
     * @param {string} cfg.idAttr Атрибут идентификатора маркера
     * @param {string} cfg.idPrefix Префикс генерируемого id
     * @param {string} cfg.className CSS-класс маркера
     * @param {string} cfg.promptLabel Заголовок prompt
     * @param {string} cfg.selectAlert Сообщение «выделите текст»
     * @param {string} cfg.spacesAlert Сообщение «текст из одних пробелов»
     */
    _createOrEditInlineMarker(cfg) {
        if (!this.activeEditor) return;

        const selection = window.getSelection();

        if (!selection || selection.isCollapsed) {
            alert(cfg.selectAlert);
            return;
        }

        // Ищем существующий маркер от НАЧАЛА выделения: при обратном выделении
        // (снизу вверх / справа налево) anchorNode — это конец выделения, и
        // маркер в начале не находился (создавался вложенный дубль).
        const existing = cfg.find(selection.getRangeAt(0).startContainer);
        const isEditing = !!existing;
        const currentValue = existing ? existing.getAttribute(cfg.valueAttr) : '';

        const value = prompt(cfg.promptLabel, currentValue);

        if (value === null) return;

        if (!value.trim()) {
            if (existing) {
                this.removeLinkOrFootnote(existing);
            }
            return;
        }

        // 6.8: UX-валидация URL — только для ссылок (текст сноски любой).
        // Зеркалит допустимые схемы бэк-санитайзера (inline.py _is_safe_url:
        // http/https/mailto); безсхемный ввод → https://.
        let resolvedValue = value;
        if (cfg.valueAttr === 'data-link-url') {
            const verdict = validateLinkUrl(value);
            if (!verdict.ok) {
                alert(verdict.message);
                return;
            }
            resolvedValue = verdict.url;
        }

        const range = selection.getRangeAt(0);
        let selectedText = range.toString();

        if (isEditing) {
            existing.setAttribute(cfg.valueAttr, resolvedValue);
            this.attachLinkFootnoteHandlers();
        } else {
            const trailingSpaces = selectedText.match(/\s+$/);
            const trailingSpaceText = trailingSpaces ? trailingSpaces[0] : '';
            selectedText = selectedText.trimEnd();

            if (!selectedText) {
                alert(cfg.spacesAlert);
                return;
            }

            const markerId = cfg.idPrefix + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            const markerSpan = document.createElement('span');
            markerSpan.className = cfg.className;
            markerSpan.setAttribute(cfg.idAttr, markerId);
            markerSpan.setAttribute(cfg.valueAttr, resolvedValue);
            markerSpan.contentEditable = 'false';
            markerSpan.textContent = selectedText;

            range.deleteContents();
            range.insertNode(markerSpan);

            this.inheritFormattingToElement(markerSpan);

            let spaceNode = null;
            if (trailingSpaceText) {
                spaceNode = document.createTextNode(trailingSpaceText);
                markerSpan.parentNode.insertBefore(spaceNode, markerSpan.nextSibling);
            }

            const nextNode = spaceNode ? spaceNode.nextSibling : markerSpan.nextSibling;
            const needsSpace = !spaceNode &&
                (!nextNode ||
                    (nextNode.nodeType === 3 && !nextNode.textContent.startsWith(' ')) ||
                    (nextNode.nodeType === 1));

            if (needsSpace) {
                const space = document.createTextNode(' ');
                if (spaceNode) {
                    spaceNode.parentNode.insertBefore(space, spaceNode.nextSibling);
                } else {
                    markerSpan.parentNode.insertBefore(space, markerSpan.nextSibling);
                }
                spaceNode = space;
            }

            if (spaceNode) {
                range.setStartAfter(spaceNode);
                range.setEndAfter(spaceNode);
            } else {
                range.setStartAfter(markerSpan);
                range.setEndAfter(markerSpan);
            }

            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);

            this.attachLinkFootnoteHandlers();
        }

        const textBlockId = this.activeEditor.dataset.textBlockId;
        this.saveContent(textBlockId, this.activeEditor.innerHTML);
        // B-10: создание/правка маркера могли добавить сноску — пере-нумеровать.
        this.renumberEditorFootnotes();
    },

    /**
     * Включает режим inline-редактирования по двойному клику
     */
    enableInlineEditing(element) {
        const originalText = element.textContent;

        element.classList.add('editing-mode');
        element.contentEditable = 'true';

        setTimeout(() => {
            element.focus();

            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }, 0);

        const finishEditing = (save = true) => {
            if (!element.classList.contains('editing-mode')) return;

            element.classList.remove('editing-mode');
            element.contentEditable = 'false';

            if (save) {
                const newText = element.textContent.trim();

                if (!newText) {
                    element.textContent = originalText;
                } else {
                    if (this.activeEditor) {
                        const textBlockId = this.activeEditor.dataset.textBlockId;
                        this.saveContent(textBlockId, this.activeEditor.innerHTML);
                    }
                }
            } else {
                element.textContent = originalText;
            }

            element.blur();

            document.removeEventListener('click', outsideClickHandler);
            document.removeEventListener('keydown', keyHandler);
        };

        const outsideClickHandler = (e) => {
            if (!element.contains(e.target)) {
                finishEditing(true);
            }
        };

        const keyHandler = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finishEditing(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishEditing(false);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', outsideClickHandler);
            document.addEventListener('keydown', keyHandler);
        }, 100);
    },

    /**
     * Находит родительский элемент ссылки
     */
    findParentLink(node) {
        if (!node) return null;

        let current = node.nodeType === 3 ? node.parentElement : node;

        while (current && current !== this.activeEditor) {
            if (current.classList && current.classList.contains('text-link')) {
                return current;
            }
            current = current.parentElement;
        }

        return null;
    },

    /**
     * Находит родительский элемент сноски
     */
    findParentFootnote(node) {
        if (!node) return null;

        let current = node.nodeType === 3 ? node.parentElement : node;

        while (current && current !== this.activeEditor) {
            if (current.classList && current.classList.contains('text-footnote')) {
                return current;
            }
            current = current.parentElement;
        }

        return null;
    },

    /**
     * Удаляет ссылку или сноску, сохраняя только размер шрифта
     */
    removeLinkOrFootnote(element) {
        if (!element) return;

        const text = element.textContent;
        const prevNode = element.previousSibling;
        const nextNode = element.nextSibling;

        const computedStyle = window.getComputedStyle(element);
        const fontSize = computedStyle.fontSize;

        const hasPrevText = prevNode && prevNode.nodeType === 3 && prevNode.textContent.trim();
        const hasNextText = nextNode && nextNode.nodeType === 3 && nextNode.textContent.trim();
        const prevEndsWithSpace = prevNode && prevNode.nodeType === 3 && /\s$/.test(prevNode.textContent);
        const nextStartsWithSpace = nextNode && nextNode.nodeType === 3 && /^\s/.test(nextNode.textContent);

        const needsSpaceBefore = hasPrevText && !prevEndsWithSpace;
        const needsSpaceAfter = hasNextText && !nextStartsWithSpace;

        let replacementText = text;
        if (needsSpaceBefore) {
            replacementText = ' ' + replacementText;
        }
        if (needsSpaceAfter) {
            replacementText = replacementText + ' ';
        }

        const formattedSpan = document.createElement('span');
        formattedSpan.textContent = replacementText;

        if (fontSize) {
            formattedSpan.style.fontSize = fontSize;
        }

        element.parentNode.replaceChild(formattedSpan, element);

        if (this.activeEditor) {
            const textBlockId = this.activeEditor.dataset.textBlockId;
            this.saveContent(textBlockId, this.activeEditor.innerHTML);
            // B-10: сноска удалена — пере-нумеровать оставшиеся.
            this.renumberEditorFootnotes();
        }
    },

    /**
     * Показывает tooltip при наведении
     */
    showTooltip(element, event) {
        this.hideTooltip();

        const isLink = element.classList.contains('text-link');
        let content;
        if (isLink) {
            content = element.getAttribute('data-link-url');
        } else {
            const text = element.getAttribute('data-footnote-text');
            const num = element.getAttribute('data-footnote-number');
            // B-10: номер проставлен numberFootnotes (рантайм-атрибут). Пустая/
            // непронумерованная сноска — показываем только текст.
            content = num ? `Сноска ${num}: ${text}` : text;
        }

        if (!content) return;

        const tooltip = document.createElement('div');
        tooltip.className = 'link-footnote-tooltip';
        tooltip.textContent = content;
        tooltip.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 0.875rem;
            z-index: 10000;
            max-width: 300px;
            word-wrap: break-word;
            pointer-events: none;
        `;

        document.body.appendChild(tooltip);

        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        let top = rect.bottom + 8;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (left + tooltipRect.width > viewportWidth) {
            left = viewportWidth - tooltipRect.width - 10;
        }
        if (left < 10) {
            left = 10;
        }

        if (top + tooltipRect.height > viewportHeight) {
            top = rect.top - tooltipRect.height - 8;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

        this.currentTooltip = tooltip;
    },

    /**
     * Скрывает tooltip
     */
    hideTooltip() {
        if (this.currentTooltip) {
            this.currentTooltip.remove();
            this.currentTooltip = null;
        }
        if (this.tooltipTimeout) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
    },

    /**
     * Привязывает обработчики событий к ссылкам и сноскам
     */
    attachLinkFootnoteHandlers() {
        if (!this.activeEditor) return;

        const links = this.activeEditor.querySelectorAll('.text-link');
        const footnotes = this.activeEditor.querySelectorAll('.text-footnote');

        [...links, ...footnotes].forEach(element => {
            // Снимаем ВЕСЬ предыдущий набор слушателей разом (включая
            // click-capture, который раньше навешивался анонимно и копился).
            // Покрывает и initial tooltip-обработчики (_attachInitialTooltipHandlers
            // навешивает свой набор через тот же _lfAbort).
            if (element._lfAbort) element._lfAbort.abort();
            const controller = new AbortController();
            element._lfAbort = controller;
            const { signal } = controller;

            // Обработчик контекстного меню (ПКМ)
            element.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                linkFootnoteContextMenu.show(e.clientX, e.clientY, {element});
            }, { signal });

            // Обработчик двойного клика (ЛКМ x2)
            element.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.enableInlineEditing(element);
            }, { signal });

            // Обработчик наведения для tooltip
            element.addEventListener('mouseenter', (e) => {
                if (element.classList.contains('editing-mode')) return;

                this.tooltipTimeout = setTimeout(() => {
                    this.showTooltip(element, e);
                }, 700);
            }, { signal });

            // Обработчик ухода мыши
            element.addEventListener('mouseleave', () => {
                this.hideTooltip();
            }, { signal });

            // Предотвращаем случайное редактирование (capture-фаза)
            element.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, { capture: true, signal });
        });
    },

    /**
     * B-10: проставляет сквозную нумерацию сносок активного редактора
     * (data-footnote-number) с учётом сносок в предшествующих по дереву блоках.
     * Вызывается из потока фокуса и после создания/удаления маркера (не из
     * attachLinkFootnoteHandlers — нумерация не привязана к навешиванию слушателей).
     */
    renumberEditorFootnotes() {
        if (!this.activeEditor) return;
        const offset = footnoteOffsetForBlock(this.activeEditor.dataset.textBlockId);
        numberFootnotes(this.activeEditor, offset + 1);
    }
});

/**
 * Расширяем обработчик фокуса редактора
 */
export const originalHandleEditorFocus = TextBlockManager.prototype.handleEditorFocus;
TextBlockManager.prototype.handleEditorFocus = function (editor, textBlock) {
    originalHandleEditorFocus.call(this, editor, textBlock);
    this.initLinkFootnoteManager();
    this.attachLinkFootnoteHandlers();
    this.renumberEditorFootnotes(); // B-10: сквозная нумерация сносок при фокусе

    setTimeout(() => {
        this.applyFormattingToNewNodes(editor);
    }, 100);
};

/**
 * B-10: проставляет сквозную нумерацию сносок (как в Word) рантайм-атрибутом
 * data-footnote-number в порядке появления в DOM (DFS). Атрибут НЕ в content
 * (санитайзер 'acts' его вырезает) — нумеровать надо после каждого рендера.
 * Пустые сноски (без data-footnote-text) пропускаются (паритет с бэком).
 * @param {ParentNode} root Корень обхода (контейнер превью или редактор)
 * @param {number} [startNumber=1] Стартовый номер (для сквозной нумерации)
 * @returns {number} Следующий свободный номер
 */
export function numberFootnotes(root, startNumber = 1) {
    if (!root || typeof root.querySelectorAll !== 'function') return startNumber;
    let n = startNumber;
    root.querySelectorAll('.text-footnote').forEach((el) => {
        const text = el.getAttribute('data-footnote-text');
        if (!text || !text.trim()) {
            el.removeAttribute('data-footnote-number');
            return;
        }
        el.setAttribute('data-footnote-number', String(n));
        n += 1;
    });
    return n;
}

/**
 * B-10: число непустых сносок во всех текстблоках, предшествующих заданному по
 * порядку обхода дерева — стартовый офсет сквозной нумерации в редакторе.
 * Безопасно деградирует к 0 (локальная нумерация), если состояние недоступно.
 * @param {string} textBlockId
 * @returns {number}
 */
export function footnoteOffsetForBlock(textBlockId) {
    const state = window.AppState;
    if (!state || !state.treeData || !state.textBlocks) return 0;
    const order = [];
    const walk = (node) => {
        if (!node) return;
        if (node.textBlockId) order.push(node.textBlockId);
        if (node.children) node.children.forEach(walk);
    };
    walk(state.treeData);
    let offset = 0;
    const tmp = document.createElement('div');
    for (const id of order) {
        if (id === textBlockId) break;
        const tb = state.textBlocks[id];
        if (!tb || typeof tb.content !== 'string') continue;
        tmp.innerHTML = tb.content;
        tmp.querySelectorAll('.text-footnote').forEach((el) => {
            const t = el.getAttribute('data-footnote-text');
            if (t && t.trim()) offset += 1;
        });
    }
    return offset;
}

/**
 * 6.8: UX-валидация и нормализация URL при вводе ссылки. НЕ замена
 * бэк-санитайзеру (_is_safe_url) — дружелюбная подсказка до сохранения.
 * Допустимые схемы зеркалят бэк: http/https/mailto. Схему парсим строго (до
 * первого ':'), а не substring-поиском (обход 'javascript:alert("http://")').
 * @param {string} raw Сырой ввод пользователя
 * @returns {{ok: true, url: string} | {ok: false, message: string}}
 */
export function validateLinkUrl(raw) {
    const value = (raw || '').trim();
    if (!value) {
        return { ok: false, message: 'URL ссылки не может быть пустым' };
    }
    const schemeMatch = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (!schemeMatch) {
        // Схемы нет — частый кейс «www.example.com», подставляем https://.
        return { ok: true, url: 'https://' + value };
    }
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
        return { ok: true, url: value };
    }
    if (scheme === 'javascript' || scheme === 'data') {
        return {
            ok: false,
            message: 'Недопустимая схема ссылки. Разрешены только http://, https:// и mailto:',
        };
    }
    return {
        ok: false,
        message: `Схема «${scheme}:» не поддерживается. Используйте http://, https:// или mailto:`,
    };
}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.linkFootnoteContextMenu = linkFootnoteContextMenu;
window.originalHandleEditorFocus = originalHandleEditorFocus;
window.numberFootnotes = numberFootnotes;
window.validateLinkUrl = validateLinkUrl;
