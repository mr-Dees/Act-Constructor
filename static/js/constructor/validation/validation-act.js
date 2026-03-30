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
    },

    /**
     * Проверяет наличие назначенных ТБ для leaf-узлов раздела 5
     * @returns {Object} Результат валидации с полями valid, message, isWarning
     */
    validateTb() {
        // Находим раздел 5
        const section5 = (AppState.treeData?.children || []).find(
            c => c.number && c.number === '5'
        );
        if (!section5?.children?.length) return ValidationCore.success();

        // Собираем leaf-узлы без назначенного ТБ
        const missingTb = [];
        const collectMissing = (node) => {
            if (TreeUtils.isUnderSection5(node)) {
                if (TreeUtils.isTbLeaf(node) && (!node.tb || node.tb.length === 0)) {
                    const name = node.number ? `${node.number}. ${node.label}` : node.label;
                    missingTb.push(`- ${name}`);
                }
            }
            (node.children || []).forEach(c => collectMissing(c));
        };
        section5.children.forEach(c => collectMissing(c));

        if (missingTb.length > 0) {
            return ValidationCore.warning(
                `Не назначен ТБ для пунктов:\n${missingTb.join('\n')}\nВы можете продолжить сохранение.`
            );
        }

        return ValidationCore.success();
    }
};
