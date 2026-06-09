/**
 * Чистые помощники для разбора ошибок API (без DOM).
 *
 * Вынесено из api.js, чтобы покрыть форматирование 422-detail unit-тестами:
 * api.js импортирует window-bound зависимости и не грузится под node:test.
 */

/**
 * Сворачивает поле `detail` ответа FastAPI в человекочитаемую строку.
 *
 * На 422 (валидация тела запроса) FastAPI возвращает `detail` массивом
 * объектов `{loc, msg, type, ...}`. Показываем `msg` каждого пункта (у
 * pydantic-валидаторов он уже на русском). Строковый detail (из AppError)
 * возвращается как есть. null/undefined → null, чтобы вызывающая сторона могла
 * подставить свой fallback.
 *
 * @param {string|Array<{msg?:string}>|null|undefined} detail
 * @returns {string|null} Человекочитаемая строка или null.
 */
export function formatValidationDetail(detail) {
  if (detail == null) return null;

  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && d.msg) || JSON.stringify(d))
      .join('; ');
  }

  return detail;
}

// Дублируем в window ради inline-скриптов в шаблонах (см. CLAUDE.md).
// Guard: модуль также импортируется в node:test, где window отсутствует.
if (typeof window !== 'undefined') {
  window.formatValidationDetail = formatValidationDetail;
}
