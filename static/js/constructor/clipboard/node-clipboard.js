/**
 * Копирование узлов/поддеревьев между актами и внутри акта (§7).
 *
 * Транспорт — localStorage (КП-1): один ключ-буфер, работает между вкладками
 * одного origin. В буфер кладётся deep-копия копируемого поддерева, записи
 * словарей (tables/textBlocks/violations) всех листьев-блоков, версия формата
 * и act_id источника.
 *
 * При вставке (КП-2) все id регенерируются и внутренние ссылки переписываются:
 * id узлов, поля-ссылки на словари (tableId/textBlockId/violationId) и ключи
 * самих словарей. Записи словарей копируются в целевой акт с НОВЫМИ id —
 * никаких коллизий и сирот (бэк-кросс-валидатор дерево↔словари вернул бы 422).
 *
 * Ограничения вставки:
 *  - КП-3: защищённые секции 1–5 и закреплённые таблицы (metrics/risk) нельзя
 *    копировать как корень выделения; pinned-дети внутри поддерева пропускаются;
 *  - КП-4: invoice-привязки сбрасываются (фактура принадлежит акту/узлу);
 *  - КП-5: картинки (inline base64) копируются как есть, при вставке —
 *    проверка лимита суммарного размера картинок целевого акта;
 *  - КП-6: вставка через штатную валидацию (ValidationTree.canAddChild/maxDepth)
 *    и официальный мутатор insertNodeAt (позиция — после pinned-таблиц).
 *
 * Чистое ядро (serialize/regenerate/filter/reset/limits) — без DOM и без
 * AppState-зависимостей, покрыто юнит-тестами. Оркестрация (copyNode/pasteInto)
 * ходит через AppState и официальные мутаторы. Установка шортката Ctrl+C/Ctrl+V
 * и пунктов меню — side-effect (installHotkey/installMenuItems из entry).
 */

import { AppState, _unwrap } from '../state/state-core.js';
import { TreeUtils } from '../tree/tree-utils.js';
import { ValidationTree } from '../validation/validation-tree.js';
import { getBlockType, isLeafBlockType } from '../block-types.js';
import { isPinnedTable } from '../table/table-kind.js';
import { AppConfig } from '../../shared/app-config.js';
import { Notifications } from '../../shared/notifications.js';
import {
    estimateActImageBytes,
    estimateDataUrlBytes,
    getImageLimits,
} from '../violation/violation-image-validator.js';
import { CONTENT_TYPE_IMAGE } from '../violation/violation-content-item.js';

/** Версия формата буфера. Несовпадение → буфер игнорируется. */
export const CLIPBOARD_FORMAT_VERSION = 1;

/** Ключ буфера в localStorage (один на origin, общий между вкладками). */
export const CLIPBOARD_STORAGE_KEY = 'constructor:clipboard';

/**
 * Deep-копия plain-данных (узлы/словари JSON-сериализуемы — они и так уходят
 * на бэкенд через exportData).
 * @param {*} value
 * @returns {*}
 */
function deepCopy(value) {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

/**
 * Сериализует поддерево узла в payload буфера: deep-копия узла + записи
 * словарей всех листьев-блоков поддерева. Чистая функция: читает raw-узлы и
 * raw-словари, возвращает новые объекты.
 *
 * @param {Object} rawNode - Raw-корень копируемого поддерева
 * @param {Object} rawDicts - Сырые словари {tables, textBlocks, violations}
 * @param {string|number|null} sourceActId - act_id источника (для справки)
 * @returns {Object} Payload буфера
 */
export function serializeSubtree(rawNode, rawDicts, sourceActId = null) {
    const dicts = {};
    const walk = (n) => {
        const spec = n.type ? getBlockType(n.type) : null;
        if (spec?.idProp && spec.dictName) {
            const contentId = n[spec.idProp];
            const dict = rawDicts[spec.dictName];
            const entry = contentId && dict ? _unwrap(dict[contentId]) : null;
            if (entry) {
                if (!dicts[spec.dictName]) dicts[spec.dictName] = {};
                dicts[spec.dictName][contentId] = deepCopy(entry);
            }
        }
        (n.children || []).forEach(child => walk(_unwrap(child)));
    };
    walk(_unwrap(rawNode));

    return {
        version: CLIPBOARD_FORMAT_VERSION,
        sourceActId: sourceActId ?? null,
        node: deepCopy(_unwrap(rawNode)),
        dicts,
    };
}

/**
 * Фильтрует поддерево от закреплённых таблиц (pinned: metrics/risk). КП-3:
 * pinned-таблицы при вставке пропускаются. Возвращает новое дерево (deep-копию)
 * без pinned-узлов и флаг, были ли что-то отброшено.
 *
 * Корень не проверяется (его проверяет caller перед вызовом — pinned/protected
 * нельзя копировать как корень выделения). Применяется к детям рекурсивно.
 *
 * @param {Object} node - Узел (будет скопирован)
 * @returns {{node: Object, skippedPinned: boolean}}
 */
export function filterPinnedFromSubtree(node) {
    let skippedPinned = false;

    const clone = (n) => {
        const copy = { ...n };
        if (Array.isArray(n.children)) {
            copy.children = [];
            for (const child of n.children) {
                if (isPinnedTable(child)) {
                    skippedPinned = true;
                    continue;
                }
                copy.children.push(clone(child));
            }
        }
        return copy;
    };

    return { node: clone(deepCopy(node)), skippedPinned };
}

/**
 * Сбрасывает invoice-привязки во всём поддереве (КП-4). Фактура принадлежит
 * конкретному акту/узлу и при копировании не переносится. Мутирует переданное
 * (уже скопированное) дерево.
 *
 * @param {Object} node - Узел (мутируется)
 */
export function resetInvoices(node) {
    if (node.invoice) delete node.invoice;
    if (Array.isArray(node.children)) {
        for (const child of node.children) resetInvoices(child);
    }
}

/**
 * Регенерирует все id поддерева и записей словарей + remap ссылок (КП-2).
 *
 * - id каждого узла → новый (генератор передаётся, чтобы соответствовать
 *   конвенциям проекта — AppState._generateId);
 * - поля-ссылки на словари (tableId/textBlockId/violationId) → новые id;
 * - ключи копий словарей → новые id; entry.id и entry.nodeId — синхронно.
 *
 * Чистая функция: принимает payload (как из буфера), возвращает новое дерево
 * и новые словари, ничего не мутирует во входе.
 *
 * @param {Object} payload - {node, dicts}
 * @param {{genNodeId: Function, genContentId: Function}} gens - Генераторы id.
 *        genNodeId(node) → новый id узла; genContentId(type) → новый id контента.
 * @returns {{node: Object, dicts: Object}} Поддерево и словари с новыми id
 */
export function regenerateIds(payload, gens) {
    const { genNodeId, genContentId } = gens;
    const srcNode = deepCopy(payload.node);
    const srcDicts = deepCopy(payload.dicts || {});

    // Маппинг старый contentId → новый contentId (по dictName).
    const contentIdMap = {};
    const newDicts = {};

    const walk = (n, parentId) => {
        const newNodeId = genNodeId(n);
        n.id = newNodeId;
        if (parentId !== null && 'parentId' in n) {
            n.parentId = parentId;
        }

        // Листовой блок: регенерируем ссылку на словарь и переносим запись.
        if (n.type && isLeafBlockType(n.type)) {
            const spec = getBlockType(n.type);
            const oldContentId = n[spec.idProp];
            const dict = srcDicts[spec.dictName];
            const entry = oldContentId && dict ? dict[oldContentId] : null;
            if (entry) {
                const newContentId = genContentId(n.type);
                n[spec.idProp] = newContentId;
                contentIdMap[oldContentId] = newContentId;

                const newEntry = { ...entry, id: newContentId, nodeId: newNodeId };
                if (!newDicts[spec.dictName]) newDicts[spec.dictName] = {};
                newDicts[spec.dictName][newContentId] = newEntry;
            }
        }

        if (Array.isArray(n.children)) {
            for (const child of n.children) walk(child, newNodeId);
        }
    };
    walk(srcNode, null);

    return { node: srcNode, dicts: newDicts };
}

/**
 * Суммарный размер картинок (inline data-URL) в записях словаря violations
 * вставляемого поддерева. Зеркалит estimateActImageBytes, но для произвольного
 * набора нарушений (а не всего AppState.violations).
 *
 * @param {Object} violationsDict - Словарь нарушений {id: violation}
 * @returns {number} Размер в байтах
 */
export function estimatePastedImageBytes(violationsDict) {
    let total = 0;
    for (const violation of Object.values(violationsDict || {})) {
        const items = violation?.additionalContent?.items || [];
        for (const item of items) {
            if (item && item.type === CONTENT_TYPE_IMAGE && item.url) {
                total += estimateDataUrlBytes(item.url);
            }
        }
    }
    return total;
}

/**
 * Проверяет, не превысит ли вставка лимит суммарного размера картинок акта
 * (КП-5). Чистая функция.
 *
 * @param {number} existingBytes - Текущий размер картинок целевого акта
 * @param {number} pastedBytes - Размер картинок вставляемого поддерева
 * @param {number} maxTotalBytes - Лимит суммарного размера на акт
 * @returns {{ok: boolean, reason: string}}
 */
export function checkImageLimits(existingBytes, pastedBytes, maxTotalBytes) {
    if (existingBytes + pastedBytes > maxTotalBytes) {
        const fmt = (b) => (b / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
        return {
            ok: false,
            reason: `Вставка превысит лимит суммарного размера картинок акта `
                + `(${fmt(maxTotalBytes)} МБ). Скопированное поддерево не вставлено.`,
        };
    }
    return { ok: true, reason: '' };
}

export const NodeClipboard = {
    /** @type {boolean} Шорткат Ctrl+C/Ctrl+V уже установлен. */
    _hotkeyInstalled: false,

    /** @type {boolean} Пункты меню уже добавлены. */
    _menuInstalled: false,

    /**
     * Копирует узел (и его поддерево) в localStorage-буфер (КП-1).
     * Защищённые секции 1–5 и pinned-таблицы как корень выделения копировать
     * нельзя (КП-3). Копирование разрешено и в read-only.
     *
     * @param {string} nodeId - ID копируемого узла
     * @returns {boolean} true — скопировано
     */
    copyNode(nodeId) {
        const rawNode = AppState._findNodeRaw?.(nodeId);
        if (!rawNode) return false;

        if (rawNode.protected) {
            Notifications.error('Защищённые разделы нельзя копировать');
            return false;
        }
        if (isPinnedTable(rawNode)) {
            Notifications.error('Закреплённые таблицы (метрики/риски) нельзя копировать');
            return false;
        }

        const rawDicts = {
            tables: _unwrap(AppState.tables) || {},
            textBlocks: _unwrap(AppState.textBlocks) || {},
            violations: _unwrap(AppState.violations) || {},
        };
        const payload = serializeSubtree(rawNode, rawDicts, window.currentActId ?? null);

        try {
            localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(payload));
        } catch (_) {
            Notifications.error('Не удалось скопировать: переполнен буфер браузера');
            return false;
        }

        Notifications.success('Скопировано');
        return true;
    },

    /**
     * Читает payload из буфера. Возвращает null при пустом/битом/устаревшем
     * буфере.
     * @returns {Object|null}
     */
    readClipboard() {
        let raw;
        try {
            raw = localStorage.getItem(CLIPBOARD_STORAGE_KEY);
        } catch (_) {
            return null;
        }
        if (!raw) return null;

        let payload;
        try {
            payload = JSON.parse(raw);
        } catch (_) {
            return null;
        }
        if (!payload || payload.version !== CLIPBOARD_FORMAT_VERSION || !payload.node) {
            return null;
        }
        return payload;
    },

    /** Есть ли что вставлять. @returns {boolean} */
    canPaste() {
        return this.readClipboard() !== null;
    },

    /**
     * Вставляет содержимое буфера дочерним элементом целевого узла.
     * Регенерация id + remap (КП-2), фильтр pinned (КП-3), сброс invoice (КП-4),
     * проверка лимита картинок (КП-5), штатная валидация + insertNodeAt (КП-6).
     *
     * @param {string} targetNodeId - ID узла, в который вставляем (как дочерний)
     * @returns {boolean} true — вставлено
     */
    pasteInto(targetNodeId) {
        if (AppConfig.readOnlyMode?.isReadOnly) {
            Notifications.warning(AppConfig.readOnlyMode.messages.cannotModifyTree);
            return false;
        }

        const payload = this.readClipboard();
        if (!payload) {
            Notifications.info('Буфер пуст');
            return false;
        }

        const target = AppState.findNodeById(targetNodeId);
        if (!target) return false;

        // Нельзя вставлять внутрь листовых блоков (таблица/текстблок/нарушение).
        if (target.type && target.type !== AppConfig.nodeTypes.ITEM) {
            Notifications.error('Нельзя вставлять внутрь этого элемента');
            return false;
        }

        // КП-3: pinned-дети пропускаются (корень буфера уже проверен при копировании).
        const filtered = filterPinnedFromSubtree(payload.node);

        // КП-2: регенерация id и remap ссылок + перенос записей словарей.
        const regenerated = regenerateIds(
            { node: filtered.node, dicts: payload.dicts },
            {
                genNodeId: () => AppState._generateId('node'),
                genContentId: (type) => AppState._generateId(type),
            }
        );

        // КП-4: сброс invoice-привязок во всём вставляемом поддереве.
        resetInvoices(regenerated.node);

        // КП-6: штатная валидация глубины/возможности добавить ребёнка.
        const validation = ValidationTree.canAddChild(targetNodeId);
        if (!validation.valid) {
            Notifications.error(validation.message || 'Нельзя вставить сюда');
            return false;
        }
        // Дополнительно: суммарная глубина вставляемого поддерева не должна
        // превысить maxDepth (canAddChild проверяет только сам узел-корень).
        const targetDepth = TreeUtils.getNodeDepth(targetNodeId);
        const subtreeDepth = TreeUtils.getSubtreeDepth(regenerated.node);
        if (targetDepth + 1 + subtreeDepth > AppConfig.tree.maxDepth) {
            Notifications.error(
                `Вставка приведёт к превышению максимальной вложенности (${AppConfig.tree.maxDepth} уровней)`
            );
            return false;
        }

        // КП-5: лимит суммарного размера картинок целевого акта.
        const limits = getImageLimits();
        const existingBytes = estimateActImageBytes(_unwrap(AppState.violations) || {});
        const pastedBytes = estimatePastedImageBytes(regenerated.dicts.violations || {});
        const imgCheck = checkImageLimits(existingBytes, pastedBytes, limits.maxTotalSizePerAct);
        if (!imgCheck.ok) {
            Notifications.error(imgCheck.reason);
            return false;
        }

        // Переносим записи словарей в целевой акт (новые id — коллизий нет).
        for (const [dictName, entries] of Object.entries(regenerated.dicts)) {
            const dict = AppState[dictName];
            if (!dict) continue;
            for (const [id, entry] of Object.entries(entries)) {
                dict[id] = entry;
            }
        }

        // КП-6: вставка через официальный мутатор. Позиция — конец children;
        // insertNodeAt сам clamp'ит индекс по pinned-инварианту (_getFirstNonPinnedIndex)
        // и длине, поэтому узел встаёт после pinned-таблиц.
        const appendIndex = target.children ? target.children.length : 0;
        const result = AppState.insertNodeAt(targetNodeId, regenerated.node, appendIndex);
        if (!result.valid) {
            // Откат перенесённых записей словарей — узел не вставился.
            for (const [dictName, entries] of Object.entries(regenerated.dicts)) {
                const dict = AppState[dictName];
                if (!dict) continue;
                for (const id of Object.keys(entries)) delete dict[id];
            }
            Notifications.error(result.message || 'Не удалось вставить');
            return false;
        }

        AppState.generateNumbering();

        if (filtered.skippedPinned) {
            Notifications.warning('Закреплённые таблицы (метрики/риски) при вставке пропущены');
        } else {
            Notifications.success('Вставлено');
        }

        this._renderAfterPaste(targetNodeId);
        return true;
    },

    /**
     * Полный/точечный рендер после вставки. Доступ через window-глобалы:
     * clipboard-слой не импортирует DOM-тяжёлые рендереры, в node-тестах
     * глобалов нет — рендер пропускается.
     * @private
     * @param {string} targetNodeId
     */
    _renderAfterPaste(targetNodeId) {
        window.treeManager?.renderer?.renderSubtree?.(targetNodeId)
            ?? window.treeManager?.render?.();
        if (AppState.currentStep === 2) {
            window.ItemsRenderer?.updateItem?.(targetNodeId)
                ?? window.ItemsRenderer?.renderAll?.();
        }
        window.PreviewManager?.update?.('previewTrim', 30);
    },

    /**
     * Устанавливает шорткаты Ctrl+C / Ctrl+V (capture-фаза). Внутри активных
     * редакторов (contenteditable/textarea/input/select) живёт браузерный
     * copy/paste — не перехватываем (по образцу UndoDeleteManager).
     *
     * Ctrl+C/Ctrl+V работают по выделенному узлу дерева (AppState.selectedNode).
     */
    installHotkey() {
        if (this._hotkeyInstalled) return;
        this._hotkeyInstalled = true;

        document.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
            if (e.code !== 'KeyC' && e.code !== 'KeyV') return;
            if (this._isEditableTarget(document.activeElement)) return;

            const selected = AppState.selectedNode;
            if (!selected?.id) return;

            if (e.code === 'KeyC') {
                e.preventDefault();
                e.stopPropagation();
                this.copyNode(selected.id);
            } else if (e.code === 'KeyV') {
                if (AppConfig.readOnlyMode?.isReadOnly) return;
                e.preventDefault();
                e.stopPropagation();
                this.pasteInto(selected.id);
            }
        }, true);
    },

    /**
     * Активный элемент — текстовый редактор (там живёт браузерный copy/paste).
     * @private
     * @param {Element|null} el
     * @returns {boolean}
     */
    _isEditableTarget(el) {
        if (!el) return false;
        if (el.isContentEditable) return true;
        return ['TEXTAREA', 'INPUT', 'SELECT'].includes(el.tagName);
    },

    /** @type {Element|null} Пункт меню «Копировать» (для refreshMenuState). */
    _copyMenuItem: null,

    /** @type {Element|null} Пункт меню «Вставить» (для refreshMenuState). */
    _pasteMenuItem: null,

    /**
     * Добавляет пункты «Копировать» / «Вставить» в контекстное меню дерева
     * (#contextMenu) программно — без правки шаблона (шаблон принадлежит другому
     * агенту волны). Пункты получают собственные click-обработчики (штатный
     * делегатор TreeContextMenu уже навешан в конструкторе — до инъекции — и
     * наши элементы не охватывает). Вставляются перед пунктом «Удалить».
     */
    installMenuItems() {
        if (this._menuInstalled) return;
        const menu = document.getElementById?.('contextMenu');
        if (!menu) return;
        this._menuInstalled = true;

        const deleteItem = menu.querySelector?.('[data-action="delete"]');
        const mkItem = (action, icon, label) => {
            const el = document.createElement('div');
            el.className = 'context-menu-item';
            el.setAttribute('role', 'menuitem');
            el.dataset.action = action;
            el.innerHTML = `<span aria-hidden="true">${icon}</span> ${label}`;
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (el.classList.contains('disabled')) return;
                this._handleMenuAction(action);
                window.ContextMenuManager?.hide?.();
            });
            return el;
        };
        const sep = () => {
            const s = document.createElement('div');
            s.className = 'context-menu-separator';
            s.setAttribute('role', 'separator');
            s.dataset.action = 'copy-paste-separator';
            return s;
        };

        const copyItem = mkItem('copy', '📄', 'Копировать');
        const pasteItem = mkItem('paste', '📋', 'Вставить');
        const separator = sep();
        this._copyMenuItem = copyItem;
        this._pasteMenuItem = pasteItem;

        if (deleteItem && menu.insertBefore) {
            menu.insertBefore(separator, deleteItem);
            menu.insertBefore(copyItem, deleteItem);
            menu.insertBefore(pasteItem, deleteItem);
        } else if (menu.appendChild) {
            menu.appendChild(separator);
            menu.appendChild(copyItem);
            menu.appendChild(pasteItem);
        }
    },

    /**
     * Обновляет доступность пунктов «Копировать»/«Вставить» при показе меню.
     * Вызывается из TreeContextMenu.updateMenuState. «Копировать» недоступно для
     * protected-секций и pinned-таблиц (их нельзя копировать как корень);
     * «Вставить» — для пустого буфера, read-only и листовых блоков.
     *
     * @param {Object|null} node - Узел, по которому открыто меню
     */
    refreshMenuState(node) {
        if (this._copyMenuItem?.classList) {
            const cannotCopy = !node || node.protected || isPinnedTable(node);
            this._copyMenuItem.classList.toggle('disabled', !!cannotCopy);
        }
        if (this._pasteMenuItem?.classList) {
            const isLeaf = node?.type && node.type !== AppConfig.nodeTypes.ITEM;
            const cannotPaste = !node
                || isLeaf
                || AppConfig.readOnlyMode?.isReadOnly
                || !this.canPaste();
            this._pasteMenuItem.classList.toggle('disabled', !!cannotPaste);
        }
    },

    /**
     * Обработчик клика по пунктам «Копировать»/«Вставить». Узел берётся из
     * ContextMenuManager.currentNodeId (как у штатных пунктов меню).
     * @private
     * @param {string} action - 'copy' | 'paste'
     */
    _handleMenuAction(action) {
        const nodeId = window.ContextMenuManager?.currentNodeId;
        if (!nodeId) return;
        if (action === 'copy') {
            this.copyNode(nodeId);
        } else if (action === 'paste') {
            this.pasteInto(nodeId);
        }
    },
};

// Window-global для совместимости с inline-скриптами в шаблонах.
window.NodeClipboard = NodeClipboard;
