/**
 * Чистая фабрика мемоизирующего кеша замечаний по таблицам.
 *
 * Вынесена в отдельный модуль БЕЗ импортов приложения/DOM, чтобы её можно было
 * импортировать и протестировать под node:test (как `*-core.js`-модули). Сам
 * инстанс кеша и его обвязка живут в `notifications-source-tables.js`, который
 * замыкает `collectFn` на `ValidationTable.collectContentWarnings()`.
 */

/**
 * Создаёт мемоизирующий кеш поверх `collectFn`.
 *
 * Считает `collectFn()` лениво при первом `get()` и держит результат до
 * `invalidate()`. Цель — один обход дерева за обновление предпросмотра,
 * переиспользуемый и рамками таблиц (_applyTableOutlines), и колокольчиком
 * (collectTableItems), и между poll-тиками. Исключение из `collectFn`
 * проглатывается и кешируется как `[]` (поведение fail-safe).
 *
 * @param {() => Array} collectFn Источник замечаний (обход дерева).
 * @returns {{ get: () => Array, invalidate: () => void }}
 */
export function makeWarningsCache(collectFn) {
  let cache = null;
  return {
    get() {
      if (cache === null) {
        try {
          cache = collectFn();
        } catch (e) {
          cache = [];
        }
      }
      return cache;
    },
    invalidate() {
      cache = null;
    },
  };
}
