/**
 * Рендерер нарушений для предпросмотра
 *
 * Создает компактное текстовое представление нарушений
 * с обрезкой длинных текстов и подсчетом элементов.
 */
class PreviewViolationRenderer {
    /**
     * Создает элемент нарушения
     *
     * @param {Object} violation - Данные нарушения
     * @param {number} previewTrim - Максимальная длина текста
     * @returns {HTMLElement} Элемент нарушения
     */
    static create(violation, previewTrim) {
        const container = this._createContainer();

        this._renderBasicInfo(container, violation);
        this._renderDescriptionList(container, violation);
        this._renderAdditionalContent(container, violation);
        this._renderOptionalFields(container, violation);

        return container;
    }

    /**
     * Создает контейнер нарушения
     * @private
     */
    static _createContainer() {
        const container = document.createElement('div');
        container.className = 'preview-violation';
        return container;
    }

    /**
     * Рендерит базовую информацию
     * @private
     */
    static _renderBasicInfo(container, violation) {
        this._addLine(container, 'Нарушено', violation.violated);
        this._addLine(container, 'Установлено', violation.established);
    }

    /**
     * Рендерит список описаний
     * @private
     */
    static _renderDescriptionList(container, violation) {
        if (!violation.descriptionList?.enabled) return;

        const items = violation.descriptionList.items;
        const count = items.filter(item => item.trim()).length;

        if (count > 0) {
            const text = `${count} ${this._pluralize(count, 'метрика', 'метрики', 'метрик')}`;
            this._addLine(container, 'В том числе', text);
        }
    }

    /**
     * Рендерит дополнительный контент
     * @private
     */
    static _renderAdditionalContent(container, violation) {
        if (!violation.additionalContent?.enabled) return;

        const items = violation.additionalContent.items || [];
        const counters = {case: 1, image: 1, text: 1};

        items.forEach(item => {
            this._renderContentItem(container, item, counters);
        });
    }

    /**
     * Рендерит элемент дополнительного контента
     * @private
     */
    static _renderContentItem(container, item, counters) {
        const handlers = {
            'case': this._renderCase,
            'image': this._renderImage,
            'freeText': this._renderFreeText
        };

        const handler = handlers[item.type];
        if (handler) {
            handler.call(this, container, item, counters);
        }
    }

    /**
     * Рендерит кейс
     * @private
     */
    static _renderCase(container, item, counters) {
        if (!item.content?.trim()) return;

        this._addLine(
            container,
            `Кейс ${counters.case}`,
            item.content,
            50
        );
        counters.case++;
        counters.image = 1;
        counters.text = 1;
    }

    /**
     * Рендерит изображение
     * @private
     */
    static _renderImage(container, item, counters) {
        const caption = item.caption ? ` - ${this._trim(item.caption, 30)}` : '';
        const text = `${this._trim(item.filename, 30)}${caption}`;

        this._addLine(container, `Изображение ${counters.image}`, text);
        counters.image++;
        counters.case = 1;
    }

    /**
     * Рендерит свободный текст
     * @private
     */
    static _renderFreeText(container, item, counters) {
        if (!item.content?.trim()) return;

        this._addLine(
            container,
            `Текст ${counters.text}`,
            item.content,
            50
        );
        counters.text++;
        counters.case = 1;
    }

    /**
     * Рендерит опциональные поля
     * @private
     */
    static _renderOptionalFields(container, violation) {
        const fields = [
            ['reasons', 'Причины'],
            ['consequences', 'Последствия'],
            ['responsible', 'Ответственный за решение проблем'],
            ['recommendations', 'Рекомендации']
        ];

        fields.forEach(([key, label]) => {
            const field = violation[key];
            if (field?.enabled && field?.content) {
                this._addLine(container, label, field.content);
            }
        });
    }

    /**
     * Добавляет строку информации
     * @private
     */
    static _addLine(container, label, text, maxLength = 15) {
        const line = document.createElement('div');
        line.className = 'preview-violation-line';
        line.innerHTML = `${label}: ${this._trim(text, maxLength)}`;
        container.appendChild(line);
    }

    /**
     * Обрезает текст
     * @private
     */
    static _trim(text, maxLength) {
        if (!text) return '—';
        const str = text.toString();
        return str.length > maxLength ? str.slice(0, maxLength) + '...' : str;
    }

    /**
     * Правильное склонение существительных
     * @private
     */
    static _pluralize(count, one, few, many) {
        const mod10 = count % 10;
        const mod100 = count % 100;

        if (mod10 === 1 && mod100 !== 11) return one;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
        return many;
    }
}
