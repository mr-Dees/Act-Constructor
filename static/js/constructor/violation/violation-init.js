/**
 * Инициализация ViolationManager
 * Создание глобального экземпляра после загрузки всех модулей
 */

import { ViolationManager } from './violation-core.js';

// Создаем глобальный экземпляр менеджера нарушений
export const violationManager = new ViolationManager();

// Инициализируем обработчики после загрузки всех расширений
violationManager.initialize();

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.violationManager = violationManager;
