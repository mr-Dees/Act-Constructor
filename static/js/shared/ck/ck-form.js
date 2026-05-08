/**
 * Компонент формы редактирования записи ЦК.
 * Рендерит поля по декларативному конфигу.
 */
class CkForm {
    static _config = null;
    static _currentRecord = null;
    static _mode = 'empty'; // 'empty' | 'create' | 'edit'

    /**
     * @param {Object} config
     * @param {Array} config.fields - конфиг полей [{key, label, type, ...}]
     * @param {Object} config.dictionaries - справочники {metrics: [...], terbanks: [...], ...}
     * @param {HTMLElement} config.containerEl - контейнер формы
     * @param {Function} [config.onProcessPick] - callback для открытия picker-а процесса
     */
    static init(config) {
        this._config = config;
        this._currentRecord = null;
        this._mode = 'empty';
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
        const fields = this._flattenFields();
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
            } else if (field.type === 'readonly-text') {
                // readonly-text без computed=true — попадает в payload как есть
                data[field.key] = el.dataset.value || '';
            } else {
                data[field.key] = el.value;
            }
        }
        return data;
    }

    /** Возвращает плоский список всех полей с учётом row-групп. */
    static _flattenFields() {
        const result = [];
        for (const field of this._config.fields) {
            if (field.row) {
                for (const sub of field.row) result.push(sub);
            } else {
                result.push(field);
            }
        }
        return result;
    }

    static validate() {
        const errors = [];
        const fields = this._flattenFields();
        for (const field of fields) {
            if (!field.required) continue;
            // computed-поля заполняются автоматически — не валидируем
            if (field.computed) continue;
            const el = document.getElementById(`ck-field-${field.key}`);
            if (!el) continue;

            let isEmpty = false;
            if (field.type === 'process-picker') {
                isEmpty = !el.dataset.value;
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
                errors.push({ key: field.key, label: field.label });
            } else {
                el.classList.remove('ck-form__input--error');
            }
        }
        return { valid: errors.length === 0, errors };
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

        for (const field of this._config.fields) {
            if (field.row) {
                // Начало строки с несколькими полями
                const row = document.createElement('div');
                row.className = 'ck-form__row';
                for (const subField of field.row) {
                    row.appendChild(this._createField(subField));
                }
                form.appendChild(row);
            } else {
                const group = document.createElement('div');
                group.className = 'ck-form__group';
                group.appendChild(this._createField(field));
                form.appendChild(group);
            }
        }

        el.innerHTML = '';
        el.appendChild(form);
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

        wrapper.appendChild(label);

        // Input element
        let input;
        switch (field.type) {
            case 'text':
                input = document.createElement('input');
                input.type = 'text';
                input.className = 'ck-form__input';
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
        // Дефолтный формат
        return items.map(i => ({
            value: i.id || i.code || i.name || '',
            label: i.name || i.label || String(i.id || '')
        }));
    }

    static _populateFields(record) {
        const fields = this._flattenFields();
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
            } else if (f.type === 'readonly-text') {
                const v = val || '';
                el.dataset.value = v;
                el.textContent = v || (f.placeholder || '—');
            } else if (f.type === 'date') {
                el.value = val ? val.substring(0, 10) : '';
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

    /** Ищет конфиг поля по key (с учётом row-групп). */
    static _findFieldConfig(key) {
        if (!this._config) return null;
        for (const field of this._config.fields) {
            if (field.row) {
                const found = field.row.find(f => f.key === key);
                if (found) return found;
            } else if (field.key === key) {
                return field;
            }
        }
        return null;
    }
}

window.CkForm = CkForm;
