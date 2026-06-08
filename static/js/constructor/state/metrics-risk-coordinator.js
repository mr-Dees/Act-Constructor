/**
 * MetricsRiskCoordinator — фасад над каскадной логикой metrics ↔ risk-таблиц.
 *
 * АРХИТЕКТУРНОЕ РЕШЕНИЕ: полная экстракция reconcile-логики из state-content.js /
 * state-tree.js / context-menu-tree.js / tree-drag-drop.js признана **сознательно
 * нежелательной** на текущий момент. Причины:
 *
 *  1. Reconcile использует AppState.tables / treeData / findNodeById / setNodeTb
 *     ссылочно. Чистая экстракция требует либо параметризации (вся AppState
 *     передаётся внутрь), либо переноса всех методов на coordinator с глобальным
 *     доступом к AppState — оба варианта дают тот же объём, но в другом файле.
 *  2. Фасад УЖЕ обеспечивает безопасность: snapshot/rollback в `_withSnapshot`
 *     ловит исключение в любом из 3 хуков (added/removed/moved) и откатывает
 *     §5 + AppState.tables целиком — partial-state невозможен.
 *  3. Каскадные инварианты (5+) не покрыты e2e. Перетасовка кода без
 *     поведенческого покрытия — высокий риск регрессий.
 *
 * Триггер для пересмотра: бизнес добавляет четвёртый каскад (например,
 * metrics ↔ violations или metrics ↔ invoice) — тогда экстракция становится
 * необходимостью, а написание e2e под это становится оправданным.
 *
 * Что даёт фасад поверх делегации в текущем виде:
 *
 * 1) Единая точка для callsite'ов (context-menu / state-tree.deleteNode /
 *    state-tree.moveNode / state-content.deleteTableFromNode) — раньше часть
 *    обходила coordinator и звала AppState._...AfterRiskTableDeleted напрямую.
 *
 * 2) Snapshot/rollback safety: каждый хук обёрнут в _withSnapshot, который
 *    делает поверхностный snapshot затронутых частей дерева и откатывается,
 *    если внутренний шаг бросил исключение. Закрывает основную дыру D3
 *    из constructor-domain-audit.md: «при прерывании операции возможен
 *    partial-state».
 *
 * 3) Seam для будущей экстракции / юнит-тестов: тесты могут заменять методы
 *    AppState mock'ами и проверять coordinator в изоляции.
 */
import { AppState } from './state-core.js';
import { Notifications } from '../../shared/notifications.js';

export const MetricsRiskCoordinator = {
    /**
     * Снимает поверхностный snapshot частей дерева, которые могут быть затронуты
     * каскадом: §5 (главная сводная таблица) и поддеревья 5.X (per-section
     * сводные). Возвращает функцию rollback(), которая восстанавливает узлы.
     *
     * Используется shallow JSON-копия — каскад модифицирует только children
     * и table-данные ссылочно, поэтому snapshot небольшой (десятки KB).
     * @private
     * @returns {{rollback: function}}
     */
    _snapshotSection5() {
        if (typeof AppState === 'undefined' || !AppState.treeData) {
            return {rollback: () => {}};
        }
        const node5 = AppState.findNodeById?.('5');
        const tables5 = node5 ? JSON.parse(JSON.stringify(node5.children || [])) : null;
        // Сохраняем также таблицы (AppState.tables) — каскад может удалять
        // metrics-таблицы через delete this.tables[id].
        const tablesCopy = AppState.tables ? JSON.parse(JSON.stringify(AppState.tables)) : null;
        return {
            rollback: () => {
                if (node5 && tables5) node5.children = tables5;
                if (tablesCopy) AppState.tables = tablesCopy;
            }
        };
    },

    /**
     * Обёртка: snapshot → fn() → on error: rollback + log + Notifications.error.
     * Возвращает true при успехе, false при rollback'е.
     * @private
     * @param {string} hookName - Имя хука для логирования.
     * @param {Function} fn - Внутренняя операция каскада.
     * @returns {boolean}
     */
    _withSnapshot(hookName, fn) {
        const snap = this._snapshotSection5();
        try {
            fn();
            return true;
        } catch (err) {
            console.error(`MetricsRiskCoordinator.${hookName} failed, откатываем snapshot:`, err);
            snap.rollback();
            if (typeof Notifications !== 'undefined' && Notifications.error) {
                Notifications.error('Ошибка обновления сводных таблиц метрик — изменения откачены');
            }
            return false;
        }
    },

    /**
     * Хук «риск-таблица добавлена». Создаёт metrics на 5.X (если risk на 5.X.Y+)
     * и main metrics в §5.
     * @param {string} nodeId - ID узла, в который добавлена risk-таблица.
     * @returns {boolean} true при успехе, false если был rollback.
     */
    onRiskTableAdded(nodeId) {
        return this._withSnapshot('onRiskTableAdded', () => {
            AppState._updateMetricsTablesAfterRiskTableCreated(nodeId);
        });
    },

    /**
     * Хук «риск-таблица удалена». Реконсилит metrics во всём §5 (функция работает
     * глобально, удалённый nodeId уже не нужен — см. M7).
     *
     * Используется для путей, где риск-узел уже удалён ДО входа в хук
     * (например, каскадное удаление потомков). Snapshot покрывает только §5 и
     * tables. Для удаления самого риск-узла используй
     * onRiskTableRemovedWithDeletion — оно покрывает и удаление узла (D1).
     * @returns {boolean} true при успехе, false если был rollback.
     */
    onRiskTableRemoved() {
        return this._withSnapshot('onRiskTableRemoved', () => {
            AppState._cleanupMetricsTablesAfterRiskTableDeleted();
        });
    },

    /**
     * D1: удаление риск-узла под ЕДИНЫМ snapshot'ом.
     *
     * Snapshot §5 снимается ДО deleteFn() (фактического удаления риск-узла),
     * поэтому при исключении в reconcile откат восстанавливает ПОЛНОЕ состояние,
     * включая удалённый риск-узел. Это закрывает дыру partial-state, когда
     * snapshot снимался уже после удаления узла (rollback не возвращал риск-узел,
     * а сводная без своего риска становилась неудаляемой).
     *
     * @param {Function} deleteFn - Фактическое удаление риск-узла из дерева/tables.
     * @returns {boolean} true при успехе, false если был rollback.
     */
    onRiskTableRemovedWithDeletion(deleteFn) {
        return this._withSnapshot('onRiskTableRemovedWithDeletion', () => {
            deleteFn();
            AppState._cleanupMetricsTablesAfterRiskTableDeleted();
        });
    },

    /**
     * Хук «поддерево перемещено внутри §5». Пересчитывает metrics для старого
     * и нового предка 5.X.
     * @param {Object} draggedNode - Перемещённый узел.
     * @param {Object|null} oldAncestor5x - Предок 5.X до перемещения.
     * @returns {boolean} true при успехе, false если был rollback.
     */
    onSubtreeMoved(draggedNode, oldAncestor5x) {
        return this._withSnapshot('onSubtreeMoved', () => {
            AppState._reconcileMetricsTablesAfterMove(draggedNode, oldAncestor5x);
        });
    }
};

window.MetricsRiskCoordinator = MetricsRiskCoordinator;
