/**
 * Фасад системы валидации
 *
 * Объединяет все валидаторы и предоставляет единую точку входа
 * для выполнения полной проверки акта перед сохранением.
 */
const ActValidation = {
    /**
     * Выполняет полную валидацию акта
     * @returns {Object} Результат с массивами ошибок и предупреждений
     */
    runAllValidations() {
        const errors = [];
        const warnings = [];

        const structure = ValidationAct.validateStructure();
        if (!structure.valid) {
            errors.push(structure.message);
        }

        const tableHeaders = ValidationTable.validateHeaders();
        if (!tableHeaders.valid) {
            errors.push(tableHeaders.message);
        }

        const tableData = ValidationTable.validateData();
        if (!tableData.valid) {
            warnings.push(tableData.message);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            canProceed: errors.length === 0
        };
    }
};