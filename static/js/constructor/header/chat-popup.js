/**
 * Менеджер popup-панели чата AI-ассистента в конструкторе
 *
 * Управляет открытием/закрытием popup, ленивой инициализацией ChatManager,
 * изменением размера панели и сохранением ширины в localStorage.
 */
class ChatPopupManager {
    /** @type {boolean} */
    static _initialized = false;
    /** @type {boolean} */
    static _chatInitialized = false;

    static _storageKey = 'chat_popup_width';
    static _defaultWidth = 500;
    static _minWidth = 400;
    static _maxWidthVw = 80;

    /**
     * Инициализирует popup: кэширует DOM, подключает обработчики
     */
    static setup() {
        this._btn = document.getElementById('chatPopupBtn');
        this._panel = document.getElementById('chatPopupPanel');
        this._resizeHandle = document.getElementById('chatPopupResizeHandle');
        this._closeBtn = this._panel?.querySelector('.chat-close-btn');

        if (!this._btn || !this._panel) {
            console.warn('ChatPopupManager: не найдены необходимые DOM-элементы');
            return;
        }

        // Восстанавливаем сохранённую ширину
        this._restoreWidth();

        // Кнопка toggle
        this._btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Кнопка закрытия внутри панели
        if (this._closeBtn) {
            this._closeBtn.addEventListener('click', () => {
                this.close();
            });
        }

        // Закрытие по клику вне панели
        document.addEventListener('click', (e) => {
            if (!this._panel.contains(e.target) && !this._btn.contains(e.target)) {
                this.close();
            }
        });

        // Предотвращаем закрытие при клике внутри
        this._panel.addEventListener('click', (e) => e.stopPropagation());

        // Закрытие по Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this._panel.classList.contains('hidden')) {
                this.close();
            }
        });

        // Resize handle
        this._setupResize();

        this._initialized = true;
        console.log('ChatPopupManager: инициализация завершена');
    }

    /**
     * Открывает popup-панель чата
     */
    static open() {
        if (!this._panel) return;

        // Ленивая инициализация ChatManager при первом открытии
        if (!this._chatInitialized && typeof ChatManager !== 'undefined') {
            ChatManager.init();
            this._chatInitialized = true;
        }

        this._panel.classList.remove('hidden');
        this._btn.classList.add('active');

        // Фокус на поле ввода
        const input = this._panel.querySelector('.chat-input');
        if (input) {
            setTimeout(() => input.focus(), 100);
        }
    }

    /**
     * Закрывает popup-панель чата
     */
    static close() {
        if (!this._panel) return;

        this._panel.classList.add('hidden');
        this._btn.classList.remove('active');
    }

    /**
     * Переключает видимость popup-панели
     */
    static toggle() {
        if (this._panel && this._panel.classList.contains('hidden')) {
            this.open();
        } else {
            this.close();
        }
    }

    /**
     * Настраивает resize через левый drag handle
     * @private
     */
    static _setupResize() {
        if (!this._resizeHandle) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        this._resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            isResizing = true;
            startX = e.clientX;
            startWidth = this._panel.offsetWidth;

            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            requestAnimationFrame(() => {
                // Правый drag → увеличение ширины = startWidth + (clientX - startX)
                const delta = e.clientX - startX;
                const maxWidth = window.innerWidth * this._maxWidthVw / 100;
                const newWidth = Math.max(this._minWidth, Math.min(maxWidth, startWidth + delta));

                this._panel.style.width = newWidth + 'px';
            });
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;

            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // Сохраняем новую ширину
            this._saveWidth();
        });
    }

    /**
     * Сохраняет ширину панели в localStorage
     * @private
     */
    static _saveWidth() {
        if (!this._panel) return;
        try {
            localStorage.setItem(this._storageKey, this._panel.style.width || this._defaultWidth + 'px');
        } catch (e) {
            // ignore
        }
    }

    /**
     * Восстанавливает ширину панели из localStorage
     * @private
     */
    static _restoreWidth() {
        try {
            const saved = localStorage.getItem(this._storageKey);
            if (saved && this._panel) {
                this._panel.style.width = saved;
            }
        } catch (e) {
            // ignore
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => ChatPopupManager.setup());

// Глобальный доступ
window.ChatPopupManager = ChatPopupManager;
