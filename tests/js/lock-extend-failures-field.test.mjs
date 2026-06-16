/**
 * Регрессия pfe-11: счётчик подряд-неудач продления лока объявлен статически.
 *
 * _extendConsecutiveFailures раньше создавался только в _resetState (внутри
 * init). До первого init обращение к полю давало undefined — латентная опора
 * на `|| 0`-guard. Поле объявлено как static = 0, как и _MAX_EXTEND_FAILURES,
 * чтобы значение было корректным с момента загрузки класса.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LockManager } from '../../static/js/constructor/lock-manager.js';

test('_extendConsecutiveFailures объявлен и равен 0 (а не undefined)', () => {
  // Поле читается из определения класса — init/_resetState не вызывались.
  assert.equal(LockManager._extendConsecutiveFailures, 0);
});

test('_MAX_EXTEND_FAILURES рядом объявлен как число (контрольный)', () => {
  assert.equal(typeof LockManager._MAX_EXTEND_FAILURES, 'number');
});
