/**
 * Расширение TextBlockManager для работы с форматированием
 */
Object.assign(TextBlockManager.prototype, {
    /**
     * Применяет сохранённое форматирование к элементу редактора
     * @param {HTMLElement} editor - DOM-элемент редактора
     * @param {Object} formatting - Объект с настройками форматирования
     */
    applyFormatting(editor, formatting) {
        if (!formatting) return;

        if (formatting.fontSize) {
            editor.style.fontSize = `${formatting.fontSize}px`;
        }

        if (formatting.alignment) {
            const alignmentMap = {
                'left': 'left',
                'center': 'center',
                'right': 'right',
                'justify': 'justify'
            };
            editor.style.textAlign = alignmentMap[formatting.alignment] || 'left';
        }
    },

    /**
     * Применяет текущее форматирование к ссылке или сноске
     * на основе окружающего текста
     */
    inheritFormattingToElement(element) {
        if (!element) return;

        // Получаем форматирование из парента (контейнера с форматированием)
        let parent = element.parentElement;
        let styles = {};

        // Ищем родительский элемент с форматированием
        while (parent && parent !== this.activeEditor) {
            const style = window.getComputedStyle(parent);

            // Копируем стили, если они есть
            if (parent.style.fontSize) {
                styles.fontSize = parent.style.fontSize;
            }
            if (parent.style.fontWeight) {
                styles.fontWeight = parent.style.fontWeight;
            }
            if (parent.style.fontStyle) {
                styles.fontStyle = parent.style.fontStyle;
            }
            if (parent.style.textDecoration) {
                styles.textDecoration = parent.style.textDecoration;
            }
            if (parent.style.color) {
                styles.color = parent.style.color;
            }
            if (parent.style.backgroundColor) {
                styles.backgroundColor = parent.style.backgroundColor;
            }

            parent = parent.parentElement;
        }

        // Применяем найденные стили к элементу
        Object.assign(element.style, styles);

        // Также наследуем форматирование от соседних элементов
        this.inheritFromNeighbors(element);
    },

    /**
     * Наследует форматирование от соседних элементов (span'ов с форматированием)
     */
    inheritFromNeighbors(element) {
        if (!element) return;

        let prevNode = element.previousSibling;
        let nextNode = element.nextSibling;

        // Ищем предыдущий span с форматированием
        while (prevNode) {
            if (prevNode.nodeType === 1 && prevNode.tagName === 'SPAN' && prevNode.style.length > 0) {
                // Копируем стили от предыдущего элемента
                const styles = window.getComputedStyle(prevNode);

                if (styles.fontSize && !element.style.fontSize) {
                    element.style.fontSize = styles.fontSize;
                }
                if (styles.fontWeight && !element.style.fontWeight) {
                    element.style.fontWeight = styles.fontWeight;
                }
                if (styles.fontStyle && !element.style.fontStyle) {
                    element.style.fontStyle = styles.fontStyle;
                }
                if (styles.textDecoration && !element.style.textDecoration) {
                    element.style.textDecoration = styles.textDecoration;
                }

                break;
            }

            prevNode = prevNode.previousSibling;
        }
    },

    /**
     * Применяет форматирование после ввода текста
     * (когда пользователь печатает обычный текст перед/после ссылки)
     */
    applyFormattingToNewNodes(editor) {
        if (!editor) return;

        // Находим все узлы с форматированием (span, b, i, u, strike и т.д.)
        const formattedElements = editor.querySelectorAll('span[style], b, i, u, strike, font, div[style]');

        // Для каждого элемента с форматированием проверяем соседние ссылки
        formattedElements.forEach(element => {
            const links = element.querySelectorAll('.text-link');
            const footnotes = element.querySelectorAll('.text-footnote');

            [...links, ...footnotes].forEach(item => {
                this.inheritFormattingToElement(item);
            });
        });

        // Также проверяем глобальные ссылки и сноски
        const allLinks = editor.querySelectorAll('.text-link');
        const allFootnotes = editor.querySelectorAll('.text-footnote');

        [...allLinks, ...allFootnotes].forEach(item => {
            this.inheritFormattingToElement(item);
        });
    }
});
