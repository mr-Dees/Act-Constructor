// static/js/api.js
/**
 * Клиент для взаимодействия с API
 *
 * Обрабатывает все HTTP-запросы к серверу для работы с актами.
 * Предоставляет методы для генерации и скачивания файлов актов,
 * загрузки/сохранения содержимого из БД, а также удаления актов.
 */
class APIClient {
    /**
     * Генерирует и сохраняет акты на сервере
     *
     * @param {string|string[]} formats - Формат или массив форматов ('txt', 'md', 'docx')
     * @returns {Promise<boolean>} true если хотя бы один файл создан успешно
     */
    static async generateAct(formats = 'txt') {
        StorageManager.disableTracking();

        try {
            StorageManager.saveState(true);

            const data = AppState.exportData();
            const formatList = Array.isArray(formats) ? formats : [formats];

            const validFormats = formatList.filter(fmt =>
                AppConfig.api.supportedFormats.includes(fmt)
            );

            if (validFormats.length === 0) {
                Notifications.error('Не выбраны валидные форматы для сохранения');
                return false;
            }

            const results = [];
            let successCount = 0;
            let errorCount = 0;

            for (const format of validFormats) {
                const result = await this._generateSingleFormat(format, data);
                results.push(result);

                if (result.success) {
                    successCount++;
                } else {
                    errorCount++;
                }
            }

            this._showGenerationResults(successCount, errorCount, results);

            if (successCount > 0) {
                await this._handleDownloadPrompt(results, successCount);
            }

            return successCount > 0;

        } catch (error) {
            Notifications.error(
                `Произошла ошибка: ${error.message}`,
                AppConfig.notifications.duration.longSuccess
            );
            return false;
        } finally {
            setTimeout(() => {
                StorageManager.enableTracking();
            }, 100);
        }
    }

    /**
     * Генерирует акт в одном формате
     * @private
     */
    static async _generateSingleFormat(format, data) {
        try {
            const response = await fetch(
                `${AppConfig.api.endpoints.saveAct}?fmt=${format}`,
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
            return {
                format,
                filename: result.filename,
                success: true
            };

        } catch (error) {
            console.error(`Ошибка генерации формата ${format}:`, error);
            return {
                format,
                error: error.message,
                success: false
            };
        }
    }

    /**
     * Показывает результаты генерации файлов
     * @private
     */
    static _showGenerationResults(successCount, errorCount, results) {
        if (successCount > 0 && errorCount === 0) {
            const formatsList = results
                .filter(r => r.success)
                .map(r => r.format.toUpperCase())
                .join(', ');
            Notifications.success(
                `Создано ${successCount} файл(ов): ${formatsList}`,
                AppConfig.notifications.duration.longSuccess
            );
        } else if (successCount > 0 && errorCount > 0) {
            Notifications.info(
                `Успешно: ${successCount}, Ошибок: ${errorCount}`,
                AppConfig.notifications.duration.longSuccess
            );
        } else {
            Notifications.error(
                'Не удалось создать файлы',
                AppConfig.notifications.duration.longSuccess
            );
        }
    }

    /**
     * Обрабатывает предложение скачать созданные файлы
     * @private
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
     */
    static async _downloadAllFiles(results) {
        const successfulResults = results.filter(r => r.success);
        let downloadedCount = 0;
        let downloadErrors = 0;

        for (const result of successfulResults) {
            try {
                await this.downloadFile(result.filename);
                downloadedCount++;
            } catch (error) {
                downloadErrors++;
            }
        }

        this._showDownloadResults(downloadedCount, downloadErrors, successfulResults.length);
    }

    /**
     * Показывает результаты скачивания файлов
     * @private
     */
    static _showDownloadResults(downloadedCount, downloadErrors, totalFiles) {
        if (downloadedCount === totalFiles) {
            Notifications.success(
                `Успешно скачано ${downloadedCount} файл(ов)`,
                AppConfig.notifications.duration.success
            );
        } else {
            Notifications.info(
                `Скачано: ${downloadedCount}, Ошибок: ${downloadErrors}`,
                AppConfig.notifications.duration.info
            );
        }
    }

    /**
     * Скачивает сгенерированный файл
     *
     * @param {string} filename - Имя файла для скачивания
     * @returns {Promise<void>}
     */
    static async downloadFile(filename) {
        try {
            const response = await fetch(
                `${AppConfig.api.endpoints.downloadFile}/${filename}`
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
            this._triggerDownload(blob, filename);

        } catch (error) {
            throw error;
        }
    }

    /**
     * Инициирует скачивание blob как файла
     * @private
     */
    static _triggerDownload(blob, filename) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;

        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }

    /**
     * Загружает содержимое акта из БД
     *
     * @param {number} actId - ID акта
     * @returns {Promise<void>}
     */
    static async loadActContent(actId) {
        const username = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";

        try {
            const resp = await fetch(`/api/v1/act_content/${actId}/content`, {
                headers: {'X-JupyterHub-User': username}
            });

            if (!resp.ok) {
                if (resp.status === 403) {
                    throw new Error('Нет доступа к акту');
                } else if (resp.status === 404) {
                    throw new Error('Акт не найден');
                }
                throw new Error('Ошибка загрузки акта');
            }

            const content = await resp.json();

            // Отключаем tracking на время загрузки
            StorageManager.disableTracking();

            // Проверяем, пустой ли акт
            const isEmpty = !content.tree ||
                !Array.isArray(content.tree.children) ||
                content.tree.children.length === 0;

            if (isEmpty) {
                // Акт пустой: инициализируем структуру по умолчанию
                console.log('Акт пуст, инициализируем дефолтную структуру');
                AppState.initializeTree();
                AppState.tables = {};
                AppState.textBlocks = {};
                AppState.violations = {};
                AppState.tableUISizes = {};
                AppState.generateNumbering();

                // Сохраняем дефолтную структуру в БД
                await this._saveDefaultStructure(actId, username);

                Notifications.info('Акт инициализирован автоматически');
            } else {
                // Загружаем существующее содержимое из БД
                console.log('Загружаем содержимое акта из БД');
                AppState.treeData = content.tree;
                AppState.tables = content.tables || {};
                AppState.textBlocks = content.textBlocks || {};
                AppState.violations = content.violations || {};
                AppState.tableUISizes = {};
                AppState.generateNumbering();
            }

            // Обновляем интерфейс
            if (typeof treeManager !== 'undefined') {
                treeManager.render();
            }
            if (typeof ItemsRenderer !== 'undefined') {
                ItemsRenderer.renderAll();
            }
            if (typeof PreviewManager !== 'undefined') {
                PreviewManager.update();
            }

            // Сохраняем в localStorage для локальной работы
            StorageManager.saveState(true);

            // Включаем tracking обратно с задержкой
            setTimeout(() => {
                StorageManager.enableTracking();
            }, 500);

            console.log('Акт загружен из БД, ID:', actId);

        } catch (err) {
            console.error('Ошибка загрузки акта:', err);
            StorageManager.enableTracking();
            throw err;
        }
    }

    /**
     * Сохраняет дефолтную структуру в БД (без уведомлений)
     * @private
     */
    static async _saveDefaultStructure(actId, username) {
        try {
            const data = AppState.exportData();

            console.log('Сохраняем дефолтную структуру:', {
                tablesCount: Object.keys(data.tables).length,
                tables: data.tables
            });

            const resp = await fetch(`/api/v1/act_content/${actId}/content`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-JupyterHub-User': username
                },
                body: JSON.stringify(data)
            });

            if (!resp.ok) {
                const error = await resp.text();
                console.error('Ошибка сохранения:', error);
                throw new Error('Ошибка сохранения дефолтной структуры');
            }

            console.log('Дефолтная структура сохранена в БД');

        } catch (err) {
            console.error('Ошибка сохранения дефолтной структуры:', err);
            // Не бросаем ошибку выше, чтобы не прерывать работу
        }
    }

    /**
     * Сохраняет содержимое акта в БД
     *
     * @param {number} actId - ID акта
     * @returns {Promise<void>}
     */
    static async saveActContent(actId) {
        const username = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";

        try {
            // Блокируем отслеживание на время сохранения
            StorageManager.disableTracking();

            const data = AppState.exportData();

            const resp = await fetch(`/api/v1/act_content/${actId}/content`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-JupyterHub-User': username
                },
                body: JSON.stringify(data)
            });

            if (!resp.ok) {
                if (resp.status === 403) {
                    throw new Error('Нет доступа к акту');
                } else if (resp.status === 404) {
                    throw new Error('Акт не найден');
                }
                throw new Error('Ошибка сохранения');
            }

            const result = await resp.json();
            console.log('Акт сохранен в БД:', result);

            // Помечаем как синхронизированное с БД
            StorageManager.markAsSyncedWithDB();

            Notifications.success('Акт сохранен в базу данных');

        } catch (err) {
            console.error('Ошибка сохранения акта в БД:', err);
            Notifications.error(`Не удалось сохранить акт: ${err.message}`);
            throw err;
        } finally {
            // Включаем отслеживание обратно
            setTimeout(() => {
                StorageManager.enableTracking();
            }, 100);
        }
    }

    /**
     * Удаляет акт из БД
     *
     * @param {number} actId - ID акта
     * @returns {Promise<void>}
     */
    static async deleteAct(actId) {
        const username = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";

        try {
            const resp = await fetch(`/api/v1/acts/${actId}`, {
                method: 'DELETE',
                headers: {'X-JupyterHub-User': username}
            });

            if (!resp.ok) {
                if (resp.status === 403) {
                    throw new Error('Нет доступа к акту');
                } else if (resp.status === 404) {
                    throw new Error('Акт не найден');
                }
                throw new Error('Ошибка удаления акта');
            }

            const result = await resp.json();
            console.log('Акт удален из БД:', result);

            Notifications.success('Акт успешно удален');

        } catch (err) {
            console.error('Ошибка удаления акта:', err);
            Notifications.error(`Не удалось удалить акт: ${err.message}`);
            throw err;
        }
    }
}

// Глобальный доступ
window.APIClient = APIClient;
