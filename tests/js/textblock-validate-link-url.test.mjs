/**
 * #9: validateLinkUrl — host:port больше не принимается за URL-схему.
 * UX-превалидатор (не бэк-санитайзер), но легитимный 'example.com:8443'
 * раньше отклонялся как «схема example.com». Опасные схемы по-прежнему блок.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLinkUrl } from '../../static/js/constructor/textblock/textblock-links-footnotes.js';

test('#9: host:port трактуется как адрес → https://', () => {
  assert.deepEqual(validateLinkUrl('example.com:8443'), { ok: true, url: 'https://example.com:8443' });
  assert.deepEqual(validateLinkUrl('localhost:8080'), { ok: true, url: 'https://localhost:8080' });
});

test('#9-регресс: IP:port тоже https:// (как и раньше)', () => {
  assert.deepEqual(validateLinkUrl('192.168.1.1:8080'), { ok: true, url: 'https://192.168.1.1:8080' });
});

test('известные схемы с // проходят как есть', () => {
  assert.deepEqual(validateLinkUrl('http://example.com'), { ok: true, url: 'http://example.com' });
  assert.deepEqual(validateLinkUrl('https://a.b/c'), { ok: true, url: 'https://a.b/c' });
  assert.deepEqual(validateLinkUrl('ftp://host/f'), { ok: true, url: 'ftp://host/f' });
});

test('схемы без // (mailto/tel/file) распознаются', () => {
  assert.equal(validateLinkUrl('mailto:x@y.com').ok, true);
  assert.equal(validateLinkUrl('tel:+123').ok, true);
  assert.equal(validateLinkUrl('file:///p').ok, true);
});

test('опасные схемы блокируются (с // и без)', () => {
  assert.equal(validateLinkUrl('javascript:alert(1)').ok, false);
  assert.equal(validateLinkUrl('javascript://x').ok, false);
  assert.equal(validateLinkUrl('data:text/html,x').ok, false);
  assert.equal(validateLinkUrl('vbscript:msgbox').ok, false);
});

test('неизвестная схема с authority отклоняется', () => {
  assert.equal(validateLinkUrl('customscheme://foo').ok, false);
});

test('schemeless, якорь и пустой — прежнее поведение', () => {
  assert.deepEqual(validateLinkUrl('www.example.com'), { ok: true, url: 'https://www.example.com' });
  assert.deepEqual(validateLinkUrl('#anchor'), { ok: true, url: '#anchor' });
  assert.equal(validateLinkUrl('').ok, false);
});
