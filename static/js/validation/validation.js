/**
 * Фасад системы валидации
 *
 * Объединяет все валидаторы и предоставляет единую точку входа
 * для выполнения полной проверки акта перед сохранением.
 */
const ActValidation = {
    /**
     * Список зарегистрированных валидаторов
     * Каждый валидатор должен возвращать объект с полями: valid, message, isWarning
     * @private
     */
    _validators: [
        () => ValidationAct.validateStructure(),
        () => ValidationTable.validateHeaders(),
        () => ValidationTable.validateData()
    ],

    /**
     * Регистрирует новый валидатор
     * @param {Function} validator - Функция валидации, возвращающая результат
     */
    registerValidator(validator) {
        if (typeof validator === 'function') {
            this._validators.push(validator);
        }
    },

    /**
     * Удаляет валидатор из списка
     * @param {Function} validator - Функция валидации для удаления
     */
    unregisterValidator(validator) {
        const index = this._validators.indexOf(validator);
        if (index !== -1) {
            this._validators.splice(index, 1);
        }
    },

    /**
     * Выполняет полную валидацию акта
     * @returns {Object} Результат с массивами ошибок и предупреждений
     * @returns {boolean} result.valid - Валидна ли структура
     * @returns {Array<string>} result.errors - Список критичных ошибок
     * @returns {Array<string>} result.warnings - Список предупреждений
     * @returns {boolean} result.canProceed - Можно ли продолжить операцию
     */
    runAllValidations() {
        const errors = [];
        const warnings = [];

        for (const validator of this._validators) {
            try {
                const result = validator();

                if (!result.valid) {
                    if (result.isWarning) {
                        warnings.push(result.message);
                    } else {
                        errors.push(result.message);
                    }
                }
            } catch (error) {
                console.error('Ошибка при выполнении валидатора:', error);
                errors.push(`Внутренняя ошибка валидации: ${error.message}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            canProceed: errors.length === 0
        };
    }
};
