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
import { AppState, _unwrap } from './state-core.js';
import { Notifications } from '../../shared/notifications.js';

export const MetricsRiskCoordinator = {
    /**
     * Снимает таргетный snapshot ровно того, что каскад способен изменить
     * (см. metrics-risk-core.js и реализацию каскада в state-content/state-tree):
     *
     *  - children-массивы узлов §5-поддерева (unshift/filter сводных таблиц,
     *    удаление риск-узла на любой глубине) — shallow-slice по ссылкам;
     *  - label/customLabel узлов §5-поддерева (updateMetricsTableLabel
     *    переписывает метки сводных);
     *  - number узлов §5-поддерева (перенумерация generateNumbering; вне §5
     *    номера каскадом не меняются — структурные правки локализованы в §5);
     *  - словарь AppState.tables — shallow-копия записей (каскад добавляет
     *    и удаляет записи, существующие объекты таблиц in-place не мутирует).
     *
     * В отличие от прежней полной JSON-копии (§5 целиком + ВСЕ таблицы
     * поячеечно) — ни одной deep-копии: rollback возвращает исходные объекты
     * по ссылкам, нетронутые узлы сохраняют ссылочную идентичность
     * (закреплено tests/js/metrics-risk-rollback.test.mjs).
     * @private
     * @returns {{rollback: function}}
     */
    _snapshotSection5() {
        if (typeof AppState === 'undefined' || !AppState.treeData) {
            return {rollback: () => {}};
        }
        const node5 = _unwrap(AppState.findNodeById?.('5'));

        // Пер-узловые shallow-записи §5-поддерева (raw-узлы, без Proxy).
        const records = [];
        const collect = (node) => {
            records.push({
                node,
                hasChildren: node.children !== undefined,
                children: node.children ? node.children.map(c => _unwrap(c)) : null,
                label: node.label,
                hasCustomLabel: Object.prototype.hasOwnProperty.call(node, 'customLabel'),
                customLabel: node.customLabel,
                hasNumber: Object.prototype.hasOwnProperty.call(node, 'number'),
                number: node.number,
            });
            if (node.children) {
                for (const child of node.children) collect(_unwrap(child));
            }
        };
        if (node5) collect(node5);

        const rawTables = _unwrap(AppState.tables);
        const tablesSnapshot = rawTables ? {...rawTables} : null;

        return {
            rollback: () => {
                for (const rec of records) {
                    const n = rec.node;
                    if (rec.hasChildren) {
                        if (!this._sameChildren(n.children, rec.children)) {
                            n.children = rec.children;
                        }
                    } else if (n.children !== undefined) {
                        delete n.children;
                    }
                    if (n.label !== rec.label) n.label = rec.label;
                    if (rec.hasCustomLabel) {
                        if (n.customLabel !== rec.customLabel) n.customLabel = rec.customLabel;
                    } else if ('customLabel' in n) {
                        delete n.customLabel;
                    }
                    if (rec.hasNumber) {
                        if (n.number !== rec.number) n.number = rec.number;
                    } else if ('number' in n) {
                        delete n.number;
                    }
                }
                if (tablesSnapshot && !this._sameTables(_unwrap(AppState.tables), tablesSnapshot)) {
                    AppState.tables = tablesSnapshot;
                }
                // Membership узлов могло поменяться (удалённый риск-узел вернулся,
                // созданные каскадом сводные выпали) — перестраиваем индекс id→node.
                AppState._rebuildNodeIndex?.();
            }
        };
    },

    /**
     * Поэлементное сравнение children с сохранённым slice'ом (по raw-ссылкам).
     * Совпадение — массив не трогаем (сохраняем ссылочную идентичность).
     * @private
     * @param {Array|undefined} current - Текущий children-массив узла.
     * @param {Array} saved - Сохранённый slice.
     * @returns {boolean}
     */
    _sameChildren(current, saved) {
        if (!Array.isArray(current) || current.length !== saved.length) return false;
        for (let i = 0; i < saved.length; i++) {
            if (_unwrap(current[i]) !== saved[i]) return false;
        }
        return true;
    },

    /**
     * Сравнение словарей таблиц по составу записей (значения — по ссылкам).
     * @private
     * @param {Object|null} current - Текущий AppState.tables (raw).
     * @param {Object} saved - Снимок словаря.
     * @returns {boolean}
     */
    _sameTables(current, saved) {
        if (!current) return false;
        const currentKeys = Object.keys(current);
        const savedKeys = Object.keys(saved);
        if (currentKeys.length !== savedKeys.length) return false;
        for (const key of savedKeys) {
            if (_unwrap(current[key]) !== saved[key]) return false;
        }
        return true;
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
