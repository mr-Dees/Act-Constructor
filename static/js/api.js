/**
 * Клиент для взаимодействия с API
 */
class APIClient {

    /**
     * Показывает уведомление в правом верхнем углу
     * @param {string} title - Заголовок уведомления
     * @param {string} message - Текст уведомления
     * @param {string} type - Тип уведомления ('success', 'error', 'info')
     * @param {number} duration - Длительность показа в мс (0 = не скрывать автоматически)
     */
    static showNotification(title, message, type = 'info', duration = 5000) {
        // Создаем контейнер для уведомлений, если его нет
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            document.body.appendChild(container);
        }

        // Иконки для разных типов
        const icons = {
            success: '✅',
            error: '❌',
            info: 'ℹ️'
        };

        // Создаем уведомление
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-icon">${icons[type] || icons.info}</div>
            <div class="notification-content">
                <div class="notification-title">${title}</div>
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close">×</button>
        `;

        // Добавляем обработчик закрытия
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.addEventListener('click', () => {
            notification.classList.add('hiding');
            setTimeout(() => notification.remove(), 300);
        });

        // Добавляем в контейнер
        container.appendChild(notification);

        // Автоматическое скрытие
        if (duration > 0) {
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.classList.add('hiding');
                    setTimeout(() => notification.remove(), 300);
                }
            }, duration);
        }
    }

    /**
     * Показывает кастомный диалог подтверждения
     * @param {string} title - Заголовок
     * @param {string} message - Сообщение
     * @param {string} confirmText - Текст кнопки подтверждения
     * @param {string} cancelText - Текст кнопки отмены
     * @returns {Promise<boolean>} - true если подтверждено
     */
    static showConfirmDialog(title, message, confirmText = 'Да', cancelText = 'Нет') {
        return new Promise((resolve) => {
            // Создаем оверлей
            const overlay = document.createElement('div');
            overlay.className = 'custom-dialog-overlay';
            overlay.innerHTML = `
                <div class="custom-dialog">
                    <div class="dialog-icon">📥</div>
                    <div class="dialog-title">${title}</div>
                    <div class="dialog-message">${message}</div>
                    <div class="dialog-buttons">
                        <button class="dialog-btn dialog-btn-primary" data-action="confirm">${confirmText}</button>
                        <button class="dialog-btn dialog-btn-secondary" data-action="cancel">${cancelText}</button>
                    </div>
                </div>
            `;

            // Обработчики кнопок
            overlay.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                if (action === 'confirm') {
                    overlay.remove();
                    resolve(true);
                } else if (action === 'cancel' || e.target === overlay) {
                    overlay.remove();
                    resolve(false);
                }
            });

            document.body.appendChild(overlay);
        });
    }

    /**
     * Генерирует и сохраняет акты на сервере (поддерживает множественные форматы)
     * @param {string|string[]} formats - Формат или массив форматов ('txt', 'md', 'docx')
     * @returns {Promise<boolean>} - Успешность операции
     */
    static async generateAct(formats = 'txt') {
        const data = AppState.exportData();

        // Нормализуем форматы в массив
        const formatList = Array.isArray(formats) ? formats : [formats];

        // Валидация форматов
        const validFormats = formatList.filter(fmt => ['txt', 'docx', 'md'].includes(fmt));
        if (validFormats.length === 0) {
            console.error('Нет валидных форматов:', formatList);
            this.showNotification(
                'Ошибка форматов',
                'Не выбраны валидные форматы для сохранения',
                'error'
            );
            return false;
        }

        console.log(`🔄 Начинаем генерацию ${validFormats.length} актов в форматах: ${validFormats.join(', ')}`);

        const results = [];
        let successCount = 0;
        let errorCount = 0;

        try {
            // Сохраняем все форматы БЕЗ промежуточных уведомлений
            for (const format of validFormats) {
                try {
                    console.log(`📝 Генерируем акт в формате ${format.toUpperCase()}...`);

                    const response = await fetch(`/api/v1/act_operations/save_act?fmt=${format}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`HTTP ${response.status}: ${errorText}`);
                    }

                    const result = await response.json();
                    results.push({format, filename: result.filename, success: true});
                    successCount++;

                    console.log(`✅ Акт ${format.toUpperCase()} успешно создан: ${result.filename}`);

                } catch (error) {
                    console.error(`❌ Ошибка при создании акта ${format.toUpperCase()}:`, error);
                    results.push({format, error: error.message, success: false});
                    errorCount++;
                }
            }

            // Показываем ОДНО общее уведомление о результате ПОСЛЕ всех операций
            if (successCount > 0 && errorCount === 0) {
                // Все файлы созданы успешно
                const formatsList = results
                    .filter(r => r.success)
                    .map(r => r.format.toUpperCase())
                    .join(', ');

                this.showNotification(
                    '✨ Акты успешно созданы',
                    `Создано ${successCount} файл(ов): ${formatsList}`,
                    'success',
                    7000
                );
            } else if (successCount > 0 && errorCount > 0) {
                // Частично успешно
                this.showNotification(
                    '⚠️ Создано с ошибками',
                    `Успешно: ${successCount}, Ошибок: ${errorCount}`,
                    'info',
                    7000
                );
            } else {
                // Все с ошибками
                this.showNotification(
                    '❌ Ошибка создания',
                    `Не удалось создать файлы. Проверьте консоль.`,
                    'error',
                    7000
                );
            }

            // Подробные ошибки только в консоль
            if (errorCount > 0) {
                console.group('❌ Детали ошибок:');
                results.filter(r => !r.success).forEach(r => {
                    console.error(`${r.format.toUpperCase()}: ${r.error}`);
                });
                console.groupEnd();
            }

            // Спрашиваем о скачивании ОДИН раз для всех успешных файлов
            if (successCount > 0) {
                const shouldDownload = await this.showConfirmDialog(
                    'Скачать созданные файлы?',
                    `Было успешно создано ${successCount} файл(ов). Хотите скачать их сейчас?`,
                    'Скачать все',
                    'Не нужно'
                );

                if (shouldDownload) {
                    console.log(`📥 Пользователь запросил скачивание ${successCount} файлов`);

                    let downloadedCount = 0;
                    let downloadErrors = 0;

                    // Скачиваем все успешные файлы
                    for (const result of results.filter(r => r.success)) {
                        try {
                            await this.downloadFile(result.filename, false);
                            downloadedCount++;
                            console.log(`✅ Файл ${result.filename} успешно скачан`);
                        } catch (error) {
                            downloadErrors++;
                            console.error(`❌ Ошибка при скачивании ${result.filename}:`, error);
                        }
                    }

                    // Финальное уведомление о скачивании
                    if (downloadedCount === successCount) {
                        this.showNotification(
                            '📥 Все файлы скачаны',
                            `Успешно скачано ${downloadedCount} файл(ов)`,
                            'success',
                            3000
                        );
                    } else {
                        this.showNotification(
                            '⚠️ Скачивание завершено',
                            `Скачано: ${downloadedCount}, Ошибок: ${downloadErrors}`,
                            'info',
                            5000
                        );
                    }
                } else {
                    console.log('📋 Файлы созданы, скачивание отклонено пользователем');
                }
            }

            return successCount > 0;

        } catch (error) {
            console.error('❌ Критическая ошибка при генерации актов:', error);
            this.showNotification(
                'Критическая ошибка',
                `Произошла ошибка: ${error.message}`,
                'error',
                8000
            );
            return false;
        }
    }

    /**
     * Получает историю сохраненных актов
     * @returns {Promise<string[]>} - Список файлов актов
     */
    static async getHistory() {
        try {
            console.log('📋 Получаем историю актов...');

            const response = await fetch('/api/v1/act_operations/history');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log(`📋 Получена история: ${data.count} файлов`);
            return data.acts;

        } catch (error) {
            console.error('❌ Ошибка при получении истории:', error);
            return [];
        }
    }

    /**
     * Скачивает сгенерированный файл без дополнительных уведомлений
     * @param {string} filename - Имя файла
     * @param {boolean} showUIErrors - Показывать ошибки в UI (по умолчанию false)
     */
    static async downloadFile(filename, showUIErrors = false) {
        try {
            console.log(`📥 Начинаем скачивание файла: ${filename}`);

            const response = await fetch(`/api/v1/act_operations/download/${filename}`);

            if (!response.ok) {
                const errorDetails = {
                    status: response.status,
                    statusText: response.statusText,
                    url: response.url,
                    filename: filename
                };

                console.error('❌ Детальная информация об ошибке скачивания:', errorDetails);

                if (showUIErrors) {
                    if (response.status === 404) {
                        this.showNotification(
                            'Файл не найден',
                            `Файл "${filename}" не найден на сервере`,
                            'error'
                        );
                    } else {
                        this.showNotification(
                            'Ошибка скачивания',
                            `Ошибка сервера: ${response.status} ${response.statusText}`,
                            'error'
                        );
                    }
                }

                throw new Error(`Ошибка скачивания: ${response.status} ${response.statusText}`);
            }

            console.log(`📦 Получаем blob для файла: ${filename}`);
            const blob = await response.blob();

            console.log(`📦 Размер файла: ${blob.size} байт, тип: ${blob.type}`);

            // Создаем ссылку для скачивания
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;

            // Добавляем элемент в DOM, кликаем и удаляем
            document.body.appendChild(a);
            a.click();

            // Очищаем ресурсы
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            console.log(`✅ Файл успешно скачан: ${filename}`);

        } catch (error) {
            const detailedError = {
                message: error.message,
                filename: filename,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent
            };

            console.error('❌ Подробная ошибка скачивания:', detailedError);

            if (showUIErrors) {
                this.showNotification(
                    'Ошибка скачивания',
                    `Не удалось скачать "${filename}". Проверьте консоль для деталей.`,
                    'error'
                );
            }

            throw error;
        }
    }
}
