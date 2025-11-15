/**
 * Валидация структуры и состава акта
 *
 * Проверяет базовые бизнес-правила на уровне акта как документа.
 */
const ValidationAct = {
    /**
     * Проверяет наличие хотя бы одного раздела в структуре акта
     * @returns {Object} Результат валидации с полями valid, message, isWarning
     */
    validateStructure() {
        if (!AppState.treeData?.children) {
            return ValidationCore.failure('Структура акта пуста');
        }

        const validation = ValidationCore.validateArrayNotEmpty(
            AppState.treeData.children,
            'Разделы акта'
        );

        if (!validation.valid) {
            return ValidationCore.failure('Добавьте хотя бы один раздел в акт');
        }

        return ValidationCore.success();
    }
};
