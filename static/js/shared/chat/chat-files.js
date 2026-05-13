/**
 * Менеджер файлов чата
 *
 * Валидация, drag-and-drop, превью прикреплённых файлов.
 * Публикует events при изменении списка файлов.
 */
const ChatFiles = {

    /** @type {boolean} */
    _initialized: false,
    /** @type {File[]} Файлы, ожидающие отправки */
    _pendingFiles: [],

    /** @type {HTMLElement|null} */
    _messagesContainer: null,

    /** Лимиты файлов (соответствуют серверным настройкам по умолчанию) */
    _FILE_LIMITS: {
        maxFileSize: 10 * 1024 * 1024,       // 10 МБ на файл
        maxFilesPerMessage: 5,                // файлов в сообщении
        maxTotalFileSize: 30 * 1024 * 1024,   // 30 МБ суммарно
    },

    /**
     * Инициализация: файловый ввод и drag-and-drop
     *
     * @param {Object} data
     * @param {HTMLElement} data.messagesContainer
     */
    init({ messagesContainer }) {
        if (this._initialized) return;
        this._messagesContainer = messagesContainer;
        this._initFileInput();
        this._initDragAndDrop();

        // Сохраняем именованные ссылки, чтобы destroy() мог отписаться.
        this._onConversationCleared = () => this.clear();
        this._onConversationSwitched = () => this.clear();
        ChatEventBus.on('context:conversation-cleared', this._onConversationCleared);
        ChatEventBus.on('context:conversation-switched', this._onConversationSwitched);

        // Лимиты тянем с сервера — fire-and-forget; до ответа используются
        // дефолты (которые совпадают с дефолтами в settings.py).
        this._loadLimits();

        this._initialized = true;
    },

    /**
     * Снимает подписки на шину событий. Идемпотентно: повторный вызов
     * безопасен. Используется в тестах и при «горячем» переинит чата.
     */
    destroy() {
        if (!this._initialized) return;
        if (this._onConversationCleared) {
            ChatEventBus.off('context:conversation-cleared', this._onConversationCleared);
            this._onConversationCleared = null;
        }
        if (this._onConversationSwitched) {
            ChatEventBus.off('context:conversation-switched', this._onConversationSwitched);
            this._onConversationSwitched = null;
        }
        this._initialized = false;
    },

    /**
     * Загружает реальные лимиты с сервера. Тихо игнорирует ошибку —
     * валидация на сервере всё равно сработает.
     * @private
     */
    async _loadLimits() {
        try {
            const resp = await fetch('/api/v1/chat/limits', {
                credentials: 'same-origin',
            });
            if (!resp.ok) return;
            const data = await resp.json();
            if (typeof data.max_file_size === 'number') {
                this._FILE_LIMITS.maxFileSize = data.max_file_size;
            }
            if (typeof data.max_total_file_size === 'number') {
                this._FILE_LIMITS.maxTotalFileSize = data.max_total_file_size;
            }
            if (typeof data.max_files_per_message === 'number') {
                this._FILE_LIMITS.maxFilesPerMessage = data.max_files_per_message;
            }
        } catch (_) {
            // Сеть/CORS — оставляем дефолты, серверная валидация прикроет.
        }
    },

    /**
     * Возвращает копию списка ожидающих файлов
     * @returns {File[]}
     */
    getPendingFiles() {
        return [...this._pendingFiles];
    },

    /**
     * Очищает список ожидающих файлов и превью
     */
    clear() {
        this._pendingFiles = [];
        this._renderFilePreview();
        ChatEventBus.emit('files:cleared');
    },

    /**
     * Инициализирует файловый ввод и превью прикреплённых файлов
     * @private
     */
    _initFileInput() {
        const fileInput = document.getElementById('chatFileInput');
        if (!fileInput) return;

        fileInput.addEventListener('change', () => {
            const validated = this._validateFiles([...fileInput.files]);
            for (const file of validated) {
                this._pendingFiles.push(file);
            }
            fileInput.value = '';
            this._renderFilePreview();
            ChatEventBus.emit('files:changed', { files: this._pendingFiles });
        });
    },

    /**
     * Инициализирует drag-and-drop файлов в область чата
     * @private
     */
    _initDragAndDrop() {
        const dropZone = this._messagesContainer?.closest('.chat-body');
        if (!dropZone) return;

        const overlay = dropZone.querySelector('.chat-drop-overlay');
        if (!overlay) return;

        let dragCounter = 0;

        dropZone.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (!this._hasDragFiles(e)) return;
            dragCounter++;
            if (dragCounter === 1) overlay.classList.remove('hidden');
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this._hasDragFiles(e)) e.dataTransfer.dropEffect = 'copy';
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                overlay.classList.add('hidden');
            }
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            overlay.classList.add('hidden');

            if (ChatUI.isProcessing()) return;

            const files = e.dataTransfer?.files;
            if (!files || files.length === 0) return;

            const validated = this._validateFiles([...files]);
            for (const file of validated) {
                this._pendingFiles.push(file);
            }
            this._renderFilePreview();
            ChatEventBus.emit('files:changed', { files: this._pendingFiles });
        });
    },

    /**
     * Проверяет, содержит ли drag-событие файлы
     * @param {DragEvent} e
     * @returns {boolean}
     * @private
     */
    _hasDragFiles(e) {
        if (e.dataTransfer?.types) {
            return e.dataTransfer.types.includes('Files');
        }
        return false;
    },

    /**
     * Валидирует новые файлы перед добавлением в очередь.
     * Возвращает массив файлов, прошедших проверку.
     *
     * @param {File[]} newFiles — новые файлы для добавления
     * @returns {File[]} валидные файлы
     * @private
     */
    _validateFiles(newFiles) {
        const limits = this._FILE_LIMITS;
        const currentSize = this._pendingFiles.reduce((sum, f) => sum + f.size, 0);
        const currentCount = this._pendingFiles.length;

        const accepted = [];
        const errors = [];

        for (const file of newFiles) {
            if (file.size > limits.maxFileSize) {
                const maxMb = (limits.maxFileSize / (1024 * 1024)).toFixed(0);
                errors.push(`«${file.name}» превышает ${maxMb} МБ`);
                continue;
            }

            if (currentCount + accepted.length >= limits.maxFilesPerMessage) {
                errors.push(`Максимум ${limits.maxFilesPerMessage} файлов в сообщении`);
                break;
            }

            const totalAfter = currentSize + accepted.reduce((s, f) => s + f.size, 0) + file.size;
            if (totalAfter > limits.maxTotalFileSize) {
                const maxMb = (limits.maxTotalFileSize / (1024 * 1024)).toFixed(0);
                errors.push(`Суммарный размер файлов превышает ${maxMb} МБ`);
                break;
            }

            accepted.push(file);
        }

        if (errors.length > 0 && typeof Notifications !== 'undefined') {
            Notifications.warning(errors.join('. '));
        }

        return accepted;
    },

    /**
     * Рендерит превью прикреплённых файлов
     * @private
     */
    _renderFilePreview() {
        const preview = document.getElementById('chatFilePreview');
        if (!preview) return;

        if (this._pendingFiles.length === 0) {
            preview.hidden = true;
            preview.innerHTML = '';
            return;
        }

        preview.hidden = false;
        preview.innerHTML = '';

        this._pendingFiles.forEach((file, index) => {
            const chip = document.createElement('div');
            chip.className = 'chat-file-chip';

            const name = document.createElement('span');
            name.textContent = file.name;

            const remove = document.createElement('span');
            remove.className = 'chat-file-chip-remove';
            remove.textContent = '\u00D7';
            remove.addEventListener('click', () => {
                this._pendingFiles.splice(index, 1);
                this._renderFilePreview();
                ChatEventBus.emit('files:changed', { files: this._pendingFiles });
            });

            chip.appendChild(name);
            chip.appendChild(remove);
            preview.appendChild(chip);
        });
    },
};

window.ChatFiles = ChatFiles;
