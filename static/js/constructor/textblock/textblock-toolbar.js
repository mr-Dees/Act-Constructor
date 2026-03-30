/**
 * Расширение для работы с панелью инструментов
 */
Object.assign(TextBlockManager.prototype, {
    /**
     * Инициализирует глобальную панель инструментов
     */
    initGlobalToolbar() {
        if (document.getElementById('globalTextBlockToolbar')) return;

        const toolbar = document.createElement('div');
        toolbar.id = 'globalTextBlockToolbar';
        toolbar.className = 'textblock-toolbar-global hidden';

        toolbar.innerHTML = `
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="bold" title="Жирный (Ctrl+Shift+B)">
                    <strong>Ж</strong>
                </button>
                <button class="toolbar-btn" data-command="italic" title="Курсив (Ctrl+Shift+I)">
                    <em>К</em>
                </button>
                <button class="toolbar-btn" data-command="underline" title="Подчёркнутый (Ctrl+Shift+U)">
                    <u>П</u>
                </button>
                <button class="toolbar-btn" data-command="strikeThrough" title="Зачёркнутый (Ctrl+Shift+X)">
                    <s>З</s>
                </button>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <select class="toolbar-select" id="fontSizeSelect" title="Размер шрифта (Ctrl+Shift+> / <)">
                    <option value="" disabled hidden>—</option>
                    ${this.fontSizes.map(size =>
            `<option value="${size}" ${size === 14 ? 'selected' : ''}>${size}px</option>`
        ).join('')}
                </select>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="justifyLeft" title="По левому краю (Ctrl+Shift+A — цикл)">
                    ◧
                </button>
                <button class="toolbar-btn" data-command="justifyCenter" title="По центру (Ctrl+Shift+A — цикл)">
                    ▥
                </button>
                <button class="toolbar-btn" data-command="justifyRight" title="По правому краю (Ctrl+Shift+A — цикл)">
                    ◨
                </button>
                <button class="toolbar-btn" data-command="justifyFull" title="По ширине (Ctrl+Shift+A — цикл)">
                    ▦
                </button>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="createLink" title="Добавить гиперссылку (Ctrl+Shift+K)">
                    🔗
                </button>
                <button class="toolbar-btn" data-command="createFootnote" title="Добавить сноску (Ctrl+Shift+F)">
                    📑
                </button>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="removeFormat" title="Очистить форматирование">
                    ✕
                </button>
            </div>
        `;

        document.body.appendChild(toolbar);
        this.globalToolbar = toolbar;
        this.attachToolbarEvents();
    },

    /**
     * Привязывает обработчики событий к тулбару
     */
    attachToolbarEvents() {
        if (!this.globalToolbar) return;

        // Обработчики для кнопок форматирования
        this.globalToolbar.querySelectorAll('.toolbar-btn[data-command]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const command = btn.dataset.command;

                // Специальная обработка для ссылок и сносок
                if (command === 'createLink') {
                    this.createOrEditLink();
                } else if (command === 'createFootnote') {
                    this.createOrEditFootnote();
                } else {
                    this.execCommand(command);
                }

                // Возвращаем фокус в редактор
                if (this.activeEditor) {
                    this.activeEditor.focus();
                    // Применяем форматирование к элементам
                    this.applyFormattingToNewNodes(this.activeEditor);
                }

                this.updateToolbarState();
            });
        });

        // Обработчик размера шрифта
        const fontSizeSelect = this.globalToolbar.querySelector('#fontSizeSelect');
        if (fontSizeSelect) {
            fontSizeSelect.addEventListener('change', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.applyFontSize(parseInt(e.target.value));
                if (this.activeEditor) {
                    this.activeEditor.focus();
                    this.applyFormattingToNewNodes(this.activeEditor);
                }
                this.updateToolbarState();
            });
        }
    },

    /**
     * Применяет размер шрифта к выделенному тексту, элементам или всему блоку
     */
    applyFontSize(fontSize) {
        if (!this.activeEditor) return;

        this.activeEditor.focus();
        const selection = window.getSelection();

        // Если есть выделение
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);

            // Собираем ID ссылок/сносок в выделении до изменения DOM
            // (contentEditable=false не позволяет execCommand менять их напрямую)
            const selectedSpecialIds = new Set();
            this.activeEditor.querySelectorAll('.text-link, .text-footnote').forEach(el => {
                if (range.intersectsNode(el)) {
                    selectedSpecialIds.add(
                        el.getAttribute('data-link-id') || el.getAttribute('data-footnote-id')
                    );
                }
            });

            // Применяем к обычному тексту через execCommand
            this.execCommand('fontSize', '7');

            // Заменяем font tags на span с точным размером, сохраняя выделение
            const fontTags = [...this.activeEditor.querySelectorAll('font[size="7"]')];
            const newSpans = [];
            fontTags.forEach(font => {
                const span = document.createElement('span');
                span.style.fontSize = `${fontSize}px`;
                span.innerHTML = font.innerHTML;

                // Удаляем font-size у вложенных элементов (кроме ссылок/сносок)
                span.querySelectorAll('[style]').forEach(child => {
                    if (child.style.fontSize &&
                        !child.classList?.contains('text-link') &&
                        !child.classList?.contains('text-footnote')) {
                        child.style.fontSize = '';
                        if (!child.getAttribute('style')?.trim()) {
                            child.removeAttribute('style');
                        }
                    }
                });

                font.parentNode.replaceChild(span, font);
                newSpans.push(span);
            });

            // Применяем размер к ссылкам/сноскам, попавшим в выделение
            if (selectedSpecialIds.size > 0) {
                this.activeEditor.querySelectorAll('.text-link, .text-footnote').forEach(el => {
                    const id = el.getAttribute('data-link-id') || el.getAttribute('data-footnote-id');
                    if (selectedSpecialIds.has(id)) {
                        el.style.fontSize = `${fontSize}px`;
                    }
                });
            }

            // Восстанавливаем выделение на новые элементы
            if (newSpans.length > 0) {
                const newRange = document.createRange();
                newRange.setStartBefore(newSpans[0]);
                newRange.setEndAfter(newSpans[newSpans.length - 1]);
                selection.removeAllRanges();
                selection.addRange(newRange);
            }
        } else {
            // Применяем ко всему блоку редактора
            this.activeEditor.style.fontSize = `${fontSize}px`;
        }

        const textBlockId = this.activeEditor.dataset.textBlockId;
        this.saveContent(textBlockId, this.activeEditor.innerHTML);
    },

    /**
     * Переключает размер шрифта на следующий/предыдущий из списка fontSizes
     * @param {number} direction - 1 для увеличения, -1 для уменьшения
     */
    stepFontSize(direction) {
        if (!this.activeEditor) return;

        const selection = window.getSelection();
        let fontSize = 14;

        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            // Для выделения — определяем размер из текстовых узлов
            const sizes = this._getSelectedFontSizes(selection);
            if (sizes.size > 0) {
                fontSize = [...sizes][0];
            }
        } else if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const container = range.startContainer;
            const element = container.nodeType === 3 ? container.parentElement : container;

            if (element && this.activeEditor.contains(element)) {
                fontSize = parseInt(window.getComputedStyle(element).fontSize);
            }
        } else {
            fontSize = parseInt(window.getComputedStyle(this.activeEditor).fontSize);
        }

        const closestIdx = this.fontSizes.reduce((bestIdx, _, idx, arr) =>
            Math.abs(arr[idx] - fontSize) < Math.abs(arr[bestIdx] - fontSize) ? idx : bestIdx, 0
        );

        const nextIdx = Math.max(0, Math.min(this.fontSizes.length - 1, closestIdx + direction));
        this.applyFontSize(this.fontSizes[nextIdx]);
        this.updateFontSizeSelect();
    },

    /**
     * Циклически переключает выравнивание текста
     * left → center → right → justify → left
     */
    cycleAlignment() {
        if (!this.activeEditor) return;

        const alignments = ['justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'];
        let currentIdx = alignments.findIndex(cmd => this.queryCommandState(cmd));
        if (currentIdx === -1) currentIdx = 0;

        const nextIdx = (currentIdx + 1) % alignments.length;
        this.execCommand(alignments[nextIdx]);
    },

    /**
     * Обновляет состояние кнопок тулбара
     */
    updateToolbarState() {
        if (!this.globalToolbar || !this.activeEditor) return;

        // Обновляем состояние кнопок форматирования
        this.globalToolbar.querySelectorAll('.toolbar-btn[data-command]').forEach(btn => {
            const command = btn.dataset.command;

            if (command === 'createLink' || command === 'createFootnote' || command === 'removeFormat') {
                return; // Эти кнопки не имеют активного состояния
            }

            try {
                const isActive = document.queryCommandState(command);
                btn.classList.toggle('active', isActive);
            } catch (e) {
                btn.classList.remove('active');
            }
        });

        // Обновляем размер шрифта
        this.updateFontSizeSelect();
    },

    /**
     * Обновляет выбранный размер шрифта в select
     */
    updateFontSizeSelect() {
        const fontSizeSelect = this.globalToolbar?.querySelector('#fontSizeSelect');
        if (!fontSizeSelect) return;

        const selection = window.getSelection();

        // Если есть выделение — проверяем смешанные размеры
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const sizes = this._getSelectedFontSizes(selection);

            if (sizes.size > 1) {
                // Смешанные размеры — показываем прочерк
                fontSizeSelect.value = '';
                return;
            }

            if (sizes.size === 1) {
                const fontSize = [...sizes][0];
                const closestSize = this.fontSizes.reduce((prev, curr) =>
                    Math.abs(curr - fontSize) < Math.abs(prev - fontSize) ? curr : prev
                );
                fontSizeSelect.value = closestSize;
                return;
            }
        }

        // Курсор без выделения
        let fontSize = 14;
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const container = range.startContainer;
            const element = container.nodeType === 3 ? container.parentElement : container;

            if (element && this.activeEditor?.contains(element)) {
                fontSize = parseInt(window.getComputedStyle(element).fontSize);
            }
        } else if (this.activeEditor) {
            fontSize = parseInt(window.getComputedStyle(this.activeEditor).fontSize);
        }

        const closestSize = this.fontSizes.reduce((prev, curr) =>
            Math.abs(curr - fontSize) < Math.abs(prev - fontSize) ? curr : prev
        );
        fontSizeSelect.value = closestSize;
    },

    /**
     * Собирает уникальные размеры шрифта из выделенного текста
     * @private
     */
    _getSelectedFontSizes(selection) {
        const sizes = new Set();
        const range = selection.getRangeAt(0);
        const ancestor = range.commonAncestorContainer;
        const root = ancestor.nodeType === 3 ? ancestor.parentElement : ancestor;

        if (!root || !this.activeEditor?.contains(root)) return sizes;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                return range.intersectsNode(node)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        });

        let node;
        while (node = walker.nextNode()) {
            const el = node.parentElement;
            if (el) {
                sizes.add(parseInt(window.getComputedStyle(el).fontSize));
            }
        }

        return sizes;
    }
});
