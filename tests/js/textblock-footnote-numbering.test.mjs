/**
 * §5 new coverage: B-10 (сквозная нумерация сносок numberFootnotes) и 6.8
 * (UX-валидация URL validateLinkUrl) — чистые функции, проверяем без реального DOM.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  numberFootnotes,
  validateLinkUrl,
} from '../../static/js/constructor/textblock/textblock-links-footnotes.js';

/** Фейковая сноска: getAttribute/setAttribute/removeAttribute по data-атрибутам. */
function fakeFootnote(text) {
  const attrs = {};
  if (text !== undefined) attrs['data-footnote-text'] = text;
  return {
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
    num: () => attrs['data-footnote-number'],
  };
}

/** Фейковый корень: querySelectorAll('.text-footnote') → переданный список. */
function fakeRoot(footnotes) {
  return { querySelectorAll: (sel) => (sel === '.text-footnote' ? footnotes : []) };
}

// ── B-10: numberFootnotes ───────────────────────────────────────────────────

test('numberFootnotes: непустые сноски нумеруются сквозно 1,2,3', () => {
  const f = [fakeFootnote('a'), fakeFootnote('b'), fakeFootnote('c')];
  const next = numberFootnotes(fakeRoot(f));
  assert.deepEqual(f.map((x) => x.num()), ['1', '2', '3']);
  assert.equal(next, 4, 'возвращает следующий свободный номер');
});

test('numberFootnotes: пустая/пробельная сноска пропускается, номер снимается', () => {
  const empty = fakeFootnote('   ');
  empty.setAttribute('data-footnote-number', '99'); // устаревший номер
  const f = [fakeFootnote('a'), empty, fakeFootnote('b')];
  numberFootnotes(fakeRoot(f));
  assert.equal(f[0].num(), '1');
  assert.equal(empty.num(), undefined, 'устаревший номер снят с пустой сноски');
  assert.equal(f[2].num(), '2', 'нумерация сквозная по непустым');
});

test('numberFootnotes: startNumber задаёт офсет (сквозная нумерация в редакторе)', () => {
  const f = [fakeFootnote('a'), fakeFootnote('b')];
  const next = numberFootnotes(fakeRoot(f), 5);
  assert.deepEqual(f.map((x) => x.num()), ['5', '6']);
  assert.equal(next, 7);
});

test('numberFootnotes: null/без querySelectorAll → no-op, возвращает startNumber', () => {
  assert.equal(numberFootnotes(null), 1);
  assert.equal(numberFootnotes(null, 3), 3);
  assert.equal(numberFootnotes({}), 1);
});

// ── 6.8: validateLinkUrl ────────────────────────────────────────────────────

test('validateLinkUrl: http/https/mailto проходят как есть', () => {
  assert.deepEqual(validateLinkUrl('https://x.ru'), { ok: true, url: 'https://x.ru' });
  assert.deepEqual(validateLinkUrl('http://x.ru/a'), { ok: true, url: 'http://x.ru/a' });
  assert.deepEqual(validateLinkUrl('mailto:a@b.ru'), { ok: true, url: 'mailto:a@b.ru' });
});

test('validateLinkUrl: безсхемный ввод → подставляется https://', () => {
  assert.deepEqual(validateLinkUrl('www.example.com'), { ok: true, url: 'https://www.example.com' });
});

test('validateLinkUrl: регистр/пробелы вокруг значения нормализуются', () => {
  const r = validateLinkUrl('  https://X.RU ');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://X.RU'); // значение триммится, схема валидна
});

test('validateLinkUrl: javascript/data отбиваются (в т.ч. substring-обход)', () => {
  assert.equal(validateLinkUrl('javascript:alert(1)').ok, false);
  // Классический обход substring-проверки 'http://' — схема парсится строго.
  assert.equal(validateLinkUrl('javascript:alert("http://x")').ok, false);
  assert.equal(validateLinkUrl('data:text/html,<b>x</b>').ok, false);
});

test('validateLinkUrl: пустой/пробельный и неподдерживаемая схема', () => {
  assert.equal(validateLinkUrl('').ok, false);
  assert.equal(validateLinkUrl('   ').ok, false);
  const ftp = validateLinkUrl('ftp://x');
  assert.equal(ftp.ok, false);
  assert.match(ftp.message, /ftp/);
});
