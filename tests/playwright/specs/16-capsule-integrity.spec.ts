import { test, expect } from '@playwright/test';
import { openAct, SEED_ACTS } from '../fixtures';

// Прогоняет validateAndRepairCapsules в браузере на заданном HTML.
async function repair(page, html: string): Promise<string> {
  return await page.evaluate((h) => {
    // Менеджер текстблоков экспонирован на window в textblock-core.js.
    const mgr = (window as any).textBlockManager;
    return mgr.validateAndRepairCapsules(h);
  }, html);
}

test.describe('capsule-integrity: validateAndRepairCapsules', () => {
  test.beforeEach(async ({ page }) => { await openAct(page, SEED_ACTS.withContent); });

  test('дубль data-link-id у НЕ-соседних капсул → клону свежий id', async ({ page }) => {
    const html =
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">A</span>' +
      ' текст ' +
      '<span class="text-link" data-link-id="L1" data-link-url="http://b">B</span>';
    const out = await repair(page, html);
    const ids = [...out.matchAll(/data-link-id="([^"]+)"/g)].map(m => m[1]);
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]); // дубль устранён
  });

  test('расщеплённый клон (тот же id, соседи, тот же url) → склейка в одну капсулу', async ({ page }) => {
    const html =
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">Ссы</span>' +
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">лка</span>';
    const out = await repair(page, html);
    const count = (out.match(/text-link/g) || []).length;
    expect(count).toBe(1);
    expect(out).toContain('>Ссылка<');
  });

  test('расщеплённый клон (разделитель — guard-узел U+FEFF) → склейка', async ({ page }) => {
    // _isInsignificantText: guard-char (U+FEFF) пропускается как незначимый;
    // _areAdjacentSplit должна видеть капсулы «соседними» и склеить их.
    const guard = '\uFEFF';
    const html =
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">Час</span>' +
      guard +
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">ть</span>';
    const out = await repair(page, html);
    const count = (out.match(/text-link/g) || []).length;
    expect(count).toBe(1);
    expect(out).toContain('>Часть<');
    // guard-символ вычищен _cleanCapGuards в конце _repairCapsulesInRoot
    expect(out).not.toContain(guard);
  });

  test('тот же id + реальный пробел между капсулами → не сливаются (свежий id)', async ({ page }) => {
    // Обычный пробел — значимый текст; _areAdjacentSplit вернёт false.
    const html =
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">A</span>' +
      ' ' +
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">B</span>';
    const out = await repair(page, html);
    const ids = [...out.matchAll(/data-link-id="([^"]+)"/g)].map(m => m[1]);
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('пустой data-footnote-text → разворот в plain-text', async ({ page }) => {
    const html = '<span class="text-footnote" data-footnote-id="F1" data-footnote-text="">слово</span>';
    const out = await repair(page, html);
    expect(out).not.toContain('text-footnote');
    expect(out).toContain('слово');
  });

  test('пустой data-link-url → разворот в plain-text', async ({ page }) => {
    const html = '<span class="text-link" data-link-id="L1" data-link-url="">слово</span>';
    const out = await repair(page, html);
    expect(out).not.toContain('text-link');
    expect(out).toContain('слово');
  });

  test('идемпотентность: повторный прогон не меняет результат', async ({ page }) => {
    const html =
      '<span class="text-link" data-link-id="L1" data-link-url="http://a">A</span>' +
      '<span class="text-footnote" data-footnote-id="F1" data-footnote-text="прим">x</span>';
    const once = await repair(page, html);
    const twice = await repair(page, once);
    expect(twice).toBe(once);
  });

  test('страховка: guard-символ и contenteditable вычищаются', async ({ page }) => {
    const guardChar = '\uFEFF';
    const html = '<span class="text-link" data-link-id="L1" data-link-url="http://a" contenteditable="false">A' + guardChar + '</span>';
    const out = await repair(page, html);
    expect(out).not.toContain(guardChar);
    expect(out).not.toContain('contenteditable');
  });
});
