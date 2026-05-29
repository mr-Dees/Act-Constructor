/**
 * Кастомный dropdown выбора номера приложения (1..5).
 *
 * Используется в AppendixRef-строке состава аудиторской группы. Не является
 * нативным <select> — это button-trigger с popup-listbox, стилизованный
 * под остальные input/select'ы диалога. Не form control, поэтому не
 * участвует в HTML5-валидации (значение собирается JS-кодом из diálog'а).
 */
import { EscapeStack } from '../../shared/escape-stack.js';

export class AppendixNumberDropdown {
    /**
     * @param {HTMLElement} container - Контейнер, в который монтируется dropdown.
     * @param {{initialValue?: number, onChange?: (value: number) => void}} options
     */
    constructor(container, { initialValue = 1, onChange = null } = {}) {
        if (!container) {
            throw new Error('AppendixNumberDropdown: container is required');
        }

        this._container = container;
        this._onChange = typeof onChange === 'function' ? onChange : null;
        const initial = Number(initialValue);
        this._value = (Number.isFinite(initial) && initial >= 1 && initial <= 5) ? initial : 1;

        this._isOpen = false;
        this._onDocumentClick = this._onDocumentClick.bind(this);
        this._escapeUnsub = null;

        this._render();
        this._bindEvents();
    }

    /** @returns {number} Текущее значение 1..5. */
    get value() {
        return this._value;
    }

    /** @param {number} v */
    set value(v) {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 5) return;
        this._value = n;
        this._updateVisibleValue();
        this._updateSelectedOption();
    }

    /** Уничтожает dropdown: снимает глобальные listeners и очищает DOM. */
    destroy() {
        this._closePopup();
        document.removeEventListener('click', this._onDocumentClick, true);
        if (this._root && this._root.parentNode) {
            this._root.parentNode.removeChild(this._root);
        }
        this._root = null;
        this._trigger = null;
        this._menu = null;
        this._valueSpan = null;
    }

    // --- private ---

    _render() {
        const root = document.createElement('div');
        root.className = 'appendix-number-dropdown';
        root.dataset.state = 'closed';
        root.innerHTML = `
            <button type="button" class="appendix-number-dropdown__trigger" aria-haspopup="listbox" aria-expanded="false">
                <span class="appendix-number-dropdown__value">${this._value}</span>
                <svg class="appendix-number-dropdown__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
            <ul class="appendix-number-dropdown__menu" role="listbox" hidden>
                ${[1, 2, 3, 4, 5].map(n => `
                    <li role="option" data-value="${n}" class="appendix-number-dropdown__option" aria-selected="${n === this._value ? 'true' : 'false'}">${n}</li>
                `).join('')}
            </ul>
        `;
        this._container.appendChild(root);

        this._root = root;
        this._trigger = root.querySelector('.appendix-number-dropdown__trigger');
        this._menu = root.querySelector('.appendix-number-dropdown__menu');
        this._valueSpan = root.querySelector('.appendix-number-dropdown__value');
    }

    _bindEvents() {
        this._trigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._togglePopup();
        });

        this._menu.addEventListener('click', (e) => {
            const option = e.target.closest('.appendix-number-dropdown__option');
            if (!option) return;
            const newValue = Number(option.dataset.value);
            if (!Number.isFinite(newValue)) return;
            this._setValue(newValue);
            this._closePopup();
            this._trigger.focus();
        });
    }

    _setValue(newValue) {
        if (newValue === this._value) return;
        this._value = newValue;
        this._updateVisibleValue();
        this._updateSelectedOption();
        if (this._onChange) {
            try {
                this._onChange(newValue);
            } catch (err) {
                console.error('AppendixNumberDropdown.onChange error:', err);
            }
        }
    }

    _updateVisibleValue() {
        if (this._valueSpan) this._valueSpan.textContent = String(this._value);
    }

    _updateSelectedOption() {
        if (!this._menu) return;
        this._menu.querySelectorAll('.appendix-number-dropdown__option').forEach(opt => {
            opt.setAttribute('aria-selected', Number(opt.dataset.value) === this._value ? 'true' : 'false');
        });
    }

    _togglePopup() {
        if (this._isOpen) {
            this._closePopup();
        } else {
            this._openPopup();
        }
    }

    _openPopup() {
        if (this._isOpen || !this._root) return;
        this._isOpen = true;
        this._root.dataset.state = 'open';
        this._trigger.setAttribute('aria-expanded', 'true');
        this._menu.hidden = false;
        document.addEventListener('click', this._onDocumentClick, true);
        this._escapeUnsub = EscapeStack.push(() => {
            this._closePopup();
            this._trigger?.focus();
        });
    }

    _closePopup() {
        if (!this._isOpen || !this._root) return;
        this._isOpen = false;
        this._root.dataset.state = 'closed';
        this._trigger.setAttribute('aria-expanded', 'false');
        this._menu.hidden = true;
        document.removeEventListener('click', this._onDocumentClick, true);
        if (this._escapeUnsub) {
            this._escapeUnsub();
            this._escapeUnsub = null;
        }
    }

    _onDocumentClick(e) {
        if (!this._root) return;
        if (!this._root.contains(e.target)) {
            this._closePopup();
        }
    }
}

// Глобальный доступ
window.AppendixNumberDropdown = AppendixNumberDropdown;
