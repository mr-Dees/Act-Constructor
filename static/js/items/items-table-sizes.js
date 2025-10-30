/**
 * Модуль для сохранения и восстановления размеров таблиц
 */
class ItemsTableSizes {
    /**
     * Сохранение размеров ячеек таблицы в AppState
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM элемент таблицы
     */
    static persistTableSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;

        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }

        const sizes = {};

        // Собираем размеры всех ячеек
        tableElement.querySelectorAll('th, td').forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            if (row === null || col === null) return;

            const key = `${row}-${col}`;
            sizes[key] = {
                width: cell.style.width || '',
                height: cell.style.height || '',
                minWidth: cell.style.minWidth || '',
                minHeight: cell.style.minHeight || '',
                wordBreak: cell.style.wordBreak || '',
                overflowWrap: cell.style.overflowWrap || ''
            };
        });

        // Сохраняем в глобальное хранилище
        AppState.tableUISizes[tableId] = {
            cellSizes: sizes
        };
    }

    /**
     * Применение сохраненных размеров к таблице
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM элемент таблицы
     */
    static applyPersistedSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;

        const saved = AppState.tableUISizes && AppState.tableUISizes[tableId];
        if (!saved || !saved.cellSizes) return;

        // Применяем сохраненные размеры к ячейкам
        tableElement.querySelectorAll('th, td').forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            if (row === null || col === null) return;

            const key = `${row}-${col}`;
            const s = saved.cellSizes[key];

            if (s) {
                // Применяем сохраненные стили
                if (s.width) cell.style.width = s.width;
                if (s.height) cell.style.height = s.height;
                if (s.minWidth) cell.style.minWidth = s.minWidth;
                if (s.minHeight) cell.style.minHeight = s.minHeight;
                cell.style.wordBreak = s.wordBreak || 'normal';
                cell.style.overflowWrap = s.overflowWrap || 'anywhere';
            } else {
                // Устанавливаем размеры по умолчанию
                cell.style.minWidth = '80px';
                cell.style.minHeight = '28px';
                cell.style.wordBreak = 'normal';
                cell.style.overflowWrap = 'anywhere';
            }
        });
    }

    /**
     * Сохранение текущих размеров таблицы
     * @param {HTMLElement} tableElement - DOM элемент таблицы
     * @returns {Object} Объект с размерами ячеек
     */
    static preserveTableSizes(tableElement) {
        const sizes = {};
        const cells = tableElement.querySelectorAll('th, td');

        cells.forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            const key = `${row}-${col}`;

            sizes[key] = {
                width: cell.style.width || '',
                height: cell.style.height || '',
                minWidth: cell.style.minWidth || '',
                minHeight: cell.style.minHeight || '',
                wordBreak: cell.style.wordBreak || '',
                overflowWrap: cell.style.overflowWrap || ''
            };
        });

        return sizes;
    }

    /**
     * Применение размеров к таблице
     * @param {HTMLElement} tableElement - DOM элемент таблицы
     * @param {Object} sizes - Объект с размерами ячеек
     */
    static applyTableSizes(tableElement, sizes) {
        if (!sizes) return;

        const cells = tableElement.querySelectorAll('th, td');
        cells.forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            const key = `${row}-${col}`;

            if (sizes[key]) {
                if (sizes[key].width) cell.style.width = sizes[key].width;
                if (sizes[key].height) cell.style.height = sizes[key].height;
                if (sizes[key].minWidth) cell.style.minWidth = sizes[key].minWidth;
                if (sizes[key].minHeight) cell.style.minHeight = sizes[key].minHeight;
                cell.style.wordBreak = sizes[key].wordBreak || 'normal';
                cell.style.overflowWrap = sizes[key].overflowWrap || 'anywhere';
            }
        });
    }
}
