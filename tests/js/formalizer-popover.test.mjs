/**
 * Смоук панели-формализатора: цепочка импортов резолвится под браузер-стабом,
 * объект экспортирован с ключевыми методами и в window. DOM-heavy поток
 * (formalize → превью → применить) покрывается вручную/e2e в браузере.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormalizerPopover } from '../../static/js/constructor/text-actions/formalizer-popover.js';

test('FormalizerPopover: экспортирован объект с ключевыми методами', () => {
  for (const m of ['open', 'close', '_build', '_run', '_renderPreview', '_accept', '_gatherSource']) {
    assert.equal(typeof FormalizerPopover[m], 'function', `метод ${m}`);
  }
});

test('FormalizerPopover: продублирован в window для inline-скриптов', () => {
  assert.equal(globalThis.window.FormalizerPopover, FormalizerPopover);
});

// --- _gatherSource: сбор свободного текста из заполненных полей карточки ---

const opt = (enabled, content) => ({ enabled, content });

test('_gatherSource: собирает непустые поля в порядке карточки через пустую строку', () => {
  const violation = {
    violated: 'Нарушен регламент',
    established: 'Выявлено 5 случаев',
    reasons: opt(true, 'Отсутствие контроля'),
    measures: opt(true, 'Проведён инструктаж'),
    consequences: opt(true, 'Финансовый ущерб'),
    responsible: opt(true, 'Иванов И.И.'),
  };
  assert.equal(
    FormalizerPopover._gatherSource(violation),
    'Нарушен регламент\n\nВыявлено 5 случаев\n\nОтсутствие контроля\n\nПроведён инструктаж\n\nФинансовый ущерб\n\nИванов И.И.',
  );
});

test('_gatherSource: выключенные опциональные блоки пропускаются даже с текстом', () => {
  const violation = {
    violated: 'Нарушено X',
    established: '',
    reasons: opt(false, 'скрытая причина'),
    measures: opt(true, 'Меры приняты'),
    consequences: opt(false, 'скрытые последствия'),
    responsible: opt(false, ''),
  };
  assert.equal(FormalizerPopover._gatherSource(violation), 'Нарушено X\n\nМеры приняты');
});

test('_gatherSource: пустые и пробельные поля не попадают в текст', () => {
  const violation = {
    violated: '   ',
    established: 'Установлено',
    reasons: opt(true, '   '),
    measures: opt(true, ''),
    consequences: opt(true, 'Последствия'),
    responsible: opt(true, ''),
  };
  assert.equal(FormalizerPopover._gatherSource(violation), 'Установлено\n\nПоследствия');
});

test('_gatherSource: пустое/отсутствующее нарушение → пустая строка', () => {
  assert.equal(FormalizerPopover._gatherSource(null), '');
  assert.equal(FormalizerPopover._gatherSource(undefined), '');
  assert.equal(FormalizerPopover._gatherSource({
    violated: '', established: '',
    reasons: opt(true, ''), measures: opt(false, 'x'),
    consequences: opt(true, ''), responsible: opt(true, ''),
  }), '');
});
