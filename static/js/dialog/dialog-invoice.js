/**
 * Диалог прикрепления фактуры к пункту акта.
 *
 * Позволяет выбрать БД (Hive/GreenPlum), найти таблицу по имени,
 * выбрать до 5 типов метрик (КС, ФР, ОР, РР, МКР) с кодами
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
     * Тип метрики, на который сейчас наведён фокус (активный чип).
     * @private
     * @type {string|null}
     */
    static _focusedMetric = null;

    /**
     * Map: metric_type -> {code, metric_name, metric_group}
     * Хранит данные для каждого выбранного типа метрики.
     * @private
     * @type {Object}
     */
    static _selectedMetrics = {};

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
     * Флаг: пропустить следующий unfocus (после выбора кода из dropdown)
     * @private
     * @type {boolean}
     */
    static _skipNextUnfocus = false;

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
        this._focusedMetric = null;
        this._selectedMetrics = {};
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

        // Заполняем метрики из массива
        const metrics = invoice.metrics || [];
        for (const m of metrics) {
            this._selectedMetrics[m.metric_type] = {
                code: m.metric_code || null,
                metric_name: m.metric_name || '',
                metric_group: m.metric_type,
            };

            // Визуализация чипов
            const chip = overlay.querySelector(`.invoice-chip[data-metric="${m.metric_type}"]`);
            if (chip) {
                chip.classList.add('configured');
                if (m.metric_code) {
                    this._updateChipBadge(chip, m.metric_code);
                }
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

        // Чипы метрик — мультивыбор + фокус
        overlay.querySelectorAll('.invoice-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const metric = chip.dataset.metric;

                if (this._focusedMetric === metric) {
                    // Клик по focused чипу — деактивировать и удалить данные
                    chip.classList.remove('active', 'configured');
                    this._removeChipBadge(chip);
                    delete this._selectedMetrics[metric];
                    this._focusedMetric = null;

                    // Очистить поле кода
                    const metricInput = overlay.querySelector('.invoice-metric-search-input');
                    if (metricInput) {
                        metricInput.value = '';
                        metricInput.classList.remove('has-value');
                    }
                    this._hideMetricDropdown(overlay);
                } else if (this._selectedMetrics[metric] !== undefined) {
                    // Клик по configured чипу — переключить фокус на него
                    this._switchFocus(overlay, metric);
                } else {
                    // Клик по невыбранному — добавить + сфокусировать
                    this._selectedMetrics[metric] = null; // пока нет кода
                    this._switchFocus(overlay, metric);
                }
            });
        });

        // Поиск кода метрики
        const metricInput = overlay.querySelector('.invoice-metric-search-input');
        if (metricInput) {
            metricInput.addEventListener('input', () => {
                const query = metricInput.value.trim();

                // Сброс выбранного кода если текст изменился
                if (this._focusedMetric && this._selectedMetrics[this._focusedMetric]) {
                    const currentData = this._selectedMetrics[this._focusedMetric];
                    const currentText = `${currentData.code} — ${currentData.metric_name}`;
                    if (query !== currentText) {
                        this._selectedMetrics[this._focusedMetric] = null;
                        metricInput.classList.remove('has-value');

                        // Убрать бейдж с чипа
                        const chip = overlay.querySelector(`.invoice-chip[data-metric="${this._focusedMetric}"]`);
                        if (chip) this._removeChipBadge(chip);
                    }
                }

                this._filterAndShowMetrics(overlay, query);
            });

            metricInput.addEventListener('focus', () => {
                // При фокусе показать начальный список
                if (this._focusedMetric && !this._selectedMetrics[this._focusedMetric]) {
                    this._filterAndShowMetrics(overlay, metricInput.value.trim());
                }
            });

            metricInput.addEventListener('blur', () => {
                setTimeout(() => this._hideMetricDropdown(overlay), 200);
            });
        }

        // Клик по пустому месту диалога — сброс фокуса с чипа
        dialog.addEventListener('click', (e) => {
            if (this._skipNextUnfocus) {
                this._skipNextUnfocus = false;
                return;
            }
            if (!e.target.closest('.invoice-chip') && !e.target.closest('.invoice-metric-search-input') && !e.target.closest('.invoice-metric-dropdown')) {
                this._unfocusMetric(overlay);
            }
        });

        // Сохранение
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this._save(overlay));
        }
    }

    /**
     * Переключает фокус на указанный тип метрики.
     * @private
     */
    static _switchFocus(overlay, metricType) {
        // Снять active с предыдущего focused чипа (если есть),
        // сделать его configured если у него есть код
        if (this._focusedMetric && this._focusedMetric !== metricType) {
            const prevChip = overlay.querySelector(`.invoice-chip[data-metric="${this._focusedMetric}"]`);
            if (prevChip) {
                prevChip.classList.remove('active');
                if (this._selectedMetrics[this._focusedMetric]) {
                    prevChip.classList.add('configured');
                } else {
                    // Нет кода — оставить configured (без бейджа, но выбран)
                    prevChip.classList.add('configured');
                }
            }
        }

        this._focusedMetric = metricType;

        // Сделать текущий чип active
        overlay.querySelectorAll('.invoice-chip').forEach(c => c.classList.remove('active'));
        const chip = overlay.querySelector(`.invoice-chip[data-metric="${metricType}"]`);
        if (chip) {
            chip.classList.add('active');
            chip.classList.remove('configured');
        }

        // Обновить поле кода
        const metricInput = overlay.querySelector('.invoice-metric-search-input');
        if (metricInput) {
            const metricData = this._selectedMetrics[metricType];
            if (metricData && metricData.code) {
                metricInput.value = `${metricData.code} — ${metricData.metric_name}`;
                metricInput.classList.add('has-value');
            } else {
                metricInput.value = '';
                metricInput.classList.remove('has-value');
            }
        }

        this._showFullMetricList = false;
        this._hideMetricDropdown(overlay);
    }

    /**
     * Снимает фокус с активного чипа и очищает поле кода метрики.
     * @private
     */
    static _unfocusMetric(overlay) {
        if (!this._focusedMetric) return;

        const chip = overlay.querySelector(`.invoice-chip[data-metric="${this._focusedMetric}"]`);
        if (chip) {
            chip.classList.remove('active');
            if (this._selectedMetrics[this._focusedMetric]) {
                chip.classList.add('configured');
            } else {
                // Нет кода — убрать чип из выбранных
                delete this._selectedMetrics[this._focusedMetric];
                chip.classList.remove('configured');
                this._removeChipBadge(chip);
            }
        }

        this._focusedMetric = null;

        const metricInput = overlay.querySelector('.invoice-metric-search-input');
        if (metricInput) {
            metricInput.value = '';
            metricInput.classList.remove('has-value');
        }
        this._hideMetricDropdown(overlay);
    }

    /**
     * Создаёт или обновляет бейдж кода внутри чипа.
     * @private
     */
    static _updateChipBadge(chip, code) {
        let badge = chip.querySelector('.invoice-chip-code');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'invoice-chip-code';
            chip.appendChild(badge);
        }
        badge.textContent = code;
    }

    /**
     * Удаляет бейдж кода из чипа.
     * @private
     */
    static _removeChipBadge(chip) {
        const badge = chip.querySelector('.invoice-chip-code');
        if (badge) badge.remove();
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

            if (this._focusedMetric) {
                // Выбранная группа — первая, остальные — ниже
                primaryItems = allFiltered.filter(m => m.metric_group === this._focusedMetric);
                otherItems = allFiltered.filter(m => m.metric_group !== this._focusedMetric);
            } else {
                primaryItems = allFiltered;
                otherItems = [];
            }
        } else {
            // Без запроса — фильтрация по группе
            if (this._focusedMetric) {
                primaryItems = this._cachedMetricDict.filter(
                    m => m.metric_group === this._focusedMetric
                );
                otherItems = this._cachedMetricDict.filter(
                    m => m.metric_group !== this._focusedMetric
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
        this._skipNextUnfocus = true;

        // Определяем целевой тип метрики
        let targetMetric = this._focusedMetric;

        // Авто-корректировка: если группа метрики не совпадает с focused
        if (item.metric_group && item.metric_group !== this._focusedMetric) {
            targetMetric = item.metric_group;

            // Если этот тип ещё не был выбран — добавляем
            if (this._selectedMetrics[targetMetric] === undefined) {
                this._selectedMetrics[targetMetric] = null;
            }

            // Переключаем фокус на новый тип
            this._switchFocus(overlay, targetMetric);
        }

        // Сохраняем данные
        this._selectedMetrics[targetMetric] = {
            code: item.code,
            metric_name: item.metric_name,
            metric_group: item.metric_group,
        };

        // Обновляем поле кода
        const metricInput = overlay.querySelector('.invoice-metric-search-input');
        if (metricInput) {
            metricInput.value = `${item.code} — ${item.metric_name}`;
            metricInput.classList.add('has-value');
        }

        // Обновляем бейдж на чипе
        const chip = overlay.querySelector(`.invoice-chip[data-metric="${targetMetric}"]`);
        if (chip) {
            this._updateChipBadge(chip, item.code);
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

        // Собираем массив метрик
        const metricsArray = [];
        for (const [metricType, metricData] of Object.entries(this._selectedMetrics)) {
            if (!metricData || !metricData.code) {
                Notifications.warning(`Выберите код для метрики ${metricType}`);
                return;
            }
            metricsArray.push({
                metric_type: metricType,
                metric_code: metricData.code,
                metric_name: metricData.metric_name,
            });
        }

        if (metricsArray.length === 0) {
            Notifications.warning('Выберите хотя бы одну метрику');
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
            metrics: metricsArray,
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
                    metrics: data.metrics,
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
        this._focusedMetric = null;
        this._selectedMetrics = {};
        this._showFullMetricList = false;
        this._skipNextUnfocus = false;
    }
}

// Глобальный доступ
window.InvoiceDialog = InvoiceDialog;
