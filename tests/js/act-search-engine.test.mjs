/**
 * B1: движок поиска/замены по текстблокам. Тестируем КРИТИЧНУЮ чистую логику без
 * реального DOM: сопоставление строк (литерал/регистр/whole-word-кириллица/regex/
 * перекрытия/лимит), guard невалидного regex, сегментацию пробегов с исключением
 * капсул и защиту замены от пересечения капсулы.
 *
 * Реального Range / CSS.highlights / document.createRange в node нет →
 * findInTarget/buildAllMatches (в части построения Range), _rangeFromRun, живая
 * замена через deleteContents и весь модуль подсветки ОТЛОЖЕНЫ в Playwright-спек
 * (B2). Здесь — только то, что тестируется на фейковых узлах без обмана ассертов.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActSearchEngine } from '../../static/js/constructor/search/act-search-engine.js';

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

// --- Фейковые узлы (как fakeLink в dedup-тесте): ровно поля, что читает движок.

/** Текстовый узел. */
function txt(data) {
  return { nodeType: 3, data, textContent: data, firstChild: null, nextSibling: null, parentNode: null };
}

/** Элемент с детьми; связывает firstChild/nextSibling/parentNode. */
function elem(tagName, children = [], className = '') {
  const set = new Set(className ? className.split(' ') : []);
  const node = {
    nodeType: 1,
    tagName,
    classList: { contains: (c) => set.has(c) },
    firstChild: children[0] || null,
    nextSibling: null,
    parentNode: null,
  };
  let tc = '';
  children.forEach((c) => { tc += c.textContent || ''; });
  node.textContent = tc;
  for (let i = 0; i < children.length; i++) {
    children[i].nextSibling = children[i + 1] || null;
    children[i].parentNode = node;
  }
  return node;
}

/** Капсула-ссылка (contenteditable=false-атом) с текстом внутри. */
const capsule = (text) => elem('SPAN', [txt(text)], 'text-link');

// ---------------------------------------------------------------------------
// _matchesInString — литерал / регистр / whole-word / regex / перекрытия / лимит
// ---------------------------------------------------------------------------

test('_matchesInString: литерал, регистронезависимо по умолчанию', () => {
  const r = ActSearchEngine._matchesInString('Foo foo FOO', 'foo', {});
  assert.deepEqual(r.matches, [{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }]);
  assert.equal(r.capped, false);
});

test('_matchesInString: литерал, caseSensitive матчит только точный регистр', () => {
  const r = ActSearchEngine._matchesInString('Foo foo', 'foo', { caseSensitive: true });
  assert.deepEqual(r.matches, [{ start: 4, end: 7 }]);
});

test('_matchesInString: спецсимволы экранируются (литерал), regex-режим — нет', () => {
  const lit = ActSearchEngine._matchesInString('a.b.c', '.', {});
  assert.deepEqual(lit.matches, [{ start: 1, end: 2 }, { start: 3, end: 4 }]); // только точки
  const rx = ActSearchEngine._matchesInString('a.b.c', '.', { regex: true });
  assert.equal(rx.matches.length, 5); // '.' — любой символ
});

test('_matchesInString: whole-word кириллица — «акт» НЕ внутри «характеристика»', () => {
  // Подстрокой находится (индекс 3), whole-word — нет.
  assert.equal(ActSearchEngine._matchesInString('характеристика', 'акт', {}).matches.length, 1);
  assert.deepEqual(ActSearchEngine._matchesInString('характеристика', 'акт', { wholeWord: true }).matches, []);
});

test('_matchesInString: whole-word матчит отдельное слово, на границах и у пунктуации', () => {
  assert.deepEqual(ActSearchEngine._matchesInString('акт', 'акт', { wholeWord: true }).matches,
    [{ start: 0, end: 3 }]);
  assert.deepEqual(ActSearchEngine._matchesInString('это акт документ', 'акт', { wholeWord: true }).matches,
    [{ start: 4, end: 7 }]);
  assert.deepEqual(ActSearchEngine._matchesInString('«акт».', 'акт', { wholeWord: true }).matches,
    [{ start: 1, end: 4 }]); // рядом кавычка/точка — граница слова
});

test('_matchesInString: whole-word регистронезависим', () => {
  assert.deepEqual(ActSearchEngine._matchesInString('АКТ и ещё', 'акт', { wholeWord: true }).matches,
    [{ start: 0, end: 3 }]);
});

test('_matchesInString: перекрытия — продвигаемся за конец (не перекрываем)', () => {
  const r = ActSearchEngine._matchesInString('aaaa', 'aa', {});
  assert.deepEqual(r.matches, [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
});

test('_matchesInString: жёсткий лимит совпадений (cap) → capped=true', () => {
  const r = ActSearchEngine._matchesInString('aaaa', 'a', { cap: 2 });
  assert.equal(r.matches.length, 2);
  assert.equal(r.capped, true);
});

test('_matchesInString: пустой запрос → нет совпадений, без ошибки', () => {
  const r = ActSearchEngine._matchesInString('foo', '', {});
  assert.deepEqual(r.matches, []);
  assert.equal(r.error, undefined);
});

test('_matchesInString: валидный regex-паттерн', () => {
  const r = ActSearchEngine._matchesInString('a1b22c333', '\\d+', { regex: true });
  assert.deepEqual(r.matches, [{ start: 1, end: 2 }, { start: 3, end: 5 }, { start: 6, end: 9 }]);
});

test('_matchesInString: regex с пустыми совпадениями (\\d*) НЕ возвращает пустых матчей', () => {
  // \d* на строке без цифр даёт только пустые совпадения — их быть не должно
  // (пустой матч → Range на весь пробег → потеря текста при замене).
  assert.deepEqual(ActSearchEngine._matchesInString('foobar', '\\d*', { regex: true }).matches, []);
  // среди цифр — только непустые куски, пустые между ними отброшены.
  assert.deepEqual(ActSearchEngine._matchesInString('a1b2', '\\d*', { regex: true }).matches,
    [{ start: 1, end: 2 }, { start: 3, end: 4 }]);
});

test('_scanWithRegex: пустое совпадение (a*) не зацикливается и пропускается', () => {
  const r = ActSearchEngine._scanWithRegex('baa', /a*/g, 5000);
  assert.deepEqual(r.matches, [{ start: 1, end: 3 }]); // только непустой «aa», без пустых
});

test('_locate: offset 0 → начало ПЕРВОГО сегмента (не конец пробега) для start и end', () => {
  const run = { segments: [{ node: 'A', start: 0, end: 3 }, { node: 'B', start: 3, end: 6 }] };
  assert.deepEqual(ActSearchEngine._locate(run, 0, false), { node: 'A', offset: 0 });
  assert.deepEqual(ActSearchEngine._locate(run, 0, true), { node: 'A', offset: 0 }); // регресс: было {B,3}
  assert.deepEqual(ActSearchEngine._locate(run, 5, true), { node: 'B', offset: 2 });
  assert.deepEqual(ActSearchEngine._locate(run, 3, true), { node: 'A', offset: 3 }); // граница → ранний сегмент
  assert.deepEqual(ActSearchEngine._locate(run, 3, false), { node: 'B', offset: 0 }); // граница → поздний сегмент
});

// ---------------------------------------------------------------------------
// _buildMatcher — guard невалидного regex (никогда не бросает)
// ---------------------------------------------------------------------------

test('_buildMatcher: невалидный regex → {error}, без исключения', () => {
  assert.ok(ActSearchEngine._buildMatcher('[', { regex: true }).error);
  assert.ok(ActSearchEngine._buildMatcher('(', { regex: true }).error);
});

test('_buildMatcher: те же символы как ЛИТЕРАЛ экранируются — не ошибка', () => {
  assert.ok(ActSearchEngine._buildMatcher('[', {}).regex instanceof RegExp);
  assert.ok(ActSearchEngine._buildMatcher('(', {}).regex instanceof RegExp);
});

test('_buildMatcher: пустой запрос → {empty:true}', () => {
  const b = ActSearchEngine._buildMatcher('', {});
  assert.equal(b.empty, true);
  assert.equal(b.regex, null);
});

test('_matchesInString: невалидный regex → структурная ошибка, matches пуст', () => {
  const r = ActSearchEngine._matchesInString('foo', '(', { regex: true });
  assert.ok(r.error);
  assert.deepEqual(r.matches, []);
});

test('buildAllMatches: невалидный regex → {error} без обхода целей и без Range', () => {
  const r = ActSearchEngine.buildAllMatches('[', { regex: true });
  assert.ok(r.error);
  assert.deepEqual(r.matches, []);
});

// ---------------------------------------------------------------------------
// collectRuns — исключение капсул, склейка формата, разрывы <br>/guard
// ---------------------------------------------------------------------------

test('collectRuns: foo<capsule>x</capsule>bar → пробеги [foo, bar], «x» исключён', () => {
  const editor = elem('DIV', [txt('foo'), capsule('x'), txt('bar')]);
  const runs = ActSearchEngine.collectRuns(editor);
  assert.deepEqual(runs.map((r) => r.text), ['foo', 'bar']);
  assert.ok(runs.every((r) => !r.text.includes('x'))); // текст капсулы нигде
});

test('collectRuns: капсула математически не пересекается поиском', () => {
  const editor = elem('DIV', [txt('foo'), capsule('x'), txt('bar')]);
  const runs = ActSearchEngine.collectRuns(editor);
  // Поиск через границу капсулы даёт ноль — совпадение не может её пересечь.
  assert.deepEqual(ActSearchEngine.findInRuns(runs, 'oobar', {}).matches, []);
  assert.deepEqual(ActSearchEngine.findInRuns(runs, 'xba', {}).matches, []);
  assert.deepEqual(ActSearchEngine.findInRuns(runs, 'fox', {}).matches, []);
  // Внешние пробеги матчатся штатно.
  assert.deepEqual(ActSearchEngine.findInRuns(runs, 'foo', {}).matches, [{ runIndex: 0, start: 0, end: 3 }]);
  assert.deepEqual(ActSearchEngine.findInRuns(runs, 'bar', {}).matches, [{ runIndex: 1, start: 0, end: 3 }]);
});

test('collectRuns: форматирование ВНУТРИ капсулы не протекает в пробег (вложенные дети)', () => {
  // Капсула с вложенным <b>x</b> — DFS не должен спускаться в поддерево капсулы,
  // иначе текст капсулы протёк бы в пробег и совпадение смогло бы его затронуть.
  const nestedCap = elem('SPAN', [elem('B', [txt('SECRET')])], 'text-link');
  const editor = elem('DIV', [txt('foo'), nestedCap, txt('bar')]);
  const runs = ActSearchEngine.collectRuns(editor);
  assert.deepEqual(runs.map((r) => r.text), ['foo', 'bar']);
  assert.ok(runs.every((r) => !r.text.includes('SECRET'))); // текст из-под капсулы нигде
});

test('collectRuns: inline-форматирование (b/i/span) склеивается в ОДИН пробег', () => {
  const editor = elem('DIV', [txt('foo'), elem('B', [txt('bar')]), txt('baz')]);
  const runs = ActSearchEngine.collectRuns(editor);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, 'foobarbaz');
  assert.equal(runs[0].segments.length, 3); // 3 текстовых узла в одном пробеге
  // Совпадение через границу формата находится (кросс-формат).
  assert.deepEqual(ActSearchEngine.findInRuns(runs, 'obarb', {}).matches, [{ runIndex: 0, start: 2, end: 7 }]);
});

test('collectRuns: <br> разрывает пробег', () => {
  const editor = elem('DIV', [txt('foo'), elem('BR', []), txt('bar')]);
  assert.deepEqual(ActSearchEngine.collectRuns(editor).map((r) => r.text), ['foo', 'bar']);
});

test('collectRuns: caret-guard U+FEFF и якорь размера U+200B пропускаются без разрыва', () => {
  const editor = elem('DIV', [txt('foo'), txt('﻿'), txt('​'), txt('bar')]);
  const runs = ActSearchEngine.collectRuns(editor);
  assert.deepEqual(runs.map((r) => r.text), ['foobar']); // один пробег, невидимки вырезаны
});

test('collectRuns: <img> (void-атом) разрывает пробег — замена не удалит картинку', () => {
  const editor = elem('DIV', [txt('foo'), elem('IMG', []), txt('bar')]);
  const runs = ActSearchEngine.collectRuns(editor);
  assert.deepEqual(runs.map((r) => r.text), ['foo', 'bar']);
  // Совпадение не может «перепрыгнуть» картинку.
  assert.deepEqual(ActSearchEngine.findInRuns(runs, 'oobar', {}).matches, []);
});

test('collectRuns: капсула внутри форматирования тоже разрывает пробег', () => {
  const editor = elem('DIV', [elem('B', [txt('foo'), capsule('LINK'), txt('bar')])]);
  const runs = ActSearchEngine.collectRuns(editor);
  assert.deepEqual(runs.map((r) => r.text), ['foo', 'bar']);
  assert.ok(runs.every((r) => !r.text.includes('LINK')));
});

// ---------------------------------------------------------------------------
// replaceRange — защита от пересечения капсулы + сплайс в одном узле
// ---------------------------------------------------------------------------

test('_hasCapsuleAncestor: текст внутри капсулы → true; вне → false', () => {
  const cap = capsule('x');
  assert.equal(ActSearchEngine._hasCapsuleAncestor(cap.firstChild), true); // txt('x') под капсулой
  assert.equal(ActSearchEngine._hasCapsuleAncestor(txt('plain')), false);
});

test('replaceRange: граница внутри капсулы → бросает (defense-in-depth)', () => {
  const cap = capsule('x');
  const inner = cap.firstChild;
  const range = {
    startContainer: inner, endContainer: inner, startOffset: 0, endOffset: 1,
    setStart() {}, setEnd() {},
  };
  assert.throws(() => ActSearchEngine.replaceRange(range, 'z'), /капсул/);
});

test('replaceRange: один текстовый узел → сплайс nodeValue', () => {
  const tn = { nodeType: 3, nodeValue: 'foobar', parentNode: null };
  let caretStart = null;
  const range = {
    startContainer: tn, endContainer: tn, startOffset: 0, endOffset: 3,
    setStart(_n, o) { caretStart = o; }, setEnd() {},
  };
  ActSearchEngine.replaceRange(range, 'XYZ');
  assert.equal(tn.nodeValue, 'XYZbar');
  assert.equal(caretStart, 3); // каретка схлопнута на конец вставки
});
