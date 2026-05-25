/**
 * MetricsRiskCoordinator — фасад над каскадной логикой metrics ↔ risk-таблиц.
 *
 * E-3 (краткая версия): полная экстракция reconcile-логики из state-content.js /
 * state-tree.js / context-menu-tree.js / tree-drag-drop.js признана высокорисковой
 * без покрытия e2e (5+ инвариантов: «metrics на 5.X ⇔ deep risks», «main metrics на
 * §5 ⇔ any risks», «5.X-only OR 5.X.Y-only», ...). Документ ver-3-tree-isolation §F-9
 * прямо предупреждает: «оправдана только если бизнес добавит ещё каскады. Сейчас
 * работает — не трогать без триггера».
 *
 * Эта версия — тонкий фасад: делегирует на существующие методы AppState,
 * предоставляя seam для будущей экстракции и единую точку API для вызовов
 * из context-menu / drag-drop / тестов. Полный перенос — отдельная веха (TODO в отчёте).
 */
const MetricsRiskCoordinator = {
    /**
     * Хук «риск-таблица добавлена». Создаёт metrics на 5.X (если risk на 5.X.Y+)
     * и main metrics в §5.
     * @param {string} nodeId - ID узла, в который добавлена risk-таблица.
     */
    onRiskTableAdded(nodeId) {
        AppState._updateMetricsTablesAfterRiskTableCreated(nodeId);
    },

    /**
     * Хук «риск-таблица удалена». Реконсилит metrics во всём §5 (функция работает
     * глобально, удалённый nodeId уже не нужен — см. M7).
     */
    onRiskTableRemoved() {
        AppState._cleanupMetricsTablesAfterRiskTableDeleted();
    },

    /**
     * Хук «поддерево перемещено внутри §5». Пересчитывает metrics для старого
     * и нового предка 5.X.
     * @param {Object} draggedNode - Перемещённый узел.
     * @param {Object|null} oldAncestor5x - Предок 5.X до перемещения.
     */
    onSubtreeMoved(draggedNode, oldAncestor5x) {
        AppState._reconcileMetricsTablesAfterMove(draggedNode, oldAncestor5x);
    },

    /**
     * Проверка: можно ли добавить риск-таблицу в указанный узел.
     * Возвращает {allowed: bool, reason?: string}.
     *
     * Делегирует на TreeContextMenu-инстанс (логика 6 предикатов уровней 5.X/5.X.Y
     * исторически живёт там). Если меню ещё не инициализировано — fallback на
     * базовую проверку «узел под §5 и item».
     *
     * @param {Object} node - Узел-кандидат.
     * @returns {{allowed: boolean, reason?: string}}
     */
    validateAddRiskTable(node) {
        const menu = window.ContextMenuManager?.treeMenu;
        if (menu && typeof menu._isRiskTableAllowedForNode === 'function') {
            const allowed = menu._isRiskTableAllowedForNode(node);
            if (!allowed && typeof menu._getRiskTableBlockReason === 'function') {
                return {allowed: false, reason: menu._getRiskTableBlockReason(node)};
            }
            return {allowed};
        }
        // Fallback (минимальная проверка)
        const isItem = !node.type || node.type === AppConfig.nodeTypes.ITEM;
        const under5 = node.number && /^5\.\d+/.test(node.number);
        return {allowed: !!(isItem && under5)};
    }
};

window.MetricsRiskCoordinator = MetricsRiskCoordinator;
