/**
 * Единая загрузка конфигурации акта с бэка (`GET /api/v1/acts/config/lock`).
 *
 * Эндпоинт отдаёт глобальные для приложения настройки (длительности блокировок,
 * период автосохранения) — от конкретного акта они не зависят. LockManager и
 * StorageManager оба читают его на старте конструктора; кэшируем промис, чтобы
 * GET уходил один раз, а оба потребителя ждали общий ответ. Возвращает
 * распарсенный JSON либо null при ошибке — потребитель подставляет свои дефолты.
 */
import { AppConfig } from '../shared/app-config.js';

let _configPromise = null;

/**
 * @returns {Promise<Object|null>} конфигурация с бэка или null при ошибке
 */
export function loadActConfig() {
    if (!_configPromise) {
        _configPromise = fetch(AppConfig.api.getUrl('/api/v1/acts/config/lock'))
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .catch(error => {
                console.error('Не удалось загрузить конфигурацию акта:', error);
                return null;
            });
    }
    return _configPromise;
}
