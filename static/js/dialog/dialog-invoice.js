/**
 * Диалог прикрепления фактуры к пункту акта.
 *
 * Позволяет выбрать БД (Hive/GreenPlum), найти таблицу по имени,
 * выбрать типы метрик и сохранить фактуру.
 * Наследует базовый функционал от DialogBase.
 */
class InvoiceDialog extends DialogBase {
    /**
     * Текущий overlay диалога
     * @private
     * @type {HTMLElement|null}
     */
    static _currentOverlay = null;

    /**
     * Текущий узел дерева
     * @private
     */
    static _currentNode = null;

    /**
     * ID текущего узла
     * @private
     */
    static _currentNodeId = null;

    /**
     * Выбранная таблица {table_name}
     * @private
     */
    static _selectedTable = null;

    /**
     * Выбранные метрики
     * @private
     * @type {Set<string>}
     */
    static _selectedMetrics = new Set();

    /**
     * Кэш конфигурации фактур (загружается 1 раз)
     * @private
     * @type {{hiveSchema: string, gpSchema: string}|null}
     */
    static _invoiceConfig = null;

    /**
     * Кэш загруженных таблиц для текущего db_type
     * @private
     * @type {Array<{table_name: string}>|null}
     */
    static _cachedTables = null;

    /**
     * Текущий выбранный тип БД (для инвалидации кэша)
     * @private
     * @type {string|null}
     */
    static _currentDbType = null;

    /**
     * Показывает диалог для указанного узла.
     * @param {Object} node - Узел дерева
     * @param {string} nodeId - ID узла
     */
    static async show(node, nodeId) {
        // Закрываем предыдущий если был
        if (this._currentOverlay) {
            this._close();
        }

        this._currentNode = node;
        this._currentNodeId = nodeId;
        this._selectedTable = null;
        this._selectedMetrics = new Set();

        const template = this._cloneTemplate('invoiceDialogTemplate');
        if (!template) return;

        const overlay = template.querySelector('.custom-dialog-overlay');
        const dialog = overlay.querySelector('.invoice-modal');

        // Заполняем информацию о пункте
        const nodeNumber = overlay.querySelector('[data-field="node-number"]');
        const nodeName = overlay.querySelector('[data-field="node-name"]');
        if (nodeNumber) nodeNumber.textContent = node.number || '';
        if (nodeName) nodeName.textContent = node.label || '';

        // Загружаем конфиг и заполняем хинты схем
        await this._loadConfig(overlay);

        // Предзаполняем если уже есть фактура на узле
        if (node.invoice) {
            this._prefill(overlay, node.invoice);
        }

        // Обработчики
        this._setupHandlers(overlay, dialog);

        // Показываем
        document.body.appendChild(overlay);
        this._currentOverlay = overlay;
        this._activeDialogs.push(overlay);
        this._lockBodyScroll();

        // Анимация
        overlay.offsetHeight;
        overlay.classList.add('visible');

        // Фокус на поле поиска
        const searchInput = overlay.querySelector('.invoice-search-input');
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 200);
        }

        // Загружаем таблицы для выбранной БД
        const dbType = overlay.querySelector('input[name="invoice-db-type"]:checked')?.value || 'hive';
        this._loadTables(overlay, dbType);
    }

    /**
     * Загружает и кэширует конфиг фактур, заполняет хинты схем.
     * @private
     */
    static async _loadConfig(overlay) {
        if (!this._invoiceConfig) {
            try {
                const resp = await fetch(AppConfig.api.getUrl('/api/v1/system/config/invoice'));
                if (resp.ok) {
                    this._invoiceConfig = await resp.json();
                }
            } catch (err) {
                console.error('Ошибка загрузки конфига фактур:', err);
            }
        }

        if (this._invoiceConfig) {
            const hiveHint = overlay.querySelector('.invoice-schema-hint[data-db="hive"]');
            const gpHint = overlay.querySelector('.invoice-schema-hint[data-db="greenplum"]');
            if (hiveHint) hiveHint.textContent = this._invoiceConfig.hiveSchema;
            if (gpHint) gpHint.textContent = this._invoiceConfig.gpSchema;
        }
    }

    /**
     * Загружает список таблиц для указанного типа БД.
     * @private
     */
    static async _loadTables(overlay, dbType) {
        // Если тот же тип БД и кэш есть — не грузим заново
        if (this._currentDbType === dbType && this._cachedTables !== null) {
            return;
        }

        this._currentDbType = dbType;
        this._cachedTables = null;

        const searchInput = overlay.querySelector('.invoice-search-input');
        if (searchInput) {
            searchInput.disabled = true;
            searchInput.placeholder = 'Загрузка таблиц...';
        }

        try {
            this._cachedTables = await APIClient.loadInvoiceTables(dbType);
        } catch (err) {
            console.error('Ошибка загрузки таблиц:', err);
            this._cachedTables = [];
        }

        if (searchInput) {
            searchInput.disabled = false;
            searchInput.placeholder = 'Начните вводить название таблицы...';
        }
    }

    /**
     * Предзаполняет диалог данными существующей фактуры.
     * @private
     */
    static _prefill(overlay, invoice) {
        // Выбираем radio
        const radio = overlay.querySelector(`input[name="invoice-db-type"][value="${invoice.db_type}"]`);
        if (radio) radio.checked = true;

        // Заполняем таблицу — показываем имя в строке поиска
        if (invoice.table_name) {
            this._selectedTable = {
                table_name: invoice.table_name,
            };
            const searchInput = overlay.querySelector('.invoice-search-input');
            if (searchInput) {
                searchInput.value = invoice.table_name;
                searchInput.classList.add('has-value');
            }
        }

        // Заполняем метрики
        if (invoice.metrics_types && Array.isArray(invoice.metrics_types)) {
            this._selectedMetrics = new Set(invoice.metrics_types);
            overlay.querySelectorAll('.invoice-chip').forEach(chip => {
                if (this._selectedMetrics.has(chip.dataset.metric)) {
                    chip.classList.add('active');
                }
            });
        }
    }

    /**
     * Настраивает обработчики событий диалога.
     * @private
     */
    static _setupHandlers(overlay, dialog) {
        // Закрытие
        const closeBtn = overlay.querySelector('.invoice-close-btn');
        const cancelBtn = overlay.querySelector('.invoice-cancel-btn');
        const saveBtn = overlay.querySelector('.invoice-save-btn');

        const closeFn = () => this._close();

        if (closeBtn) closeBtn.addEventListener('click', closeFn);
        if (cancelBtn) cancelBtn.addEventListener('click', closeFn);

        // Overlay click
        this._setupOverlayClickHandler(overlay, dialog, closeFn);

        // Escape
        this._setupEscapeHandler(overlay, closeFn);

        // Смена БД — сброс выбора и загрузка таблиц нового типа
        overlay.querySelectorAll('input[name="invoice-db-type"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this._selectedTable = null;
                const searchInput = overlay.querySelector('.invoice-search-input');
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.classList.remove('has-value');
                }
                this._hideDropdown(overlay);
                this._loadTables(overlay, radio.value);
            });
        });

        // Поиск таблицы — клиентская фильтрация
        const searchInput = overlay.querySelector('.invoice-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const query = searchInput.value.trim();

                // Сброс выбора если текст изменился
                if (this._selectedTable && query !== this._selectedTable.table_name) {
                    this._selectedTable = null;
                    searchInput.classList.remove('has-value');
                }

                if (query.length === 0 && !this._selectedTable) {
                    this._hideDropdown(overlay);
                    return;
                }

                if (query.length === 0) {
                    this._hideDropdown(overlay);
                    return;
                }

                this._filterAndShowResults(overlay, query);
            });

            // Скрываем dropdown при потере фокуса (с задержкой для клика)
            searchInput.addEventListener('blur', () => {
                setTimeout(() => this._hideDropdown(overlay), 200);
            });
        }

        // Чипы метрик
        overlay.querySelectorAll('.invoice-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const metric = chip.dataset.metric;
                if (this._selectedMetrics.has(metric)) {
                    this._selectedMetrics.delete(metric);
                    chip.classList.remove('active');
                } else {
                    this._selectedMetrics.add(metric);
                    chip.classList.add('active');
                }
            });
        });

        // Сохранение
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this._save(overlay));
        }
    }

    /**
     * Фильтрует кэш таблиц и показывает результаты.
     * @private
     */
    static _filterAndShowResults(overlay, query) {
        if (!this._cachedTables) {
            this._showDropdown(overlay, []);
            return;
        }

        const queryLower = query.toLowerCase();
        const filtered = this._cachedTables.filter(
            t => t.table_name.toLowerCase().includes(queryLower)
        );

        this._showDropdown(overlay, filtered.slice(0, 50));
    }

    /**
     * Показывает dropdown с результатами поиска.
     * @private
     */
    static _showDropdown(overlay, results) {
        const dropdown = overlay.querySelector('.invoice-search-dropdown');
        if (!dropdown) return;

        dropdown.innerHTML = '';

        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'invoice-search-dropdown-empty';
            empty.textContent = 'Таблицы не найдены';
            dropdown.appendChild(empty);
        } else {
            results.forEach(item => {
                const el = document.createElement('div');
                el.className = 'invoice-search-dropdown-item';
                el.textContent = item.table_name;
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // Предотвращаем blur на input
                    this._selectTable(overlay, item);
                });
                dropdown.appendChild(el);
            });
        }

        dropdown.classList.add('visible');
    }

    /**
     * Скрывает dropdown.
     * @private
     */
    static _hideDropdown(overlay) {
        const dropdown = overlay.querySelector('.invoice-search-dropdown');
        if (dropdown) dropdown.classList.remove('visible');
    }

    /**
     * Выбирает таблицу из dropdown.
     * @private
     */
    static _selectTable(overlay, item) {
        this._selectedTable = item;

        const searchInput = overlay.querySelector('.invoice-search-input');
        if (searchInput) {
            searchInput.value = item.table_name;
            searchInput.classList.add('has-value');
        }

        this._hideDropdown(overlay);
    }

    /**
     * Сохраняет фактуру.
     * @private
     */
    static async _save(overlay) {
        // Валидация
        if (!this._selectedTable) {
            Notifications.warning('Выберите таблицу');
            return;
        }

        if (this._selectedMetrics.size === 0) {
            Notifications.warning('Выберите хотя бы один тип метрики');
            return;
        }

        const actId = new URLSearchParams(window.location.search).get('act_id');
        if (!actId) {
            Notifications.error('Не удалось определить ID акта');
            return;
        }

        const dbType = overlay.querySelector('input[name="invoice-db-type"]:checked')?.value || 'hive';

        // Схема берётся из конфига, а не из таблицы реестра
        const schemaName = dbType === 'hive'
            ? (this._invoiceConfig?.hiveSchema || 'team_sva_oarb_3')
            : (this._invoiceConfig?.gpSchema || 's_grnplm_ld_audit_da_sandbox_oarb');

        const data = {
            act_id: parseInt(actId, 10),
            node_id: this._currentNodeId,
            node_number: this._currentNode?.number || null,
            db_type: dbType,
            schema_name: schemaName,
            table_name: this._selectedTable.table_name,
            metrics_types: Array.from(this._selectedMetrics),
        };

        // Блокируем кнопку на время сохранения
        const saveBtn = overlay.querySelector('.invoice-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Сохранение...';
        }

        try {
            const result = await APIClient.saveInvoice(data);

            // Сохраняем в структуру дерева
            if (this._currentNode) {
                this._currentNode.invoice = {
                    db_type: data.db_type,
                    schema_name: data.schema_name,
                    table_name: data.table_name,
                    metrics_types: data.metrics_types,
                };
            }

            // Вызываем верификацию (заглушка)
            if (result && result.id) {
                try {
                    const verifyResult = await APIClient.verifyInvoice(result.id);
                    console.log('Результат верификации (заглушка):', verifyResult);
                } catch (verifyErr) {
                    console.warn('Ошибка верификации (заглушка):', verifyErr);
                }
            }

            Notifications.success('Фактура успешно прикреплена');

            // Обновляем дерево чтобы показать/обновить бейдж фактуры
            if (typeof treeManager !== 'undefined') {
                treeManager.render();
            }

            this._close();

            // Сохраняем акт в БД чтобы audit_act_id и audit_point_id
            // сразу попали в таблицу act_invoices
            if (window.currentActId) {
                try {
                    await APIClient.saveActContent(window.currentActId);
                } catch (saveErr) {
                    console.warn('Не удалось сохранить акт после прикрепления фактуры:', saveErr);
                }
            }

        } catch (err) {
            console.error('Ошибка сохранения фактуры:', err);
            Notifications.error(`Ошибка сохранения: ${err.message}`);

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Сохранить';
            }
        }
    }

    /**
     * Закрывает диалог.
     * @private
     */
    static _close() {
        if (!this._currentOverlay) return;

        this._removeEscapeHandler(this._currentOverlay);
        this._hideDialog(this._currentOverlay);

        this._currentOverlay = null;
        this._currentNode = null;
        this._currentNodeId = null;
        this._selectedTable = null;
        this._selectedMetrics = new Set();
    }
}

// Глобальный доступ
window.InvoiceDialog = InvoiceDialog;
