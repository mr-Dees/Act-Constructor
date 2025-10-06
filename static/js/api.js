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
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Получить файл
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `act_${Date.now()}.docx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            return true;
        } catch (error) {
            console.error('Ошибка при генерации акта:', error);
            alert('Произошла ошибка при генерации акта');
            return false;
        }
    }
}
