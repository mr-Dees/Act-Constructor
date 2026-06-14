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

test('forceSaveAsync: при throw в forceSave отложенный enableTracking всё равно выполняется (Finding 7)', async () => {
  // Зеркало withoutTracking-throws: forceSave() кидает → _trackingDepth
  // обязан вернуться к доисходному значению (а не залипнуть > 0), иначе
  // markAsUnsaved() навсегда станет no-op'ом.
  const realRaf = globalThis.requestAnimationFrame;
  const realSetTimeout = globalThis.setTimeout;
  const realForceSave = StorageManager.forceSave;

  // rAF и setTimeout (только для deferred enableTracking) исполняем синхронно,
  // чтобы прогнать весь pipeline forceSaveAsync без реальных таймеров.
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
  globalThis.setTimeout = (cb) => { cb(); return 0; };
  StorageManager.forceSave = () => { throw new Error('сбой forceSave'); };

  const depthBefore = StorageManager._trackingDepth;
  try {
    const result = await StorageManager.forceSaveAsync();
    assert.equal(result, false, 'при сбое forceSave результат false');
    assert.equal(
      StorageManager._trackingDepth,
      depthBefore,
      'глубина трекинга вернулась к доисходной — enableTracking выполнился даже при throw'
    );
  } finally {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.setTimeout = realSetTimeout;
    StorageManager.forceSave = realForceSave;
  }
});

test('forceSaveAsync: кадр не наступил — destroy() сбрасывает залипший трекинг (#5)', () => {
  // rAF, который НИКОГДА не вызывает колбэк (вкладка в фоне / страница рушится):
  // отложенный enableTracking не выполнится, _trackingDepth залип бы навсегда.
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  try {
    StorageManager._trackingDepth = 0;
    // Не await: промис не резолвится без кадра — нам важен синхронный инкремент.
    StorageManager.forceSaveAsync();
    assert.equal(StorageManager._trackingDepth, 1, 'disableTracking сработал синхронно');

    // destroy() обязан вернуть счётчик в 0, иначе markAsUnsaved — навсегда no-op.
    StorageManager.destroy();
    assert.equal(StorageManager._trackingDepth, 0, 'destroy сбросил залипший счётчик');

    StorageManager._setState('saved');
    StorageManager.markAsUnsaved();
    assert.equal(StorageManager._state, 'unsaved', 'после destroy трекинг снова работает');
  } finally {
    globalThis.requestAnimationFrame = realRaf;
  }
});
