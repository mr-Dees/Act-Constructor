/**
 * Сервис для работы с идентификаторами аудита (audit_point_id)
 *
 * Запрашивает audit_point_id для узлов дерева через бэкенд.
 * Все вызовы асинхронные, ошибки логируются но не прерывают работу.
 */
class AuditIdService {
    /**
     * Запрашивает audit_point_id для списка node_id через бэкенд
     *
     * @param {number} actId - ID акта
     * @param {string[]} nodeIds - Список ID узлов
     * @returns {Promise<Object<string, string>>} Словарь {node_id: audit_point_id}
     */
    static async fetchAuditPointIds(actId, nodeIds) {
        if (!actId || !nodeIds || nodeIds.length === 0) {
            return {};
        }

        try {
            const username = AuthManager.getCurrentUser();
            if (!username) {
                console.warn('AuditIdService: пользователь не авторизован');
                return {};
            }

            const response = await fetch(
                AppConfig.api.getUrl(`/api/v1/acts/${actId}/audit-point-ids`),
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-JupyterHub-User': username
                    },
                    body: JSON.stringify({ node_ids: nodeIds })
                }
            );

            if (!response.ok) {
                console.error(`AuditIdService: ошибка запроса audit_point_ids: HTTP ${response.status}`);
                return {};
            }

            return await response.json();
        } catch (error) {
            console.error('AuditIdService: ошибка получения audit_point_ids:', error);
            return {};
        }
    }

    /**
     * Обходит дерево, собирает item-узлы без auditPointId,
     * выполняет batch-запрос и присваивает полученные ID.
     *
     * @param {number} actId - ID акта
     * @param {Object} treeData - Корневой узел дерева
     * @returns {Promise<void>}
     */
    static async assignMissingPointIds(actId, treeData) {
        if (!actId || !treeData) return;

        try {
            // Собираем item-узлы без auditPointId
            const missingNodes = [];
            this._collectMissingNodes(treeData, missingNodes);

            if (missingNodes.length === 0) return;

            const nodeIds = missingNodes.map(n => n.id);

            // Batch-запрос к бэкенду
            const pointIds = await this.fetchAuditPointIds(actId, nodeIds);
            if (!pointIds || Object.keys(pointIds).length === 0) return;

            // Присваиваем полученные ID узлам
            let assigned = 0;
            for (const node of missingNodes) {
                if (pointIds[node.id]) {
                    node.auditPointId = pointIds[node.id];
                    assigned++;
                }
            }

            if (assigned > 0) {
                console.log(`AuditIdService: присвоено ${assigned} audit_point_id`);

                // Помечаем состояние как несохранённое
                if (typeof StorageManager !== 'undefined' && StorageManager.markAsUnsaved) {
                    StorageManager.markAsUnsaved();
                }
            }
        } catch (error) {
            console.error('AuditIdService: ошибка assignMissingPointIds:', error);
        }
    }

    /**
     * Рекурсивно собирает item-узлы без auditPointId
     * @private
     * @param {Object} node - Текущий узел
     * @param {Array} result - Массив для накопления результатов
     */
    static _collectMissingNodes(node, result) {
        if (!node) return;

        const type = node.type || 'item';

        // Собираем только item-узлы (не content-узлы и не root)
        if (type === 'item' && node.id !== 'root' && !node.auditPointId) {
            result.push(node);
        }

        if (node.children) {
            for (const child of node.children) {
                this._collectMissingNodes(child, result);
            }
        }
    }
}
