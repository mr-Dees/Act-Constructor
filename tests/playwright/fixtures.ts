import { Page, expect, test as base } from '@playwright/test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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

const ROOT = path.resolve(__dirname, '..', '..');
const SEED_SCRIPT = path.join(__dirname, 'seed.py');

/**
 * Парсит .env (то же что global-setup) — нужно для DATABASE__* в seed-вызове.
 */
function loadDotEnv(): Record<string, string> {
  const envPath = path.join(ROOT, '.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return out;
  for (const raw of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Пере-сидит БД (DELETE + INSERT для актов 999001/2/3 и cleanup singleton-lock).
 * Используется в `test` fixture перед каждым тестом — иначе мутирующие
 * сценарии (rename / merge / DnD / delete) ломают последующие тесты,
 * которые ждут исходное состояние.
 */
function reseed(): void {
  const env = { ...process.env, ...loadDotEnv() };
  const r = spawnSync('python', [SEED_SCRIPT], { cwd: ROOT, env, encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(
      `Re-seed упал: status=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`
    );
  }
}

/**
 * Расширенный `test` с авто-reseed перед каждым тестом.
 * Все спеки должны импортить `test` отсюда, не из @playwright/test.
 */
export const test = base.extend<{}>({
  page: async ({ page }, use) => {
    reseed();
    await use(page);
  },
});

export { expect } from '@playwright/test';

/**
 * Открывает /constructor?act_id={actId} и ждёт что step1 (дерево + preview)
 * прогрузился. Бросает ошибку если за 10 сек дерево не появилось.
 */
export async function openAct(page: Page, actId: number): Promise<void> {
  await page.goto(`/constructor?act_id=${actId}`);
  // #tree — ul внутри tree-container (tree_panel.html), всегда есть на step1.
  await page.locator('#tree').waitFor({ state: 'visible', timeout: 10000 });
  // tree-renderer вкладывает <ul class="tree"> внутрь #tree (который сам ul),
  // и в нём — <li class="tree-item"> на каждую секцию.
  await page
    .locator('#tree li.tree-item')
    .first()
    .waitFor({ state: 'attached', timeout: 10000 });
}

/**
 * Ждёт пока save-indicator перейдёт в состояние "saved" (класс .saved
 * на #saveIndicatorBtn). Дефолтное состояние — saved; после правок становится
 * "unsaved" (yellow) → "local-only" (red, локально сохранено) → "saved"
 * (после DB-save через Ctrl+S или autosave).
 */
export async function waitForSaveComplete(
  page: Page,
  timeoutMs = 15000
): Promise<void> {
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
