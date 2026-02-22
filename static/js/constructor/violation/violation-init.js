/**
 * Инициализация ViolationManager
 * Создание глобального экземпляра после загрузки всех модулей
 */

// Создаем глобальный экземпляр менеджера нарушений
const violationManager = new ViolationManager();

// Инициализируем обработчики после загрузки всех расширений
violationManager.initialize();
