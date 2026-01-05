/**
 * Менеджер выпадающего меню предпросмотра
 *
 * Управляет открытием/закрытием меню и обновлением содержимого
 * Поддерживает изменение размера через drag-ручку
 */
class PreviewMenuManager {
    constructor() {
        this.menu = null;
        this.menuBody = null;
        this.openButton = null;
        this.closeButton = null;
        this.resizeHandle = null;
        this.isOpen = false;

        // Настройки ресайза
        this.isResizing = false;
        this.startX = 0;
        this.startWidth = 0;
        this.minWidth = 480; // 30rem = 480px
        this.maxWidth = window.innerWidth * 0.9;
        this.defaultWidth = window.innerWidth * 0.66;

        // Оптимизация: throttle для resize
        this.resizeRAF = null;

        this.init();
    }

    /**
     * Инициализация меню и обработчиков событий
     */
    init() {
        this.menu = document.getElementById('previewMenu');
        this.menuBody = document.getElementById('previewMenuBody');
        this.openButton = document.getElementById('previewMenuBtn');
        this.closeButton = document.getElementById('closePreviewMenuBtn');
        this.resizeHandle = document.getElementById('previewMenuResizeHandle');

        if (!this.menu || !this.menuBody || !this.openButton || !this.closeButton) {
            console.error('PreviewMenu: не найдены необходимые элементы');
            return;
        }

        // Загружаем сохраненную ширину или используем по умолчанию
        this._loadWidth();

        this._attachEventListeners();
        this._attachResizeListeners();
    }

    /**
     * Подключает обработчики событий
     * @private
     */
    _attachEventListeners() {
        this.openButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        this.closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });

        // Закрытие при клике вне меню
        document.addEventListener('click', (e) => {
            if (this.isOpen &&
                !this.menu.contains(e.target) &&
                !this.openButton.closest('.header-action-container').contains(e.target)) {
                this.close();
            }
        });

        // Закрытие по Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });

        // Обновление максимальной ширины при изменении размера окна (с debounce)
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.maxWidth = window.innerWidth * 0.9;
                const currentWidth = parseInt(this.menu.style.width) || this.defaultWidth;
                if (currentWidth > this.maxWidth) {
                    this._setWidth(this.maxWidth);
                }
            }, 150);
        });
    }

    /**
     * Подключает обработчики для ресайза
     * @private
     */
    _attachResizeListeners() {
        if (!this.resizeHandle) return;

        // Привязываем контекст один раз
        this._boundHandleResize = this._handleResize.bind(this);
        this._boundStopResize = this._stopResize.bind(this);

        this.resizeHandle.addEventListener('mousedown', (e) => {
            this._startResize(e);
        });

        // Двойной клик для сброса к ширине по умолчанию
        this.resizeHandle.addEventListener('dblclick', () => {
            this._resetWidth();
        });
    }

    /**
     * Начало изменения размера
     * @private
     */
    _startResize(e) {
        this.isResizing = true;
        this.startX = e.clientX;
        this.startWidth = this.menu.offsetWidth;

        this.resizeHandle.classList.add('resizing');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';

        // Добавляем слушатели только при активном resize
        document.addEventListener('mousemove', this._boundHandleResize, {passive: true});
        document.addEventListener('mouseup', this._boundStopResize, {once: true});

        // Отключаем transition для плавности
        this.menu.style.transition = 'none';

        e.preventDefault();
    }

    /**
     * Обработка изменения размера с throttle через RAF
     * @private
     */
    _handleResize(e) {
        if (!this.isResizing) return;

        // Используем requestAnimationFrame для throttle
        if (this.resizeRAF) return;

        this.resizeRAF = requestAnimationFrame(() => {
            const deltaX = this.startX - e.clientX;
            const newWidth = this.startWidth + deltaX;

            // Ограничиваем ширину минимумом и максимумом
            const clampedWidth = Math.max(this.minWidth, Math.min(newWidth, this.maxWidth));

            this.menu.style.width = `${clampedWidth}px`;

            this.resizeRAF = null;
        });
    }

    /**
     * Завершение изменения размера
     * @private
     */
    _stopResize() {
        if (!this.isResizing) return;

        this.isResizing = false;
        this.resizeHandle.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Удаляем слушатели
        document.removeEventListener('mousemove', this._boundHandleResize);

        // Включаем обратно transition
        this.menu.style.transition = '';

        // Отменяем pending RAF если есть
        if (this.resizeRAF) {
            cancelAnimationFrame(this.resizeRAF);
            this.resizeRAF = null;
        }

        // Сохраняем новую ширину
        this._saveWidth();
    }

    /**
     * Устанавливает ширину меню
     * @private
     */
    _setWidth(width) {
        this.menu.style.width = `${width}px`;
    }

    /**
     * Сбрасывает ширину к значению по умолчанию
     * @private
     */
    _resetWidth() {
        this._setWidth(this.defaultWidth);
        this._saveWidth();
    }

    /**
     * Сохраняет текущую ширину в localStorage
     * @private
     */
    _saveWidth() {
        const width = this.menu.offsetWidth;
        localStorage.setItem('preview-menu-width', width.toString());
    }

    /**
     * Загружает сохраненную ширину из localStorage
     * @private
     */
    _loadWidth() {
        const savedWidth = localStorage.getItem('preview-menu-width');
        if (savedWidth) {
            const width = parseInt(savedWidth, 10);
            if (width >= this.minWidth && width <= this.maxWidth) {
                this._setWidth(width);
                return;
            }
        }
        this._setWidth(this.defaultWidth);
    }

    /**
     * Переключает состояние меню
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Открывает меню предпросмотра
     */
    open() {
        this.menu.classList.remove('hidden');
        this.openButton.classList.add('active');
        this.isOpen = true;

        // Обновляем содержимое
        this.updateContent();

        // Уведомляем о событии
        this._dispatchEvent('preview-menu:opened');
    }

    /**
     * Закрывает меню предпросмотра
     */
    close() {
        this.menu.classList.add('hidden');
        this.openButton.classList.remove('active');
        this.isOpen = false;

        // Уведомляем о событии
        this._dispatchEvent('preview-menu:closed');
    }

    /**
     * Обновляет содержимое меню
     */
    updateContent() {
        if (!this.isOpen) return;

        this.menuBody.classList.add('loading');
        this.menuBody.innerHTML = '';

        // Используем requestAnimationFrame для плавности
        requestAnimationFrame(() => {
            this._renderContent();
            this.menuBody.classList.remove('loading');
        });
    }

    /**
     * Рендерит содержимое предпросмотра
     * @private
     */
    _renderContent() {
        // Проверяем наличие данных
        if (!AppState.treeData || !AppState.treeData.children?.length) {
            this.menuBody.classList.add('empty');
            return;
        }

        this.menuBody.classList.remove('empty');

        // Создаем заголовок
        const title = document.createElement('h1');
        title.textContent = 'АКТ';
        this.menuBody.appendChild(title);

        // Рендерим дерево через PreviewManager
        const previewTrim = AppConfig.preview.defaultTrimLength;
        PreviewManager.renderNode(
            AppState.treeData,
            this.menuBody,
            1,
            previewTrim
        );
    }

    /**
     * Отправляет кастомное событие
     * @private
     */
    _dispatchEvent(eventName) {
        const event = new CustomEvent(eventName, {
            detail: {isOpen: this.isOpen}
        });
        document.dispatchEvent(event);
    }

    /**
     * Принудительно обновляет содержимое, если меню открыто
     */
    forceUpdate() {
        if (this.isOpen) {
            this.updateContent();
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.previewMenuManager = new PreviewMenuManager();

    // Автообновление при изменениях в AppState (опционально)
    document.addEventListener('app:state-changed', () => {
        if (window.previewMenuManager?.isOpen) {
            window.previewMenuManager.forceUpdate();
        }
    });
});
