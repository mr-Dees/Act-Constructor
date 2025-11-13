/**
 * Валидация структуры и состава акта
 *
 * Проверяет базовые бизнес-правила на уровне акта как документа.
 */
const ValidationAct = {
    /**
     * Проверяет наличие хотя бы одного раздела в структуре акта
     * @returns {Object} Результат валидации
     */
    validateStructure() {
        if (!AppState.treeData?.children) {
            return {valid: false, message: 'Структура акта пуста'};
        }

        if (AppState.treeData.children.length === 0) {
            return {valid: false, message: 'Добавьте хотя бы один раздел в акт'};
        }

        return {valid: true, message: 'OK'};
    }
};