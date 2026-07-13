/**
 * Модалка распределения суммы метрики по ТБ (домен ЦК Фин.Рез).
 * Редактор ЗНАЧЕНИЯ поля формы: результат возвращается через onApply,
 * сохранение группы выполняет страница кнопкой «Сохранить».
 */
import { DialogBase } from '../../shared/dialog/dialog-base.js';
import { SafeHTML } from '../../shared/sanitize.js';
import { fmtKop, parseKop, largestRemainder, niceStep, sumKop, headroomKop } from './fr-breakdown-logic.js';

const esc = SafeHTML.escapeHtml;

export class FRBreakdownEditor extends DialogBase {
    /**
     * @param {Object} opts
     * @param {string} opts.subtitle - подпись под заголовком (пункт/код/наименование метрики)
     * @param {Array<{tb_id, short_name, full_name}>} opts.terbanks - справочник ТБ
     * @param {(tbId) => string} opts.colorOf - цвет точки/сегмента для tb_id
     * @param {Array<{neg_finder_tb_id, metric_amount_rubles, metric_element_counts}>} [opts.breakdown]
     * @param {{loss: boolean, ns: boolean}} [opts.flags]
     * @param {boolean} [opts.showCounts=true] - колонка «шт.» (при false не рендерится, onApply отдаёт 0)
     * @param {boolean} [opts.showFlags=true] - блок флагов пункта (при false скрыт)
     * @param {(result: {breakdown, flags}) => void} opts.onApply
     */
    static show(opts) {
        // Иначе фокус может остаться на элементе фона (например, ячейке таблицы),
        // с которого открыли модалку — DialogBase переберёт фокус на себя сам.
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }

        const st = {
            mode: 'total', target: 0, rows: {},
            flags: { loss: !!(opts.flags && opts.flags.loss), ns: !!(opts.flags && opts.flags.ns) },
            confirmOpen: false, amongOpen: false,
        };
        // ТБ развертки, выпавшие из актуального справочника, дополняются
        // синтетическими строками: их суммы участвуют в итоге и не должны
        // молча теряться при «Применить» (см. _withUnknownTbs).
        const terbanks = this._withUnknownTbs(opts.terbanks || [], opts.breakdown || []);
        for (const tb of terbanks) st.rows[String(tb.tb_id)] = { a: 0, n: 0 };
        for (const b of (opts.breakdown || [])) {
            const id = String(b.neg_finder_tb_id);
            if (!st.rows[id]) st.rows[id] = { a: 0, n: 0 };
            st.rows[id].a = Math.round(Number(b.metric_amount_rubles || 0) * 100);
            st.rows[id].n = Number(b.metric_element_counts || 0);
        }
        st.target = sumKop(st.rows);
        st.mode = st.target > 0 ? 'total' : 'sum';

        const overlay = this._createOverlay();
        const dialog = document.createElement('div');
        dialog.className = 'custom-dialog fr-breakdown-editor' + (opts.showCounts === false ? ' frb--no-counts' : '');
        dialog.innerHTML = this._template(opts, terbanks);
        overlay.appendChild(dialog);

        this._wire(dialog, overlay, st, opts, terbanks);
        this._setupOverlayClickHandler(overlay, dialog, () => this._close(overlay));
        this._setupEscapeHandler(overlay, () => {
            if (st.amongOpen) { st.amongOpen = false; dialog.querySelector('#frbAmongLayer').classList.remove('visible'); return; }
            if (st.confirmOpen) { st.confirmOpen = false; dialog.querySelector('#frbConfirmLayer').classList.remove('visible'); return; }
            this._close(overlay);
        });
        this._showDialog(overlay);
        this._syncAll(dialog, st, terbanks, opts);
    }

    static _close(overlay) {
        this._removeEscapeHandler(overlay);
        this._hideDialog(overlay);
    }

    /**
     * Дополняет справочник ТБ синтетическими записями для ТБ из развертки,
     * которых нет в актуальном словаре (дрейф справочника). Без них строка
     * не отображалась бы вовсе, но её сумма сидела бы в итоге — после
     * «Применить» и сохранения значение молча пропадало бы.
     */
    static _withUnknownTbs(terbanks, breakdown) {
        const known = new Set(terbanks.map(t => String(t.tb_id)));
        const extra = [];
        for (const b of breakdown) {
            const id = String(b.neg_finder_tb_id);
            if (known.has(id)) continue;
            known.add(id);
            extra.push({
                tb_id: id,
                short_name: `ТБ ${id}`,
                full_name: `ТБ ${id} — вне текущего справочника`,
            });
        }
        return extra.length ? [...terbanks, ...extra] : terbanks;
    }

    /** Статическая разметка диалога (шапка/верх/футер/слои). Строки ТБ строит _buildRows. */
    static _template(opts, terbanks) {
        const showFlags = opts.showFlags !== false;
        return `
            <div class="frb-head">
                <div>
                    <h3 class="frb-title">Развертка по ТБ</h3>
                    <div class="frb-sub">${esc(opts.subtitle || '')}</div>
                </div>
                <button type="button" class="frb-close" id="frbClose" aria-label="Закрыть">✕</button>
            </div>

            <div class="frb-top">
                <div class="frb-mode-switch" role="group" aria-label="Способ ввода">
                    <button type="button" id="frbModeTotal" aria-pressed="true">От общей суммы</button>
                    <button type="button" id="frbModeSum" aria-pressed="false">От сумм по ТБ</button>
                </div>

                <div class="frb-total-row">
                    <label for="frbTotalInput" id="frbTotalLabel">Общая сумма — цель распределения</label>
                    <span class="frb-total-wrap">
                        <input class="frb-total-input" id="frbTotalInput" inputmode="decimal" autocomplete="off" placeholder="0,00">
                        <span class="frb-rub">₽</span>
                    </span>
                    <span class="frb-auto-badge" id="frbAutoBadge" hidden>вычисляется автоматически</span>
                </div>

                <div class="frb-bar-wrap">
                    <div class="frb-bar" id="frbBar" role="img" aria-label="Шкала распределения">
                        <div class="frb-bar-target" id="frbBarTarget"></div>
                        <div class="frb-bar-segs" id="frbBarSegments"></div>
                    </div>
                    <div class="frb-legend">
                        <span class="frb-legend-left" id="frbAllocLeft">Распределено <span class="frb-num" id="frbAllocSum">0,00 ₽</span> из <span class="frb-num" id="frbAllocTotal">0,00 ₽</span></span>
                        <span class="frb-rest-pill warn" id="frbRestPill">Остаток 0,00 ₽</span>
                    </div>
                </div>

                <div class="frb-group-flags"${showFlags ? '' : ' hidden'}>
                    <span class="frb-group-flags__cap">Поля пункта — для всех ТБ:</span>
                    <label><input type="checkbox" id="frbLoss"> Реальные потери</label>
                    <label><input type="checkbox" id="frbNS"> На наблюдательный совет</label>
                </div>
            </div>

            <div class="frb-rows" id="frbRows"></div>

            <div class="frb-foot">
                <button type="button" class="btn btn-ghost" id="frbBtnEqual">Поровну</button>
                <button type="button" class="btn btn-ghost" id="frbBtnEqualAmong" title="Разделить остаток поровну между выбранными ТБ">Поровну между…</button>
                <button type="button" class="btn btn-ghost" id="frbBtnClear">Сбросить</button>
                <span class="frb-foot-spacer"></span>
                <span class="frb-reason" id="frbReason"></span>
                <button type="button" class="btn btn-secondary" id="frbCancel">Отмена</button>
                <button type="button" class="btn btn-primary" id="frbApply">Применить</button>
            </div>

            <div class="frb-confirm-layer" id="frbConfirmLayer">
                <div class="frb-confirm-card">
                    <h3>Общая сумма рассчитана автоматически</h3>
                    <p>Вы вводили суммы по ТБ — итог вычислен из них. Проверьте значения перед применением.</p>
                    <div class="frb-confirm-list" id="frbConfirmList"></div>
                    <div class="frb-confirm-actions">
                        <button type="button" class="btn btn-ghost" id="frbConfirmBack">Назад</button>
                        <button type="button" class="btn btn-primary" id="frbConfirmOk">Всё верно, применить</button>
                    </div>
                </div>
            </div>

            <div class="frb-confirm-layer" id="frbAmongLayer">
                <div class="frb-confirm-card">
                    <h3>Распределить остаток поровну</h3>
                    <p>Остаток <b class="frb-num" id="frbAmongRest">0,00 ₽</b> будет разделён между выбранными ТБ.<br>
                       У ТБ, где сумма уже указана, доля <b>добавится</b> к текущей.</p>
                    <div class="frb-among-list" id="frbAmongList"></div>
                    <div class="frb-confirm-actions">
                        <button type="button" class="btn btn-ghost" id="frbAmongCancel">Отмена</button>
                        <button type="button" class="btn btn-primary" id="frbAmongOk" disabled>Распределить</button>
                    </div>
                </div>
            </div>
        `;
    }

    /** Строит строки ТБ в #frbRows: точка-цвет + имя + range + сумма + «шт.» + % + «+ остаток». Без шеврона/деталей. */
    static _buildRows(dialog, st, terbanks, opts) {
        const showCounts = opts.showCounts !== false;
        const wrap = dialog.querySelector('#frbRows');
        wrap.innerHTML = '';
        for (const tb of terbanks) {
            const id = String(tb.tb_id);
            const row = document.createElement('div');
            row.className = 'frb-row';
            row.dataset.tb = id;
            row.innerHTML = `
                <span class="frb-name"><span class="frb-dot" style="background:${opts.colorOf(tb.tb_id)}"></span><span class="frb-nm" title="${esc(tb.full_name)}">${esc(tb.short_name)}</span></span>
                <input type="range" min="0" value="0" aria-label="${esc(tb.short_name)}: доля суммы">
                <input class="frb-amount" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-label="${esc(tb.short_name)}: сумма, рубли">
                ${showCounts ? `<input class="frb-count" inputmode="numeric" autocomplete="off" placeholder="шт." title="Количество элементов (операций)" aria-label="${esc(tb.short_name)}: количество элементов">` : ''}
                <span class="frb-pct">—</span>
                <button type="button" class="frb-give" title="Отдать весь остаток этому ТБ">+ остаток</button>`;

            const range = row.querySelector('input[type="range"]');
            const amount = row.querySelector('.frb-amount');
            const count = row.querySelector('.frb-count');
            const give = row.querySelector('.frb-give');

            range.addEventListener('input', () => {
                const raw = Math.round(Number(range.value)) * 100;
                let kop = raw;
                if (st.mode === 'total') kop = Math.min(kop, headroomKop(st.rows, st.target, id));
                const clamped = kop !== raw;
                if (clamped) range.value = Math.round(kop / 100); // ползунок «упирается», не убегает
                st.rows[id].a = kop;
                // Тик ползунка даёт десятки событий в секунду — синхронизацию
                // UI коалессируем в один кадр (rAF), состояние st уже обновлено.
                this._scheduleSync(dialog, st, terbanks, opts);
                if (clamped) this._signalLimit(dialog);
            });
            amount.addEventListener('change', () => {
                const raw = parseKop(amount.value);
                // NaN (мусор во вводе) — не перезаписывать текущее значение
                let kop = isNaN(raw) ? st.rows[id].a : raw;
                const clamped = st.mode === 'total' && kop > headroomKop(st.rows, st.target, id);
                if (clamped) kop = headroomKop(st.rows, st.target, id);
                st.rows[id].a = kop;
                this._syncAll(dialog, st, terbanks, opts);
                if (clamped) this._signalLimit(dialog);
            });
            amount.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); amount.blur(); }
            });
            if (count) {
                count.addEventListener('change', () => {
                    const v = parseInt(String(count.value).replace(/\D/g, ''), 10);
                    st.rows[id].n = isFinite(v) && v > 0 ? v : 0;
                    this._syncAll(dialog, st, terbanks, opts);
                });
            }
            // «+ остаток»: отдать весь нераспределённый остаток этому ТБ
            give.addEventListener('click', () => {
                const rest = st.target - sumKop(st.rows);
                if (rest > 0) {
                    st.rows[id].a += rest;
                    this._syncAll(dialog, st, terbanks, opts);
                }
            });
            // Попытка тронуть заблокированный контрол пустого ТБ при исчерпанном лимите → красная индикация
            row.addEventListener('pointerdown', () => {
                if (st.mode !== 'total' || st.target <= 0) return;
                if (st.target - sumKop(st.rows) <= 0 && !st.rows[id].a) this._signalLimit(dialog);
            });

            wrap.appendChild(row);
        }
        const note = document.createElement('div');
        note.className = 'frb-rows-note';
        note.id = 'frbRowsNote';
        wrap.appendChild(note);
    }

    static _wire(dialog, overlay, st, opts, terbanks) {
        this._buildRows(dialog, st, terbanks, opts);

        const totalInput = dialog.querySelector('#frbTotalInput');
        totalInput.addEventListener('change', () => {
            if (st.mode !== 'total') return;
            const kop = parseKop(totalInput.value);
            st.target = isNaN(kop) ? st.target : kop; // NaN — оставить прежнее значение
            this._syncAll(dialog, st, terbanks, opts);
        });
        totalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        });

        dialog.querySelector('#frbModeTotal').addEventListener('click', () => {
            st.mode = 'total';
            if (st.target < sumKop(st.rows)) st.target = sumKop(st.rows);
            this._syncAll(dialog, st, terbanks, opts);
        });
        dialog.querySelector('#frbModeSum').addEventListener('click', () => {
            st.mode = 'sum';
            this._syncAll(dialog, st, terbanks, opts);
        });

        dialog.querySelector('#frbLoss').addEventListener('change', (e) => { st.flags.loss = e.target.checked; });
        dialog.querySelector('#frbNS').addEventListener('change', (e) => { st.flags.ns = e.target.checked; });

        dialog.querySelector('#frbBtnEqual').addEventListener('click', () => {
            const total = st.mode === 'total' ? st.target : sumKop(st.rows);
            if (total <= 0) return;
            const parts = largestRemainder(total, terbanks.length);
            terbanks.forEach((tb, i) => { st.rows[String(tb.tb_id)].a = parts[i]; });
            this._syncAll(dialog, st, terbanks, opts);
        });
        dialog.querySelector('#frbBtnClear').addEventListener('click', () => {
            terbanks.forEach((tb) => { st.rows[String(tb.tb_id)] = { a: 0, n: 0 }; });
            this._syncAll(dialog, st, terbanks, opts);
        });

        const amongSel = new Set();
        dialog.querySelector('#frbBtnEqualAmong').addEventListener('click', () => {
            this._openAmong(dialog, st, terbanks, opts, amongSel);
        });
        dialog.querySelector('#frbAmongCancel').addEventListener('click', () => {
            st.amongOpen = false;
            dialog.querySelector('#frbAmongLayer').classList.remove('visible');
        });
        dialog.querySelector('#frbAmongOk').addEventListener('click', () => {
            const rest = st.target - sumKop(st.rows);
            const ids = terbanks.filter((tb) => amongSel.has(String(tb.tb_id))).map((tb) => String(tb.tb_id));
            if (rest > 0 && ids.length) {
                const parts = largestRemainder(rest, ids.length);
                ids.forEach((id, i) => { st.rows[id].a += parts[i]; }); // у кого была сумма — добавляется сверху
            }
            st.amongOpen = false;
            dialog.querySelector('#frbAmongLayer').classList.remove('visible');
            this._syncAll(dialog, st, terbanks, opts);
        });

        dialog.querySelector('#frbClose').addEventListener('click', () => this._close(overlay));
        dialog.querySelector('#frbCancel').addEventListener('click', () => this._close(overlay));

        dialog.querySelector('#frbApply').addEventListener('click', () => {
            if (st.mode === 'sum') {
                this._buildConfirmList(dialog, st, terbanks);
                st.confirmOpen = true;
                dialog.querySelector('#frbConfirmLayer').classList.add('visible');
            } else {
                this._doApply(dialog, overlay, st, terbanks, opts);
            }
        });
        dialog.querySelector('#frbConfirmBack').addEventListener('click', () => {
            st.confirmOpen = false;
            dialog.querySelector('#frbConfirmLayer').classList.remove('visible');
        });
        dialog.querySelector('#frbConfirmOk').addEventListener('click', () => {
            this._doApply(dialog, overlay, st, terbanks, opts);
        });
    }

    /** «Поровну между…»: слой выбора ТБ для дораспределения остатка (добавление к текущим суммам). */
    static _openAmong(dialog, st, terbanks, opts, amongSel) {
        const rest = st.target - sumKop(st.rows);
        if (st.mode !== 'total' || rest <= 0) return;
        amongSel.clear();
        dialog.querySelector('#frbAmongRest').textContent = this._fmtR(rest);

        const list = dialog.querySelector('#frbAmongList');
        list.innerHTML = '';
        const okBtn = dialog.querySelector('#frbAmongOk');
        for (const tb of terbanks) {
            const id = String(tb.tb_id);
            const r = st.rows[id] || { a: 0, n: 0 };
            const label = document.createElement('label');
            if (r.a > 0) label.className = 'has-sum';
            label.innerHTML = `<input type="checkbox"><span class="frb-dot" style="background:${opts.colorOf(tb.tb_id)}"></span>${esc(tb.short_name)}`
                + (r.a > 0 ? `<span class="cur">сейчас ${this._fmtR(r.a)}</span>` : '');
            label.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) amongSel.add(id); else amongSel.delete(id);
                okBtn.disabled = amongSel.size === 0;
                okBtn.textContent = amongSel.size ? `Распределить (${amongSel.size})` : 'Распределить';
            });
            list.appendChild(label);
        }
        okBtn.disabled = true;
        okBtn.textContent = 'Распределить';

        st.amongOpen = true;
        dialog.querySelector('#frbAmongLayer').classList.add('visible');
    }

    /** Список для confirm-слоя режима «От сумм по ТБ» (итог считается автоматически). */
    static _buildConfirmList(dialog, st, terbanks) {
        const list = dialog.querySelector('#frbConfirmList');
        list.innerHTML = '';
        for (const tb of terbanks) {
            const r = st.rows[String(tb.tb_id)];
            if (!r || !r.a) continue;
            const row = document.createElement('div');
            const countSuffix = r.n ? ` · ${r.n} шт.` : '';
            row.innerHTML = `<span>${esc(tb.short_name)}${countSuffix}</span><span class="frb-num">${this._fmtR(r.a)}</span>`;
            list.appendChild(row);
        }
        const total = document.createElement('div');
        total.className = 'total';
        total.innerHTML = `<span>Итого — рассчитано</span><span class="frb-num">${this._fmtR(sumKop(st.rows))}</span>`;
        list.appendChild(total);
    }

    /** Формирует breakdown (только ТБ с суммой > 0) и передаёт результат наверх через onApply. */
    static _doApply(dialog, overlay, st, terbanks, opts) {
        const showCounts = opts.showCounts !== false;
        const breakdown = [];
        for (const tb of terbanks) {
            const id = String(tb.tb_id);
            const r = st.rows[id];
            if (r && r.a > 0) {
                breakdown.push({
                    neg_finder_tb_id: id,
                    metric_amount_rubles: (r.a / 100).toFixed(2),
                    metric_element_counts: showCounts ? r.n : 0,
                });
            }
        }
        opts.onApply({ breakdown, flags: { ...st.flags } });
        this._close(overlay);
    }

    /** Кеш ссылок на элементы диалога: _syncAll дёргается на каждый тик
     * ползунка, без кеша это ~80 DOM-запросов на тик (заметно на VDI). */
    static _collectRefs(dialog) {
        const q = (sel) => dialog.querySelector(sel);
        const rows = new Map();
        dialog.querySelectorAll('.frb-row').forEach((row) => {
            rows.set(row.dataset.tb, {
                row,
                range: row.querySelector('input[type="range"]'),
                amount: row.querySelector('.frb-amount'),
                count: row.querySelector('.frb-count'),
                pct: row.querySelector('.frb-pct'),
                give: row.querySelector('.frb-give'),
            });
        });
        return {
            rows,
            totalInput: q('#frbTotalInput'), modeTotal: q('#frbModeTotal'), modeSum: q('#frbModeSum'),
            totalLabel: q('#frbTotalLabel'), autoBadge: q('#frbAutoBadge'), rowsWrap: q('#frbRows'),
            loss: q('#frbLoss'), ns: q('#frbNS'), bar: q('#frbBar'), segs: q('#frbBarSegments'),
            allocSum: q('#frbAllocSum'), allocTotal: q('#frbAllocTotal'), pill: q('#frbRestPill'),
            rowsNote: q('#frbRowsNote'), reason: q('#frbReason'), apply: q('#frbApply'),
            btnEqual: q('#frbBtnEqual'), btnEqualAmong: q('#frbBtnEqualAmong'),
        };
    }

    /** Коалессирует _syncAll в один кадр (rAF) — для высокочастотных событий
     * вроде тика ползунка; состояние st к моменту кадра уже актуально. */
    static _scheduleSync(dialog, st, terbanks, opts) {
        if (dialog._frbSyncPending) return;
        dialog._frbSyncPending = true;
        const raf = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (fn) => setTimeout(fn, 16);
        raf(() => {
            dialog._frbSyncPending = false;
            this._syncAll(dialog, st, terbanks, opts);
        });
    }

    /** Синхронизация всего UI с состоянием st (режим/бар/строки/гейт кнопки «Применить»). */
    static _syncAll(dialog, st, terbanks, opts) {
        const ui = dialog._frbUi || (dialog._frbUi = this._collectRefs(dialog));
        const sum = sumKop(st.rows);
        const total = st.mode === 'total' ? st.target : sum;
        const rest = total - sum;
        const totalInput = ui.totalInput;

        // Режим
        ui.modeTotal.setAttribute('aria-pressed', st.mode === 'total');
        ui.modeSum.setAttribute('aria-pressed', st.mode === 'sum');
        ui.totalLabel.textContent = st.mode === 'total'
            ? 'Общая сумма — цель распределения'
            : 'Итоговая сумма';
        ui.autoBadge.hidden = st.mode !== 'sum';
        totalInput.readOnly = st.mode === 'sum';
        if (document.activeElement !== totalInput || st.mode === 'sum') {
            totalInput.value = total ? fmtKop(total) : '';
        }
        ui.rowsWrap.classList.toggle('mode-sum', st.mode === 'sum');

        // Поля пункта
        ui.loss.checked = st.flags.loss;
        ui.ns.checked = st.flags.ns;

        // Бар (сегменты немногочисленны — пересборка дешевле точечного диффа)
        ui.bar.classList.toggle('overflow', st.mode === 'total' && sum > st.target);
        const segs = ui.segs;
        segs.innerHTML = '';
        const denom = Math.max(total, sum, 1);
        for (const tb of terbanks) {
            const id = String(tb.tb_id);
            const v = (st.rows[id] && st.rows[id].a) || 0;
            if (!v) continue;
            const s = document.createElement('span');
            s.className = 'seg';
            s.style.width = (v / denom * 100) + '%';
            s.style.background = opts.colorOf(tb.tb_id);
            const pct = (v / Math.max(sum, 1) * 100).toFixed(1).replace('.', ',');
            s.title = `${tb.short_name} — ${this._fmtR(v)} (${pct}%)`;
            segs.appendChild(s);
        }
        ui.allocSum.textContent = this._fmtR(sum);
        ui.allocTotal.textContent = this._fmtR(total);
        const pill = ui.pill;
        if (st.mode === 'sum') {
            pill.className = 'frb-rest-pill ok';
            pill.textContent = 'Итог = сумма по ТБ';
        } else if (rest > 0) {
            pill.className = 'frb-rest-pill warn';
            pill.textContent = 'Остаток ' + this._fmtR(rest);
        } else if (rest === 0 && total > 0) {
            pill.className = 'frb-rest-pill ok';
            pill.textContent = 'Распределено полностью ✓';
        } else if (rest < 0) {
            pill.className = 'frb-rest-pill over';
            pill.textContent = 'Перебор ' + this._fmtR(-rest);
        } else {
            pill.className = 'frb-rest-pill warn';
            pill.textContent = 'Остаток 0,00 ₽';
        }

        // Строки — по кешу ссылок, без повторных querySelector'ов
        const stepR = niceStep(Math.max(total, 1));
        const fullSpent = st.mode === 'total' && st.target > 0 && rest <= 0;
        for (const [id, refs] of ui.rows) {
            const r = st.rows[id] || { a: 0, n: 0 };
            const { row, range, amount, count, pct, give } = refs;
            row.classList.toggle('zero', !r.a);
            range.disabled = fullSpent && !r.a;   // лимит исчерпан → пустые ТБ заблокированы
            amount.disabled = fullSpent && !r.a;
            if (count) count.disabled = !r.a;     // количество — только при сумме (хотя бы 1 копейка)
            // «+ остаток» доступна только в режиме цели при ненулевом остатке (disabled → visibility:hidden)
            give.disabled = !(st.mode === 'total' && st.target > 0 && rest > 0);
            if (count) count.title = !r.a ? 'Сначала укажите сумму — хотя бы 1 копейку' : 'Количество элементов (операций)';
            range.max = Math.max(Math.round(total / 100), 1);
            range.step = stepR;
            if (document.activeElement !== range) range.value = Math.round(r.a / 100);
            if (document.activeElement !== amount) amount.value = r.a ? fmtKop(r.a) : '';
            if (count && document.activeElement !== count) count.value = r.n ? String(r.n) : '';
            pct.textContent = sum > 0 && r.a
                ? (r.a / sum * 100).toFixed(1).replace('.', ',') + '%'
                : '—';
        }
        ui.rowsNote.textContent = st.mode === 'sum'
            ? 'Вводите суммы по каждому ТБ — итог считается автоматически.'
            : 'Ползунок — грубая настройка, точное значение вводится в поле.';

        // Гейт кнопки «Применить»
        let ok = false;
        let msg = '';
        if (st.mode === 'total') {
            if (st.target <= 0) msg = 'Укажите общую сумму';
            else if (rest > 0) msg = 'Распределите всю сумму — остаток ' + this._fmtR(rest);
            else if (rest < 0) msg = 'Суммы по ТБ превышают общую';
            else ok = true;
        } else {
            if (sum <= 0) msg = 'Введите сумму хотя бы по одному ТБ';
            else ok = true;
        }
        ui.apply.disabled = !ok;
        ui.reason.textContent = msg;
        ui.reason.className = 'frb-reason' + (rest < 0 ? ' err' : '');
        ui.btnEqual.disabled = st.mode === 'total' ? st.target <= 0 : false;
        ui.btnEqualAmong.disabled = !(st.mode === 'total' && st.target > 0 && rest > 0);
    }

    /** Сигнал «лимит исчерпан»: красное мигание бара и фразы «Распределено» (стиль перерасхода). */
    static _signalLimit(dialog) {
        const bar = dialog.querySelector('#frbBar');
        const left = dialog.querySelector('#frbAllocLeft');
        if (bar.classList.contains('bar-flash')) return; // guard от повторного запуска анимации
        bar.classList.add('bar-flash');
        left.classList.add('legend-flash');
        setTimeout(() => {
            bar.classList.remove('bar-flash');
            left.classList.remove('legend-flash');
        }, 1350);
    }

    static _fmtR(kop) {
        return fmtKop(kop) + ' ₽';
    }
}

window.FRBreakdownEditor = FRBreakdownEditor;
