/**
 * Сервис генерации уникальных идентификаторов
 *
 * Генерирует UUID v4 для узлов дерева и контента.
 * Поддерживает переключение между локальной генерацией
 * и внешним сервисом (заглушка для будущей интеграции).
 */
class IdGeneratorService {
    /**
     * Конфигурация сервиса
     * @type {Object}
     */
    static config = {
        /** @type {'local'|'external'} Режим генерации */
        mode: 'local',

        /** @type {string|null} URL внешнего сервиса (заглушка) */
        externalEndpoint: null,

        /** @type {Array<string>} Кеш предзагруженных ID для external режима */
        _idCache: []
    };

    /**
     * Синхронная генерация ID (для local режима)
     *
     * Используется для немедленного создания узлов без асинхронных вызовов.
     * В режиме external возвращает ID из кеша или генерирует локально.
     *
     * @param {string} [prefix='node'] - Префикс ID (node, table, textblock, violation)
     * @returns {string} Уникальный идентификатор в формате prefix_uuid
     *
     * @example
     * const nodeId = IdGeneratorService.generateIdSync('node');
     * // node_a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
     */
    static generateIdSync(prefix = 'node') {
        if (this.config.mode === 'external' && this.config._idCache.length > 0) {
            const cachedId = this.config._idCache.shift();
            return `${prefix}_${cachedId}`;
        }
        return this._generateLocalId(prefix);
    }

    /**
     * Асинхронная генерация ID (для external режима)
     *
     * В режиме local работает синхронно.
     * В режиме external запрашивает ID у внешнего сервиса.
     *
     * @param {string} [prefix='node'] - Префикс ID
     * @returns {Promise<string>} Уникальный идентификатор
     *
     * @example
     * const nodeId = await IdGeneratorService.generateId('table');
     */
    static async generateId(prefix = 'node') {
        if (this.config.mode === 'external') {
            return this._getExternalId(prefix);
        }
        return this._generateLocalId(prefix);
    }

    /**
     * Локальная генерация UUID v4
     *
     * Генерирует криптографически случайный UUID v4.
     * Использует crypto.getRandomValues() при наличии, иначе Math.random().
     *
     * @private
     * @param {string} prefix - Префикс ID
     * @returns {string} ID в формате prefix_uuid
     */
    static _generateLocalId(prefix) {
        const uuid = this._generateUUIDv4();
        return `${prefix}_${uuid}`;
    }

    /**
     * Генерирует UUID v4 строку
     *
     * @private
     * @returns {string} UUID в формате xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
     */
    static _generateUUIDv4() {
        // Используем crypto.randomUUID() если доступен (современные браузеры)
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }

        // Фолбэк на шаблонную генерацию
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    /**
     * Заглушка для получения ID от внешнего сервиса
     *
     * TODO: Реализовать запрос к внешнему сервису генерации ID.
     * Сервис должен возвращать гарантированно уникальные ID
     * в распределенной среде.
     *
     * @private
     * @param {string} prefix - Префикс ID
     * @returns {Promise<string>} ID от внешнего сервиса или локальный фолбэк
     */
    static async _getExternalId(prefix) {
        // Проверяем конфигурацию
        if (!this.config.externalEndpoint) {
            console.warn('IdGeneratorService: external endpoint не настроен, используется локальная генерация');
            return this._generateLocalId(prefix);
        }

        try {
            // TODO: Реализовать запрос к внешнему сервису
            // const response = await fetch(this.config.externalEndpoint, {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify({ prefix, count: 1 })
            // });
            //
            // if (!response.ok) {
            //     throw new Error(`HTTP ${response.status}`);
            // }
            //
            // const data = await response.json();
            // return data.id;

            console.warn('IdGeneratorService: внешний сервис ID не реализован, используется локальная генерация');
            return this._generateLocalId(prefix);

        } catch (error) {
            console.error('IdGeneratorService: ошибка внешнего сервиса:', error);
            return this._generateLocalId(prefix);
        }
    }

    /**
     * Предзагрузка ID для external режима (заглушка)
     *
     * Позволяет заранее получить пул ID для синхронного использования.
     *
     * @param {number} [count=10] - Количество ID для предзагрузки
     * @returns {Promise<void>}
     */
    static async prefetchIds(count = 10) {
        if (this.config.mode !== 'external' || !this.config.externalEndpoint) {
            return;
        }

        // TODO: Реализовать предзагрузку ID
        // try {
        //     const response = await fetch(this.config.externalEndpoint, {
        //         method: 'POST',
        //         headers: { 'Content-Type': 'application/json' },
        //         body: JSON.stringify({ count })
        //     });
        //
        //     const data = await response.json();
        //     this.config._idCache.push(...data.ids);
        // } catch (error) {
        //     console.error('IdGeneratorService: ошибка предзагрузки ID:', error);
        // }

        console.warn('IdGeneratorService: предзагрузка ID не реализована');
    }

    /**
     * Настройка сервиса
     *
     * @param {Object} options - Параметры конфигурации
     * @param {string} [options.mode] - Режим генерации ('local' | 'external')
     * @param {string} [options.externalEndpoint] - URL внешнего сервиса
     *
     * @example
     * IdGeneratorService.configure({
     *     mode: 'external',
     *     externalEndpoint: 'https://id-service.example.com/generate'
     * });
     */
    static configure(options) {
        Object.assign(this.config, options);

        if (options.mode === 'external' && !options.externalEndpoint) {
            console.warn('IdGeneratorService: включен external режим без указания endpoint');
        }
    }

    /**
     * Сброс конфигурации к значениям по умолчанию
     * Используется в тестах.
     */
    static reset() {
        this.config = {
            mode: 'local',
            externalEndpoint: null,
            _idCache: []
        };
    }
}
