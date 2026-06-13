/**
 * render-8: единый предикат показа заголовка таблицы для DOM-рендерера и
 * превью, согласованный с DOCX-эталоном
 * (app/domains/acts/formatters/docx/formatter.py::_add_table_title:
 * `title = customLabel or label; if not title: return`).
 *
 * Ключевой кейс рассинхрона: customLabel==='' (дефолт защищённых таблиц) —
 * DOCX показывает label, прежний фронт (customLabel !== '') скрывал заголовок.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowTableTitle, tableTitleText } from '../../static/js/constructor/table/table-title.js';

/** Воспроизводит предикат DOCX _add_table_title: показывать если customLabel||label. */
function docxShows(node) {
  return !!(node.customLabel || node.label);
}

test('customLabel==="" + label: заголовок показывается (паритет с DOCX)', () => {
  const node = { customLabel: '', number: 'Таблица 1', label: 'Таблица' };
  assert.equal(shouldShowTableTitle(node), true);
  assert.equal(docxShows(node), true, 'эталон DOCX тоже показывает');
});

test('пустые customLabel/number/label — заголовок скрыт', () => {
  const node = { customLabel: '', number: '', label: '' };
  assert.equal(shouldShowTableTitle(node), false);
});

test('заданный customLabel — показывается, текст = customLabel', () => {
  const node = { customLabel: 'Моя таблица', number: 'Таблица 2', label: 'Таблица' };
  assert.equal(shouldShowTableTitle(node), true);
  assert.equal(tableTitleText(node), 'Моя таблица');
  assert.equal(docxShows(node), true);
});

test('только label (customLabel undefined) — показывается label', () => {
  const node = { label: 'Таблица' };
  assert.equal(shouldShowTableTitle(node), true);
  assert.equal(tableTitleText(node), 'Таблица');
  assert.equal(docxShows(node), true);
});

test('текст заголовка: приоритет customLabel → number → label', () => {
  assert.equal(tableTitleText({ customLabel: 'A', number: 'B', label: 'C' }), 'A');
  assert.equal(tableTitleText({ customLabel: '', number: 'B', label: 'C' }), 'B');
  assert.equal(tableTitleText({ customLabel: '', number: '', label: 'C' }), 'C');
});

test('предикат показа согласован с DOCX при непустом customLabel или label', () => {
  // number — фронтовый fallback, в DOCX отсутствует; при пустых customLabel/label
  // фронт может показать number, что НЕ сужает показ относительно DOCX.
  const cases = [
    { customLabel: 'X', label: '' },
    { customLabel: '', label: 'Y' },
    { customLabel: 'X', label: 'Y' },
  ];
  for (const node of cases) {
    assert.equal(shouldShowTableTitle(node), docxShows(node), JSON.stringify(node));
  }
});
