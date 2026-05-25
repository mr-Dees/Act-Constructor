import { Page, expect } from '@playwright/test';

/**
 * ID seed-актов из tests/playwright/seed.py.
 * Должны совпадать с константой SEED_ACT_IDS в seed.py.
 */
export const SEED_ACTS = {
  /** Пустой процессный акт (5 защищённых секций без потомков). */
  empty: 999001,
  /** Непроцессный акт с одной таблицей и одним текстблоком в секции 2. */
  withContent: 999002,
  /** Третий акт — используется в cross-tab сценарии (его удаляют). */
  forDelete: 999003,
} as const;

export function getActIds(): number[] {
  return Object.values(SEED_ACTS);
}

/**
 * Открывает /constructor?act_id={actId} и ждёт что step1 (дерево + preview)
 * прогрузился. Бросает ошибку если за 10 сек дерево не появилось.
 */
export async function openAct(page: Page, actId: number): Promise<void> {
  await page.goto(`/constructor?act_id=${actId}`);
  // #tree — ul внутри tree-container (tree_panel.html), всегда есть на step1.
  await page.locator('#tree').waitFor({ state: 'visible', timeout: 10000 });
  // Дождаться что корневой <li> (root-секция) отрендерился — это значит
  // AppState.renderTree() выполнился. AppState не публикуется в window, поэтому
  // проверяем результат через DOM.
  // tree-renderer вкладывает <ul class="tree"> внутрь #tree (который сам ul),
  // и в нём — <li class="tree-item"> на каждую секцию.
  await page.locator('#tree li.tree-item').first().waitFor({ state: 'attached', timeout: 10000 });
}

/**
 * Ждёт пока save-indicator перейдёт в состояние "saved" (класс .saved
 * на #saveIndicatorBtn). Дефолтное состояние — saved; после правок становится
 * "unsaved" (yellow) или "dirty" (red), потом возвращается в saved после autosave.
 */
export async function waitForSaveComplete(page: Page, timeoutMs = 15000): Promise<void> {
  await expect(page.locator('#saveIndicatorBtn')).toHaveClass(/\bsaved\b/, {
    timeout: timeoutMs,
  });
}

/**
 * Сбрасывает console-error трекинг и возвращает массив ошибок,
 * накопленных за время теста (для смок-проверки чистоты консоли).
 */
export function trackConsoleErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return { errors };
}
