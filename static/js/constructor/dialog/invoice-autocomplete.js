/**
 * Виджет автодополнения диалога фактур.
 *
 * Вынесен из dialog-invoice.js (§6 п.8 аудита): клиентская фильтрация
 * и dropdown-механика для четырёх поисковых полей — таблицы, коды метрик,
 * процессы, подразделения. Поведение идентично исходному; состояние диалога
 * (кэши справочников, выбранные значения) остаётся в InvoiceDialog и
 * передаётся первым параметром `dialog`.
 */
export class InvoiceAutocomplete {
    // -----------------------------------------------------------------
    // Секция таблиц
    // -----------------------------------------------------------------

    /**
     * Фильтрует кэш таблиц и показывает результаты.
     */
    static filterAndShowTables(dialog, overlay, query) {
        if (!dialog._cachedTables) {
            this._showTableDropdown(dialog, overlay, []);
            return;
        }

        const queryLower = query.toLowerCase();
        const filtered = dialog._cachedTables.filter(
            t => t.table_name.toLowerCase().includes(queryLower)
        );

        this._showTableDropdown(dialog, overlay, filtered.slice(0, 50));
    }

    /**
     * Показывает dropdown с результатами поиска.
     * @private
     */
    static _showTableDropdown(dialog, overlay, results) {
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
                    this._selectTable(dialog, overlay, item);
                });
                dropdown.appendChild(el);
            });
        }

        dropdown.classList.add('visible');
    }

    /**
     * Скрывает dropdown.
     */
    static hideTableDropdown(overlay) {
        const dropdown = overlay.querySelector('.invoice-search-dropdown');
        if (dropdown) dropdown.classList.remove('visible');
    }

    /**
     * Выбирает таблицу из dropdown.
     * @private
     */
    static _selectTable(dialog, overlay, item) {
        dialog._selectedTable = item;

        const searchInput = overlay.querySelector('.invoice-search-input');
        if (searchInput) {
            searchInput.value = item.table_name;
            searchInput.classList.add('has-value');
        }

        this.hideTableDropdown(overlay);
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
     */
    static filterAndShowMetrics(dialog, overlay, query) {
        if (!dialog._cachedMetricDict) return;

        let primaryItems;
        let otherItems;

        if (query.length > 0) {
            // С запросом — ищем по ВСЕМ метрикам
            const isDigitSearch = /^\d/.test(query);
            const queryLower = query.toLowerCase();

            const filterFn = isDigitSearch
                ? (m) => m.code.includes(query)
                : (m) => m.metric_name.toLowerCase().includes(queryLower);

            const allFiltered = dialog._cachedMetricDict.filter(filterFn);

            if (dialog._focusedMetric) {
                // Выбранная группа — первая, остальные — ниже
                primaryItems = allFiltered.filter(m => m.metric_group === dialog._focusedMetric);
                otherItems = allFiltered.filter(m => m.metric_group !== dialog._focusedMetric);
            } else {
                primaryItems = allFiltered;
                otherItems = [];
            }
        } else {
            // Без запроса — фильтрация по группе
            if (dialog._focusedMetric) {
                primaryItems = dialog._cachedMetricDict.filter(
                    m => m.metric_group === dialog._focusedMetric
                );
                otherItems = dialog._cachedMetricDict.filter(
                    m => m.metric_group !== dialog._focusedMetric
                );
            } else {
                primaryItems = dialog._cachedMetricDict;
                otherItems = [];
            }
        }

        const hasQuery = query.length > 0;
        this._showMetricDropdown(dialog, overlay, primaryItems.slice(0, 100), otherItems, hasQuery);
    }

    /**
     * Показывает dropdown с метриками.
     * @param {Object} dialog - Класс InvoiceDialog (состояние диалога)
     * @param {HTMLElement} overlay
     * @param {Array} primaryItems - основной список (выбранная группа или все)
     * @param {Array} otherItems - метрики из других групп
     * @param {boolean} hasQuery - есть ли поисковый запрос (если да, показываем всё сразу)
     * @private
     */
    static _showMetricDropdown(dialog, overlay, primaryItems, otherItems, hasQuery = false) {
        const dropdown = overlay.querySelector('.invoice-metric-dropdown');
        if (!dropdown) return;

        dropdown.innerHTML = '';

        // При активном поиске показываем другие группы сразу
        const expandOther = dialog._showFullMetricList || hasQuery;

        if (primaryItems.length === 0 && (!expandOther || otherItems.length === 0)) {
            const empty = document.createElement('div');
            empty.className = 'invoice-search-dropdown-empty';
            empty.textContent = 'Метрики не найдены';
            dropdown.appendChild(empty);
        } else {
            // Основной список
            primaryItems.forEach(item => {
                dropdown.appendChild(this._createMetricDropdownItem(dialog, overlay, item));
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
                        dropdown.appendChild(this._createMetricDropdownItem(dialog, overlay, item));
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
                    dialog._showFullMetricList = true;
                    const metricInput = overlay.querySelector('.invoice-metric-search-input');
                    this.filterAndShowMetrics(dialog, overlay, metricInput?.value?.trim() || '');
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
    static _createMetricDropdownItem(dialog, overlay, item) {
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
            this._selectMetricCode(dialog, overlay, item);
        });

        return el;
    }

    /**
     * Скрывает dropdown метрик.
     */
    static hideMetricDropdown(overlay) {
        const dropdown = overlay.querySelector('.invoice-metric-dropdown');
        if (dropdown) dropdown.classList.remove('visible');
    }

    /**
     * Выбирает код метрики из dropdown.
     * @private
     */
    static _selectMetricCode(dialog, overlay, item) {
        dialog._skipNextUnfocus = true;

        // Определяем целевой тип метрики
        let targetMetric = dialog._focusedMetric;

        // Авто-корректировка: если группа метрики не совпадает с focused
        if (item.metric_group && item.metric_group !== dialog._focusedMetric) {
            targetMetric = item.metric_group;

            // Если этот тип ещё не был выбран — добавляем
            if (dialog._selectedMetrics[targetMetric] === undefined) {
                dialog._selectedMetrics[targetMetric] = null;
            }

            // Переключаем фокус на новый тип
            dialog._switchFocus(overlay, targetMetric);
        }

        // Сохраняем данные
        dialog._selectedMetrics[targetMetric] = {
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
            dialog._updateChipBadge(chip, item.code);
        }

        this.hideMetricDropdown(overlay);
    }

    // -----------------------------------------------------------------
    // Секция процессов
    // -----------------------------------------------------------------

    static filterAndShowProcesses(dialog, overlay, query) {
        if (!dialog._cachedProcessDict) return;

        const queryLower = query.toLowerCase();
        const filtered = dialog._cachedProcessDict.filter(
            p => p.process_code.toLowerCase().includes(queryLower) ||
                 p.process_name.toLowerCase().includes(queryLower)
        );

        // Исключаем уже выбранные
        const selectedCodes = new Set(dialog._selectedProcesses.map(p => p.process_code));
        const available = filtered.filter(p => !selectedCodes.has(p.process_code));

        this._showProcessDropdown(dialog, overlay, available.slice(0, 50));
    }

    static _showProcessDropdown(dialog, overlay, results) {
        const dropdown = overlay.querySelector('.invoice-process-dropdown');
        if (!dropdown) return;

        dropdown.innerHTML = '';

        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'invoice-process-search-dropdown-empty';
            empty.textContent = 'Процессы не найдены';
            dropdown.appendChild(empty);
        } else {
            results.forEach(item => {
                const el = document.createElement('div');
                el.className = 'invoice-process-dropdown-item';

                const codeSpan = document.createElement('span');
                codeSpan.className = 'invoice-process-item-code';
                codeSpan.textContent = item.process_code;

                const nameSpan = document.createElement('span');
                nameSpan.className = 'invoice-process-item-name';
                nameSpan.textContent = ` — ${item.process_name}`;

                el.appendChild(codeSpan);
                el.appendChild(nameSpan);

                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this._selectProcess(dialog, overlay, item);
                });
                dropdown.appendChild(el);
            });
        }

        dropdown.classList.add('visible');
    }

    static hideProcessDropdown(overlay) {
        const dropdown = overlay.querySelector('.invoice-process-dropdown');
        if (dropdown) dropdown.classList.remove('visible');
    }

    static _selectProcess(dialog, overlay, item) {
        dialog._selectedProcesses.push({
            process_code: item.process_code,
            process_name: item.process_name,
        });

        // Очищаем input
        const processInput = overlay.querySelector('.invoice-process-search-input');
        if (processInput) processInput.value = '';

        this.hideProcessDropdown(overlay);
        dialog._renderProcessChips(overlay);
    }

    // -----------------------------------------------------------------
    // Секция подразделений
    // -----------------------------------------------------------------

    static filterAndShowSubsidiaries(dialog, overlay, query) {
        if (!dialog._cachedSubsidiaryDict) return;

        const queryLower = query.toLowerCase();
        const filtered = dialog._cachedSubsidiaryDict.filter(
            s => s.name.toLowerCase().includes(queryLower)
        );

        this._showSubsidiaryDropdown(dialog, overlay, filtered.slice(0, 50));
    }

    static _showSubsidiaryDropdown(dialog, overlay, results) {
        const dropdown = overlay.querySelector('.invoice-subsidiary-dropdown');
        if (!dropdown) return;

        dropdown.innerHTML = '';

        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'invoice-subsidiary-search-dropdown-empty';
            empty.textContent = 'Подразделения не найдены';
            dropdown.appendChild(empty);
        } else {
            results.forEach(item => {
                const el = document.createElement('div');
                el.className = 'invoice-subsidiary-dropdown-item';
                el.textContent = item.name;
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this._selectSubsidiary(dialog, overlay, item);
                });
                dropdown.appendChild(el);
            });
        }

        dropdown.classList.add('visible');
    }

    static hideSubsidiaryDropdown(overlay) {
        const dropdown = overlay.querySelector('.invoice-subsidiary-dropdown');
        if (dropdown) dropdown.classList.remove('visible');
    }

    static _selectSubsidiary(dialog, overlay, item) {
        dialog._selectedSubsidiary = item.name;

        const subInput = overlay.querySelector('.invoice-subsidiary-search-input');
        if (subInput) {
            subInput.value = item.name;
            subInput.classList.add('has-value');
        }

        this.hideSubsidiaryDropdown(overlay);
    }
}
