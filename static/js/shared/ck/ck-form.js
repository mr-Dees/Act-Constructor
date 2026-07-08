/**
 * Компонент формы редактирования записи ЦК.
 * Рендерит поля по декларативному конфигу.
 */
import { flattenFields } from '../../shared/datatable/build-columns.js';

export class CkForm {
    static _config = null;
    static _currentRecord = null;
    static _mode = 'empty'; // 'empty' | 'create' | 'edit'
    static _collapsed = new Set();  // id свёрнутых секций
    static _sectionStateKey = null; // ключ localStorage для состояния секций

    /**
     * @param {Object} config
     * @param {Array} config.fields - конфиг полей [{key, label, type, ...}]
     * @param {Object} config.dictionaries - справочники {metrics: [...], terbanks: [...], ...}
     * @param {HTMLElement} config.containerEl - контейнер формы
     * @param {Function} [config.onProcessPick] - callback для открытия picker-а процесса
     * @param {Function} [config.onBreakdownEdit] - callback для открытия модалки развёртки суммы по ТБ
     */
    static init(config) {
        this._config = config;
        this._currentRecord = null;
        this._mode = 'empty';
        this._sectionStateKey = config.sectionStateKey || null;
        this._loadSectionState();
        this._renderEmpty();
    }

    static fill(record) {
        this._currentRecord = record;
        this._mode = 'edit';
        this._renderForm();
        this._populateFields(record);
    }

    static clear() {
        this._currentRecord = null;
        this._mode = 'create';
        this._renderForm();
    }

    static renderEmpty() {
        this._currentRecord = null;
        this._mode = 'empty';
        this._renderEmpty();
    }

    static getMode() {
        return this._mode;
    }

    static getCurrentRecord() {
        return this._currentRecord;
    }

    static collectData() {
        const data = {};
        const fields = flattenFields(this._config.fields);
        for (const field of fields) {
            // computed-поля приходят из VIEW JOIN на бэке — не отправляем в payload
            if (field.computed) continue;

            const el = document.getElementById(`ck-field-${field.key}`);
            if (!el) continue;

            if (field.type === 'checkbox') {
                data[field.key] = el.checked;
            } else if (field.type === 'number') {
                const val = el.value.trim();
                data[field.key] = val === '' ? 0 : Number(val);
            } else if (field.type === 'date') {
                data[field.key] = el.value || null;
            } else if (field.type === 'process-picker') {
                data[field.key] = el.dataset.value || '';
                if (field.paired) {
                    data[field.paired] = el.dataset.pairedValue || '';
                }
                // paired_extras не отправляются — они вычисляются на бэке через JOIN
            } else if (field.type === 'amount-breakdown') {
                try { data[field.key] = JSON.parse(el.dataset.value || '[]'); }
                catch { data[field.key] = []; }
            } else if (field.type === 'readonly-text') {
                // Пустое значение опускаем — пусть {...record, ...data} сохранит исходное
                // (важно для Optional[int]-полей вроде reestr_metric_id: '' не парсится в int)
                const v = el.dataset.value || '';
                if (v !== '') data[field.key] = v;
            } else {
                data[field.key] = el.value;
            }
        }
        return data;
    }

    static validate() {
        const errors = [];
        const fields = flattenFields(this._config.fields);
        for (const field of fields) {
            if (!field.required) continue;
            // computed-поля заполняются автоматически — не валидируем
            if (field.computed) continue;
            const el = document.getElementById(`ck-field-${field.key}`);
            if (!el) continue;

            let isEmpty = false;
            if (field.type === 'process-picker') {
                isEmpty = !el.dataset.value;
            } else if (field.type === 'amount-breakdown') {
                try { isEmpty = !(JSON.parse(el.dataset.value || '[]').length); }
                catch { isEmpty = true; }
            } else if (field.type === 'readonly-text') {
                isEmpty = !(el.dataset.value || '').trim();
            } else if (field.type === 'checkbox') {
                isEmpty = false; // checkbox всегда valid
            } else {
                isEmpty = !el.value.trim();
            }

            // Убираем/добавляем класс ошибки
            if (isEmpty) {
                el.classList.add('ck-form__input--error');
                errors.push({ key: field.key, label: field.label, el });
            } else {
                el.classList.remove('ck-form__input--error');
            }
        }
        // Первая ошибка может прятаться в свёрнутой секции — раскрываем и
        // фокусируем поле, иначе пользователь не увидит, что блокирует сохранение.
        if (errors.length) this._revealError(errors[0].el);
        return { valid: errors.length === 0, errors };
    }

    /** Раскрывает секцию с ошибкой и переводит фокус на проблемное поле. */
    static _revealError(el) {
        if (!el || typeof el.closest !== 'function') return;
        const sec = el.closest('.ck-form__section');
        if (sec && sec.classList.contains('ck-form__section--collapsed')) {
            sec.classList.remove('ck-form__section--collapsed');
            const header = sec.querySelector('.ck-form__section-header');
            if (header) header.setAttribute('aria-expanded', 'true');
            const id = sec.dataset.section;
            if (id) { this._collapsed.delete(id); this._saveSectionState(); }
        }
        if (typeof el.focus === 'function') el.focus();
    }

    static _renderEmpty() {
        const el = this._config?.containerEl;
        if (!el) return;
        el.innerHTML = '<div class="ck-form__empty">Выберите запись или создайте новую</div>';
    }

    static _renderForm() {
        const el = this._config?.containerEl;
        if (!el) return;

        const form = document.createElement('div');
        form.className = 'ck-form';

        for (const entry of this._config.fields) {
            if (entry.section) form.appendChild(this._createSection(entry));
            else this._appendEntry(form, entry);
        }

        el.innerHTML = '';
        el.appendChild(form);
    }

    /** Добавляет в контейнер row-группу или одиночное поле. */
    static _appendEntry(container, entry) {
        if (entry.row) {
            const row = document.createElement('div');
            row.className = 'ck-form__row';
            for (const sub of entry.row) row.appendChild(this._createField(sub));
            container.appendChild(row);
        } else {
            const group = document.createElement('div');
            group.className = 'ck-form__group';
            group.appendChild(this._createField(entry));
            container.appendChild(group);
        }
    }

    /**
     * Сворачиваемая секция (disclosure): кнопка-заголовок с aria-expanded +
     * region-панель. Несколько секций раскрыты одновременно (multi-open).
     * Состояние свёрнутости — по стабильному id (`key`/название) с persist.
     */
    static _createSection(cfg) {
        const sec = document.createElement('div');
        sec.className = 'ck-form__section';
        const id = cfg.key || cfg.section;
        sec.dataset.section = id;

        const panelId = `ck-section-${id}`;
        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'ck-form__section-header';
        header.setAttribute('aria-controls', panelId);

        const chevron = document.createElement('span');
        chevron.className = 'ck-form__section-chevron';
        chevron.setAttribute('aria-hidden', 'true');

        const title = document.createElement('span');
        title.className = 'ck-form__section-title';
        title.textContent = cfg.section;

        header.appendChild(chevron);
        header.appendChild(title);

        const panel = document.createElement('div');
        panel.className = 'ck-form__section-body';
        panel.id = panelId;
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', cfg.section);
        for (const entry of (cfg.fields || [])) this._appendEntry(panel, entry);

        const collapsed = this._collapsed.has(id);
        sec.classList.toggle('ck-form__section--collapsed', collapsed);
        header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

        header.addEventListener('click', () => {
            const isCollapsed = sec.classList.toggle('ck-form__section--collapsed');
            header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
            if (isCollapsed) this._collapsed.add(id);
            else this._collapsed.delete(id);
            this._saveSectionState();
        });

        sec.appendChild(header);
        sec.appendChild(panel);
        return sec;
    }

    /** Загружает свёрнутые секции из localStorage (по ключу формы). */
    static _loadSectionState() {
        this._collapsed = new Set();
        if (!this._sectionStateKey) return;
        try {
            const raw = window.localStorage.getItem(this._sectionStateKey);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) this._collapsed = new Set(arr);
            }
        } catch {
            /* битое состояние — все секции раскрыты */
        }
    }

    /** Сохраняет свёрнутые секции в localStorage. */
    static _saveSectionState() {
        if (!this._sectionStateKey) return;
        try {
            window.localStorage.setItem(this._sectionStateKey, JSON.stringify([...this._collapsed]));
        } catch {
            /* переполнение квоты — игнорируем */
        }
    }

    static _createField(field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'ck-form__field';
        if (field.width) {
            wrapper.classList.add('ck-form__field--fixed');
            wrapper.style.width = field.width;
        }

        // Label
        const label = document.createElement('label');
        label.className = 'ck-form__label';
        label.textContent = field.label;
        if (field.description) {
            label.title = field.description; // подсказка по наведению — полное описание поля
            label.classList.add('ck-form__label--described');
        }
        if (field.required) {
            const req = document.createElement('span');
            req.className = 'required';
            req.textContent = ' *';
            label.appendChild(req);
        }

        // Trigger для process-picker
        if (field.type === 'process-picker') {
            const trigger = document.createElement('span');
            trigger.className = 'ck-form__picker-trigger';
            trigger.textContent = '🔍 выбрать';
            trigger.addEventListener('click', () => {
                if (this._config.onProcessPick) {
                    this._config.onProcessPick(field);
                }
            });
            label.appendChild(trigger);
        }

        // Trigger для amount-breakdown
        if (field.type === 'amount-breakdown') {
            const trigger = document.createElement('span');
            trigger.className = 'ck-form__picker-trigger';
            trigger.textContent = 'изменить ▸';
            trigger.addEventListener('click', () => {
                if (this._config.onBreakdownEdit) {
                    this._config.onBreakdownEdit(field);
                }
            });
            label.appendChild(trigger);
        }

        wrapper.appendChild(label);

        // Input element
        let input;
        switch (field.type) {
            case 'text':
                input = document.createElement('input');
                input.type = 'text';
                input.className = 'ck-form__input';
                if (field.mask === 'km') this._attachKmMask(input);
                if (field.pattern) this._attachPatternValidator(input, field);
                break;

            case 'number':
                input = document.createElement('input');
                input.type = 'number';
                input.className = 'ck-form__input';
                if (field.min !== undefined) input.min = field.min;
                break;

            case 'date':
                input = document.createElement('input');
                input.type = 'date';
                input.className = 'ck-form__input';
                break;

            case 'textarea':
                input = document.createElement('textarea');
                input.className = 'ck-form__textarea';
                input.rows = field.rows || 2;
                break;

            case 'checkbox':
                const checkWrap = document.createElement('div');
                checkWrap.className = 'ck-form__checkbox-wrap';
                input = document.createElement('input');
                input.type = 'checkbox';
                checkWrap.appendChild(input);
                const checkLabel = document.createElement('span');
                checkLabel.textContent = 'Да';
                checkWrap.appendChild(checkLabel);
                input.id = `ck-field-${field.key}`;
                wrapper.appendChild(checkWrap);
                return wrapper;

            case 'dictionary': {
                input = document.createElement('select');
                input.className = 'ck-form__select';
                const emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = '— выберите —';
                input.appendChild(emptyOpt);
                const items = this._getDictItems(field.dict);
                for (const item of items) {
                    const opt = document.createElement('option');
                    opt.value = item.value;
                    opt.textContent = item.label;
                    input.appendChild(opt);
                }
                break;
            }

            case 'select': {
                input = document.createElement('select');
                input.className = 'ck-form__select';
                const emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = '— выберите —';
                input.appendChild(emptyOpt);
                for (const opt of (field.options || [])) {
                    const optEl = document.createElement('option');
                    optEl.value = opt;
                    optEl.textContent = opt;
                    input.appendChild(optEl);
                }
                break;
            }

            case 'process-picker':
                input = document.createElement('div');
                input.className = 'ck-form__readonly';
                input.dataset.value = '';
                input.dataset.pairedValue = '';
                input.textContent = '— не выбран —';
                break;

            case 'readonly-text':
                input = document.createElement('div');
                input.className = 'ck-form__readonly';
                input.dataset.value = '';
                input.textContent = field.placeholder || '—';
                break;

            case 'amount-breakdown':
                // Развертка суммы по ТБ: readonly-итог + триггер модалки распределения
                input = document.createElement('div');
                input.className = 'ck-form__readonly ck-form__breakdown';
                input.dataset.value = '[]';
                input.textContent = '— не распределено —';
                break;

            default:
                input = document.createElement('input');
                input.type = 'text';
                input.className = 'ck-form__input';
        }

        input.id = `ck-field-${field.key}`;
        wrapper.appendChild(input);
        return wrapper;
    }

    static _getDictItems(dictName) {
        const dicts = this._config.dictionaries || {};
        const items = dicts[dictName] || [];

        if (dictName === 'metrics') {
            return items.map(m => ({
                value: m.code,
                label: `${m.code} — ${m.metric_name}`
            }));
        }
        if (dictName === 'terbanks') {
            return items.map(t => ({
                value: String(t.tb_id),
                label: `${t.tb_id} — ${t.short_name}`
            }));
        }
        if (dictName === 'risk_types') {
            return items.map(r => ({ value: r.risk, label: r.risk }));
        }
        // Дефолтный формат
        return items.map(i => ({
            value: i.id || i.code || i.name || '',
            label: i.name || i.label || String(i.id || '')
        }));
    }

    static _populateFields(record) {
        const fields = flattenFields(this._config.fields);
        for (const f of fields) {
            const el = document.getElementById(`ck-field-${f.key}`);
            if (!el) continue;
            const val = record[f.key];

            if (f.type === 'checkbox') {
                el.checked = !!val;
            } else if (f.type === 'process-picker') {
                el.dataset.value = record[f.key] || '';
                el.dataset.pairedValue = record[f.paired] || '';
                const num = record[f.key] || '';
                const name = record[f.paired] || '';
                el.textContent = num ? `${num} — ${name}` : '— не выбран —';
                // paired_extras: заполняем связанные read-only поля
                if (Array.isArray(f.paired_extras)) {
                    for (const extra of f.paired_extras) {
                        const extraEl = document.getElementById(`ck-field-${extra.key}`);
                        if (!extraEl) continue;
                        const extraVal = record[extra.source] || '';
                        extraEl.dataset.value = extraVal;
                        extraEl.textContent = extraVal || (extra.placeholder || '—');
                    }
                }
            } else if (f.type === 'amount-breakdown') {
                const breakdown = Array.isArray(record[f.key]) ? record[f.key] : [];
                CkForm.setBreakdownValue(f.key, breakdown);
            } else if (f.type === 'readonly-text') {
                const v = val || '';
                el.dataset.value = v;
                el.textContent = v || (f.placeholder || '—');
            } else if (f.type === 'date') {
                el.value = val ? val.substring(0, 10) : '';
            } else if ((f.type === 'select' || f.type === 'dictionary') && val) {
                // Если значение не попало в options (legacy/удалённое из справочника),
                // подкладываем его как опцию, чтобы оно отображалось.
                const strVal = String(val);
                const exists = Array.from(el.options).some(o => o.value === strVal);
                if (!exists) {
                    const opt = document.createElement('option');
                    opt.value = strVal;
                    opt.textContent = strVal;
                    el.appendChild(opt);
                }
                el.value = strVal;
            } else {
                el.value = val ?? '';
            }
        }
    }

    /**
     * Устанавливает значение процесса извне (после picker).
     * @param {string} fieldKey - ключ основного поля (например, 'process_number')
     * @param {string} processNumber - значение основного поля
     * @param {string} processName - значение paired-поля (например, process_name)
     * @param {Object} [extras] - словарь значений для paired_extras, ключ = source
     *   из конфига {key, source}. Например: { block_owner: '...', department_owner: '...' }
     */
    static setProcessValue(fieldKey, processNumber, processName, extras) {
        const el = document.getElementById(`ck-field-${fieldKey}`);
        if (!el) return;
        const num = processNumber || '';
        const name = processName || '';
        el.dataset.value = num;
        el.dataset.pairedValue = name;
        el.textContent = num ? `${num} — ${name}` : '— не выбран —';

        // Заполняем paired_extras, если они описаны в конфиге
        const fieldCfg = this._findFieldConfig(fieldKey);
        if (fieldCfg && Array.isArray(fieldCfg.paired_extras) && extras) {
            for (const extra of fieldCfg.paired_extras) {
                const extraEl = document.getElementById(`ck-field-${extra.key}`);
                if (!extraEl) continue;
                const v = extras[extra.source] || '';
                extraEl.dataset.value = v;
                extraEl.textContent = v || (extra.placeholder || '—');
            }
        }
    }

    /** Записывает развертку по ТБ в поле формы и обновляет readonly-итог. */
    static setBreakdownValue(fieldKey, breakdown) {
        const el = document.getElementById(`ck-field-${fieldKey}`);
        if (!el) return;
        const list = Array.isArray(breakdown) ? breakdown : [];
        el.dataset.value = JSON.stringify(list);
        const totalKop = list.reduce((s, b) => s + Math.round(Number(b.metric_amount_rubles || 0) * 100), 0);
        el.textContent = list.length
            ? `${(totalKop / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽ · ТБ: ${list.length}`
            : '— не распределено —';
        el.classList.remove('ck-form__input--error');
    }

    static getBreakdownValue(fieldKey) {
        const el = document.getElementById(`ck-field-${fieldKey}`);
        if (!el) return [];
        try { return JSON.parse(el.dataset.value || '[]'); } catch { return []; }
    }

    /**
     * Маска для № КМ: авто-префикс "КМ-" + ровно 2 цифры + "-" + ровно 5 цифр.
     * Работает аналогично acts-manager: пользователь вводит цифры,
     * прочее форматируется автоматически.
     */
    static _attachKmMask(input) {
        const format = (raw) => {
            const digits = (raw || '').replace(/\D/g, '').slice(0, 7);
            if (!digits) return '';
            if (digits.length <= 2) return `КМ-${digits}`;
            return `КМ-${digits.slice(0, 2)}-${digits.slice(2)}`;
        };
        input.addEventListener('input', (e) => {
            input.setCustomValidity('');
            e.target.value = format(e.target.value);
        });
        input.addEventListener('blur', (e) => {
            const v = (e.target.value || '').trim();
            if (!v) return;
            if (!/^КМ-\d{2}-\d{5}$/.test(v)) {
                e.target.setCustomValidity('№ КМ должен быть в формате КМ-XX-XXXXX (например, КМ-09-41726)');
                e.target.reportValidity();
            } else {
                e.target.setCustomValidity('');
            }
        });
    }

    /** Валидация на blur по произвольному regex (string). */
    static _attachPatternValidator(input, field) {
        const re = new RegExp(field.pattern);
        const msg = field.patternMessage || `Значение должно соответствовать формату ${field.pattern}`;
        input.addEventListener('input', () => input.setCustomValidity(''));
        input.addEventListener('blur', (e) => {
            const v = (e.target.value || '').trim();
            if (!v) return;
            if (!re.test(v)) {
                e.target.setCustomValidity(msg);
                e.target.reportValidity();
            } else {
                e.target.setCustomValidity('');
            }
        });
    }

    /** Ищет конфиг поля по key (с учётом секций и row-групп). */
    static _findFieldConfig(key) {
        if (!this._config) return null;
        return flattenFields(this._config.fields).find(f => f.key === key) || null;
    }
}

window.CkForm = CkForm;
