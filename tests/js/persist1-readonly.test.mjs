/**
 * Тесты RO-гарда персистентности (PERSIST-1).
 *
 * Зритель read-only акта не должен генерировать фоновые PUT и тосты «Не удалось
 * сохранить». Две точки:
 *  - AuditIdService.assignMissingPointIds — ранний return при isReadOnly:
 *    не фетчит audit_point_id, не мутирует дерево (node.auditPointId), не
 *    помечает акт грязным;
 *  - периодический DB-save StorageManager — гард при isReadOnly: даже если
 *    состояние помечено несинхронизированным, тик не зовёт saveActContent.
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AuditIdService } from '../../static/js/constructor/services/id-generator.js';
import { StorageManager } from '../../static/js/constructor/storage-manager.js';
import { APIClient } from '../../static/js/shared/api.js';
import { AppConfig } from '../../static/js/shared/app-config.js';
import { AuthManager } from '../../static/js/shared/auth.js';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import { LifecycleHelper } from '../../static/js/constructor/lifecycle-helper.js';

const realFetch = globalThis.fetch;
const realMark = StorageManager.markAsUnsaved;
const realGetUser = AuthManager.getCurrentUser;
const realSaveActContent = APIClient.saveActContent;

let fetchCalls;
let markCalls;
let saveCalls;
let intervalCallbacks;

beforeEach(() => {
  fetchCalls = 0;
  markCalls = 0;
  saveCalls = 0;
  intervalCallbacks = [];

  globalThis.fetch = async () => { fetchCalls++; return { ok: true, json: async () => ({}) }; };
  StorageManager.markAsUnsaved = () => { markCalls++; };
  AuthManager.getCurrentUser = () => 'u42';
  APIClient.saveActContent = async (...args) => { saveCalls++; return args; };

  AppConfig.readOnlyMode.isReadOnly = false;

  // Стабы для _setupEventHandlers (навигация/интервалы) — как в
  // storage-lifecycle-cleanup.test.mjs.
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.document.addEventListener = () => {};
  globalThis.document.removeEventListener = () => {};
  globalThis.history = { replaceState() {}, pushState() {}, back() {} };
  globalThis.location = { href: 'http://test/', hostname: 'test', pathname: '/' };
  globalThis.setInterval = (cb) => { intervalCallbacks.push(cb); return intervalCallbacks.length; };
  globalThis.clearInterval = () => {};

  LifecycleHelper._handlers.clear();
  StorageManager._dbSaveInProgress = false;
  AppState._dragInProgress = false;
  globalThis.currentActId = 7;
});

afterEach(() => {
  StorageManager.destroy();
  StorageManager._setState('saved');
  globalThis.fetch = realFetch;
  StorageManager.markAsUnsaved = realMark;
  AuthManager.getCurrentUser = realGetUser;
  APIClient.saveActContent = realSaveActContent;
  AppConfig.readOnlyMode.isReadOnly = false;
  LifecycleHelper._handlers.clear();
  delete globalThis.addEventListener;
  delete globalThis.removeEventListener;
  delete globalThis.history;
  delete globalThis.location;
  globalThis.currentActId = null;
});

/** Дерево с item-узлами без auditPointId. */
function treeWithMissingIds() {
  return {
    id: 'root', type: 'item', children: [
      { id: 'n1', type: 'item', children: [] },
      { id: 'n2', type: 'item', children: [] },
    ],
  };
}

// ─── assignMissingPointIds ──────────────────────────────────────────────────

test('PERSIST-1: RO — assignMissingPointIds не фетчит, не мутирует дерево, не помечает dirty', async () => {
  AppConfig.readOnlyMode.isReadOnly = true;
  const tree = treeWithMissingIds();

  await AuditIdService.assignMissingPointIds(101, tree);

  assert.equal(fetchCalls, 0, 'RO: запрос audit_point_ids не отправляется');
  assert.equal(markCalls, 0, 'RO: акт не помечается грязным');
  assert.equal(tree.children[0].auditPointId, undefined, 'RO: узлы не мутированы');
  assert.equal(tree.children[1].auditPointId, undefined);
});

test('не-RO: assignMissingPointIds фетчит и присваивает audit_point_id узлам без него', async () => {
  AppConfig.readOnlyMode.isReadOnly = false;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ n1: 'AP-1', n2: 'AP-2' }) });
  const tree = treeWithMissingIds();

  await AuditIdService.assignMissingPointIds(101, tree);

  assert.equal(tree.children[0].auditPointId, 'AP-1', 'узлу присвоен audit_point_id');
  assert.equal(tree.children[1].auditPointId, 'AP-2');
});

// ─── периодический DB-save ──────────────────────────────────────────────────

/** Возвращает callback второго интервала (_periodicDbSaveInterval). */
function dbSaveTick() {
  StorageManager._setupEventHandlers();
  return intervalCallbacks[1];
}

test('PERSIST-1: RO — периодический DB-save молчит даже при несинхронизированном состоянии', async () => {
  AppConfig.readOnlyMode.isReadOnly = true;
  StorageManager._setState('local-only'); // hasUnsyncedChanges() → true

  const tick = dbSaveTick();
  await tick();

  assert.equal(saveCalls, 0, 'RO: периодический DB-save не вызывает saveActContent');
});

test('не-RO: периодический DB-save сохраняет при несинхронизированном состоянии (гард нагружен)', async () => {
  AppConfig.readOnlyMode.isReadOnly = false;
  StorageManager._setState('local-only');

  const tick = dbSaveTick();
  await tick();

  assert.equal(saveCalls, 1, 'не-RO: периодический DB-save вызывает saveActContent при unsynced');
});
