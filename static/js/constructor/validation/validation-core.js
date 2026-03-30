/**
 * Ядро системы валидации
 *
 * Содержит базовые утилиты, общие интерфейсы и вспомогательные функции
 * для всех модулей валидации. Обеспечивает единообразие API.
 */
const ValidationCore = {
    /**
     * Создает успешный результат валидации
     * @param {string} [message='OK'] - Сообщение (опционально)
     * @returns {Object} Результат валидации с полями valid, message, isWarning
     */
    success(message = 'OK') {
        return {
            valid: true,
            message,
            isWarning: false
        };
    },

    /**
     * Создает неуспешный результат валидации
     * @param {string} message - Сообщение об ошибке
     * @returns {Object} Результат валидации с полями valid, message, isWarning
     */
    failure(message) {
        return {
            valid: false,
            message,
            isWarning: false
        };
    },

    /**
     * Создает результат-предупреждение (не блокирует операцию)
     * @param {string} message - Сообщение-предупреждение
     * @returns {Object} Результат валидации с флагом isWarning
     */
    warning(message) {
        return {
            valid: false,
            message,
            isWarning: true
        };
    },

    /**
     * Проверяет, существует ли узел
     * @param {Object|null} node - Проверяемый узел
     * @returns {Object} Результат валидации
     */
    validateNodeExists(node) {
        if (!node) {
            return this.failure(AppConfig.tree.validation.nodeNotFound);
        }
        return this.success();
    },

    /**
     * Проверяет, находится ли значение в допустимом диапазоне
     * @param {number} value - Проверяемое значение
     * @param {number} min - Минимум
     * @param {number} max - Максимум
     * @param {string} fieldName - Название поля для сообщения
     * @returns {Object} Результат валидации
     */
    validateRange(value, min, max, fieldName) {
        if (value < min || value > max) {
            return this.failure(
                `${fieldName} должно быть в диапазоне ${min}-${max}`
            );
        }
        return this.success();
    },

    /**
     * Проверяет, что строка не пуста
     * @param {string} value - Проверяемая строка
     * @param {string} fieldName - Название поля для сообщения
     * @returns {Object} Результат валидации
     */
    validateNotEmpty(value, fieldName) {
        if (!value || !value.trim()) {
            return this.failure(`${fieldName} не может быть пустым`);
        }
        return this.success();
    },

    /**
     * Проверяет, что массив не пустой
     * @param {Array} array - Проверяемый массив
     * @param {string} fieldName - Название поля для сообщения
     * @returns {Object} Результат валидации
     */
    validateArrayNotEmpty(array, fieldName) {
        if (!array || !Array.isArray(array) || array.length === 0) {
            return this.failure(`${fieldName} не может быть пустым`);
        }
        return this.success();
    },

    /**
     * Проверяет лимит количества элементов
     * @param {number} current - Текущее количество
     * @param {number} limit - Максимальное количество
     * @param {string} itemName - Название элементов для сообщения
     * @returns {Object} Результат валидации
     */
    validateLimit(current, limit, itemName) {
        if (current >= limit) {
            return this.failure(
                AppConfig.content.errors.limitReached(itemName, limit)
            );
        }
        return this.success();
    },

    /**
     * Объединяет результаты нескольких валидаций
     * @param {...Object} results - Результаты валидаций
     * @returns {Object} Объединенный результат
     */
    combine(...results) {
        const failures = results.filter(r => !r.valid);

        if (failures.length === 0) {
            return this.success();
        }

        // Разделяем ошибки и предупреждения
        const errors = failures.filter(f => !f.isWarning);
        const warnings = failures.filter(f => f.isWarning);

        // Если есть хоть одна ошибка, возвращаем ошибку
        if (errors.length > 0) {
            const messages = errors.map(f => f.message).filter(Boolean);
            return this.failure(messages.join('\n'));
        }

        // Иначе возвращаем предупреждение
        const messages = warnings.map(f => f.message).filter(Boolean);
        return this.warning(messages.join('\n'));
    },

    /**
     * Проверяет, что узел имеет допустимый тип
     * @param {Object} node - Проверяемый узел
     * @param {string[]} allowedTypes - Разрешенные типы
     * @param {string} operation - Описание операции для сообщения
     * @returns {Object} Результат валидации
     */
    validateNodeType(node, allowedTypes, operation) {
        const nodeType = node.type || 'item';

        if (!allowedTypes.includes(nodeType)) {
            return this.failure(
                `Нельзя ${operation} для узла типа "${nodeType}"`
            );
        }
        return this.success();
    }
};
