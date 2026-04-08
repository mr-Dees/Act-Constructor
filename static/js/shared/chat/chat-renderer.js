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
     * Блок файла — карточка с иконкой, именем, размером и кнопками действий
     * @private
     */
    _renderFile(block) {
        const div = document.createElement('div');
        div.className = 'chat-block chat-block-file';

        const icon = document.createElement('span');
        icon.className = 'chat-block-file-icon';
        icon.textContent = '\uD83D\uDCC4'; // 📄

        const nameEl = document.createElement('span');
        nameEl.className = 'chat-block-file-name';
        nameEl.textContent = block.filename || block.name || 'Файл';

        if (block.file_id) {
            nameEl.classList.add('chat-block-file-name--clickable');
            nameEl.addEventListener('click', () => ChatRenderer._openFileViewer(block));
        }

        const size = document.createElement('span');
        size.className = 'chat-block-file-size';
        size.textContent = this._formatSize(block.file_size || block.size || 0);

        div.appendChild(icon);
        div.appendChild(nameEl);
        div.appendChild(size);

        // Кнопки действий — только при наличии file_id
        if (block.file_id) {
            const actions = document.createElement('div');
            actions.className = 'chat-block-file-actions';

            // Предпросмотр
            const previewBtn = document.createElement('button');
            previewBtn.className = 'chat-block-file-btn';
            previewBtn.title = 'Предпросмотр';
            previewBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>';
            previewBtn.addEventListener('click', () => ChatRenderer._openFileViewer(block));

            // Скачать
            const downloadBtn = document.createElement('a');
            downloadBtn.className = 'chat-block-file-btn';
            downloadBtn.href = this._getFileUrl(block.file_id);
            downloadBtn.download = block.filename || block.name || 'Файл';
            downloadBtn.title = 'Скачать';
            downloadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

            actions.appendChild(previewBtn);
            actions.appendChild(downloadBtn);
            div.appendChild(actions);
        }

        return div;
    },

    /**
     * Блок изображения с ленивой загрузкой и предпросмотром по клику
     * @private
     */
    _renderImage(block) {
        const div = document.createElement('div');
        div.className = 'chat-block chat-block-image';

        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = block.alt || 'Изображение';

        const imgUrl = block.url || (block.file_id
            ? this._getFileUrl(block.file_id)
            : '');

        img.src = imgUrl;

        if (block.file_id) {
            img.style.cursor = 'pointer';
            img.addEventListener('click', () => ChatRenderer._openFileViewer({
                ...block,
                mime_type: block.mime_type || 'image/png',
            }));
        }

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
     * Конструирует URL для скачивания файла чата
     *
     * @param {string} fileId — идентификатор файла
     * @returns {string}
     * @private
     */
    _getFileUrl(fileId) {
        const path = `/api/v1/chat/files/${fileId}`;
        return (typeof AppConfig !== 'undefined') ? AppConfig.api.getUrl(path) : path;
    },

    /**
     * Открывает полноэкранный модальный просмотрщик файла
     *
     * Поддерживает изображения, PDF, текстовые файлы и JSON/XML.
     * Для неподдерживаемых типов предлагает скачать.
     *
     * @param {Object} block — блок файла {file_id, filename, name, mime_type, ...}
     * @private
     */
    _openFileViewer(block) {
        // Удаляем предыдущий просмотрщик, если есть
        ChatRenderer._closeFileViewer();

        const fileUrl = ChatRenderer._getFileUrl(block.file_id);
        const inlineUrl = fileUrl + (fileUrl.includes('?') ? '&' : '?') + 'inline=true';
        const mime = (block.mime_type || '').toLowerCase();
        const filename = block.filename || block.name || 'Файл';

        // Оверлей
        const overlay = document.createElement('div');
        overlay.className = 'chat-file-viewer-overlay';

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) ChatRenderer._closeFileViewer();
        });

        ChatRenderer._fileViewerEscHandler = (e) => {
            if (e.key === 'Escape') ChatRenderer._closeFileViewer();
        };
        document.addEventListener('keydown', ChatRenderer._fileViewerEscHandler);

        // Модальный контейнер
        const modal = document.createElement('div');
        modal.className = 'chat-file-viewer';

        // Шапка
        const header = document.createElement('div');
        header.className = 'chat-file-viewer-header';

        const title = document.createElement('span');
        title.className = 'chat-file-viewer-title';
        title.textContent = filename;

        const actions = document.createElement('div');
        actions.className = 'chat-file-viewer-actions';

        // Кнопка «Скачать» в шапке
        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'chat-file-viewer-btn';
        downloadBtn.href = fileUrl;
        downloadBtn.download = filename;
        downloadBtn.title = 'Скачать';
        downloadBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        // Кнопка «Закрыть»
        const closeBtn = document.createElement('button');
        closeBtn.className = 'chat-file-viewer-btn';
        closeBtn.title = 'Закрыть';
        closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        closeBtn.addEventListener('click', () => ChatRenderer._closeFileViewer());

        actions.appendChild(downloadBtn);
        actions.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(actions);

        // Тело — содержимое зависит от MIME-типа
        const body = document.createElement('div');
        body.className = 'chat-file-viewer-body';

        if (mime.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = inlineUrl;
            img.alt = filename;
            img.className = 'chat-file-viewer-image';
            body.appendChild(img);
        } else if (mime === 'application/pdf') {
            const iframe = document.createElement('iframe');
            iframe.src = inlineUrl;
            iframe.className = 'chat-file-viewer-iframe';
            body.appendChild(iframe);
        } else if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
            const pre = document.createElement('pre');
            pre.className = 'chat-file-viewer-text';
            pre.textContent = 'Загрузка...';
            body.appendChild(pre);

            const fetchOpts = {};
            if (typeof AuthManager !== 'undefined' && AuthManager.getAuthHeaders) {
                fetchOpts.headers = AuthManager.getAuthHeaders();
            }
            fetch(inlineUrl, fetchOpts)
                .then(r => r.text())
                .then(text => { pre.textContent = text; })
                .catch(() => { pre.textContent = 'Ошибка загрузки файла'; });
        } else {
            // Неподдерживаемый тип — сообщение + ссылка на скачивание
            const unsupported = document.createElement('div');
            unsupported.className = 'chat-file-viewer-unsupported';
            unsupported.innerHTML = `
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <polyline points="14,2 14,8 20,8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <p>Предпросмотр недоступен для данного типа файла</p>
            `;
            const dlLink = document.createElement('a');
            dlLink.href = fileUrl;
            dlLink.download = filename;
            dlLink.className = 'chat-file-viewer-download-link';
            dlLink.textContent = 'Скачать файл';
            unsupported.appendChild(dlLink);
            body.appendChild(unsupported);
        }

        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    /**
     * Закрывает модальный просмотрщик файла
     * @private
     */
    _closeFileViewer() {
        const existing = document.querySelector('.chat-file-viewer-overlay');
        if (existing) existing.remove();
        if (ChatRenderer._fileViewerEscHandler) {
            document.removeEventListener('keydown', ChatRenderer._fileViewerEscHandler);
            ChatRenderer._fileViewerEscHandler = null;
        }
    },

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
