/**
 * Тесты счётчика глубины блокировки трекинга (M.11).
 *
 * _trackingDepth заменил boolean _trackingDisabled: вложенные/перекрывающиеся
 * пары disableTracking/enableTracking композируются — markAsUnsaved начинает
 * срабатывать только после ПОСЛЕДНЕГО enableTracking, а лишний enable
 * (дисбаланс) не уводит счётчик ниже нуля.
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StorageManager } from '../../static/js/constructor/storage-manager.js';

beforeEach(() => {
  StorageManager._trackingDepth = 0;
  StorageManager._setState('saved');
});

afterEach(() => {
  // markAsUnsaved запускает 3-секундный debounce — снимаем, чтобы тест-процесс
  // не ждал таймер.
  StorageManager.destroy();
  StorageManager._trackingDepth = 0;
  StorageManager._setState('saved');
});

test('вложенные disable/disable/enable/enable: markAsUnsaved срабатывает только после последнего enable', () => {
  StorageManager.disableTracking();
  StorageManager.disableTracking();

  StorageManager.markAsUnsaved();
  assert.equal(StorageManager._state, 'saved', 'глубина 2 — трекинг выключен');

  StorageManager.enableTracking();
  StorageManager.markAsUnsaved();
  assert.equal(StorageManager._state, 'saved', 'глубина 1 — трекинг всё ещё выключен');

  StorageManager.enableTracking();
  StorageManager.markAsUnsaved();
  assert.equal(StorageManager._state, 'unsaved', 'глубина 0 — трекинг снова работает');
});

test('лишний enableTracking не уводит счётчик ниже нуля', () => {
  StorageManager.enableTracking();
  StorageManager.enableTracking();
  assert.equal(StorageManager._trackingDepth, 0);

  // Следующая пара disable/enable остаётся сбалансированной
  StorageManager.disableTracking();
  StorageManager.markAsUnsaved();
  assert.equal(StorageManager._state, 'saved');
  StorageManager.enableTracking();
  StorageManager.markAsUnsaved();
  assert.equal(StorageManager._state, 'unsaved');
});

test('withoutTracking композируется с внешним disableTracking', () => {
  StorageManager.disableTracking();

  StorageManager.withoutTracking(() => {
    StorageManager.markAsUnsaved();
  });
  assert.equal(StorageManager._state, 'saved', 'внутри и после withoutTracking — выключено');

  // Внешний disable ещё держит блокировку (boolean-версия здесь ошибочно включала трекинг)
  StorageManager.markAsUnsaved();
  assert.equal(StorageManager._state, 'saved');

  StorageManager.enableTracking();
  StorageManager.markAsUnsaved();
  assert.equal(StorageManager._state, 'unsaved');
});

test('withoutTracking восстанавливает глубину и при исключении', () => {
  StorageManager.disableTracking();
  assert.throws(() => {
    StorageManager.withoutTracking(() => {
      throw new Error('сбой внутри');
    });
  });
  assert.equal(StorageManager._trackingDepth, 1, 'глубина внешнего disable сохранена');
  StorageManager.enableTracking();
});
