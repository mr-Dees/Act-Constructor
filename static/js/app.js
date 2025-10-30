/**
 * Главный класс приложения
 * Отвечает за инициализацию и управление всем приложением
 */
class App {
    /**
     * Инициализация приложения
     * Вызывается при загрузке страницы
     */
    static init() {
        // Создаем начальную структуру дерева
        AppState.initializeTree();

        // Генерируем нумерацию для всех элементов
        AppState.generateNumbering();

        // Создаем хранилище для размеров таблиц, если его еще нет
        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }

        // Отрисовываем дерево в левой панели
        treeManager.render();

        // Обновляем превью с небольшой задержкой для корректного рендера
        setTimeout(() => PreviewManager.update('previewTrim'), 30);

        // Настраиваем навигацию между шагами
        this.setupNavigation();

        // Настраиваем меню выбора форматов
        this.setupFormatMenu();

        // Инициализируем контекстное меню
        ContextMenuManager.init();

        // Инициализируем систему подсказок
        HelpManager.init();
    }

    /**
     * Настройка навигации между шагами и обработчиков кнопок
     */
    static setupNavigation() {
        // Получаем элементы кнопок
        const nextBtn = document.getElementById('nextBtn');
        const backBtn = document.getElementById('backBtn');
        const generateBtn = document.getElementById('generateBtn');

        // Кнопка "Далее" - переход ко второму шагу
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.goToStep(2));
        }

        // Кнопка "Назад" - возврат к первому шагу
        backBtn.addEventListener('click', () => this.goToStep(1));

        // Кнопка "Сохранить" - генерация документов
        generateBtn.addEventListener('click', async () => {
            // Получаем выбранные форматы
            const selectedFormats = this.getSelectedFormats();

            // Проверяем, что выбран хотя бы один формат
            if (selectedFormats.length === 0) {
                alert('Выберите хотя бы один формат для сохранения');
                return;
            }

            // Проверяем данные акта на корректность
            const validationResult = this.validateActData();
            if (!validationResult.valid) {
                alert(validationResult.message);
                return;
            }

            // Сохраняем данные из DOM обратно в AppState
            ItemsRenderer.syncDataToState();

            // Блокируем кнопку на время операции
            generateBtn.disabled = true;
            const originalText = generateBtn.textContent;
            generateBtn.textContent = '⏳ Создаём акты...';

            try {
                // Отправляем запрос на создание актов во всех выбранных форматах
                const success = await APIClient.generateAct(selectedFormats);
            } catch (error) {
                // Показываем ошибку, если что-то пошло не так
                console.error('Критическая ошибка:', error);
                APIClient.showNotification(
                    'Критическая ошибка',
                    `Произошла непредвиденная ошибка: ${error.message}`,
                    'error'
                );
            } finally {
                // Возвращаем кнопку в исходное состояние
                generateBtn.disabled = false;
                generateBtn.textContent = originalText;
            }
        });

        // Клик по заголовкам шагов для быстрой навигации
        const header = document.querySelector('.header');
        header.querySelectorAll('.step').forEach(step => {
            step.addEventListener('click', () => {
                const stepNum = parseInt(step.dataset.step);
                this.goToStep(stepNum);
            });
        });

        // Горячая клавиша Ctrl+S для быстрого сохранения
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                // Сохраняем только если находимся на втором шаге
                if (AppState.currentStep === 2) {
                    generateBtn.click();
                }
            }
        });
    }

    /**
     * Настройка выпадающего меню выбора форматов
     */
    static setupFormatMenu() {
        const dropdownBtn = document.getElementById('formatDropdownBtn');
        const formatMenu = document.getElementById('formatMenu');
        const generateBtn = document.getElementById('generateBtn');

        // Если элементы не найдены - выходим
        if (!dropdownBtn || !formatMenu) return;

        // Открытие/закрытие меню по клику на кнопку
        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // Умное позиционирование меню
            if (formatMenu.classList.contains('hidden')) {
                // Определяем доступное пространство сверху и снизу
                const buttonRect = dropdownBtn.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const spaceBelow = viewportHeight - buttonRect.bottom;
                const spaceAbove = buttonRect.top;

                // Показываем меню сверху, если снизу недостаточно места
                if (spaceBelow < 200 && spaceAbove > 200) {
                    formatMenu.style.bottom = 'calc(100% + 8px)';
                    formatMenu.style.top = 'auto';
                } else {
                    formatMenu.style.top = 'calc(100% + 8px)';
                    formatMenu.style.bottom = 'auto';
                }
            }

            // Переключаем видимость меню
            formatMenu.classList.toggle('hidden');
            dropdownBtn.classList.toggle('active');
        });

        // Закрываем меню при клике вне его
        document.addEventListener('click', (e) => {
            if (!formatMenu.contains(e.target) && e.target !== dropdownBtn) {
                formatMenu.classList.add('hidden');
                dropdownBtn.classList.remove('active');
            }
        });

        // Обновляем индикатор при изменении чекбоксов
        const checkboxes = formatMenu.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateFormatIndicator();
            });
        });

        // Предотвращаем закрытие меню при клике на чекбоксы
        formatMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Показываем начальное состояние индикатора
        this.updateFormatIndicator();
    }

    /**
     * Получение списка выбранных форматов
     * @returns {string[]} Массив выбранных форматов (например, ['txt', 'docx'])
     */
    static getSelectedFormats() {
        const checkboxes = document.querySelectorAll('#formatMenu input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    /**
     * Обновление визуального индикатора выбранных форматов
     */
    static updateFormatIndicator() {
        const generateBtn = document.getElementById('generateBtn');
        const dropdownBtn = document.getElementById('formatDropdownBtn');
        const selectedFormats = this.getSelectedFormats();

        if (selectedFormats.length > 0) {
            // Формируем текст с выбранными форматами
            const formatsText = selectedFormats.map(f => f.toUpperCase()).join(' + ');

            // Убираем индикатор с основной кнопки
            generateBtn.removeAttribute('data-formats');
            generateBtn.classList.remove('has-formats');

            // Добавляем индикатор на кнопку выпадающего меню
            dropdownBtn.setAttribute('data-formats', formatsText);
            dropdownBtn.classList.add('has-formats');
            dropdownBtn.title = `Выбрано: ${formatsText}`;
            generateBtn.title = `Сохранить в форматах: ${formatsText}`;
        } else {
            // Убираем все индикаторы
            generateBtn.removeAttribute('data-formats');
            generateBtn.classList.remove('has-formats');
            dropdownBtn.removeAttribute('data-formats');
            dropdownBtn.classList.remove('has-formats');
            generateBtn.title = 'Выберите хотя бы один формат';
            dropdownBtn.title = 'Выбрать форматы';
        }
    }

    /**
     * Проверка данных акта перед сохранением
     * @returns {{valid: boolean, message: string}} Результат валидации
     */
    static validateActData() {
        // Проверяем наличие структуры дерева
        if (!AppState.treeData || !AppState.treeData.children) {
            return {valid: false, message: 'Структура акта пуста'};
        }

        // Проверяем, что добавлен хотя бы один раздел
        if (AppState.treeData.children.length === 0) {
            return {valid: false, message: 'Добавьте хотя бы один раздел в акт'};
        }

        // Проверяем, что все таблицы заполнены
        for (const tableId in AppState.tables) {
            const table = AppState.tables[tableId];
            if (!table.rows || table.rows.length === 0) {
                return {valid: false, message: `Таблица ${tableId} пуста`};
            }
        }

        return {valid: true, message: 'OK'};
    }

    /**
     * Переключение между шагами приложения
     * @param {number} stepNum - Номер шага (1 или 2)
     */
    static goToStep(stepNum) {
        // Сохраняем текущий шаг
        AppState.currentStep = stepNum;

        // Обновляем активный шаг в заголовке
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
            if (parseInt(step.dataset.step) === stepNum) {
                step.classList.add('active');
            }
        });

        // Скрываем все шаги
        document.querySelectorAll('.step-content').forEach(content => {
            content.classList.add('hidden');
        });

        // Показываем нужный шаг
        const currentContent = document.getElementById(`step${stepNum}`);
        if (currentContent) {
            currentContent.classList.remove('hidden');
        }

        // На втором шаге показываем панели редактирования
        if (stepNum === 2) {
            textBlockManager.initGlobalToolbar();
            ItemsRenderer.renderAll();
        } else {
            textBlockManager.hideToolbar();
        }

        // На первом шаге обновляем превью
        if (stepNum === 1) {
            setTimeout(() => PreviewManager.update('previewTrim'), 30);
        }

        // Обновляем подсказки
        if (typeof HelpManager !== 'undefined') {
            HelpManager.updateTooltip();
        }
    }
}

// Запуск приложения при загрузке DOM
document.addEventListener('DOMContentLoaded', () => App.init());