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

        const existing = cfg.find(selection.anchorNode);
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

        const range = selection.getRangeAt(0);
        let selectedText = range.toString();

        if (isEditing) {
            existing.setAttribute(cfg.valueAttr, value);
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
            markerSpan.setAttribute(cfg.valueAttr, value);
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
        }
    },

    /**
     * Показывает tooltip при наведении
     */
    showTooltip(element, event) {
        this.hideTooltip();

        const isLink = element.classList.contains('text-link');
        const content = isLink
            ? element.getAttribute('data-link-url')
            : element.getAttribute('data-footnote-text');

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
            // Удаляем старые обработчики
            if (element._contextmenuHandler) {
                element.removeEventListener('contextmenu', element._contextmenuHandler);
            }
            if (element._mouseenterHandler) {
                element.removeEventListener('mouseenter', element._mouseenterHandler);
            }
            if (element._mouseleaveHandler) {
                element.removeEventListener('mouseleave', element._mouseleaveHandler);
            }
            if (element._dblclickHandler) {
                element.removeEventListener('dblclick', element._dblclickHandler);
            }

            // Обработчик контекстного меню (ПКМ)
            element._contextmenuHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                linkFootnoteContextMenu.show(e.clientX, e.clientY, {element});
            };

            // Обработчик двойного клика (ЛКМ x2)
            element._dblclickHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.enableInlineEditing(element);
            };

            // Обработчик наведения для tooltip
            element._mouseenterHandler = (e) => {
                if (element.classList.contains('editing-mode')) return;

                this.tooltipTimeout = setTimeout(() => {
                    this.showTooltip(element, e);
                }, 700);
            };

            // Обработчик ухода мыши
            element._mouseleaveHandler = () => {
                this.hideTooltip();
            };

            // Привязываем обработчики
            element.addEventListener('contextmenu', element._contextmenuHandler);
            element.addEventListener('dblclick', element._dblclickHandler);
            element.addEventListener('mouseenter', element._mouseenterHandler);
            element.addEventListener('mouseleave', element._mouseleaveHandler);

            // Предотвращаем случайное редактирование
            element.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, true);
        });
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

    setTimeout(() => {
        this.applyFormattingToNewNodes(editor);
    }, 100);
};

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.linkFootnoteContextMenu = linkFootnoteContextMenu;
window.originalHandleEditorFocus = originalHandleEditorFocus;
