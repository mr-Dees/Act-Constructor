/**
 * Клиент для взаимодействия с API
 *
 * Обрабатывает все HTTP-запросы к серверу для работы с актами.
 * Предоставляет методы для генерации и скачивания файлов актов,
 * загрузки/сохранения содержимого из БД, а также удаления актов.
 */
class APIClient {
    static async lockAct(actId) {
        const username = AuthManager.getCurrentUser();

        const response = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}/lock`), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-JupyterHub-User': username
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw this._createError(response.status, error.detail);
        }

        return response.json();
    }

    static async unlockAct(actId) {
        const username = AuthManager.getCurrentUser();

        const response = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}/unlock`), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-JupyterHub-User': username
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw this._createError(response.status, error.detail);
        }

        return response.json();
    }

    static async extendLock(actId) {
        const username = AuthManager.getCurrentUser();

        const response = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}/extend-lock`), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-JupyterHub-User': username
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw this._createError(response.status, error.detail);
        }

        return response.json();
    }

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
                ['txt', 'docx', 'md'].includes(fmt)
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
            // Передаём act_id для привязки файла к контролю доступа
            const actId = new URLSearchParams(window.location.search).get('act_id');
            let url = `/api/v1/acts/export/save_act?fmt=${format}`;
            if (actId) {
                url += `&act_id=${encodeURIComponent(actId)}`;
            }

            const response = await fetch(AppConfig.api.getUrl(url),
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
            const response = await fetch(AppConfig.api.getUrl(
                `/api/v1/acts/export/download/${filename}`)
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
     * @throws {Error} При ошибке доступа или загрузки
     */
    static async loadActContent(actId) {
        const username = AuthManager.getCurrentUser();

        if (!username) {
            throw new Error('Пользователь не авторизован');
        }

        try {
            const resp = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}/content`), {
                headers: {'X-JupyterHub-User': username}
            });

            if (!resp.ok) {
                if (resp.status === 403) {
                    const error = new Error('Нет доступа к акту');
                    error.code = 'ACCESS_DENIED';
                    throw error;
                } else if (resp.status === 404) {
                    const error = new Error('Акт не найден');
                    error.code = 'NOT_FOUND';
                    throw error;
                }
                throw new Error('Ошибка загрузки акта');
            }

            const content = await resp.json();

            // Сохраняем метаданные в глобальную переменную
            window.actMetadata = content.metadata;

            // Обрабатываем права пользователя
            if (content.userPermission) {
                AppConfig.readOnlyMode.isReadOnly = !content.userPermission.canEdit;
                AppConfig.readOnlyMode.userRole = content.userPermission.role;

                console.log('Права пользователя:', content.userPermission);
                console.log('Режим только чтения:', AppConfig.readOnlyMode.isReadOnly);
            }

            // Получаем флаг процессной проверки из метаданных
            const isProcessBased = content.metadata?.is_process_based !== undefined
                ? content.metadata.is_process_based
                : true;

            console.log('Загружены метаданные акта:', window.actMetadata);
            console.log('Тип проверки:', isProcessBased ? 'процессная' : 'непроцессная');

            // Отключаем tracking на время загрузки
            StorageManager.disableTracking();

            // Проверяем, пустой ли акт
            const isEmpty = !content.tree ||
                !Array.isArray(content.tree.children) ||
                content.tree.children.length === 0;

            if (isEmpty) {
                // Акт пуст, инициализируем дефолтную структуру

                // Очищаем состояние ДО инициализации
                AppState.treeData = null;
                AppState.tables = {};
                AppState.textBlocks = {};
                AppState.violations = {};
                AppState.tableUISizes = {};

                // Инициализируем дерево и таблицы с учетом типа проверки
                AppState.initializeTree(isProcessBased);
                AppState.generateNumbering();

                // Привязываем фактуры к узлам дерева
                if (content.invoices) {
                    this._attachInvoicesToTree(AppState.treeData, content.invoices);
                }

                // Асинхронно присваиваем audit_point_id (не блокируем пользователя)
                if (typeof AuditIdService !== 'undefined') {
                    AuditIdService.assignMissingPointIds(actId, AppState.treeData);
                }

                // Сохраняем дефолтную структуру в БД ТОЛЬКО если есть права на редактирование
                if (!AppConfig.readOnlyMode.isReadOnly) {
                    await this._saveDefaultStructure(actId, username);
                }

                Notifications.info('Акт инициализирован с базовой структурой');
            } else {
                // Загружаем существующее содержимое из БД
                AppState.treeData = content.tree;
                AppState.tables = content.tables || {};
                AppState.textBlocks = content.textBlocks || {};
                AppState.violations = content.violations || {};
                AppState.tableUISizes = {};

                // Миграция: strip числового префикса из label для item-узлов
                this._migrateStripNumberFromLabels(AppState.treeData);

                AppState.generateNumbering();

                // Привязываем фактуры к узлам дерева
                if (content.invoices) {
                    this._attachInvoicesToTree(AppState.treeData, content.invoices);
                }

                // Асинхронно присваиваем audit_point_id (не блокируем пользователя)
                if (typeof AuditIdService !== 'undefined') {
                    AuditIdService.assignMissingPointIds(actId, AppState.treeData);
                }
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

            // Показываем баннер и применяем режим просмотра если нет прав на редактирование
            if (AppConfig.readOnlyMode.isReadOnly) {
                this._showReadOnlyBanner();
                // Применяем read-only стили к интерфейсу
                if (typeof App !== 'undefined' && App._applyReadOnlyMode) {
                    App._applyReadOnlyMode();
                }
                // Применяем ограничения к меню актов
                if (typeof ActsMenuManager !== 'undefined' && ActsMenuManager.applyReadOnlyRestrictions) {
                    ActsMenuManager.applyReadOnlyRestrictions();
                }
            }

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

            const resp = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}/content`), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-JupyterHub-User': username
                },
                body: JSON.stringify(data)
            });

            if (!resp.ok) {
                const error = await resp.text();
                console.error('Ошибка сохранения дефолтной структуры:', error);
                throw new Error('Ошибка сохранения дефолтной структуры');
            }

        } catch (err) {
            console.error('Ошибка сохранения дефолтной структуры:', err);
            // Не бросаем ошибку выше, чтобы не прерывать работу
        }
    }

    /**
     * Сохраняет содержимое акта в БД
     *
     * @param {number} actId - ID акта
     * @param {Object} [options] - Опции сохранения
     * @param {string} [options.saveType='auto'] - Тип сохранения: 'manual' | 'periodic' | 'auto'
     * @returns {Promise<void>}
     */
    static async saveActContent(actId, { saveType = 'auto' } = {}) {
        const username = AuthManager.getCurrentUser();

        if (!username) {
            throw new Error('Пользователь не авторизован');
        }

        try {
            // Блокируем отслеживание на время сохранения
            StorageManager.disableTracking();

            const data = AppState.exportData();
            data.saveType = saveType;
            data.changelog = typeof ChangelogTracker !== 'undefined' ? ChangelogTracker.flush() : [];

            const resp = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}/content`), {
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
        const username = AuthManager.getCurrentUser();

        if (!username) {
            throw new Error('Пользователь не авторизован');
        }

        try {
            const resp = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}`), {
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

    /**
     * Миграция: удаляет числовой префикс из label для item-узлов.
     * Нужна для обратной совместимости с данными, где label содержал номер.
     * @private
     * @param {Object} node - Узел дерева для обработки
     */
    static _migrateStripNumberFromLabels(node) {
        if (!node) return;

        if (node.children) {
            for (const child of node.children) {
                // Только для item-узлов (не table/textblock/violation)
                if (!child.type || child.type === 'item') {
                    const match = child.label?.match(/^\d+(?:\.\d+)*\.\s*(.+)$/);
                    if (match) {
                        child.label = match[1];
                    }
                }
                this._migrateStripNumberFromLabels(child);
            }
        }
    }

    /**
     * Привязывает фактуры из БД к соответствующим узлам дерева.
     * @private
     * @param {Object} node - Узел дерева
     * @param {Object} invoicesMap - Словарь фактур {node_id: invoice_data}
     */
    static _attachInvoicesToTree(node, invoicesMap) {
        if (!node) return;
        if (invoicesMap[node.id]) {
            const inv = invoicesMap[node.id];
            node.invoice = {
                db_type: inv.db_type,
                schema_name: inv.schema_name,
                table_name: inv.table_name,
                metrics: inv.metrics || [],
            };
        }
        if (node.children) {
            for (const child of node.children) {
                this._attachInvoicesToTree(child, invoicesMap);
            }
        }
    }

    // -----------------------------------------------------------------
    // Фактуры
    // -----------------------------------------------------------------

    /**
     * Загружает справочник метрик
     *
     * @returns {Promise<Array<{code: string, metric_name: string, metric_group: string|null}>>}
     */
    static async loadMetricDict() {
        const username = AuthManager.getCurrentUser();

        const response = await fetch(
            AppConfig.api.getUrl('/api/v1/acts/invoice/metrics'),
            {
                headers: { 'X-JupyterHub-User': username }
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw this._createError(response.status, error.detail);
        }

        return response.json();
    }

    /**
     * Загружает полный список таблиц для фактуры
     *
     * @param {string} dbType - Тип БД ('hive' или 'greenplum')
     * @returns {Promise<Array<{table_name: string}>>}
     */
    static async loadInvoiceTables(dbType) {
        const username = AuthManager.getCurrentUser();

        const response = await fetch(
            AppConfig.api.getUrl(`/api/v1/acts/invoice/tables/${dbType}`),
            {
                headers: { 'X-JupyterHub-User': username }
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw this._createError(response.status, error.detail);
        }

        return response.json();
    }

    /**
     * Сохраняет фактуру (UPSERT по act_id + node_id)
     *
     * @param {Object} data - Данные фактуры
     * @returns {Promise<Object>} Сохраненная фактура
     */
    static async saveInvoice(data) {
        const username = AuthManager.getCurrentUser();

        const response = await fetch(AppConfig.api.getUrl('/api/v1/acts/invoice/save'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-JupyterHub-User': username,
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw this._createError(response.status, error.detail);
        }

        return response.json();
    }

    /**
     * Верификация фактуры (TODO-заглушка)
     *
     * @param {number} invoiceId - ID фактуры
     * @returns {Promise<Object>} Результат верификации
     */
    static async verifyInvoice(invoiceId) {
        const username = AuthManager.getCurrentUser();

        const response = await fetch(AppConfig.api.getUrl('/api/v1/acts/invoice/verify'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-JupyterHub-User': username,
            },
            body: JSON.stringify({ invoice_id: invoiceId }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw this._createError(response.status, error.detail);
        }

        return response.json();
    }

    /**
     * Создает ошибку API с кодом
     * @private
     */
    static _createError(status, detail) {
        const error = new Error(detail);
        error.status = status;
        return error;
    }

    /**
     * Показывает баннер режима только чтения
     * @private
     */
    static _showReadOnlyBanner() {
        // Проверяем, не показан ли уже баннер
        if (document.querySelector('.read-only-banner')) {
            return;
        }

        const banner = document.createElement('div');
        banner.className = 'read-only-banner';
        banner.innerHTML = `
            <span class="read-only-banner-icon">👁</span>
            <span class="read-only-banner-text">${AppConfig.readOnlyMode.messages.viewOnlyBanner}</span>
        `;

        // Вставляем баннер после header
        const header = document.querySelector('.header');
        if (header && header.nextSibling) {
            header.parentNode.insertBefore(banner, header.nextSibling);
        } else {
            document.body.insertBefore(banner, document.body.firstChild);
        }
    }

    /**
     * Проверяет режим только чтения и показывает уведомление
     * @returns {boolean} true если режим только чтения активен
     */
    static checkReadOnlyMode() {
        if (AppConfig.readOnlyMode?.isReadOnly) {
            Notifications.warning(AppConfig.readOnlyMode.messages.cannotEdit);
            return true;
        }
        return false;
    }

    /**
     * Загружает содержимое акта (raw JSON) без побочных эффектов.
     * Используется для diff-сравнения версий.
     * @param {number} actId
     * @returns {Promise<Object>}
     */
    static async loadActContentRaw(actId) {
        const username = AuthManager.getCurrentUser();
        const resp = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}/content`), {
            headers: { 'X-JupyterHub-User': username }
        });
        if (!resp.ok) throw this._createError(resp.status, `HTTP ${resp.status}`);
        return resp.json();
    }

    // -------------------------------------------------------------------------
    // АУДИТ-ЛОГ И ВЕРСИИ
    // -------------------------------------------------------------------------

    /**
     * Получает записи аудит-лога акта
     * @param {number} actId - ID акта
     * @param {Object} [params] - Параметры фильтрации
     * @returns {Promise<{items: Array, total: number}>}
     */
    static async getAuditLog(actId, { action, username, fromDate, toDate, limit = 50, offset = 0 } = {}) {
        const currentUser = AuthManager.getCurrentUser();
        const query = new URLSearchParams();
        if (action) query.set('action', action);
        if (username) query.set('username', username);
        if (fromDate) query.set('from_date', fromDate);
        if (toDate) query.set('to_date', toDate);
        query.set('limit', limit);
        query.set('offset', offset);

        const resp = await fetch(AppConfig.api.getUrl(`/api/v1/acts/${actId}/audit-log?${query}`), {
            headers: { 'X-JupyterHub-User': currentUser }
        });
        if (!resp.ok) throw this._createError(resp.status, 'Ошибка загрузки аудит-лога');
        return resp.json();
    }

    /**
     * Получает список версий содержимого акта
     * @param {number} actId - ID акта
     * @param {Object} [params] - Параметры пагинации
     * @returns {Promise<{items: Array, total: number}>}
     */
    static async getVersions(actId, { limit = 50, offset = 0 } = {}) {
        const username = AuthManager.getCurrentUser();
        const resp = await fetch(
            AppConfig.api.getUrl(`/api/v1/acts/${actId}/versions?limit=${limit}&offset=${offset}`),
            { headers: { 'X-JupyterHub-User': username } }
        );
        if (!resp.ok) throw this._createError(resp.status, 'Ошибка загрузки версий');
        return resp.json();
    }

    /**
     * Получает полный снэпшот конкретной версии
     * @param {number} actId - ID акта
     * @param {number} versionId - ID версии
     * @returns {Promise<Object>}
     */
    static async getVersion(actId, versionId) {
        const username = AuthManager.getCurrentUser();
        const resp = await fetch(
            AppConfig.api.getUrl(`/api/v1/acts/${actId}/versions/${versionId}`),
            { headers: { 'X-JupyterHub-User': username } }
        );
        if (!resp.ok) throw this._createError(resp.status, 'Ошибка загрузки версии');
        return resp.json();
    }

    /**
     * Восстанавливает содержимое акта из указанной версии
     * @param {number} actId - ID акта
     * @param {number} versionId - ID версии
     * @returns {Promise<Object>}
     */
    static async restoreVersion(actId, versionId) {
        const username = AuthManager.getCurrentUser();
        const resp = await fetch(
            AppConfig.api.getUrl(`/api/v1/acts/${actId}/versions/${versionId}/restore`),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-JupyterHub-User': username
                }
            }
        );
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw this._createError(resp.status, err.detail || 'Ошибка восстановления версии');
        }
        return resp.json();
    }
}

// Глобальный доступ
window.APIClient = APIClient;
