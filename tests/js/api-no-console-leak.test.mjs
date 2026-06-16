/**
 * Регрессия I-CONSOLE (§4): права/метаданные акта НЕ должны утекать в console.
 *
 * Раньше _applyActContent логировал в DevTools права пользователя, режим
 * только чтения, метаданные акта и тип проверки — видно в проде. Эти 4
 * console.log убраны. Тест читает исходник api.js и проверяет отсутствие
 * соответствующих строк, чтобы регрессия не вернулась.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const apiSrc = readFileSync(
  fileURLToPath(new URL('../../static/js/shared/api.js', import.meta.url)),
  'utf8'
);

test('нет console.log прав пользователя', () => {
  assert.ok(!apiSrc.includes("console.log('Права пользователя:'"));
});

test('нет console.log режима только чтения', () => {
  assert.ok(!apiSrc.includes("console.log('Режим только чтения:'"));
});

test('нет console.log метаданных акта', () => {
  assert.ok(!apiSrc.includes("console.log('Загружены метаданные акта:'"));
});

test('нет console.log типа проверки', () => {
  assert.ok(!apiSrc.includes("console.log('Тип проверки:'"));
});
