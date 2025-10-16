/**
 * Клиент для взаимодействия с API
 */
class APIClient {
    /**
     * Генерирует и сохраняет акт на сервере
     * @param {string} format - Формат файла ('txt' или 'docx')
     * @returns {Promise<boolean>} - Успешность операции
     */
    static async generateAct(format = 'txt') {
        const data = AppState.exportData();

        // Валидация формата
        if (!['txt', 'docx', 'md'].includes(format)) {
            console.error('Неподдерживаемый формат:', format);
            format = 'txt';
        }

        try {
            const response = await fetch(`/api/v1/acts/generate?fmt=${format}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const result = await response.json();

            // Показать успешное сообщение с форматом
            alert(`✅ Акт успешно сохранён в формате ${format.toUpperCase()}: ${result.filename}`);

            if (confirm('Хотите скачать файл?')) {
                this.downloadFile(result.filename);
            }
            return true;

        } catch (error) {
            console.error('Ошибка при генерации акта:', error);
            alert(`❌ Произошла ошибка при генерации акта: ${error.message}`);
            return false;
        }
    }

    /**
     * Сохраняет акт на сервере
     * @param {string} format - Формат файла ('txt' или 'docx')
     * @returns {Promise<Object>} - Результат сохранения
     */
    static async saveAct(format = 'txt') {
        const data = AppState.exportData();

        // Валидация формата
        if (!['txt', 'docx', 'md'].includes(format)) {
            console.error('Неподдерживаемый формат:', format);
            format = 'txt';
        }

        try {
            const response = await fetch(`/api/v1/acts/save?fmt=${format}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const result = await response.json();
            return result;

        } catch (error) {
            console.error('Ошибка при сохранении акта:', error);
            throw error;
        }
    }

    /**
     * Получает историю сохраненных актов
     * @returns {Promise<Array>} - Список файлов актов
     */
    static async getHistory() {
        try {
            const response = await fetch('/api/v1/acts/history');

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data.acts;

        } catch (error) {
            console.error('Ошибка при получении истории:', error);
            return [];
        }
    }

    /**
     * Скачивает сгенерированный файл
     * @param {string} filename - Имя файла
     */
    static async downloadFile(filename) {
        try {
            const response = await fetch(`/api/v1/acts/download/${filename}`);

            if (!response.ok) {
                throw new Error('Ошибка при скачивании файла');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Ошибка при скачивании:', error);
            throw error;
        }
    }
}
