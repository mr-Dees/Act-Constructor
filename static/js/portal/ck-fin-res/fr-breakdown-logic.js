/**
 * Чистая логика развертки сумм по ТБ (без DOM): деньги в целых копейках.
 * Используется модалкой распределения и рендером ячеек таблицы ЦКФР.
 */

export const fmtRub = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Копейки → строка '1 234 567,89'. */
export function fmtKop(kop) {
  return fmtRub.format((kop || 0) / 100);
}

/** Строка пользователя → копейки (int). Терпима к пробелам и запятой/точке. NaN при мусоре/минусе. */
export function parseKop(s) {
  if (s == null) return 0;
  const norm = String(s).replace(/\s| /g, '').replace(',', '.');
  if (norm === '' || norm === '.') return 0;
  const v = Number(norm);
  if (!isFinite(v) || v < 0) return NaN;
  return Math.round(v * 100);
}

/** Метод наибольшего остатка: totalKop делится на n частей, сумма частей РОВНО totalKop. */
export function largestRemainder(totalKop, n) {
  if (n <= 0) return [];
  const base = Math.floor(totalKop / n);
  const rest = totalKop - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/** «Красивый» шаг ползунка в рублях (~150 шагов на диапазон). */
export function niceStep(totalKop) {
  const raw = totalKop / 100 / 150;
  if (raw <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Сумма распределённого по всем ТБ, копейки. rows: {[tbId]: {a}} */
export function sumKop(rows) {
  return Object.values(rows).reduce((s, r) => s + (r.a || 0), 0);
}

/** Максимум, доступный строке ТБ (ВКЛЮЧАЯ её текущую сумму) при цели targetKop. */
export function headroomKop(rows, targetKop, tbId) {
  const others = sumKop(rows) - ((rows[tbId] && rows[tbId].a) || 0);
  return Math.max(0, targetKop - others);
}

if (typeof window !== 'undefined') {
  window.FRBreakdownLogic = { fmtKop, parseKop, largestRemainder, niceStep, sumKop, headroomKop };
}
