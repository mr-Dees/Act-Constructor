/**
 * Модуль Drag & Drop для элементов контента
 * Перестановка элементов внутри дополнительного контента
 */

import { PreviewManager } from '../preview/preview.js';
import { ViolationManager } from './violation-core.js';

// Расширение ViolationManager
Object.assign(ViolationManager.prototype, {
    /**
     * Обработчик начала перетаскивания с созданием миниатюры
     * @param {Event} e - Событие dragstart
     * @param {Object} violation - Объект нарушения
     * @param {number} index - Индекс перетаскиваемого элемента
     * @param {Object} item - Данные элемента
     */
    handleDragStart(e, violation, index, item) {
        const wrapper = e.currentTarget;
        wrapper.classList.add('dragging');

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);

        // Создаем миниатюру
        const miniature = this.createDragMiniature(item, index, violation.additionalContent.items);
        miniature.style.position = 'absolute';
        miniature.style.top = '-1000px';
        miniature.id = 'drag-miniature-temp';
        document.body.appendChild(miniature);

        e.dataTransfer.setDragImage(miniature, 20, 20);

        // Удаляем миниатюру после начала перетаскивания
        setTimeout(() => {
            const temp = document.getElementById('drag-miniature-temp');
            if (temp) temp.remove();
        }, 0);

        // Сбрасываем последний индекс при начале перетаскивания
        this.lastDragOverIndex = null;
    },

    /**
     * Создает миниатюру элемента для drag-and-drop
     * @param {Object} item - Данные элемента
     * @param {number} index - Индекс элемента
     * @param {Array} allItems - Все элементы
     * @returns {HTMLElement} Миниатюра
     */
    createDragMiniature(item, index, allItems) {
        const miniature = document.createElement('div');
        miniature.className = 'drag-miniature';

        let label = '';
        let icon = '';

        if (item.type === 'case') {
            const caseNumbers = this.calculateCaseNumbers(allItems);
            const caseNumber = caseNumbers[index];
            icon = '📋';
            label = `Кейс ${caseNumber}`;
        } else if (item.type === 'image') {
            const imageNumber = this.getTypeSequentialNumber(allItems, 'image', index);
            icon = '🖼️';
            label = `Изображение ${imageNumber}`;
        } else if (item.type === 'freeText') {
            const textNumber = this.getTypeSequentialNumber(allItems, 'freeText', index);
            icon = '📝';
            label = `Текст ${textNumber}`;
        }

        miniature.innerHTML = `${icon} ${label}`;
        return miniature;
    },

    /**
     * Обработчик входа в зону элемента
     * @param {Event} e - Событие dragenter
     */
    handleDragEnter(e) {
        e.preventDefault();
    },

    /**
     * Обработчик перемещения над элементом с плавным визуальным перемещением
     * @param {Event} e - Событие dragover
     * @param {Object} violation - Объект нарушения
     * @param {HTMLElement} container - Контейнер элементов
     */
    handleDragOver(e, violation, container) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const draggingElement = document.querySelector('.dragging');
        if (!draggingElement) return;

        const currentElement = e.target.closest('.content-item-wrapper');

        if (!currentElement || currentElement === draggingElement) {
            return;
        }

        // Получаем границы текущего элемента
        const rect = currentElement.getBoundingClientRect();
        const mouseY = e.clientY;
        const elementMiddle = rect.top + rect.height / 2;

        // Определяем, в какую половину элемента попал курсор
        const isTopHalf = mouseY < elementMiddle;

        // Получаем индекс текущего элемента
        const allWrappers = [...container.querySelectorAll('.content-item-wrapper')];
        const currentIndex = allWrappers.indexOf(currentElement);

        // Проверяем, изменилась ли позиция с последнего вызова
        const targetPosition = isTopHalf ? currentIndex : currentIndex + 1;

        if (this.lastDragOverIndex === targetPosition) {
            return; // Позиция не изменилась, не делаем ничего
        }

        this.lastDragOverIndex = targetPosition;

        // Физически перемещаем элемент в DOM
        if (isTopHalf) {
            container.insertBefore(draggingElement, currentElement);
        } else {
            container.insertBefore(draggingElement, currentElement.nextSibling);
        }
    },

    /**
     * Обработчик выхода курсора из зоны элемента
     * @param {Event} e - Событие dragleave
     */
    handleDragLeave(e) {
        // Оставляем пустым, визуальное перемещение происходит в handleDragOver
    },

    /**
     * Обработчик сброса элемента - фиксирует новый порядок в данных
     * @param {Event} e - Событие drop
     * @param {Object} violation - Объект нарушения
     * @param {number} targetIndex - Индекс целевого элемента
     * @param {HTMLElement} container - Контейнер элементов
     */
    handleDrop(e, violation, targetIndex, container) {
        e.preventDefault();
        e.stopPropagation();

        const draggingElement = document.querySelector('.dragging');
        if (!draggingElement) return;

        // Получаем все элементы в текущем визуальном порядке
        const allWrappers = [...container.querySelectorAll('.content-item-wrapper')];

        // Создаем новый массив items в визуальном порядке по ID
        const newItems = allWrappers.map(wrapper => {
            const itemId = wrapper.dataset.itemId;
            return violation.additionalContent.items.find(item => item.id === itemId);
        }).filter(item => item !== undefined);

        // Заменяем массив items новым упорядоченным массивом
        violation.additionalContent.items = newItems;

        // Обновляем order для всех элементов
        violation.additionalContent.items.forEach((item, idx) => {
            item.order = idx;
        });

        // Перерисовываем с обновленными индексами
        this.renderContentItems(violation, container);

        PreviewManager.update();
    },

    /**
     * Обработчик окончания перетаскивания
     * @param {Event} e - Событие dragend
     * @param {HTMLElement} container - Контейнер элементов
     */
    handleDragEnd(e, container) {
        e.target.classList.remove('dragging');

        // Удаляем все индикаторы перетаскивания
        const allWrappers = container.querySelectorAll('.content-item-wrapper');
        allWrappers.forEach(w => {
            w.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        // Сбрасываем последний индекс
        this.lastDragOverIndex = null;
    }
});
