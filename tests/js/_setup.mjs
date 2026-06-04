/**
 * Переиспользуемые чистые фабрики тестовых данных для таблиц конструктора.
 *
 * Здесь НЕТ DOM и НЕТ импортов модулей приложения — только построители данных,
 * повторяющие форму структур таблиц (ячейка / сетка / таблица). Используются
 * в unit- и property-тестах (node:test + fast-check), чтобы тестировать чистую
 * логику (каскады, объединения, сериализация, дискриминатор) без браузера.
 */

/**
 * Создаёт ячейку таблицы со значениями по умолчанию.
 *
 * @param {Object} [opts={}] Переопределения полей ячейки.
 * @param {string} [opts.content] Текстовое содержимое ячейки.
 * @param {boolean} [opts.isHeader] Признак ячейки-заголовка.
 * @param {number} [opts.colSpan] Горизонтальное объединение (число колонок).
 * @param {number} [opts.rowSpan] Вертикальное объединение (число строк).
 * @param {boolean} [opts.isSpanned] Признак поглощённой объединением ячейки.
 * @param {string|null} [opts.spanOrigin] Координата ведущей ячейки объединения.
 * @param {number|null} [opts.originRow] Исходная строка ячейки в сетке.
 * @param {number|null} [opts.originCol] Исходная колонка ячейки в сетке.
 * @returns {Object} Объект ячейки с заполненными полями по умолчанию.
 */
export function makeCell(opts = {}) {
  return {
    content: '',
    isHeader: false,
    colSpan: 1,
    rowSpan: 1,
    isSpanned: false,
    spanOrigin: null,
    originRow: null,
    originCol: null,
    ...opts,
  };
}

/**
 * Создаёт двумерную сетку ячеек размером rows × cols.
 *
 * Каждой ячейке по умолчанию проставляются её координаты в сетке
 * (`originRow=r`, `originCol=c`).
 *
 * @param {number} rows Количество строк.
 * @param {number} cols Количество колонок.
 * @param {(opts?: Object) => Object} [cellFactory=makeCell] Фабрика ячейки.
 * @returns {Object[][]} Двумерный массив ячеек.
 */
export function makeGrid(rows, cols, cellFactory = makeCell) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push(cellFactory({ originRow: r, originCol: c }));
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Создаёт объект таблицы со значениями по умолчанию.
 *
 * @param {Object} [opts={}] Переопределения полей таблицы.
 * @param {string} [opts.id] Идентификатор таблицы.
 * @param {string} [opts.nodeId] Идентификатор узла дерева, к которому привязана таблица.
 * @param {Object[][]} [opts.grid] Сетка ячеек.
 * @param {number[]} [opts.colWidths] Ширины колонок (px).
 * @param {boolean} [opts.protected] Признак защищённой таблицы.
 * @param {boolean} [opts.deletable] Признак удаляемой таблицы.
 * @returns {Object} Объект таблицы с заполненными полями по умолчанию.
 */
export function makeTable(opts = {}) {
  return {
    id: 't1',
    nodeId: 'n1',
    grid: makeGrid(2, 3),
    colWidths: [100, 100, 100],
    protected: false,
    deletable: true,
    ...opts,
  };
}
