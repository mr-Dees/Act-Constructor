/**
 * Компонент пагинации ЦК.
 */
class CkPagination {
    static _config = null;
    static _total = 0;
    static _page = 1;
    static _pageSize = 20;

    /**
     * @param {Object} config
     * @param {HTMLElement} config.containerEl
     * @param {Function} config.onChange - callback(page)
     * @param {number} [config.pageSize=20]
     */
    static init(config) {
        this._config = config;
        this._pageSize = config.pageSize || 20;
        this._page = 1;
        this._total = 0;
        this._render();
    }

    static setTotal(count) {
        this._total = count;
        this._render();
    }

    static getPage() {
        return this._page;
    }

    static getPageSize() {
        return this._pageSize;
    }

    static reset() {
        this._page = 1;
        this._render();
    }

    static _getTotalPages() {
        return Math.max(1, Math.ceil(this._total / this._pageSize));
    }

    static _render() {
        const el = this._config?.containerEl;
        if (!el) return;

        const totalPages = this._getTotalPages();

        el.innerHTML = '';

        // Всего
        const totalSpan = document.createElement('span');
        totalSpan.innerHTML = `Всего: <b>${this._total}</b>`;
        el.appendChild(totalSpan);

        // Навигация
        const nav = document.createElement('div');
        nav.style.display = 'flex';
        nav.style.alignItems = 'center';
        nav.style.gap = '4px';

        // Кнопка назад
        const prevBtn = this._createBtn('◀', this._page > 1, () => {
            if (this._page > 1) {
                this._page--;
                this._render();
                this._config.onChange(this._page);
            }
        });
        nav.appendChild(prevBtn);

        // Номера страниц
        for (let i = 1; i <= totalPages && i <= 7; i++) {
            const pageBtn = this._createBtn(String(i), true, () => {
                this._page = i;
                this._render();
                this._config.onChange(this._page);
            });
            if (i === this._page) {
                pageBtn.style.background = 'var(--primary)';
                pageBtn.style.color = '#fff';
                pageBtn.style.fontWeight = '500';
                pageBtn.style.borderColor = 'var(--primary)';
            }
            nav.appendChild(pageBtn);
        }

        // Кнопка вперёд
        const nextBtn = this._createBtn('▶', this._page < totalPages, () => {
            if (this._page < totalPages) {
                this._page++;
                this._render();
                this._config.onChange(this._page);
            }
        });
        nav.appendChild(nextBtn);

        el.appendChild(nav);
    }

    static _createBtn(text, enabled, onClick) {
        const btn = document.createElement('span');
        btn.textContent = text;
        btn.style.padding = '2px 7px';
        btn.style.border = '1px solid var(--border)';
        btn.style.borderRadius = '4px';
        btn.style.background = 'var(--bg-primary)';
        btn.style.fontSize = '11px';
        btn.style.cursor = enabled ? 'pointer' : 'default';
        btn.style.opacity = enabled ? '1' : '0.4';
        if (enabled) {
            btn.addEventListener('click', onClick);
        }
        return btn;
    }
}

window.CkPagination = CkPagination;
