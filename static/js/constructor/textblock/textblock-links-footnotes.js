/**
 * Расширение TextBlockManager для работы с гиперссылками и сносками
 */

// Создаем глобальный экземпляр менеджера контекстного меню
const linkFootnoteContextMenu = new LinkFootnoteContextMenu();

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
        if (!this.activeEditor) return;

        const selection = window.getSelection();

        if (!selection || selection.isCollapsed) {
            alert('Выделите текст для создания гиперссылки');
            return;
        }

        let existingLink = this.findParentLink(selection.anchorNode);
        const isEditing = !!existingLink;
        const currentUrl = existingLink ? existingLink.getAttribute('data-link-url') : '';

        const url = prompt('Введите URL гиперссылки:', currentUrl);

        if (url === null) return;

        if (!url.trim()) {
            if (existingLink) {
                this.removeLinkOrFootnote(existingLink);
            }
            return;
        }

        const range = selection.getRangeAt(0);
        let selectedText = range.toString();

        if (isEditing) {
            existingLink.setAttribute('data-link-url', url);
            this.attachLinkFootnoteHandlers();
        } else {
            const trailingSpaces = selectedText.match(/\s+$/);
            const trailingSpaceText = trailingSpaces ? trailingSpaces[0] : '';
            selectedText = selectedText.trimEnd();

            if (!selectedText) {
                alert('Текст ссылки не может состоять только из пробелов');
                return;
            }

            const linkId = 'link_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            const linkSpan = document.createElement('span');
            linkSpan.className = 'text-link';
            linkSpan.setAttribute('data-link-id', linkId);
            linkSpan.setAttribute('data-link-url', url);
            linkSpan.contentEditable = 'false';
            linkSpan.textContent = selectedText;

            range.deleteContents();
            range.insertNode(linkSpan);

            this.inheritFormattingToElement(linkSpan);

            let spaceNode = null;
            if (trailingSpaceText) {
                spaceNode = document.createTextNode(trailingSpaceText);
                linkSpan.parentNode.insertBefore(spaceNode, linkSpan.nextSibling);
            }

            const nextNode = spaceNode ? spaceNode.nextSibling : linkSpan.nextSibling;
            const needsSpace = !spaceNode &&
                (!nextNode ||
                    (nextNode.nodeType === 3 && !nextNode.textContent.startsWith(' ')) ||
                    (nextNode.nodeType === 1));

            if (needsSpace) {
                const space = document.createTextNode(' ');
                if (spaceNode) {
                    spaceNode.parentNode.insertBefore(space, spaceNode.nextSibling);
                } else {
                    linkSpan.parentNode.insertBefore(space, linkSpan.nextSibling);
                }
                spaceNode = space;
            }

            if (spaceNode) {
                range.setStartAfter(spaceNode);
                range.setEndAfter(spaceNode);
            } else {
                range.setStartAfter(linkSpan);
                range.setEndAfter(linkSpan);
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
     * Создает или редактирует сноску
     */
    createOrEditFootnote() {
        if (!this.activeEditor) return;

        const selection = window.getSelection();

        if (!selection || selection.isCollapsed) {
            alert('Выделите текст для создания сноски');
            return;
        }

        let existingFootnote = this.findParentFootnote(selection.anchorNode);
        const isEditing = !!existingFootnote;
        const currentNote = existingFootnote ? existingFootnote.getAttribute('data-footnote-text') : '';

        const noteText = prompt('Введите текст сноски:', currentNote);

        if (noteText === null) return;

        if (!noteText.trim()) {
            if (existingFootnote) {
                this.removeLinkOrFootnote(existingFootnote);
            }
            return;
        }

        const range = selection.getRangeAt(0);
        let selectedText = range.toString();

        if (isEditing) {
            existingFootnote.setAttribute('data-footnote-text', noteText);
            this.attachLinkFootnoteHandlers();
        } else {
            const trailingSpaces = selectedText.match(/\s+$/);
            const trailingSpaceText = trailingSpaces ? trailingSpaces[0] : '';
            selectedText = selectedText.trimEnd();

            if (!selectedText) {
                alert('Текст сноски не может состоять только из пробелов');
                return;
            }

            const footnoteId = 'footnote_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            const footnoteSpan = document.createElement('span');
            footnoteSpan.className = 'text-footnote';
            footnoteSpan.setAttribute('data-footnote-id', footnoteId);
            footnoteSpan.setAttribute('data-footnote-text', noteText);
            footnoteSpan.contentEditable = 'false';
            footnoteSpan.textContent = selectedText;

            range.deleteContents();
            range.insertNode(footnoteSpan);

            this.inheritFormattingToElement(footnoteSpan);

            let spaceNode = null;
            if (trailingSpaceText) {
                spaceNode = document.createTextNode(trailingSpaceText);
                footnoteSpan.parentNode.insertBefore(spaceNode, footnoteSpan.nextSibling);
            }

            const nextNode = spaceNode ? spaceNode.nextSibling : footnoteSpan.nextSibling;
            const needsSpace = !spaceNode &&
                (!nextNode ||
                    (nextNode.nodeType === 3 && !nextNode.textContent.startsWith(' ')) ||
                    (nextNode.nodeType === 1));

            if (needsSpace) {
                const space = document.createTextNode(' ');
                if (spaceNode) {
                    spaceNode.parentNode.insertBefore(space, spaceNode.nextSibling);
                } else {
                    footnoteSpan.parentNode.insertBefore(space, footnoteSpan.nextSibling);
                }
                spaceNode = space;
            }

            if (spaceNode) {
                range.setStartAfter(spaceNode);
                range.setEndAfter(spaceNode);
            } else {
                range.setStartAfter(footnoteSpan);
                range.setEndAfter(footnoteSpan);
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
const originalHandleEditorFocus = TextBlockManager.prototype.handleEditorFocus;
TextBlockManager.prototype.handleEditorFocus = function (editor, textBlock) {
    originalHandleEditorFocus.call(this, editor, textBlock);
    this.initLinkFootnoteManager();
    this.attachLinkFootnoteHandlers();

    setTimeout(() => {
        this.applyFormattingToNewNodes(editor);
    }, 100);
};
