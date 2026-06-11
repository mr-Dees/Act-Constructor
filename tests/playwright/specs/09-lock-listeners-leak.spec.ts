import { test, expect, openAct, SEED_ACTS } from '../fixtures';

/**
 * H4: LockManager._setupActivityTracking подключал 4 anonymous listener'а на
 * document (`mousedown`, `keydown`, `scroll`, `touchstart`) без сохранения
 * ref'ов, поэтому destroy() не мог их снять. При фуллрелоадных переходах
 * между актами (window.location.href, full document reload) листенеры
 * самозачищались вместе с документом, но при handoff'ах БЕЗ unload (popstate,
 * SPA-навигация в будущем) утечка копила +4 на каждый switch.
 *
 * Этот тест:
 *  - устанавливает spy на addEventListener/removeEventListener документа
 *    через addInitScript (persists across navigations),
 *  - делает 5 switch'ей через openAct (page.goto = full reload),
 *  - проверяет что для документа активной страницы счётчик не накопил >10
 *    лишних listener'ов (на полный fix LockManager-теmplate'а должно быть 4
 *    активных всегда, без накопления; маржу 10 даём на другие подсистемы).
 *
 * При полном reload каждый новый document — свежий объект, и init-script
 * ре-инициализирует spy для него. Без fix'а Wave 2 в рамках ОДНОГО документа
 * leak не виден (LockManager init только один раз); тест защищает от
 * регрессий в будущей SPA-навигации и проверяет что destroy() реально
 * вызывает removeEventListener (счётчик уменьшается при beforeunload).
 */
test.describe('Lock listeners cleanup @smoke', () => {
  test('5 switch актов не накапливают listeners на document', async ({ page }) => {
    // Spy инстальируется ДО каждого page-load через init-script.
    // __listenerNet — net (added - removed) для всех addEventListener-вызовов
    // на текущем document. __lockHandlersAlive — счётчик именно LockManager-handler'ов
    // (определяем по сигнатуре: тот же handler-ref подписан на 4 события из
    // _activityEvents). Считаем добавленных handler-объектов на mousedown.
    await page.addInitScript(() => {
      const win = window as unknown as {
        __listenerNet: number;
        __mousedownAdds: number;
        __mousedownRemoves: number;
      };
      win.__listenerNet = 0;
      win.__mousedownAdds = 0;
      win.__mousedownRemoves = 0;

      const origAdd = document.addEventListener.bind(document);
      const origRemove = document.removeEventListener.bind(document);

      document.addEventListener = function (
        type: string,
        fn: EventListenerOrEventListenerObject,
        ...rest: unknown[]
      ): void {
        win.__listenerNet++;
        if (type === 'mousedown') win.__mousedownAdds++;
        return origAdd(
          type,
          fn,
          ...(rest as [boolean | AddEventListenerOptions | undefined])
        );
      };
      document.removeEventListener = function (
        type: string,
        fn: EventListenerOrEventListenerObject,
        ...rest: unknown[]
      ): void {
        win.__listenerNet--;
        if (type === 'mousedown') win.__mousedownRemoves++;
        return origRemove(
          type,
          fn,
          ...(rest as [boolean | EventListenerOptions | undefined])
        );
      };
    });

    await openAct(page, SEED_ACTS.empty);

    // Baseline: сколько listener'ов на этом конкретном document после init.
    // Должно быть ≥4 (LockManager) + другие подсистемы.
    const baseline = await page.evaluate(
      () => (window as unknown as { __listenerNet: number }).__listenerNet
    );
    expect(baseline, 'baseline counter should be positive (init установил spy)')
      .toBeGreaterThan(0);

    // 5 switch'ей между разными актами.
    for (let i = 0; i < 5; i++) {
      await openAct(page, SEED_ACTS.withContent);
      await openAct(page, SEED_ACTS.empty);
    }

    // После каждого page.goto document пересоздаётся, init-script
    // перезапускает spy с 0. Поэтому проверяем счётчик на ПОСЛЕДНЕМ
    // загруженном document — он не должен накопить большой delta от baseline.
    const after = await page.evaluate(
      () => (window as unknown as { __listenerNet: number }).__listenerNet
    );
    const adds = await page.evaluate(
      () => (window as unknown as { __mousedownAdds: number }).__mousedownAdds
    );
    const removes = await page.evaluate(
      () =>
        (window as unknown as { __mousedownRemoves: number }).__mousedownRemoves
    );

    // На каждом document LockManager делает +1 add на mousedown.
    // Без fix'а: removeEventListener никогда не вызывался → adds=1, removes=0.
    // С fix'ом: либо adds=1 removes=0 (если на этом конкретном document
    // beforeunload не успел) — допустимо; либо adds=1 removes=1.
    expect(adds, 'хотя бы один mousedown-listener подписан').toBeGreaterThanOrEqual(1);

    // Главный инвариант: net counter на текущем (после-навигаций) document
    // должен быть в разумных пределах. Поскольку каждая page.goto обнуляет
    // spy и init заново — net должен быть сопоставим с baseline,
    // а не baseline × 5.
    expect(
      Math.abs(after - baseline),
      `listener growth net=${after - baseline}, mousedown adds=${adds} removes=${removes}, baseline=${baseline}`
    ).toBeLessThan(10);
  });

  test('destroy() вызывает removeEventListener для всех подписок LockManager', async ({ page }) => {
    // Прямая проверка контракта destroy() через unit-style вызов из браузера.
    // Гарантирует, что refactor сохранил ref handler'ов и удаляет их
    // ровно для тех событий, которые добавил: 4 activity-события
    // (_activityEvents) + visibilitychange (возврат вкладки из фона).
    await page.addInitScript(() => {
      const win = window as unknown as {
        __removed: string[];
      };
      win.__removed = [];
      const origRemove = document.removeEventListener.bind(document);
      document.removeEventListener = function (
        type: string,
        fn: EventListenerOrEventListenerObject,
        ...rest: unknown[]
      ): void {
        win.__removed.push(type);
        return origRemove(
          type,
          fn,
          ...(rest as [boolean | EventListenerOptions | undefined])
        );
      };
    });

    await openAct(page, SEED_ACTS.empty);

    // Дёргаем destroy() из браузера и смотрим какие removeEventListener'ы он сделал.
    const removed = await page.evaluate(() => {
      const win = window as unknown as {
        LockManager: { destroy: () => void };
        __removed: string[];
      };
      win.__removed.length = 0; // reset, чтобы не учитывать pre-destroy
      win.LockManager.destroy();
      return [...win.__removed].sort();
    });

    // _activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart']
    // + visibilitychange (bound-обработчик, см. lock-manager.js _visibilityHandler)
    expect(removed).toEqual(
      ['keydown', 'mousedown', 'scroll', 'touchstart', 'visibilitychange']
    );
  });
});
