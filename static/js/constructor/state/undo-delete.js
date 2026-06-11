/**
 * Откат удалений блоков дерева (решение Б-4: только undo для delete,
 * не полный command-stack).
 *
 * Чистое ядро (buildDeletionSnapshot / collectDictEntries) + менеджер
 * UndoDeleteManager со стеком LIFO глубиной 20.
 *
 * Жизненный цикл снимка:
 *  - AppState.deleteNode зовёт captureDeletion(nodeId) ДО фактического
 *    удаления (снимок строится по raw-узлам, без Proxy);
 *  - после успешного удаления deleteNode зовёт commit(snapshot) — снимок
 *    попадает в стек. Если каскад metrics↔risk откатил удаление
 *    (rollback фасада), commit не вызывается — стек не засоряется;
 *  - undoLast() восстанавливает последний удалённый блок.
 *
 * Два вида снимков:
 *  - 'node' — обычный узел: deep-копия поддерева + индекс в родителе +
 *    записи словарей (tables/textBlocks/violations) всех листьев поддерева
 *    (обход по реестру block-types: idProp/dictName);
 *  - 'section5' — удаление затрагивает риск-таблицы под разделом 5:
 *    каскад может снести сводные таблицы в ДРУГИХ узлах §5, поэтому
 *    снимается полный кластер — deep-копия children узла «5» + записи
 *    словарей всего §5-поддерева. Восстановление возвращает риск и
 *    сводные атомарно, без повторного запуска каскада (состояние до
 *    удаления уже консистентно).
 *
 * Решение «родитель удалён»: ОТКАЗ с понятным уведомлением (снимок
 * выбрасывается). LIFO-порядок сам по себе восстанавливает родителя
 * раньше ребёнка (родителя удалили позже — он выше в стеке), поэтому
 * отказ возможен только в вырожденных случаях (вытеснение по глубине 20).
 *
 * Восстановление идёт через официальные мутаторы AppState
 * (insertNodeAt + словарные присваивания через tracked-Proxy), поэтому
 * _nodeIndex/_parentIndex и dirty-tracking остаются консистентными.
 * Рендереры (treeManager/ItemsRenderer/PreviewManager) вызываются через
 * window-глобалы с optional chaining: state-слой не импортирует
 * DOM-тяжёлые модули, а в node-тестах глобалов нет — рендер пропускается.
 */
import { ChangelogTracker } from '../changelog-tracker.js';
import { AppState, _unwrap } from './state-core.js';
import { MetricsRiskCoordinator } from './metrics-risk-coordinator.js';
import { TreeUtils } from '../tree/tree-utils.js';
import { getBlockType } from '../block-types.js';
import { AppConfig } from '../../shared/app-config.js';
import { Notifications } from '../../shared/notifications.js';

/** Максимальная глубина стека отката (LIFO, старые вытесняются). */
export const UNDO_STACK_DEPTH = 20;

/** Длительность toast'а с кнопкой «Отменить», мс. */
export const UNDO_TOAST_DURATION_MS = 9000;

/**
 * Deep-копия plain-данных снимка. Узлы дерева и записи словарей —
 * JSON-сериализуемые объекты (они и так уходят на бэкенд через exportData).
 * @param {*} value - Копируемое значение
 * @returns {*} Глубокая копия
 */
function deepCopy(value) {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

/**
 * Собирает записи словарей (tables/textBlocks/violations) для всех
 * листьев-блоков поддерева. Обход по реестру block-types: idProp/dictName.
 *
 * Чистая функция: читает raw-узлы и raw-словари, возвращает deep-копии.
 *
 * @param {Object} rawNode - Raw-корень поддерева
 * @param {Object} rawDicts - Сырые словари {tables, textBlocks, violations}
 * @returns {Object} Словарь dictName → {id: deep-копия записи}
 */
export function collectDictEntries(rawNode, rawDicts) {
    const result = {};
    const walk = (n) => {
        const spec = n.type ? getBlockType(n.type) : null;
        if (spec?.idProp && spec.dictName) {
            const contentId = n[spec.idProp];
            const dict = rawDicts[spec.dictName];
            const entry = contentId && dict ? _unwrap(dict[contentId]) : null;
            if (entry) {
                if (!result[spec.dictName]) result[spec.dictName] = {};
                result[spec.dictName][contentId] = deepCopy(entry);
            }
        }
        (n.children || []).forEach(child => walk(_unwrap(child)));
    };
    walk(_unwrap(rawNode));
    return result;
}

/**
 * Строит снимок удаления (чистое ядро, без побочных эффектов).
 *
 * @param {Object} params - Параметры снимка
 * @param {Object} params.rawNode - Raw-узел, который будет удалён (с поддеревом)
 * @param {string} params.parentId - ID родителя
 * @param {number} params.index - Индекс узла в children родителя
 * @param {Object} params.rawDicts - Сырые словари {tables, textBlocks, violations}
 * @param {Object|null} [params.rawNode5] - Raw-узел «5», если удаление затрагивает
 *        риск-таблицы под §5 (включает каскадный снос сводных) — снимается
 *        полный §5-кластер
 * @returns {Object} Снимок для стека отката
 */
export function buildDeletionSnapshot({rawNode, parentId, index, rawDicts, rawNode5 = null}) {
    const snapshot = {
        kind: rawNode5 ? 'section5' : 'node',
        nodeId: rawNode.id,
        label: rawNode.label || '',
        parentId,
        index,
        node: deepCopy(rawNode),
        dicts: collectDictEntries(rawNode, rawDicts),
    };

    if (rawNode5) {
        // Каскад способен снести сводные таблицы в других узлах §5 —
        // снимаем кластер целиком (children узла «5» + словари §5-поддерева).
        snapshot.section5Children = (rawNode5.children || []).map(c => deepCopy(_unwrap(c)));
        snapshot.dicts = collectDictEntries(rawNode5, rawDicts);
    }

    return snapshot;
}

export const UndoDeleteManager = {
    /** @type {Array<Object>} Стек снимков удалений (LIFO). */
    _stack: [],

    /** @type {boolean} Hotkey Ctrl+Z уже установлен. */
    _hotkeyInstalled: false,

    /**
     * Есть ли что откатывать.
     * @returns {boolean}
     */
    canUndo() {
        return this._stack.length > 0;
    },

    /**
     * Очищает стек отката. Вызывается при переключении/загрузке акта
     * (resetForActSwitch) — снимки принадлежат покидаемому акту.
     */
    clear() {
        this._stack.length = 0;
    },

    /**
     * Строит снимок удаления ПЕРЕД фактическим удалением узла.
     * НЕ кладёт снимок в стек — это делает commit() после того, как
     * deleteNode убедился, что удаление реально произошло (каскад
     * metrics↔risk мог откатить его целиком).
     *
     * @param {string} nodeId - ID удаляемого узла
     * @returns {Object|null} Снимок или null (узел/родитель не найдены)
     */
    captureDeletion(nodeId) {
        const rawNode = AppState._findNodeRaw?.(nodeId);
        if (!rawNode) return null;

        const rawParent = AppState._findParentRaw?.(nodeId);
        if (!rawParent?.children) return null;

        const index = rawParent.children.findIndex(c => _unwrap(c).id === nodeId);
        if (index === -1) return null;

        const rawDicts = {
            tables: _unwrap(AppState.tables) || {},
            textBlocks: _unwrap(AppState.textBlocks) || {},
            violations: _unwrap(AppState.violations) || {},
        };

        // Удаление риск-таблицы (или поддерева с риск-таблицами) запускает
        // каскад, способный снести сводные в других узлах §5 — снимаем
        // полный §5-кластер.
        const touchesRisk = TreeUtils.findRiskTables(rawNode, {firstOnly: true}).length > 0;
        const rawNode5 = touchesRisk ? AppState._findNodeRaw?.('5') : null;

        return buildDeletionSnapshot({rawNode, parentId: rawParent.id, index, rawDicts, rawNode5});
    },

    /**
     * Кладёт снимок в стек (LIFO, глубина UNDO_STACK_DEPTH).
     * @param {Object|null} snapshot - Снимок из captureDeletion
     */
    commit(snapshot) {
        if (!snapshot) return;
        this._stack.push(snapshot);
        while (this._stack.length > UNDO_STACK_DEPTH) {
            this._stack.shift();
        }
    },

    /**
     * Откатывает ПОСЛЕДНЕЕ удаление: записи словарей обратно, поддерево
     * в родителя по сохранённому индексу (clamp по pinned-инварианту и
     * длине children внутри insertNodeAt), перенумерация, полный рендер.
     *
     * @returns {boolean} true — восстановление выполнено
     */
    undoLast() {
        if (AppConfig.readOnlyMode?.isReadOnly) {
            Notifications.warning('Отмена удаления недоступна в режиме просмотра');
            return false;
        }
        if (!this.canUndo()) return false;

        const snapshot = this._stack.pop();

        // Узел уже в дереве (например, откат каскада вернул его сам) —
        // восстанавливать нечего, снимок выбрасывается.
        if (AppState._findNodeRaw?.(snapshot.nodeId)) {
            Notifications.info('Элемент уже восстановлен');
            return false;
        }

        const restored = snapshot.kind === 'section5'
            ? this._restoreSection5(snapshot)
            : this._restoreNode(snapshot);

        if (!restored) return false;

        AppState.generateNumbering();

        if (typeof ChangelogTracker !== 'undefined') {
            ChangelogTracker.record('undo_delete', snapshot.nodeId, snapshot.label, {parentId: snapshot.parentId});
        }

        this._renderAfterRestore();
        Notifications.success('Удаление отменено');
        return true;
    },

    /**
     * Восстанавливает обычный узел через официальный мутатор insertNodeAt.
     * @private
     * @param {Object} snapshot - Снимок вида 'node'
     * @returns {boolean}
     */
    _restoreNode(snapshot) {
        if (!AppState._findNodeRaw?.(snapshot.parentId)) {
            // Решение Б-4: при удалённом родителе — отказ (см. шапку модуля).
            Notifications.error('Не удалось отменить удаление: родительский элемент тоже удалён');
            return false;
        }

        this._restoreDictEntries(snapshot.dicts);

        const result = AppState.insertNodeAt(snapshot.parentId, snapshot.node, snapshot.index);
        if (!result.valid) {
            Notifications.error(result.message || 'Не удалось отменить удаление');
            return false;
        }

        // Защитная реконсиляция каскада: если в восстановленном поддереве
        // есть риск-таблицы (в норме такие удаления идут через 'section5'),
        // сводные пересчитываются фасадом — как при создании риск-таблиц.
        if (TreeUtils.findRiskTables(snapshot.node, {firstOnly: true}).length > 0) {
            MetricsRiskCoordinator.onRiskTableAdded(snapshot.node.id);
        }

        return true;
    },

    /**
     * Восстанавливает §5-кластер целиком: children узла «5» заменяются
     * снимком (риск + сводные возвращаются атомарно), недостающие записи
     * словарей возвращаются. Повторный каскад не нужен — снимок снят до
     * удаления, состояние уже консистентно.
     * @private
     * @param {Object} snapshot - Снимок вида 'section5'
     * @returns {boolean}
     */
    _restoreSection5(snapshot) {
        const node5 = AppState.findNodeById('5');
        if (!node5) {
            Notifications.error('Не удалось отменить удаление: раздел 5 не найден');
            return false;
        }

        this._restoreDictEntries(snapshot.dicts);

        // Замена через tracked-узел — dirty-tracking ловит присваивание.
        node5.children = snapshot.section5Children;
        // Membership §5 сменился по ссылкам целиком — полный rebuild индекса.
        AppState._rebuildNodeIndex?.();

        return true;
    },

    /**
     * Возвращает записи словарей из снимка. Только отсутствующие id —
     * живые записи (не тронутые удалением) не перезаписываются.
     * @private
     * @param {Object} dicts - Снимок словарей dictName → {id: запись}
     */
    _restoreDictEntries(dicts) {
        for (const [dictName, entries] of Object.entries(dicts || {})) {
            const target = AppState[dictName];
            if (!target) continue;
            for (const [id, entry] of Object.entries(entries)) {
                if (!_unwrap(target)[id]) {
                    target[id] = entry;
                }
            }
        }
    },

    /**
     * Полный рендер после восстановления (редкая операция — полный рендер
     * честнее точечного). Доступ через window-глобалы: state-слой не
     * импортирует рендереры, в node-тестах глобалов нет.
     * @private
     */
    _renderAfterRestore() {
        window.treeManager?.render?.();
        if (AppState.currentStep === 2) {
            window.ItemsRenderer?.renderAll?.();
        }
        window.PreviewManager?.update?.('previewTrim', 30);
    },

    /**
     * Показывает toast «Элемент удалён» с кнопкой «Отменить» (8-10 сек).
     * В read-only или при пустом стеке — обычное info без кнопки.
     */
    showDeletedToast() {
        if (AppConfig.readOnlyMode?.isReadOnly || !this.canUndo()) {
            Notifications.info('Элемент удалён');
            return;
        }
        Notifications.show('Элемент удалён', 'info', UNDO_TOAST_DURATION_MS, {
            action: {
                label: 'Отменить',
                onClick: () => this.undoLast(),
            },
        });
    },

    /**
     * Устанавливает глобальный hotkey Ctrl+Z (capture-фаза).
     * Внутри активных редакторов (contenteditable/textarea/input/select)
     * живёт браузерный undo — не перехватываем.
     */
    installHotkey() {
        if (this._hotkeyInstalled) return;
        this._hotkeyInstalled = true;

        document.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyZ' || e.shiftKey || e.altKey) return;
            if (this._isEditableTarget(document.activeElement)) return;
            if (AppConfig.readOnlyMode?.isReadOnly) return;
            if (!this.canUndo()) return;

            e.preventDefault();
            e.stopPropagation();
            this.undoLast();
        }, true);
    },

    /**
     * Активный элемент — текстовый редактор (там живёт браузерный undo).
     * @private
     * @param {Element|null} el - document.activeElement
     * @returns {boolean}
     */
    _isEditableTarget(el) {
        if (!el) return false;
        if (el.isContentEditable) return true;
        return ['TEXTAREA', 'INPUT', 'SELECT'].includes(el.tagName);
    },
};

// Window-global для совместимости с inline-скриптами в шаблонах.
window.UndoDeleteManager = UndoDeleteManager;
