/**
 * Клиент для взаимодействия с API
 *
 * Обрабатывает все HTTP-запросы к серверу для работы с актами.
 * Предоставляет методы для генерации и скачивания файлов актов.
 */
class APIClient {
    /**
     * Генерирует и сохраняет акты на сервере
     *
     * Поддерживает создание нескольких форматов за один вызов.
     * Автоматически предлагает скачать созданные файлы.
     *
     * @param {string|string[]} formats - Формат или массив форматов ('txt', 'md', 'docx')
     * @returns {Promise<boolean>} true если хотя бы один файл создан успешно
     */
    static async generateAct(formats = 'txt') {
        const data = AppState.exportData();
        const formatList = Array.isArray(formats) ? formats : [formats];

        // Фильтруем только поддерживаемые форматы
        const validFormats = formatList.filter(fmt =>
            ['txt', 'docx', 'md'].includes(fmt)
        );

        if (validFormats.length === 0) {
            Notifications.error('Не выбраны валидные форматы для сохранения');
            return false;
        }

        const results = [];
        let successCount = 0;
        let errorCount = 0;

        try {
            // Последовательно создаем файлы всех форматов
            for (const format of validFormats) {
                try {
                    const response = await fetch(
                        `/api/v1/act_operations/save_act?fmt=${format}`,
                        {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify(data)
                        }
                    );

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`HTTP ${response.status}: ${errorText}`);
                    }

                    const result = await response.json();
                    results.push({
                        format,
                        filename: result.filename,
                        success: true
                    });
                    successCount++;

                } catch (error) {
                    results.push({
                        format,
                        error: error.message,
                        success: false
                    });
                    errorCount++;
                }
            }

            // Показываем итоговое уведомление
            this._showGenerationResults(successCount, errorCount, results);

            // Предлагаем скачать успешно созданные файлы
            if (successCount > 0) {
                await this._handleDownloadPrompt(results, successCount);
            }

            return successCount > 0;

        } catch (error) {
            Notifications.error(`Произошла ошибка: ${error.message}`, 8000);
            return false;
        }
    }

    /**
     * Показывает результаты генерации файлов
     * @private
     * @param {number} successCount - Количество успешно созданных файлов
     * @param {number} errorCount - Количество ошибок
     * @param {Array} results - Массив результатов
     */
    static _showGenerationResults(successCount, errorCount, results) {
        if (successCount > 0 && errorCount === 0) {
            const formatsList = results
                .filter(r => r.success)
                .map(r => r.format.toUpperCase())
                .join(', ');
            Notifications.success(
                `Создано ${successCount} файл(ов): ${formatsList}`,
                7000
            );
        } else if (successCount > 0 && errorCount > 0) {
            Notifications.info(
                `Успешно: ${successCount}, Ошибок: ${errorCount}`,
                7000
            );
        } else {
            Notifications.error('Не удалось создать файлы', 7000);
        }
    }

    /**
     * Обрабатывает предложение скачать созданные файлы
     * @private
     * @param {Array} results - Массив результатов генерации
     * @param {number} successCount - Количество успешно созданных файлов
     */
    static async _handleDownloadPrompt(results, successCount) {
        const shouldDownload = await DialogManager.show({
            title: 'Скачать созданные файлы?',
            message: `Было успешно создано ${successCount} файл(ов). Хотите скачать их сейчас?`,
            icon: '📥',
            confirmText: 'Скачать все',
            cancelText: 'Не нужно'
        });

        if (shouldDownload) {
            await this._downloadAllFiles(results);
        }
    }

    /**
     * Скачивает все успешно созданные файлы
     * @private
     * @param {Array} results - Массив результатов генерации
     */
    static async _downloadAllFiles(results) {
        let downloadedCount = 0;
        let downloadErrors = 0;

        for (const result of results.filter(r => r.success)) {
            try {
                await this.downloadFile(result.filename);
                downloadedCount++;
            } catch (error) {
                downloadErrors++;
            }
        }

        // Показываем итоговое уведомление о скачивании
        if (downloadedCount === results.filter(r => r.success).length) {
            Notifications.success(
                `Успешно скачано ${downloadedCount} файл(ов)`,
                3000
            );
        } else {
            Notifications.info(
                `Скачано: ${downloadedCount}, Ошибок: ${downloadErrors}`,
                5000
            );
        }
    }

    /**
     * Скачивает сгенерированный файл
     *
     * @param {string} filename - Имя файла для скачивания
     * @throws {Error} При ошибке скачивания
     */
    static async downloadFile(filename) {
        try {
            const response = await fetch(
                `/api/v1/act_operations/download/${filename}`
            );

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`Файл "${filename}" не найден на сервере`);
                }
                throw new Error(
                    `Ошибка сервера: ${response.status} ${response.statusText}`
                );
            }

            const blob = await response.blob();

            // Создаем временную ссылку для инициации скачивания
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;

            document.body.appendChild(a);
            a.click();

            // Освобождаем память
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (error) {
            throw error;
        }
    }
}
