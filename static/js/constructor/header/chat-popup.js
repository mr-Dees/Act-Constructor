/**
 * Менеджер popup-панели чата AI-ассистента в конструкторе
 *
 * Управляет открытием/закрытием popup, ленивой инициализацией ChatManager,
 * свободным изменением размера (corner grip) и сохранением размеров в localStorage.
 */
class ChatPopupManager {
    /** @type {boolean} */
    static _initialized = false;
    /** @type {boolean} */
    static _chatInitialized = false;

    static _storageKey = 'chat_popup_size';
    static _defaultWidth = 650;
    static _minWidth = 480;
    static _maxWidthVw = 80;
    static _minHeight = 300;
    static _maxHeightVh = 85;

    /**
     * Инициализирует popup: кэширует DOM, подключает обработчики
     */
    static setup() {
        this._btn = document.getElementById('chatPopupBtn');
        this._panel = document.getElementById('chatPopupPanel');
        this._resizeCorner = document.getElementById('chatPopupResizeCorner');
        this._closeBtn = this._panel?.querySelector('.chat-close-btn');

        if (!this._btn || !this._panel) {
            console.warn('ChatPopupManager: не найдены необходимые DOM-элементы');
            return;
        }

        // Восстанавливаем сохранённые размеры
        this._restoreSize();

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

        // Corner resize (свободное изменение ширины и высоты)
        this._setupCornerResize();

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
     * Настраивает свободный resize через угловую ручку (bottom-right)
     * @private
     */
    static _setupCornerResize() {
        if (!this._resizeCorner) return;

        let isResizing = false;
        let startX = 0;
        let startY = 0;
        let startWidth = 0;
        let startHeight = 0;

        this._resizeCorner.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = this._panel.offsetWidth;
            startHeight = this._panel.offsetHeight;

            document.body.style.cursor = 'nwse-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            requestAnimationFrame(() => {
                const maxWidth = window.innerWidth * this._maxWidthVw / 100;
                const maxHeight = window.innerHeight * this._maxHeightVh / 100;

                const newWidth = Math.max(
                    this._minWidth,
                    Math.min(maxWidth, startWidth + (e.clientX - startX)),
                );
                const newHeight = Math.max(
                    this._minHeight,
                    Math.min(maxHeight, startHeight + (e.clientY - startY)),
                );

                this._panel.style.width = newWidth + 'px';
                this._panel.style.height = newHeight + 'px';
                this._panel.style.maxHeight = newHeight + 'px';
            });
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;

            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            this._saveSize();
        });
    }

    /**
     * Сохраняет размеры панели в localStorage
     * @private
     */
    static _saveSize() {
        if (!this._panel) return;
        try {
            localStorage.setItem(this._storageKey, JSON.stringify({
                width: this._panel.style.width,
                height: this._panel.style.height,
            }));
        } catch { /* ignore */ }
    }

    /**
     * Восстанавливает размеры панели из localStorage
     * @private
     */
    static _restoreSize() {
        try {
            const saved = localStorage.getItem(this._storageKey);
            if (!saved || !this._panel) return;

            const { width, height } = JSON.parse(saved);
            if (width) this._panel.style.width = width;
            if (height) {
                this._panel.style.height = height;
                this._panel.style.maxHeight = height;
            }
        } catch { /* ignore */ }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => ChatPopupManager.setup());

// Глобальный доступ
window.ChatPopupManager = ChatPopupManager;
