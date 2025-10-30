/**
 * Модуль обработки вставки из буфера обмена
 * Поддержка Ctrl+V для изображений и текста
 */

// Расширение ViolationManager
Object.assign(ViolationManager.prototype, {
    /**
     * Настраивает обработчик клавиши Escape для сброса активной зоны
     */
    setupEscapeHandler() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.currentActiveContainer) {
                    this.currentActiveContainer = null;
                    this.cursorInsertPosition = null;
                    Notifications.info('Активная зона сброшена');
                }
            }
        });
    },

    /**
     * Настраивает глобальный обработчик вставки изображений и текста из буфера обмена
     */
    setupPasteHandler() {
        document.addEventListener('paste', async (e) => {
            // Проверяем, есть ли текущий активный контейнер
            if (!this.currentActiveContainer) {
                return;
            }

            // Получаем данные из буфера обмена
            const items = e.clipboardData?.items;
            if (!items) {
                return;
            }

            const targetContainer = this.currentActiveContainer;
            const itemsContainer = targetContainer.querySelector('.additional-content-items');
            const violationId = itemsContainer?.dataset.violationId;

            if (!violationId) {
                return;
            }

            // Получаем violation из хранилища
            const violation = this.activeViolations.get(violationId);
            if (!violation) {
                console.error('Violation not found in storage:', violationId);
                return;
            }

            // Определяем позицию вставки на основе положения курсора
            const insertIndex = this.cursorInsertPosition !== null
                ? this.cursorInsertPosition
                : violation.additionalContent.items.length;

            let hasImage = false;
            let imageItem = null;
            let textItem = null;

            // Сначала определяем, что есть в буфере
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type.indexOf('image') !== -1) {
                    hasImage = true;
                    imageItem = item;
                } else if (item.type === 'text/plain') {
                    textItem = item;
                }
            }

            // Обрабатываем изображение если есть
            if (hasImage && imageItem) {
                e.preventDefault();
                const file = imageItem.getAsFile();

                if (file) {
                    const reader = new FileReader();

                    reader.onload = (event) => {
                        const timestamp = Date.now();
                        const extension = file.type.split('/')[1] || 'png';
                        const filename = `pasted_image_${timestamp}.${extension}`;

                        this.addContentItemAtPosition(violation, 'image', targetContainer, insertIndex, {
                            url: event.target.result,
                            filename: filename
                        });

                        Notifications.success('Изображение добавлено из буфера обмена');
                    };

                    reader.onerror = (error) => {
                        console.error('Error reading image:', error);
                        Notifications.error('Ошибка при чтении изображения');
                    };

                    reader.readAsDataURL(file);
                }
            }
            // Обрабатываем текст только если нет изображения
            else if (textItem) {
                textItem.getAsString((text) => {
                    const textContent = text.trim();

                    if (textContent) {
                        e.preventDefault();

                        // Определяем тип: кейс или текст
                        const normalizedText = textContent.toLowerCase();
                        const startsWithCase = normalizedText.startsWith('кейс');

                        let type, content, message;

                        if (startsWithCase) {
                            type = 'case';
                            // Убираем "кейс" (4 символа) и затем номер с разделителем
                            content = textContent
                                .substring(4)
                                .replace(/^\s*\d+\s*[.:\-–—]?\s*/, '')
                                .trim();
                            message = 'Кейс добавлен из буфера обмена';
                        } else {
                            type = 'freeText';
                            content = textContent;
                            message = 'Текст добавлен из буфера обмена';
                        }

                        // Добавляем элемент в определенную позицию
                        this.addContentItemAtPosition(violation, type, targetContainer, insertIndex, {
                            content: content
                        });

                        PreviewManager.update();
                        Notifications.success(message);
                    }
                });
            }
        });
    }
});
