/**
 * Диалог прикрепления фактуры к пункту акта.
 *
 * Позволяет выбрать БД (Hive/GreenPlum), найти таблицу по имени,
 * выбрать до 5 типов метрик (КС, ФР, ОР, РР, МКР) с кодами
 * из справочника и сохранить фактуру.
 * Наследует базовый функционал от DialogBase.
 */
import { AppState } from '../state/state-core.js';
import { APIClient } from '../../shared/api.js';
import { AppConfig } from '../../shared/app-config.js';
import { DialogBase } from '../../shared/dialog/dialog-base.js';
import { Notifications } from '../../shared/notifications.js';
import { InvoiceAutocomplete } from './invoice-autocomplete.js';

export class InvoiceDialog extends DialogBase {
    /**
     * Текущий overlay диалога
     * @private
     * @type {HTMLElement|null}
     */
    static _currentOverlay = null;

    /**
     * AbortController для текущего save+verify-запроса. При закрытии диалога
     * или повторном открытии прерываем «висящий» запрос, иначе ответ
     * прилетит уже закрытому или другому экземпляру диалога.
     * @private
     * @type {AbortController|null}
     */
    static _saveAbort = null;

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

    /** Кэш справочника процессов */
    static _cachedProcessDict = null;

    /** Кэш справочника подразделений */
    static _cachedSubsidiaryDict = null;

    /** Timestamp'ы кешей (ключ — имя поля) для TTL-инвалидации. */
    static _cacheTimestamps = {};

    /** TTL кешей (15 минут): дольше держать рискованно — внешние словари меняются ETL. */
    static _cacheTtlMs = 15 * 60 * 1000;

    /** Выбранные процессы [{process_code, process_name}] */
    static _selectedProcesses = [];

    /** Выбранное подразделение (строка) */
    static _selectedSubsidiary = null;

    /**
     * Помечает указанный кеш текущим временем (для TTL-проверки).
     * @private
     */
    static _markCacheTimestamp(key) {
        this._cacheTimestamps[key] = Date.now();
    }

    /**
     * Проверяет, не устарел ли кеш по своему timestamp'у.
     * @private
     */
    static _isCacheFresh(key) {
        const ts = this._cacheTimestamps[key];
        if (!ts) return false;
        return (Date.now() - ts) <= this._cacheTtlMs;
    }

    /**
     * Инвалидирует все устаревшие кеши по TTL. Вызывается из show().
     * @private
     */
    static _invalidateStaleCaches() {
        const keys = ['_invoiceConfig', '_cachedTables', '_cachedMetricDict',
                      '_cachedProcessDict', '_cachedSubsidiaryDict'];
        for (const key of keys) {
            if (this[key] !== null && !this._isCacheFresh(key)) {
                this[key] = null;
                delete this._cacheTimestamps[key];
            }
        }
    }

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

        // Инвалидируем устаревшие кеши: внешние словари (метрики/процессы/
        // подразделения, конфиг фактур) могут поменяться ETL-ом между сессиями.
        this._invalidateStaleCaches();

        this._currentNode = node;
        this._currentNodeId = nodeId;
        this._selectedTable = null;
        this._focusedMetric = null;
        this._selectedMetrics = {};
        this._showFullMetricList = false;
        this._selectedProcesses = [];
        this._selectedSubsidiary = null;

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
        this._loadProcessDict();
        this._loadSubsidiaryDict();
    }

    /**
     * Загружает и кэширует конфиг фактур, заполняет хинты схем.
     * @private
     */
    static async _loadConfig(overlay) {
        if (!this._invoiceConfig) {
            try {
                const resp = await fetch(AppConfig.api.getUrl('/api/v1/acts/config/invoice'));
                if (resp.ok) {
                    this._invoiceConfig = await resp.json();
                    this._markCacheTimestamp('_invoiceConfig');
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
            this._markCacheTimestamp('_cachedTables');
        } catch (err) {
            console.error('Ошибка загрузки таблиц:', err);
            this._cachedTables = null;
            Notifications.error('Не удалось загрузить список таблиц. Повторите позже.');
        }

        if (searchInput) {
            searchInput.disabled = false;
            searchInput.placeholder = 'Начните вводить название таблицы...';
        }
    }

    /**
     * Загружает справочник метрик (кэширует при первом вызове).
     * При ошибке НЕ кешируем [] — иначе следующее открытие диалога молча
     * покажет пустой список вместо повторной попытки загрузки.
     * @private
     */
    static async _loadMetricDict() {
        if (this._cachedMetricDict !== null && this._isCacheFresh('_cachedMetricDict')) return;

        try {
            this._cachedMetricDict = await APIClient.loadMetricDict();
            this._markCacheTimestamp('_cachedMetricDict');
        } catch (err) {
            console.error('Ошибка загрузки справочника метрик:', err);
            this._cachedMetricDict = null;
            Notifications.error('Не удалось загрузить справочник метрик. Повторите позже.');
        }
    }

    static async _loadProcessDict() {
        if (this._cachedProcessDict !== null && this._isCacheFresh('_cachedProcessDict')) return;
        try {
            this._cachedProcessDict = await APIClient.loadProcessDict();
            this._markCacheTimestamp('_cachedProcessDict');
        } catch (err) {
            console.error('Ошибка загрузки справочника процессов:', err);
            this._cachedProcessDict = null;
            Notifications.error('Не удалось загрузить справочник процессов. Повторите позже.');
        }
    }

    static async _loadSubsidiaryDict() {
        if (this._cachedSubsidiaryDict !== null && this._isCacheFresh('_cachedSubsidiaryDict')) return;
        try {
            this._cachedSubsidiaryDict = await APIClient.loadSubsidiaryDict();
            this._markCacheTimestamp('_cachedSubsidiaryDict');
        } catch (err) {
            console.error('Ошибка загрузки справочника подразделений:', err);
            this._cachedSubsidiaryDict = null;
            Notifications.error('Не удалось загрузить справочник подразделений. Повторите позже.');
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

        // Предзаполняем процессы
        if (invoice.process && Array.isArray(invoice.process)) {
            this._selectedProcesses = [...invoice.process];
            this._renderProcessChips(overlay);
        }

        // Предзаполняем подразделение
        if (invoice.profile_div) {
            this._selectedSubsidiary = invoice.profile_div;
            const subInput = overlay.querySelector('.invoice-subsidiary-search-input');
            if (subInput) {
                subInput.value = invoice.profile_div;
                subInput.classList.add('has-value');
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
                InvoiceAutocomplete.hideTableDropdown(overlay);
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
                    InvoiceAutocomplete.hideTableDropdown(overlay);
                    return;
                }

                if (query.length === 0) {
                    InvoiceAutocomplete.hideTableDropdown(overlay);
                    return;
                }

                InvoiceAutocomplete.filterAndShowTables(this, overlay, query);
            });

            // Скрываем dropdown при потере фокуса (с задержкой для клика)
            searchInput.addEventListener('blur', () => {
                setTimeout(() => InvoiceAutocomplete.hideTableDropdown(overlay), 200);
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
                    InvoiceAutocomplete.hideMetricDropdown(overlay);
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

                InvoiceAutocomplete.filterAndShowMetrics(this, overlay, query);
            });

            metricInput.addEventListener('focus', () => {
                // При фокусе показать начальный список
                if (this._focusedMetric && !this._selectedMetrics[this._focusedMetric]) {
                    InvoiceAutocomplete.filterAndShowMetrics(this, overlay, metricInput.value.trim());
                }
            });

            metricInput.addEventListener('blur', () => {
                setTimeout(() => InvoiceAutocomplete.hideMetricDropdown(overlay), 200);
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

        // Поиск процессов — клиентская фильтрация + мульти-выбор
        const processInput = overlay.querySelector('.invoice-process-search-input');
        if (processInput) {
            processInput.addEventListener('input', () => {
                const query = processInput.value.trim();
                if (query.length === 0) {
                    InvoiceAutocomplete.hideProcessDropdown(overlay);
                    return;
                }
                InvoiceAutocomplete.filterAndShowProcesses(this, overlay, query);
            });
            processInput.addEventListener('blur', () => {
                setTimeout(() => InvoiceAutocomplete.hideProcessDropdown(overlay), 200);
            });
            processInput.addEventListener('focus', () => {
                const query = processInput.value.trim();
                if (query.length > 0) {
                    InvoiceAutocomplete.filterAndShowProcesses(this, overlay, query);
                }
            });
        }

        // Поиск подразделений — клиентская фильтрация + одиночный выбор
        const subInput = overlay.querySelector('.invoice-subsidiary-search-input');
        if (subInput) {
            subInput.addEventListener('input', () => {
                const query = subInput.value.trim();
                if (this._selectedSubsidiary && query !== this._selectedSubsidiary) {
                    this._selectedSubsidiary = null;
                    subInput.classList.remove('has-value');
                }
                if (query.length === 0) {
                    InvoiceAutocomplete.hideSubsidiaryDropdown(overlay);
                    return;
                }
                InvoiceAutocomplete.filterAndShowSubsidiaries(this, overlay, query);
            });
            subInput.addEventListener('blur', () => {
                setTimeout(() => InvoiceAutocomplete.hideSubsidiaryDropdown(overlay), 200);
            });
            subInput.addEventListener('focus', () => {
                const query = subInput.value.trim();
                if (query.length > 0 && !this._selectedSubsidiary) {
                    InvoiceAutocomplete.filterAndShowSubsidiaries(this, overlay, query);
                }
            });
        }

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
        // Снять active с предыдущего focused чипа (если есть).
        // configured ставим только при наличии данных метрики — иначе чип чистим
        // (зеркало логики _unfocusMetric: null-state не должен выглядеть как настроенный).
        if (this._focusedMetric && this._focusedMetric !== metricType) {
            const prevChip = overlay.querySelector(`.invoice-chip[data-metric="${this._focusedMetric}"]`);
            if (prevChip) {
                prevChip.classList.remove('active');
                if (this._selectedMetrics[this._focusedMetric]) {
                    prevChip.classList.add('configured');
                } else {
                    delete this._selectedMetrics[this._focusedMetric];
                    prevChip.classList.remove('configured');
                    this._removeChipBadge(prevChip);
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
        InvoiceAutocomplete.hideMetricDropdown(overlay);
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
        InvoiceAutocomplete.hideMetricDropdown(overlay);
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

    // -----------------------------------------------------------------
    // Секция процессов
    // -----------------------------------------------------------------

    static _renderProcessChips(overlay) {
        const container = overlay.querySelector('.invoice-process-chips');
        if (!container) return;

        container.innerHTML = '';

        this._selectedProcesses.forEach((proc, index) => {
            const chip = document.createElement('div');
            chip.className = 'invoice-process-chip';

            const codeSpan = document.createElement('span');
            codeSpan.className = 'invoice-process-chip-code';
            codeSpan.textContent = proc.process_code;

            const removeBtn = document.createElement('span');
            removeBtn.className = 'invoice-process-chip-remove';
            removeBtn.textContent = '\u00d7';
            removeBtn.addEventListener('click', () => {
                this._selectedProcesses.splice(index, 1);
                this._renderProcessChips(overlay);
            });

            chip.appendChild(codeSpan);
            chip.appendChild(removeBtn);
            container.appendChild(chip);
        });
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
            ? this._invoiceConfig?.hiveSchema
            : this._invoiceConfig?.gpSchema;

        if (!schemaName) {
            Notifications.warning('Конфигурация фактур не загружена. Обновите страницу.');
            return;
        }

        const data = {
            act_id: parseInt(actId, 10),
            node_id: this._currentNodeId,
            node_number: this._currentNode?.number || null,
            db_type: dbType,
            schema_name: schemaName,
            table_name: this._selectedTable.table_name,
            metrics: metricsArray,
            process: this._selectedProcesses.length > 0 ? this._selectedProcesses : null,
            profile_div: this._selectedSubsidiary || null,
        };

        // Блокируем кнопку на время сохранения
        const saveBtn = overlay.querySelector('.invoice-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Сохранение...';
        }

        // Прерываем предыдущий save (если по какой-то причине он ещё в полёте).
        if (this._saveAbort) {
            this._saveAbort.abort();
        }
        this._saveAbort = new AbortController();
        const signal = this._saveAbort.signal;
        const expectedOverlay = overlay;

        try {
            const result = await APIClient.saveInvoice(data, signal);

            // Race-guard: пока ждали ответ, диалог уже закрыли — выходим.
            if (!this._currentOverlay || this._currentOverlay !== expectedOverlay) return;

            // Сохраняем в структуру дерева через единую точку записи:
            // setNodeInvoice пишет в changelog ('invoice_set'), эмитит
            // 'node:invoice-changed', помечает stage как unsaved.
            if (this._currentNode) {
                AppState.setNodeInvoice(this._currentNode.id, {
                    db_type: data.db_type,
                    schema_name: data.schema_name,
                    table_name: data.table_name,
                    metrics: data.metrics,
                    process: data.process,
                    profile_div: data.profile_div,
                });
            }

            // Вызываем верификацию (заглушка) — backend пока возвращает status only.
            // Когда добавит warnings:string[] — surface через Notifications.warning.
            if (result && result.id) {
                try {
                    const verifyResult = await APIClient.verifyInvoice(result.id, data.act_id, signal);
                    console.log('Результат верификации (заглушка):', verifyResult);
                    if (this._currentOverlay !== expectedOverlay) return;
                    if (Array.isArray(verifyResult?.warnings) && verifyResult.warnings.length > 0) {
                        Notifications.warning(verifyResult.warnings.join('; '));
                    }
                } catch (verifyErr) {
                    if (verifyErr?.name === 'AbortError') return;
                    console.warn('Ошибка верификации (заглушка):', verifyErr);
                }
            }

            Notifications.success('Фактура успешно прикреплена');

            // Бейдж фактуры в дереве обновляется TreeRenderer'ом через подписку
            // на 'node:invoice-changed' (эмитится setNodeInvoice выше). Полный
            // treeManager.render() здесь больше не нужен.

            this._close();

            // Сохраняем акт в БД чтобы audit_act_id и audit_point_id
            // сразу попали в таблицу act_invoices
            if (window.currentActId) {
                try {
                    await APIClient.saveActContent(window.currentActId, { saveType: 'auto' });
                } catch (saveErr) {
                    console.warn('Не удалось сохранить акт после прикрепления фактуры:', saveErr);
                }
            }

        } catch (err) {
            if (err?.name === 'AbortError') {
                // Диалог закрыли / новый save запустили — тихо выходим.
                return;
            }
            console.error('Ошибка сохранения фактуры:', err);
            Notifications.error(`Ошибка сохранения: ${err.message}`);

            if (saveBtn && this._currentOverlay === expectedOverlay) {
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

        // Прерываем все висящие save/verify-запросы.
        if (this._saveAbort) {
            this._saveAbort.abort();
            this._saveAbort = null;
        }

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
        this._selectedProcesses = [];
        this._selectedSubsidiary = null;
    }
}

// Глобальный доступ
window.InvoiceDialog = InvoiceDialog;
