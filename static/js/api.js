// Взаимодействие с API

class APIClient {
    static async generateAct() {
        const data = AppState.exportData();

        try {
            const response = await fetch('/api/v1/acts/generate', {
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

            // Показать успешное сообщение
            alert(`Акт успешно сохранён: ${result.filename}`);

            return true;
        } catch (error) {
            console.error('Ошибка при генерации акта:', error);
            alert(`Произошла ошибка при генерации акта: ${error.message}`);
            return false;
        }
    }

    static async saveAct() {
        const data = AppState.exportData();

        try {
            const response = await fetch('/api/v1/acts/save', {
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
}
