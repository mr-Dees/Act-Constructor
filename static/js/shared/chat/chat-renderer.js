/**
 * Рендерер блоков чата
 *
 * Отвечает за отображение структурированных блоков сообщений:
 * текст с markdown, код с подсветкой, reasoning, plan, файлы, изображения, кнопки.
 * Поддерживает стриминг через createStreamingBlock().
 */
const ChatRenderer = {

    /**
     * Рендерит массив блоков в DOM-контейнер
     *
     * @param {HTMLElement} container — контейнер для отрисовки
     * @param {Array<Object>} blocks — массив блоков {type, ...data}
     */
    renderBlocks(container, blocks) {
        if (!container || !Array.isArray(blocks)) return;

        for (const block of blocks) {
            const el = this.renderBlock(block);
            if (el) container.appendChild(el);
        }
    },

    /**
     * Рендерит один блок в DOM-элемент
     *
     * @param {Object} block — блок {type, ...data}
     * @returns {HTMLElement|null}
     */
    renderBlock(block) {
        if (!block || !block.type) return null;

        switch (block.type) {
            case 'text':
                return this._renderText(block);
            case 'code':
                return this._renderCode(block);
            case 'reasoning':
                return this._renderReasoning(block);
            case 'plan':
                return this._renderPlan(block);
            case 'file':
                return this._renderFile(block);
            case 'image':
                return this._renderImage(block);
            case 'buttons':
                return this._renderButtons(block);
            default:
                console.warn('ChatRenderer: неизвестный тип блока', block.type);
                return null;
        }
    },

    /**
     * Создаёт стриминговый блок для инкрементального отображения SSE-данных
     *
     * @param {string} blockType — тип блока ('text' или 'reasoning')
     * @returns {{ element: HTMLElement, appendText: function(string): void, finalize: function(): void }}
     */
    createStreamingBlock(blockType) {
        if (blockType === 'reasoning') {
            const details = document.createElement('details');
            details.className = 'chat-block chat-block-reasoning';

            const displayMode = this._getReasoningDisplayMode();
            if (displayMode === 'hidden') {
                details.style.display = 'none';
            } else if (displayMode === 'expanded') {
                details.open = true;
            }

            const summary = document.createElement('summary');
            summary.textContent = 'Рассуждение';
            details.appendChild(summary);

            const content = document.createElement('div');
            content.className = 'chat-block-reasoning-content';
            details.appendChild(content);

            let accumulated = '';

            return {
                element: details,
                appendText(text) {
                    accumulated += text;
                    content.innerHTML = ChatRenderer._markdownToHtml(accumulated);
                },
                finalize() {
                    content.innerHTML = ChatRenderer._markdownToHtml(accumulated);
                },
            };
        }

        // По умолчанию — текстовый блок
        const div = document.createElement('div');
        div.className = 'chat-block chat-block-text';

        let accumulated = '';

        return {
            element: div,
            appendText(text) {
                accumulated += text;
                div.innerHTML = ChatRenderer._markdownToHtml(accumulated);
            },
            finalize() {
                div.innerHTML = ChatRenderer._markdownToHtml(accumulated);
            },
        };
    },

    /**
     * Обновляет существующий блок плана или создаёт новый
     *
     * @param {HTMLElement} container — контейнер, в котором ищем/создаём plan
     * @param {Array<{title: string, status: string}>} steps — шаги плана
     */
    updatePlan(container, steps) {
        let planEl = container.querySelector('.chat-block-plan');

        if (!planEl) {
            planEl = this._renderPlan({ steps });
            container.appendChild(planEl);
            return;
        }

        // Обновляем содержимое существующего блока
        const list = planEl.querySelector('.chat-block-plan-steps');
        if (list) {
            list.innerHTML = '';
            for (const step of steps) {
                const li = document.createElement('li');
                li.className = `chat-block-plan-step chat-block-plan-step--${step.status || 'pending'}`;

                const icon = document.createElement('span');
                icon.className = 'chat-block-plan-step-icon';
                icon.textContent = this._getPlanStatusIcon(step.status);

                const title = document.createElement('span');
                title.textContent = step.title || '';

                li.appendChild(icon);
                li.appendChild(title);
                list.appendChild(li);
            }
        }
    },

    // ========================================================
    //  Рендереры отдельных типов блоков
    // ========================================================

    /**
     * Текстовый блок с базовым markdown
     * @private
     */
    _renderText(block) {
        const div = document.createElement('div');
        div.className = 'chat-block chat-block-text';
        div.innerHTML = this._markdownToHtml(block.text || block.content || '');
        return div;
    },

    /**
     * Блок кода с заголовком (язык + кнопка копирования)
     * @private
     */
    _renderCode(block) {
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-block chat-block-code';

        // Заголовок: язык + копировать
        const header = document.createElement('div');
        header.className = 'chat-block-code-header';

        const lang = document.createElement('span');
        lang.className = 'chat-block-code-lang';
        lang.textContent = block.language || 'code';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'chat-block-code-copy';
        copyBtn.textContent = 'Копировать';
        copyBtn.addEventListener('click', () => this._copyCode(copyBtn));

        header.appendChild(lang);
        header.appendChild(copyBtn);

        // Код
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = block.code || block.content || '';
        pre.appendChild(code);

        wrapper.appendChild(header);
        wrapper.appendChild(pre);

        return wrapper;
    },

    /**
     * Блок рассуждений (сворачиваемый details/summary)
     * @private
     */
    _renderReasoning(block) {
        const details = document.createElement('details');
        details.className = 'chat-block chat-block-reasoning';

        const displayMode = this._getReasoningDisplayMode();
        if (displayMode === 'hidden') {
            details.style.display = 'none';
        } else if (displayMode === 'expanded') {
            details.open = true;
        }

        const summary = document.createElement('summary');
        summary.textContent = 'Рассуждение';
        details.appendChild(summary);

        const content = document.createElement('div');
        content.className = 'chat-block-reasoning-content';
        content.innerHTML = this._markdownToHtml(block.text || block.content || '');
        details.appendChild(content);

        return details;
    },

    /**
     * Блок плана с шагами и статусами
     * @private
     */
    _renderPlan(block) {
        const div = document.createElement('div');
        div.className = 'chat-block chat-block-plan';

        if (block.title) {
            const title = document.createElement('div');
            title.className = 'chat-block-plan-title';
            title.textContent = block.title;
            div.appendChild(title);
        }

        const list = document.createElement('ul');
        list.className = 'chat-block-plan-steps';

        const steps = block.steps || [];
        for (const step of steps) {
            const li = document.createElement('li');
            li.className = `chat-block-plan-step chat-block-plan-step--${step.status || 'pending'}`;

            const icon = document.createElement('span');
            icon.className = 'chat-block-plan-step-icon';
            icon.textContent = this._getPlanStatusIcon(step.status);

            const title = document.createElement('span');
            title.textContent = step.title || '';

            li.appendChild(icon);
            li.appendChild(title);
            list.appendChild(li);
        }

        div.appendChild(list);
        return div;
    },

    /**
     * Блок файла — карточка с иконкой, именем и размером
     * @private
     */
    _renderFile(block) {
        const div = document.createElement('div');
        div.className = 'chat-block chat-block-file';

        const icon = document.createElement('span');
        icon.className = 'chat-block-file-icon';
        icon.textContent = '\uD83D\uDCC4'; // 📄

        // Если есть file_id — ссылка для скачивания, иначе просто span
        const nameEl = document.createElement(block.file_id ? 'a' : 'span');
        nameEl.className = 'chat-block-file-name';
        nameEl.textContent = block.filename || block.name || 'Файл';

        if (block.file_id) {
            nameEl.target = '_blank';
            nameEl.rel = 'noopener noreferrer';
            const fileUrl = `/api/v1/chat/files/${block.file_id}`;
            nameEl.href = (typeof AppConfig !== 'undefined')
                ? AppConfig.api.getUrl(fileUrl)
                : fileUrl;
        }

        const size = document.createElement('span');
        size.className = 'chat-block-file-size';
        size.textContent = this._formatSize(block.file_size || block.size || 0);

        div.appendChild(icon);
        div.appendChild(nameEl);
        div.appendChild(size);

        return div;
    },

    /**
     * Блок изображения с ленивой загрузкой
     * @private
     */
    _renderImage(block) {
        const div = document.createElement('div');
        div.className = 'chat-block chat-block-image';

        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = block.alt || 'Изображение';

        const imgUrl = block.url || (block.file_id
            ? ((typeof AppConfig !== 'undefined')
                ? AppConfig.api.getUrl(`/api/v1/chat/files/${block.file_id}`)
                : `/api/v1/chat/files/${block.file_id}`)
            : '');

        img.src = imgUrl;
        div.appendChild(img);

        return div;
    },

    /**
     * Блок кнопок (quick_reply или action)
     * @private
     */
    _renderButtons(block) {
        const variant = block.variant || 'quick_reply';
        const div = document.createElement('div');
        div.className = `chat-block chat-block-buttons chat-block-buttons--${variant}`;

        const buttons = block.buttons || [];
        for (const btn of buttons) {
            const button = document.createElement('button');
            button.className = 'chat-btn';
            button.textContent = btn.label || btn.text || '';

            if (variant === 'quick_reply') {
                button.addEventListener('click', () => {
                    if (typeof ChatManager !== 'undefined' && ChatManager.sendQuickReply) {
                        ChatManager.sendQuickReply(btn.value || btn.label || '');
                    }
                });
            } else if (variant === 'action') {
                button.addEventListener('click', () => {
                    if (btn.confirm) {
                        const confirmed = window.confirm(
                            typeof btn.confirm === 'string' ? btn.confirm : 'Выполнить действие?'
                        );
                        if (!confirmed) return;
                    }
                    if (typeof ChatManager !== 'undefined' && ChatManager.executeAction) {
                        ChatManager.executeAction(btn.id, btn.params || {});
                    }
                });
            }

            div.appendChild(button);
        }

        return div;
    },

    // ========================================================
    //  Хелперы
    // ========================================================

    /**
     * Базовый markdown → HTML (bold, italic, inline code, переносы строк)
     * Сначала экранирует HTML, затем применяет форматирование.
     *
     * @param {string} text
     * @returns {string}
     * @private
     */
    _markdownToHtml(text) {
        if (!text) return '';

        let html = this._escapeHtml(text);

        // Inline code (одинарные обратные кавычки)
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold: **text** или __text__
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

        // Italic: *text* или _text_
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.+?)_/g, '<em>$1</em>');

        // Переносы строк
        html = html.replace(/\n/g, '<br>');

        return html;
    },

    /**
     * Экранирует HTML-спецсимволы
     *
     * @param {string} text
     * @returns {string}
     * @private
     */
    _escapeHtml(text) {
        const el = document.createElement('div');
        el.textContent = text;
        return el.innerHTML;
    },

    /**
     * Форматирует размер файла в человекочитаемый вид
     *
     * @param {number} bytes
     * @returns {string}
     * @private
     */
    _formatSize(bytes) {
        if (bytes < 1024) return bytes + ' Б';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
        return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
    },

    /**
     * Копирует код в буфер обмена, показывает подтверждение
     *
     * @param {HTMLButtonElement} button — кнопка «Копировать»
     * @private
     */
    _copyCode(button) {
        const wrapper = button.closest('.chat-block-code');
        if (!wrapper) return;

        const code = wrapper.querySelector('code');
        if (!code) return;

        navigator.clipboard.writeText(code.textContent).then(() => {
            const originalText = button.textContent;
            button.textContent = 'Скопировано';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        }).catch(() => {
            console.warn('ChatRenderer: не удалось скопировать в буфер обмена');
        });
    },

    /**
     * Возвращает иконку статуса шага плана
     *
     * @param {string} status — 'done', 'in_progress' или 'pending'
     * @returns {string}
     * @private
     */
    _getPlanStatusIcon(status) {
        switch (status) {
            case 'done': return '\u2713'; // ✓
            case 'in_progress': return '\u27F3'; // ⟳
            default: return '\u25CB'; // ○
        }
    },

    /**
     * Читает режим отображения reasoning из localStorage
     *
     * @returns {'hidden'|'collapsed'|'expanded'}
     * @private
     */
    _getReasoningDisplayMode() {
        try {
            const mode = localStorage.getItem('chat_reasoning_display');
            if (mode === 'hidden' || mode === 'collapsed' || mode === 'expanded') {
                return mode;
            }
        } catch { /* localStorage недоступен */ }
        return 'collapsed';
    },
};

window.ChatRenderer = ChatRenderer;
