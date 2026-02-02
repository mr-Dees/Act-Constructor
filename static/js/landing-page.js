/**
 * Менеджер стартовой страницы (Landing Page)
 *
 * Управляет отображением портала инструментов компании:
 * - Sidebar с навигацией по инструментам
 * - Airflow dashboard с проектами (заглушка)
 * - AI-чат ассистент (заглушка)
 */
class LandingPage {
    /**
     * Инициализирует landing page
     */
    static init() {
        console.log('LandingPage: инициализация');

        this._setupNavigation();
        this._setupPlaceholderInteractions();

        console.log('LandingPage: инициализация завершена');
    }

    /**
     * Настраивает обработчики для topbar, чата и airflow
     * @private
     */
    static _setupNavigation() {
        // Кнопка закрытия чата (пока ничего не делает, т.к. это заглушка)
        const chatCloseBtn = document.querySelector('.chat-close-btn');
        if (chatCloseBtn) {
            chatCloseBtn.addEventListener('click', () => {
                console.log('Закрытие чата (функция в разработке)');
            });
        }

        // Кнопки в topbar
        const topbarButtons = document.querySelectorAll('.landing-topbar-btn');
        topbarButtons.forEach(button => {
            button.addEventListener('click', () => {
                console.log('Функция в разработке');
            });
        });

        // Кнопка фильтров в airflow
        const filterBtn = document.querySelector('.airflow-filter-btn');
        if (filterBtn) {
            filterBtn.addEventListener('click', () => {
                console.log('Фильтры проектов (функция в разработке)');
            });
        }
    }

    /**
     * Настраивает взаимодействия с заглушками
     * @private
     */
    static _setupPlaceholderInteractions() {
        // Клики по карточкам проектов (заглушка)
        const projectCards = document.querySelectorAll('.project-card');
        projectCards.forEach((card, index) => {
            card.addEventListener('click', () => {
                const title = card.querySelector('.project-card-title').textContent;
                console.log(`Открытие проекта: ${title} (функция в разработке)`);
            });

            // Добавляем hover эффект
            card.style.cursor = 'pointer';
        });

        // Попытка отправить сообщение в чат (заглушка)
        const chatInput = document.querySelector('.chat-input');
        const chatSendBtn = document.querySelector('.chat-send-btn');

        if (chatInput) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !chatInput.disabled) {
                    this._sendChatMessage(chatInput.value);
                    chatInput.value = '';
                }
            });
        }

        if (chatSendBtn) {
            chatSendBtn.addEventListener('click', () => {
                if (!chatInput.disabled && chatInput.value.trim()) {
                    this._sendChatMessage(chatInput.value);
                    chatInput.value = '';
                }
            });
        }
    }

    /**
     * Отправляет сообщение в чат (заглушка)
     * @private
     * @param {string} message - Текст сообщения
     */
    static _sendChatMessage(message) {
        console.log('Отправка сообщения в чат (функция в разработке):', message);
        // В будущем здесь будет реальная отправка сообщения AI-ассистенту
    }

    /**
     * Обновляет список проектов (заглушка для будущей интеграции с Airflow)
     * @private
     */
    static async _refreshProjects() {
        console.log('Обновление списка проектов (функция в разработке)');
        // В будущем здесь будет запрос к Airflow API
    }
}

// Экспортируем в глобальную область видимости
window.LandingPage = LandingPage;
