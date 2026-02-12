/**
 * Диалог прикрепления фактуры к пункту акта.
 *
 * Позволяет выбрать БД (Hive/GreenPlum), найти таблицу по имени,
 * выбрать тип метрики (одиночный выбор), выбрать код метрики
 * из справочника и сохранить фактуру.
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
     * Выбранный тип метрики (одиночный выбор)
     * @private
     * @type {string|null}
     */
    static _selectedMetric = null;

    /**
     * Выбранный код метрики из справочника
     * @private
     * @type {{code: string, metric_name: string, metric_group: string|null}|null}
     */
    static _selectedMetricCode = null;

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
     * Кэш справочника метрик (загружается 1 раз)
     * @private
     * @type {Array<{code: string, metric_name: string, metric_group: string|null}>|null}
     */
    static _cachedMetricDict = null;

    /**
     * Флаг: показать полный перечень метрик (все группы)
     * @private
     * @type {boolean}
     */
    static _showFullMetricList = false;

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
        this._selectedMetric = null;
        this._selectedMetricCode = null;
        this._showFullMetricList = false;

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

        // Загружаем таблицы и справочник метрик параллельно
        const dbType = overlay.querySelector('input[name="invoice-db-type"]:checked')?.value || 'hive';
        this._loadTables(overlay, dbType);
        this._loadMetricDict();
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
     * Загружает справочник метрик (кэширует при первом вызове).
     * @private
     */
    static async _loadMetricDict() {
        if (this._cachedMetricDict !== null) return;

        try {
            this._cachedMetricDict = await APIClient.loadMetricDict();
        } catch (err) {
            console.error('Ошибка загрузки справочника метрик:', err);
            this._cachedMetricDict = [];
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

        // Заполняем тип метрики
        if (invoice.metric_type) {
            this._selectedMetric = invoice.metric_type;
            overlay.querySelectorAll('.invoice-chip').forEach(chip => {
                if (chip.dataset.metric === this._selectedMetric) {
                    chip.classList.add('active');
                }
            });
        }

        // Заполняем код метрики
        if (invoice.metric_code) {
            this._selectedMetricCode = {
                code: invoice.metric_code,
                metric_name: invoice.metric_name || '',
                metric_group: this._selectedMetric || null,
            };
            const metricInput = overlay.querySelector('.invoice-metric-search-input');
            if (metricInput) {
                metricInput.value = `${invoice.metric_code} — ${invoice.metric_name || ''}`;
                metricInput.classList.add('has-value');
            }
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

        // Чипы метрик — одиночный выбор
        overlay.querySelectorAll('.invoice-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const metric = chip.dataset.metric;

                if (this._selectedMetric === metric) {
                    // Повторный клик — деактивировать
                    this._selectedMetric = null;
                    chip.classList.remove('active');
                } else {
                    // Новый выбор — убрать active со всех, поставить на текущий
                    overlay.querySelectorAll('.invoice-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    this._selectedMetric = metric;

                    // Сбросить код метрики при смене типа
                    this._selectedMetricCode = null;
                    this._showFullMetricList = false;
                    const metricInput = overlay.querySelector('.invoice-metric-search-input');
                    if (metricInput) {
                        metricInput.value = '';
                        metricInput.classList.remove('has-value');
                    }
                    this._hideMetricDropdown(overlay);
                }
            });
        });

        // Поиск кода метрики
        const metricInput = overlay.querySelector('.invoice-metric-search-input');
        if (metricInput) {
            metricInput.addEventListener('input', () => {
                const query = metricInput.value.trim();

                // Сброс выбора если текст изменился
                if (this._selectedMetricCode) {
                    const currentText = `${this._selectedMetricCode.code} — ${this._selectedMetricCode.metric_name}`;
                    if (query !== currentText) {
                        this._selectedMetricCode = null;
                        metricInput.classList.remove('has-value');
                    }
                }

                this._filterAndShowMetrics(overlay, query);
            });

            metricInput.addEventListener('focus', () => {
                // При фокусе показать начальный список
                if (!this._selectedMetricCode) {
                    this._filterAndShowMetrics(overlay, metricInput.value.trim());
                }
            });

            metricInput.addEventListener('blur', () => {
                setTimeout(() => this._hideMetricDropdown(overlay), 200);
            });
        }

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

    // -----------------------------------------------------------------
    // Секция кода метрики
    // -----------------------------------------------------------------

    /**
     * Фильтрует справочник метрик и показывает dropdown.
     *
     * Логика:
     * - Без запроса: показываем метрики выбранной группы, остальные через "Показать полный перечень"
     * - С запросом: ищем по ВСЕМ метрикам, но группа выбранного типа идёт первой
     * @private
     */
    static _filterAndShowMetrics(overlay, query) {
        if (!this._cachedMetricDict) return;

        let primaryItems;
        let otherItems;

        if (query.length > 0) {
            // С запросом — ищем по ВСЕМ метрикам
            const isDigitSearch = /^\d/.test(query);
            const queryLower = query.toLowerCase();

            const filterFn = isDigitSearch
                ? (m) => m.code.includes(query)
                : (m) => m.metric_name.toLowerCase().includes(queryLower);

            const allFiltered = this._cachedMetricDict.filter(filterFn);

            if (this._selectedMetric) {
                // Выбранная группа — первая, остальные — ниже
                primaryItems = allFiltered.filter(m => m.metric_group === this._selectedMetric);
                otherItems = allFiltered.filter(m => m.metric_group !== this._selectedMetric);
            } else {
                primaryItems = allFiltered;
                otherItems = [];
            }
        } else {
            // Без запроса — фильтрация по группе
            if (this._selectedMetric) {
                primaryItems = this._cachedMetricDict.filter(
                    m => m.metric_group === this._selectedMetric
                );
                otherItems = this._cachedMetricDict.filter(
                    m => m.metric_group !== this._selectedMetric
                );
            } else {
                primaryItems = this._cachedMetricDict;
                otherItems = [];
            }
        }

        const hasQuery = query.length > 0;
        this._showMetricDropdown(overlay, primaryItems.slice(0, 100), otherItems, hasQuery);
    }

    /**
     * Показывает dropdown с метриками.
     * @param {HTMLElement} overlay
     * @param {Array} primaryItems - основной список (выбранная группа или все)
     * @param {Array} otherItems - метрики из других групп
     * @param {boolean} hasQuery - есть ли поисковый запрос (если да, показываем всё сразу)
     * @private
     */
    static _showMetricDropdown(overlay, primaryItems, otherItems, hasQuery = false) {
        const dropdown = overlay.querySelector('.invoice-metric-dropdown');
        if (!dropdown) return;

        dropdown.innerHTML = '';

        // При активном поиске показываем другие группы сразу
        const expandOther = this._showFullMetricList || hasQuery;

        if (primaryItems.length === 0 && (!expandOther || otherItems.length === 0)) {
            const empty = document.createElement('div');
            empty.className = 'invoice-search-dropdown-empty';
            empty.textContent = 'Метрики не найдены';
            dropdown.appendChild(empty);
        } else {
            // Основной список
            primaryItems.forEach(item => {
                dropdown.appendChild(this._createMetricDropdownItem(overlay, item));
            });

            // Другие группы
            if (expandOther && otherItems.length > 0) {
                // Группируем другие метрики по группам
                const groups = {};
                otherItems.forEach(item => {
                    const group = item.metric_group || 'Без группы';
                    if (!groups[group]) groups[group] = [];
                    groups[group].push(item);
                });

                let totalShown = primaryItems.length;
                for (const [groupName, items] of Object.entries(groups)) {
                    if (totalShown >= 100) break;

                    // Разделитель группы
                    const separator = document.createElement('div');
                    separator.className = 'invoice-metric-group-separator';
                    separator.textContent = groupName;
                    dropdown.appendChild(separator);

                    for (const item of items) {
                        if (totalShown >= 100) break;
                        dropdown.appendChild(this._createMetricDropdownItem(overlay, item));
                        totalShown++;
                    }
                }
            }

            // Кнопка "Показать полный перечень" только без активного поиска
            if (!expandOther && otherItems.length > 0) {
                const showAllBtn = document.createElement('div');
                showAllBtn.className = 'invoice-metric-show-all';
                showAllBtn.textContent = `Показать полный перечень метрик (ещё ${otherItems.length})`;
                showAllBtn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this._showFullMetricList = true;
                    const metricInput = overlay.querySelector('.invoice-metric-search-input');
                    this._filterAndShowMetrics(overlay, metricInput?.value?.trim() || '');
                });
                dropdown.appendChild(showAllBtn);
            }
        }

        dropdown.classList.add('visible');
    }

    /**
     * Создаёт элемент dropdown для метрики.
     * @private
     */
    static _createMetricDropdownItem(overlay, item) {
        const el = document.createElement('div');
        el.className = 'invoice-metric-dropdown-item';

        const codeSpan = document.createElement('span');
        codeSpan.className = 'invoice-metric-item-code';
        codeSpan.textContent = item.code;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'invoice-metric-item-name';
        nameSpan.textContent = ` — ${item.metric_name}`;

        el.appendChild(codeSpan);
        el.appendChild(nameSpan);

        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this._selectMetricCode(overlay, item);
        });

        return el;
    }

    /**
     * Скрывает dropdown метрик.
     * @private
     */
    static _hideMetricDropdown(overlay) {
        const dropdown = overlay.querySelector('.invoice-metric-dropdown');
        if (dropdown) dropdown.classList.remove('visible');
    }

    /**
     * Выбирает код метрики из dropdown.
     * @private
     */
    static _selectMetricCode(overlay, item) {
        this._selectedMetricCode = item;

        const metricInput = overlay.querySelector('.invoice-metric-search-input');
        if (metricInput) {
            metricInput.value = `${item.code} — ${item.metric_name}`;
            metricInput.classList.add('has-value');
        }

        // Авто-корректировка типа метрики
        if (item.metric_group && item.metric_group !== this._selectedMetric) {
            this._selectedMetric = item.metric_group;
            overlay.querySelectorAll('.invoice-chip').forEach(chip => {
                if (chip.dataset.metric === item.metric_group) {
                    chip.classList.add('active');
                } else {
                    chip.classList.remove('active');
                }
            });
        }

        this._hideMetricDropdown(overlay);
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

        if (!this._selectedMetric) {
            Notifications.warning('Выберите тип метрики');
            return;
        }

        if (!this._selectedMetricCode) {
            Notifications.warning('Выберите код метрики');
            return;
        }

        // Если код метрики без группы и тип не указан
        if (this._selectedMetricCode.metric_group === null && !this._selectedMetric) {
            Notifications.warning('Необходимо указать тип метрики');
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
            metric_type: this._selectedMetric,
            metric_code: this._selectedMetricCode.code,
            metric_name: this._selectedMetricCode.metric_name,
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
                    metric_type: data.metric_type,
                    metric_code: data.metric_code,
                    metric_name: data.metric_name,
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
        this._selectedMetric = null;
        this._selectedMetricCode = null;
        this._showFullMetricList = false;
    }
}

// Глобальный доступ
window.InvoiceDialog = InvoiceDialog;
