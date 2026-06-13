/**
 * Модуль рендеринга дерева элементов
 *
 * Отвечает за создание DOM-структуры дерева на основе данных из AppState.
 * Обрабатывает события взаимодействия с узлами.
 * Все константы вынесены в AppConfig для централизованного управления.
 */
import { ContextMenuManager } from '../context-menu/context-menu-core.js';
import { isLeafBlockType } from '../block-types.js';
import { ItemsTitleEditing } from '../items/items-title-editing.js';
import { AppState, _unwrap } from '../state/state-core.js';
import { loadCollapsedSet, saveCollapsedSet, pruneCollapsedSet } from './tree-collapsed-store.js';
import { TreeUtils } from './tree-utils.js';
import { AppConfig } from '../../shared/app-config.js';
import { ChatEventBus } from '../../shared/chat/chat-event-bus.js';

export class TreeRenderer {
    /**
     * @param {TreeManager} manager - Экземпляр менеджера дерева
     */
    constructor(manager) {
        /** @type {TreeManager} */
        this.manager = manager;

        /**
         * Индекс отрисованных узлов: nodeId → li. Паттерн items-renderer._domIndex.
         * Заполняется в _createBaseLiElement, чистится в render() и при замене
         * поддерева в renderSubtree (_purgeSubtreeFromDomIndex).
         * @type {Map<string, HTMLLIElement>}
         */
        this._domIndex = new Map();

        /**
         * Набор id свёрнутых узлов текущего акта (персист в localStorage,
         * ключ audit_workstation_collapsed:{actId}). Лениво перечитывается
         * при смене window.currentActId.
         * @type {Set<string>|null}
         */
        this._collapsed = null;
        this._collapsedActId = undefined;

        // Точечный апдейт бейджа фактуры при изменении node.invoice
        // через AppState.setNodeInvoice. Заменяет полный treeManager.render()
        // после save в диалоге фактуры.
        window.ChatEventBus?.on?.('node:invoice-changed', ({nodeId}) => {
            const node = AppState?.findNodeById?.(nodeId);
            if (node) this.updateInvoiceBadge(node);
        });

        // Точечный апдейт бейджа ТБ при изменении node.tb через AppState.setNodeTb.
        // Подписчик отвечает за обновление и текущего узла, и родителей под §5.
        window.ChatEventBus?.on?.('node:tb-changed', ({nodeId}) => {
            const node = AppState?.findNodeById?.(nodeId);
            if (node) this.updateTbBadge(node);
        });
    }

    /**
     * Рендеринг дерева
     *
     * Создает HTML-структуру дерева на основе данных из AppState.
     *
     * @param {Object} [node=AppState.treeData] - Корневой узел для отрисовки
     */
    render(node = AppState.treeData) {
        // Read-only обход — по raw-дереву (без Proxy get-трапов). Узлы,
        // попадающие в write-замыкания обработчиков, оборачиваются точечно
        // в _setupNodeEventHandlers через AppState._trackedNode.
        node = _unwrap(node);
        this._domIndex.clear();
        this._pruneCollapsed();
        this.manager.container.innerHTML = '';
        // Корневой #tree уже играет role="tree" (шаблон); рендерим прямо в него.
        // node.children — секции 1-го уровня (aria-level=1).
        const siblings = node.children || [];
        siblings.forEach((child, idx) => {
            this.manager.container.appendChild(
                this.createNodeElement(child, 1, idx + 1, siblings.length)
            );
        });
        // После рендера ровно один treeitem имеет tabindex=0 (roving).
        this._applyRovingTabindex();
    }

    /**
     * Точечная пересборка поддерева одного узла (add/delete/move в его
     * пределах) — взамен полного render(). Заменяет li узла свежепостроенным,
     * обновляет DOM-индекс, номера всех видимых узлов (нумерация уже
     * пересчитана в state), восстанавливает выделение, roving tabindex и фокус.
     * Fallback на полный render() — если узла нет в индексе/DOM (осознанный
     * путь для сложных операций: загрузка, реструктуризация, root-уровень).
     * @param {string} nodeId - ID узла, чьё поддерево пересобрать
     */
    renderSubtree(nodeId) {
        const oldLi = this._domIndex.get(nodeId);
        const node = AppState._findNodeRaw ? AppState._findNodeRaw(nodeId) : null;
        if (!oldLi || !node || !oldLi.parentNode) {
            return this.render();
        }

        // Сохраняем контекст до замены: ARIA-позиция li (сиблинги не менялись),
        // наличие фокуса/roving-нуля внутри заменяемого поддерева.
        const level = parseInt(oldLi.getAttribute('aria-level'), 10) || 1;
        const posinset = parseInt(oldLi.getAttribute('aria-posinset'), 10) || 1;
        const setsize = parseInt(oldLi.getAttribute('aria-setsize'), 10) || 1;
        const activeEl = document.activeElement;
        const hadFocusInside = !!activeEl && oldLi.contains(activeEl);
        const focusedId = hadFocusInside ? (activeEl.closest('li.tree-item')?.dataset.nodeId ?? null) : null;
        const hadRovingInside = oldLi.getAttribute('tabindex') === '0' || !!oldLi.querySelector('[tabindex="0"]');

        this._purgeSubtreeFromDomIndex(oldLi);
        this._pruneCollapsed();

        const newLi = this.createNodeElement(node, level, posinset, setsize);
        oldLi.parentNode.replaceChild(newLi, oldLi);

        this._restoreSelection();
        // Инвариант: renderSubtree пересобирает поддерево от структурного
        // родителя, поэтому все узлы с изменившейся нумерацией лежат внутри
        // newLi. Сужаем сверку текста до этого поддерева (O(поддерево))
        // вместо полного обхода _domIndex (O(всех узлов)).
        this._refreshNumbersIn(newLi);

        // Roving tabindex/фокус: если «нулевой» элемент был внутри заменённого
        // поддерева — возвращаем его (предпочтительно на тот же узел).
        if (hadRovingInside || hadFocusInside) {
            const preferred = (focusedId && this._domIndex.get(focusedId)) || null;
            if (preferred) {
                this.manager.container.querySelectorAll('li.tree-item')
                    .forEach(el => el.setAttribute('tabindex', '-1'));
                preferred.setAttribute('tabindex', '0');
                if (hadFocusInside) preferred.focus();
            } else {
                this._applyRovingTabindex();
                if (hadFocusInside) {
                    this.manager.container.querySelector('li.tree-item[tabindex="0"]')?.focus();
                }
            }
        }
    }

    /**
     * Лёгкое точечное обновление подписи узла (rename) — только текст
     * номера/заголовка, без пересборки DOM и перевешивания слушателей.
     * @param {string} nodeId - ID узла
     */
    renderNodeRenamed(nodeId) {
        const li = this._domIndex.get(nodeId);
        const node = AppState._findNodeRaw ? AppState._findNodeRaw(nodeId) : null;
        if (!li || !node) {
            return this.render();
        }
        this._updateLiLabelText(li, node);
    }

    /**
     * Точечно обновляет номера/подписи всех отрисованных узлов из state.
     * Нумерация уже пересчитана generateNumbering — здесь только текст.
     */
    refreshNumbers() {
        for (const [nodeId, li] of this._domIndex) {
            const node = AppState._nodeIndex?.get(nodeId);
            if (node) this._updateLiLabelText(li, node);
        }
    }

    /**
     * Точечно обновляет номера/подписи только в пределах одного поддерева.
     * Применяется из renderSubtree: переименование/перенумерация после
     * add/delete/move затрагивает лишь узлы внутри пересобранного rootLi,
     * поэтому обход сужен до него (O(поддерево)) вместо полного _domIndex.
     * @param {HTMLLIElement} rootLi - Корневой li пересобранного поддерева
     */
    _refreshNumbersIn(rootLi) {
        if (!rootLi) return;
        const apply = (li) => {
            const nodeId = li.dataset.nodeId;
            const node = nodeId ? AppState._nodeIndex?.get(nodeId) : null;
            if (node) this._updateLiLabelText(li, node);
        };
        apply(rootLi);
        rootLi.querySelectorAll('li.tree-item').forEach(apply);
    }

    /**
     * Обновляет текст подписи li из узла: номер + заголовок (item-узлы)
     * или единый текст (content-типы). Бейджи ТБ/фактуры не трогает.
     * @private
     * @param {HTMLLIElement} li - Элемент узла
     * @param {Object} node - Узел дерева (raw)
     */
    _updateLiLabelText(li, node) {
        const label = li.querySelector(':scope > .tree-label');
        if (!label) return;

        const isContentType = isLeafBlockType(node.type);
        if (isContentType) {
            const text = node.customLabel || node.number || node.label;
            if (label.textContent !== text) label.textContent = text;
            return;
        }

        const numberSpan = label.querySelector(':scope > .tree-node-number');
        if (node.number) {
            const text = node.number + '. ';
            if (numberSpan) {
                if (numberSpan.textContent !== text) numberSpan.textContent = text;
            } else {
                const span = document.createElement('span');
                span.className = 'tree-node-number';
                span.textContent = text;
                span.contentEditable = false;
                label.insertBefore(span, label.firstChild);
            }
        } else if (numberSpan) {
            numberSpan.remove();
        }

        const textSpan = label.querySelector(':scope > .tree-node-text');
        if (textSpan && textSpan.textContent !== node.label) {
            textSpan.textContent = node.label;
        }
    }

    /**
     * Удаляет все записи DOM-индекса для заменяемого поддерева.
     * @private
     * @param {HTMLLIElement} rootLi - Старый li поддерева
     */
    _purgeSubtreeFromDomIndex(rootLi) {
        rootLi.querySelectorAll('li.tree-item').forEach(el => {
            const id = el.dataset.nodeId;
            if (id) this._domIndex.delete(id);
        });
        if (rootLi.dataset.nodeId) this._domIndex.delete(rootLi.dataset.nodeId);
    }

    /**
     * Возвращает .selected выделенному узлу после точечной пересборки
     * (полный render() выделение тоже не сохраняет — это не регресс,
     * а выравнивание: точечный рендер не должен быть хуже).
     * @private
     */
    _restoreSelection() {
        const selectedId = this.manager.selectedNode;
        if (!selectedId) return;
        const li = this._domIndex.get(selectedId);
        if (li && !li.classList.contains('selected')) {
            li.classList.add('selected');
            li.setAttribute('aria-selected', 'true');
        }
    }

    // ── Персист свёрнутых узлов (M.24) ───────────────────────────────────

    /**
     * Набор свёрнутых узлов текущего акта (лениво, со сменой акта перечитывается).
     * @private
     * @returns {Set<string>}
     */
    _collapsedSet() {
        const actId = (typeof window !== 'undefined' ? window.currentActId : null) ?? null;
        if (this._collapsed === null || this._collapsedActId !== actId) {
            this._collapsedActId = actId;
            this._collapsed = loadCollapsedSet(
                typeof localStorage !== 'undefined' ? localStorage : null,
                actId
            );
        }
        return this._collapsed;
    }

    /**
     * Запоминает состояние свёрнутости узла (вызывается из toggle-иконки
     * и клавиатурного _setExpanded TreeManager'а).
     * @param {string} nodeId - ID узла
     * @param {boolean} collapsed - Свёрнут ли узел
     */
    persistCollapsed(nodeId, collapsed) {
        if (!nodeId) return;
        const set = this._collapsedSet();
        if (collapsed) set.add(nodeId);
        else set.delete(nodeId);
        saveCollapsedSet(
            typeof localStorage !== 'undefined' ? localStorage : null,
            this._collapsedActId,
            set
        );
    }

    /**
     * Чистит набор свёрнутых от удалённых узлов (по индексу AppState).
     * @private
     */
    _pruneCollapsed() {
        const set = this._collapsedSet();
        if (set.size === 0) return;
        AppState._ensureNodeIndex?.();
        const changed = pruneCollapsedSet(set, id => !!AppState._nodeIndex?.get(id));
        if (changed) {
            saveCollapsedSet(
                typeof localStorage !== 'undefined' ? localStorage : null,
                this._collapsedActId,
                set
            );
        }
    }

    /**
     * Создание элемента списка для дерева (используется для подгрупп).
     *
     * @param {Object} node - Узел с дочерними элементами
     * @param {number} childLevel - aria-level для детей
     * @returns {HTMLUListElement} Элемент списка с деревом
     */
    createTreeElement(node, childLevel = 1) {
        const ul = document.createElement('ul');
        ul.className = 'tree';
        ul.setAttribute('role', 'group');

        const siblings = node.children || [];
        siblings.forEach((child, idx) => {
            ul.appendChild(this.createNodeElement(child, childLevel, idx + 1, siblings.length));
        });

        return ul;
    }

    /**
     * Создание элемента узла дерева
     *
     * Создает полный HTML-элемент узла со всеми обработчиками и иконками.
     *
     * @param {Object} node - Данные узла (id, label, type, children и т.д.)
     * @param {number} level - aria-level (1 для секций, +1 на каждый уровень)
     * @param {number} [posinset=1] - aria-posinset (позиция в группе сиблингов, 1-based)
     * @param {number} [setsize=1] - aria-setsize (всего сиблингов в группе)
     * @returns {HTMLLIElement} Готовый элемент узла дерева
     */
    createNodeElement(node, level = 1, posinset = 1, setsize = 1) {
        const li = this._createBaseLiElement(node, level, posinset, setsize);

        // Добавляем элементы узла
        li.appendChild(this._createToggleIcon(node, li));
        li.appendChild(this._createLabel(node));
        this._addNodeTypeIcon(li, node.type);

        // Настраиваем обработчики. Узел оборачивается в tracking-Proxy:
        // замыкания обработчиков пишут в него (rename через ItemsTitleEditing),
        // и эти записи обязаны ловиться markAsUnsaved.
        this._setupNodeEventHandlers(li, AppState._trackedNode(node));

        // Рекурсивно создаем дочерние элементы
        if (node.children?.length) {
            li.appendChild(this._createChildrenContainer(node, level + 1));

            // Восстанавливаем персистентную свёрнутость (M.24).
            if (this._collapsedSet().has(node.id)) {
                li.classList.add('collapsed');
                li.setAttribute('aria-expanded', 'false');
                const toggle = li.querySelector(':scope > .toggle-icon');
                if (toggle) toggle.textContent = AppConfig.tree.interaction.toggleIcons.collapsed;
            }
        }

        return li;
    }

    /**
     * Создает базовый li элемент с классами и атрибутами
     * @private
     * @param {Object} node - Данные узла
     * @returns {HTMLLIElement} Базовый элемент li
     */
    _createBaseLiElement(node, level = 1, posinset = 1, setsize = 1) {
        const li = document.createElement('li');
        li.className = 'tree-item';
        li.dataset.nodeId = node.id;
        this._domIndex.set(node.id, li);

        // ARIA-атрибуты для treeitem (https://www.w3.org/WAI/ARIA/apg/patterns/treeview/).
        // aria-expanded ставится только для узлов с детьми; selected — false по умолчанию,
        // обновляется в TreeManager.selectNode/clearSelection. tabindex=-1 (roving).
        li.setAttribute('role', 'treeitem');
        li.setAttribute('aria-level', String(level));
        li.setAttribute('aria-posinset', String(posinset));
        li.setAttribute('aria-setsize', String(setsize));
        li.setAttribute('aria-selected', 'false');
        li.setAttribute('tabindex', '-1');
        if (node.children?.length) {
            li.setAttribute('aria-expanded', 'true');
        }

        if (node.protected) {
            li.classList.add('protected');
        }

        this._addNodeTypeClass(li, node.type);

        return li;
    }

    /**
     * Добавляет CSS класс в зависимости от типа узла
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {string} type - Тип узла
     */
    _addNodeTypeClass(li, type) {
        const typeClassMap = {
            table: 'table-node',
            textblock: 'textblock-node',
            violation: 'violation-node'
        };

        const className = typeClassMap[type];
        if (className) {
            li.classList.add(className);
        }
    }

    /**
     * Создает иконку для раскрытия/сворачивания узла
     * @private
     * @param {Object} node - Узел данных
     * @param {HTMLElement} li - Элемент узла
     * @returns {HTMLElement} Элемент toggle
     */
    _createToggleIcon(node, li) {
        const toggle = document.createElement('span');
        toggle.className = 'toggle-icon';

        const icons = AppConfig.tree.interaction.toggleIcons;
        toggle.textContent = node.children?.length > 0 ? icons.expanded : '';

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            li.classList.toggle('collapsed');
            const collapsed = li.classList.contains('collapsed');
            toggle.textContent = collapsed ? icons.collapsed : icons.expanded;
            // Синхронизируем ARIA-состояние для скринридеров.
            if (li.hasAttribute('aria-expanded')) {
                li.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            }
            // Сворачивание — class-toggle (без childList-мутации), поэтому
            // MutationObserver видимых узлов его не ловит: инвалидируем кеш явно.
            this.manager._invalidateVisibleItemsCache?.();
            // Персист свёрнутости per-act (M.24).
            this.persistCollapsed(node.id, collapsed);
        });

        return toggle;
    }

    /**
     * Создает метку узла
     * @private
     * @param {Object} node - Узел данных
     * @returns {HTMLElement} Элемент метки
     */
    _createLabel(node) {
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.contentEditable = false;

        const isContentType = isLeafBlockType(node.type);

        if (isContentType) {
            // Для content-типов: один span с customLabel или number
            label.textContent = node.customLabel || node.number || node.label;
        } else {
            // Для item-узлов: два span-а (номер + текст)
            if (node.number) {
                const numberSpan = document.createElement('span');
                numberSpan.className = 'tree-node-number';
                numberSpan.textContent = node.number + '. ';
                numberSpan.contentEditable = false;
                label.appendChild(numberSpan);
            }

            const textSpan = document.createElement('span');
            textSpan.className = 'tree-node-text';
            textSpan.textContent = node.label;
            label.appendChild(textSpan);

            // Бейдж ТБ для узлов под разделом 5
            if (TreeUtils.isUnderSection5(node)) {
                label.appendChild(this._createTbBadge(node));
            }

            // Бейдж фактуры для leaf-узлов под разделом 5
            if (TreeUtils.isTbLeaf(node) && node.invoice) {
                label.appendChild(this._createInvoiceBadge(node));
            }
        }

        return label;
    }

    /**
     * Создает контейнер для дочерних элементов
     * @private
     * @param {Object} node - Узел данных
     * @returns {HTMLElement} Контейнер с дочерними элементами
     */
    _createChildrenContainer(node, childLevel = 2) {
        const childrenUl = document.createElement('ul');
        childrenUl.className = 'tree-children';
        // role="group" — стандарт ARIA APG для подгрупп treeview.
        childrenUl.setAttribute('role', 'group');

        node.children.forEach(child => {
            childrenUl.appendChild(this.createNodeElement(child, childLevel));
        });

        return childrenUl;
    }

    /**
     * Гарантирует, что ровно один treeitem имеет tabindex=0 (roving tabindex).
     * Если есть выделенный — он; иначе первый видимый.
     * @private
     */
    _applyRovingTabindex() {
        const container = this.manager.container;
        if (!container) return;

        const items = container.querySelectorAll('li.tree-item');
        if (items.length === 0) return;

        // Все на -1.
        items.forEach(li => li.setAttribute('tabindex', '-1'));

        // Выделенный (если есть в DOM) — приоритет.
        const selectedId = this.manager.selectedNode;
        let focusable = null;
        if (selectedId) {
            focusable = container.querySelector(`li.tree-item[data-node-id="${selectedId}"]`);
        }
        if (!focusable) {
            focusable = items[0];
        }
        focusable.setAttribute('tabindex', '0');
    }

    /**
     * Добавляет иконку типа узла
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {string} type - Тип узла (table, textblock, violation)
     */
    _addNodeTypeIcon(li, type) {
        const config = AppConfig.tree.icons[type];
        if (!config) return;

        const icon = document.createElement('span');
        icon.className = config.className;
        icon.textContent = config.emoji;
        icon.style.marginLeft = '5px';
        icon.contentEditable = false;

        li.appendChild(icon);
    }

    /**
     * Настройка обработчиков событий для узла дерева
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {Object} node - Данные узла
     */
    _setupNodeEventHandlers(li, node) {
        const label = li.querySelector('.tree-label');
        const handleCtrlClick = () => this.manager.handleCtrlClick(node, li);

        // Обработчики для метки
        if (node.protected) {
            this._setupProtectedLabelHandlers(label, li, handleCtrlClick);
        } else {
            this._setupEditableLabelHandlers(label, li, node, handleCtrlClick);
        }

        // Обработчик для всего li
        this._setupLiClickHandler(li, label, handleCtrlClick);

        // Контекстное меню
        this._setupContextMenuHandler(li, node);
    }

    /**
     * Настраивает обработчики для редактируемых меток
     * @private
     * @param {HTMLElement} label - Элемент метки
     * @param {HTMLElement} li - Элемент узла
     * @param {Object} node - Данные узла
     * @param {Function} handleCtrlClick - Обработчик Ctrl+Click
     */
    _setupEditableLabelHandlers(label, li, node, handleCtrlClick) {
        let clickCount = 0;
        let clickTimer = null;
        const doubleClickDelay = AppConfig.tree.interaction.doubleClickDelay;

        label.addEventListener('click', (e) => {
            e.stopPropagation();

            // Игнорируем клики по нередактируемому номеру
            if (e.target.closest('.tree-node-number')) {
                this.manager.selectNode(li);
                return;
            }

            // Обработка Ctrl+Click
            if (e.ctrlKey || e.metaKey) {
                handleCtrlClick();
                return;
            }

            // Обработка двойного клика
            clickCount++;

            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                    this.manager.selectNode(li);
                }, doubleClickDelay);
            } else if (clickCount === 2) {
                clearTimeout(clickTimer);
                clickCount = 0;
                // Для item-узлов передаём .tree-node-text, для остальных — весь label
                const editTarget = label.querySelector('.tree-node-text') || label;
                ItemsTitleEditing.startEditingTreeNode(editTarget, node, this.manager);
            }
        });

        label.style.cursor = 'pointer';
    }

    /**
     * Настраивает обработчики для защищенных меток
     * @private
     * @param {HTMLElement} label - Элемент метки
     * @param {HTMLElement} li - Элемент узла
     * @param {Function} handleCtrlClick - Обработчик Ctrl+Click
     */
    _setupProtectedLabelHandlers(label, li, handleCtrlClick) {
        label.addEventListener('click', (e) => {
            e.stopPropagation();

            if (e.ctrlKey || e.metaKey) {
                handleCtrlClick();
                return;
            }

            this.manager.selectNode(li);
        });
    }

    /**
     * Настраивает обработчик клика по элементу li
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {HTMLElement} label - Элемент метки
     * @param {Function} handleCtrlClick - Обработчик Ctrl+Click
     */
    _setupLiClickHandler(li, label, handleCtrlClick) {
        li.addEventListener('click', (e) => {
            // Игнорируем клики по метке и служебным элементам
            if (e.target === label || e.target.closest('.tree-label') || this._isIgnoredElement(e.target)) {
                return;
            }

            e.stopPropagation();

            if (e.ctrlKey || e.metaKey) {
                handleCtrlClick();
                return;
            }

            this.manager.selectNode(li);
        });
    }

    /**
     * Проверяет, является ли элемент служебным (иконка)
     * @private
     * @param {HTMLElement} element - Проверяемый элемент
     * @returns {boolean} true если элемент служебный
     */
    _isIgnoredElement(element) {
        const ignoredClasses = AppConfig.tree.interaction.ignoredClickClasses;
        return ignoredClasses.some(cls => element.classList.contains(cls));
    }

    /**
     * Настраивает обработчик контекстного меню
     * @private
     * @param {HTMLElement} li - Элемент узла
     * @param {Object} node - Данные узла
     */
    _setupContextMenuHandler(li, node) {
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            this.manager.selectNode(li);
            ContextMenuManager.show(e.clientX, e.clientY, node.id, 'tree');
        });
    }

    /**
     * Создает бейдж ТБ для узла дерева
     * @private
     * @param {Object} node - Узел дерева
     * @returns {HTMLElement} Элемент бейджа
     */
    _createTbBadge(node) {
        const badge = document.createElement('span');
        badge.className = 'tb-badge';

        const isLeaf = TreeUtils.isTbLeaf(node);

        if (isLeaf) {
            const tbList = node.tb || [];
            if (tbList.length > 0) {
                badge.classList.add('tb-badge--assigned');
                badge.textContent = tbList.join(', ');
                badge.title = tbList.map(abbr => {
                    const bank = AppConfig.territorialBanks.find(b => b.abbr === abbr);
                    return bank ? `${bank.name} (${abbr})` : abbr;
                }).join(', ');
            } else {
                badge.classList.add('tb-badge--empty');
                badge.textContent = 'ТБ';
                badge.title = 'Назначить территориальный банк';
            }

            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                if (AppConfig.readOnlyMode?.isReadOnly) return;
                this._showTbDropdown(badge, node);
            });
        } else {
            const computed = TreeUtils.getComputedTb(node);
            if (computed.length > 0) {
                badge.classList.add('tb-badge--computed');
                badge.textContent = computed.join(', ');
                badge.title = 'Вычислено из дочерних пунктов: ' + computed.join(', ');
            } else {
                badge.classList.add('tb-badge--empty');
                badge.textContent = 'ТБ';
                badge.title = 'ТБ не назначен дочерним пунктам';
                badge.style.cursor = 'default';
            }
        }

        return badge;
    }

    /**
     * Обновляет бейдж фактуры в дереве для конкретного узла.
     * Публичный API: вызывается subscriber'ом 'node:invoice-changed' —
     * заменяет полный treeManager.render() после диалога фактуры.
     * Снимает существующий бейдж и (если node.invoice) создаёт новый.
     * @param {Object} node - Узел дерева
     */
    updateInvoiceBadge(node) {
        const li = this.manager.container.querySelector(`[data-node-id="${node.id}"]`);
        if (!li) return;
        const label = li.querySelector(':scope > .tree-label');
        if (!label) return;
        const oldBadge = label.querySelector('.invoice-badge');
        if (oldBadge) oldBadge.remove();
        if (TreeUtils.isTbLeaf(node) && node.invoice) {
            label.appendChild(this._createInvoiceBadge(node));
        }
    }

    /**
     * Создает бейдж фактуры
     * @private
     * @returns {HTMLElement} Элемент бейджа
     */
    _createInvoiceBadge(node) {
        const badge = document.createElement('span');
        badge.className = 'invoice-badge';
        badge.textContent = '📎';
        badge.contentEditable = false;

        // Формируем tooltip с типами метрик
        const metrics = node.invoice?.metrics;
        if (metrics && metrics.length > 0) {
            const types = metrics.map(m => m.metric_type).join(', ');
            badge.title = `Фактура: ${types}`;
        } else {
            badge.title = 'Фактура прикреплена';
        }

        return badge;
    }

    /**
     * Показывает дропдаун для выбора ТБ
     * @private
     * @param {HTMLElement} badge - Элемент бейджа
     * @param {Object} node - Узел дерева
     */
    _showTbDropdown(badge, node) {
        // Закрываем предыдущий дропдаун если есть
        this._closeTbDropdown();

        const dropdown = document.createElement('div');
        dropdown.className = 'tb-dropdown';

        const currentTb = node.tb || [];

        AppConfig.territorialBanks.forEach(bank => {
            const item = document.createElement('label');
            item.className = 'tb-dropdown-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = currentTb.includes(bank.abbr);
            checkbox.addEventListener('change', () => {
                this._onTbCheckboxChange(node, bank.abbr, checkbox.checked);
                // Бейджи в дереве и в items обновляются подписчиками
                // на событие 'node:tb-changed', которое эмитит AppState.setNodeTb.
            });

            const nameSpan = document.createElement('span');
            nameSpan.className = 'tb-dropdown-item-name';
            nameSpan.textContent = bank.name;

            const abbrSpan = document.createElement('span');
            abbrSpan.className = 'tb-dropdown-item-abbr';
            abbrSpan.textContent = bank.abbr;

            item.appendChild(checkbox);
            item.appendChild(nameSpan);
            item.appendChild(abbrSpan);
            dropdown.appendChild(item);
        });

        // Позиционируем дропдаун
        document.body.appendChild(dropdown);
        const rect = badge.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.left = `${rect.left}px`;

        // Корректируем позицию если выходит за экран
        const dropdownRect = dropdown.getBoundingClientRect();
        if (dropdownRect.right > window.innerWidth) {
            dropdown.style.left = `${window.innerWidth - dropdownRect.width - 8}px`;
        }
        if (dropdownRect.bottom > window.innerHeight) {
            dropdown.style.top = `${rect.top - dropdownRect.height - 4}px`;
        }

        // Закрытие при клике вне
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== badge) {
                this._closeTbDropdown();
                document.removeEventListener('mousedown', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);

        this._currentTbDropdown = dropdown;
        this._currentTbDropdownCloseHandler = closeHandler;
    }

    /**
     * Закрывает текущий дропдаун ТБ
     * @private
     */
    _closeTbDropdown() {
        if (this._currentTbDropdown) {
            this._currentTbDropdown.remove();
            this._currentTbDropdown = null;
        }
        if (this._currentTbDropdownCloseHandler) {
            document.removeEventListener('mousedown', this._currentTbDropdownCloseHandler);
            this._currentTbDropdownCloseHandler = null;
        }
    }

    /**
     * Обработчик изменения чекбокса ТБ
     * @private
     * @param {Object} node - Узел дерева
     * @param {string} abbr - Аббревиатура банка
     * @param {boolean} checked - Выбран ли
     */
    _onTbCheckboxChange(node, abbr, checked) {
        // Делегируем единой точке: AppState.setNodeTb обновит node.tb,
        // запишет в changelog и эмитит 'node:tb-changed' для подписчиков.
        AppState.setNodeTb(node.id, abbr, checked);
    }

    /**
     * Обновляет бейдж ТБ в дереве для узла и его родителей.
     * Публичный API: вызывается ItemsRenderer'ом из обработчика TB-чекбокса
     * шага 2 вместо полного `treeManager.render()` — точечный апдейт DOM.
     * @param {Object} node - Узел дерева
     */
    updateTbBadge(node) {
        // Обновляем бейдж текущего узла
        const li = this.manager.container.querySelector(`[data-node-id="${node.id}"]`);
        if (li) {
            const oldBadge = li.querySelector(':scope > .tree-label .tb-badge');
            if (oldBadge) {
                const newBadge = this._createTbBadge(node);
                oldBadge.replaceWith(newBadge);
            }
        }

        // Обновляем бейджи родительских узлов (computed TB)
        let parent = AppState.findParentNode(node.id);
        while (parent && parent.id !== 'root') {
            if (TreeUtils.isUnderSection5(parent)) {
                const parentLi = this.manager.container.querySelector(`[data-node-id="${parent.id}"]`);
                if (parentLi) {
                    const parentBadge = parentLi.querySelector(':scope > .tree-label .tb-badge');
                    if (parentBadge) {
                        const newParentBadge = this._createTbBadge(parent);
                        parentBadge.replaceWith(newParentBadge);
                    }
                }
            }
            parent = AppState.findParentNode(parent.id);
        }
    }

}

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.TreeRenderer = TreeRenderer;
