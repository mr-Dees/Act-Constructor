/**
 * Конфигурация приложения
 *
 * Централизованное хранилище всех настроек и констант приложения.
 * Обеспечивает единую точку для изменения параметров поведения системы.
 */
class AppConfig {
    /**
     * Типы узлов дерева документа
     * @type {{ITEM: string, TABLE: string, TEXTBLOCK: string, VIOLATION: string}}
     */
    static nodeTypes = {
        ITEM: 'item',
        TABLE: 'table',
        TEXTBLOCK: 'textblock',
        VIOLATION: 'violation'
    };

    /**
     * Настройки предпросмотра документа
     */
    static preview = {
        // Максимальная длина текста по умолчанию для обрезки
        defaultTrimLength: 30,

        // Максимальный уровень вложенности заголовков (h1-h4)
        maxHeadingLevel: 4,

        // Настройки обрезки текста для разных типов контента
        trimLengths: {
            // Базовое значение (используется если не указано специфичное)
            default: 30,

            // Критичные короткие поля (Нарушено, Установлено и т.д.)
            short: 15,

            // Расширенные поля (Кейсы, свободный текст)
            extended: 50
        }
    };

    /**
     * Настройки навигации
     * TODO: Добавить настройки навигации при работе с модулем
     */
    static navigation = {
        // Здесь будут настройки навигации
    };

    /**
     * Настройки меню форматов
     * TODO: Добавить настройки меню форматов при работе с модулем
     */
    static formatMenu = {
        // Здесь будут настройки меню форматов
    };

    /**
     * Настройки диалоговых окон
     */
    static dialog = {
        // Анимация
        closeDelay: 200
    };

    /**
     * Настройки уведомлений
     */
    static notifications = {
        // Длительности показа уведомлений (мс)
        duration: {
            error: 5000,
            warning: 4000,
            info: 3000,
            success: 2000,
            longSuccess: 6000
        },

        // Анимация
        animation: {
            // Длительность анимации скрытия
            hidingDuration: 250,
            // Длительность анимации счетчика
            counterScaleDuration: 150
        },

        // Группировка повторяющихся уведомлений
        grouping: {
            // Статус активности
            enabled: true,
            // Дополнительное время за каждое повторение (мс)
            extensionPerRepeat: 500
        },

        // Иконки для типов уведомлений
        icons: {
            success: '✓',
            error: '✗',
            info: 'ℹ',
            warning: '⚠'
        },
    };

    /**
     * Настройки системы помощи
     */
    static help = {
        // ID контейнеров с инструкциями
        contentIds: {
            1: 'help-step-1-content',
            2: 'help-step-2-content'
        },

        // Названия шагов для подсказок
        stepNames: {
            1: 'Составление структуры акта',
            2: 'Заполнение данных'
        },

        // Заголовки инструкций
        titles: {
            1: 'Инструкция: Шаг 1 - Составление структуры акта',
            2: 'Инструкция: Шаг 2 - Заполнение данных'
        }
    };

    /**
     * Настройки дерева документа
     */
    static tree = {
        // Ограничения структуры
        maxDepth: 4,
        maxCustomFirstLevelSections: 1,

        // Стандартные разделы
        defaultSections: [
            {id: '1', label: 'Информация о процессе, клиентском пути'},
            {id: '2', label: 'Оценка качества проверенного процесса / сценария процесса / потока работ'},
            {id: '3', label: 'Примененные технологии'},
            {id: '4', label: 'Основные выводы'},
            {id: '5', label: 'Результаты проверки'}
        ],

        // Префиксы для автогенерации названий
        labels: {
            newItem: 'Новый пункт',
            table: 'Таблица',
            textBlock: 'Текстовый блок',
            violation: 'Нарушение'
        },

        // Сообщения валидации
        validation: {
            maxDepthExceeded: (depth) => `Достигнута максимальная вложенность (${depth} уровней: ${'.'.repeat(depth - 1)}*)`,
            maxCustomSections: (max) => `Можно добавить только ${max} дополнительный пункт первого уровня (пункт 6)`,
            firstLevelOnlyAtEnd: 'Новый пункт первого уровня можно добавить только в конец списка',
            cannotMoveToSelf: 'Нельзя переместить узел в самого себя',
            cannotMoveProtected: 'Нельзя перемещать защищенный элемент',
            cannotMoveToDescendant: 'Нельзя переместить узел внутрь своего потомка',
            nodeNotFound: 'Узел не найден',
            parentNotFound: 'Родительский узел не найден'
        }
    };

    /**
     * Настройки контента
     */
    static content = {
        // Лимиты элементов на узел
        limits: {
            tablesPerNode: 10,
            textBlocksPerNode: 10,
            violationsPerNode: 10
        },

        // Значения по умолчанию
        defaults: {
            // Таблицы
            tableRows: 3,
            tableCols: 3,
            columnWidth: 100,

            // Текстовые блоки
            fontSize: 14,
            alignment: 'left',

            // Форматирование
            formatting: {
                bold: false,
                italic: false,
                underline: false
            }
        },

        // Сообщения об ошибках
        errors: {
            cannotAddToTable: 'Нельзя добавить {type} к таблице',
            cannotAddToTextBlock: 'Нельзя добавить {type} к текстовому блоку',
            cannotAddToViolation: 'Нельзя добавить {type} к нарушению',
            limitReached: (type, limit) => `Достигнуто максимальное количество ${type} (${limit}) для этого пункта`,
            protectedFromDeletion: 'Эта таблица защищена от удаления',
            notFound: (type) => `${type} не найден`
        },

        // Названия типов контента для сообщений
        typeNames: {
            [AppConfig.nodeTypes?.TABLE || 'table']: 'таблицу',
            [AppConfig.nodeTypes?.TEXTBLOCK || 'textblock']: 'текстовый блок',
            [AppConfig.nodeTypes?.VIOLATION || 'violation']: 'нарушение'
        },

        // Названия для лимитов (множественное число)
        limitNames: {
            [AppConfig.nodeTypes?.TABLE || 'table']: 'таблиц',
            [AppConfig.nodeTypes?.TEXTBLOCK || 'textblock']: 'текстовых блоков',
            [AppConfig.nodeTypes?.VIOLATION || 'violation']: 'нарушений'
        },

        // Предустановленные таблицы
        tablePresets: {
            qualityAssessment: {
                rows: 2,
                cols: 4,
                headers: [
                    'Процесс',
                    'Количество проверенных экземпляров области проверки процесса, шт',
                    'Общее количество отклонений, шт',
                    'Уровень отклонений, %'
                ],
                colWidths: [150, 200, 150, 100]
            },

            dataTools: {
                rows: 2,
                cols: 4,
                headers: ['Решаемая задача', 'Методы/технологии', 'Среда/инструменты', 'Tag'],
                label: 'Инструменты обработки данных'
            },

            dataSources: {
                rows: 2,
                cols: 4,
                headers: ['Автоматизированная система', 'Источник', 'База данных', 'Tag'],
                label: 'Источники данных'
            },

            repositories: {
                rows: 2,
                cols: 6,
                headers: [
                    'Процесс',
                    'Ссылка на репозиторий, отвечающий за данный процесс',
                    'Ссылка на описание релизов',
                    'Ссылка на описание бизнес требований и постановку задач',
                    'Контактное лицо по вопросам к коду',
                    'Комментарий к коду'
                ],
                label: 'Репозитории по процессу'
            },

            metrics: {
                headers: {
                    row1: [
                        {content: 'Код метрики', colspan: 1, rowspan: 2},
                        {content: 'Наименование метрики', colspan: 1, rowspan: 2},
                        {content: 'Количество клиентов / элементов, ед.', colspan: 2, rowspan: 1},
                        {content: 'Сумма, руб.', colspan: 1, rowspan: 2},
                        {content: 'Код БП', colspan: 1, rowspan: 2},
                        {content: 'Пункт / подпункт акта', colspan: 1, rowspan: 2}
                    ],
                    row2: [
                        {content: 'ФЛ', colspan: 1, rowspan: 1},
                        {content: 'ЮЛ', colspan: 1, rowspan: 1}
                    ]
                },
                colWidths: [80, 200, 100, 100, 120, 80, 120],
                rows: 2
            },

            regularRisk: {
                headers: [
                    'Код процесса (номер-название)',
                    'Клиентский путь (номер-название)',
                    'Наименование нормативно-правового акта (НПА), который был нарушен',
                    'Статья/пункт НПА',
                    'Пункт, статья, название нормативного документа (КоАП/ФЗ и пр.), в соответствии с которыми к Банку могут быть применены санкции, с указанием суммы штрафа (min/max) согласно формулировок нормативного документа',
                    'Нефинансовые последствия/санкция к должностному лицу'
                ],
                colWidths: [150, 150, 200, 120, 250, 180],
                rows: 2,
                label: 'Выявленные инциденты регулярного риска'
            },

            operationalRisk: {
                headers: {
                    row1: [
                        {content: 'ОР', colspan: 1, rowspan: 1},
                        {content: 'Отклонения с признаками операционного риска (далее - ОР)', colspan: 5, rowspan: 1}
                    ],
                    row2: [
                        {content: 'Код процесса', colspan: 1, rowspan: 1},
                        {content: 'Блок - владелец процесса', colspan: 1, rowspan: 1},
                        {content: 'Тип рискового события (уровень 2)', colspan: 1, rowspan: 1},
                        {content: 'Оценка суммы события, руб', colspan: 1, rowspan: 1},
                        {content: 'Подтип и сумма последствия', colspan: 2, rowspan: 1}
                    ]
                },
                colWidths: [120, 150, 180, 150, 150, 150],
                rows: 2,
                label: 'Выявленные отклонения с признаками операционного риска'
            }
        },

        // Диалоги
        dialogs: {
            deleteMetricsTable: {
                title: 'Удаление таблицы метрик',
                message: 'При перемещении этого пункта таблица метрик будет удалена. Продолжить?',
                icon: '⚠️',
                confirmText: 'Да, переместить',
                cancelText: 'Отмена'
            }
        }
    };

    /**
     * Настройки таблиц
     * TODO: Добавить настройки таблиц при работе с модулем
     */
    static table = {
        // Здесь будут настройки таблиц
    };

    /**
     * Настройки текстовых блоков
     * TODO: Добавить настройки текстовых блоков при работе с модулем
     */
    static textBlock = {
        // Здесь будут настройки текстовых блоков
    };

    /**
     * Настройки нарушений
     * TODO: Добавить настройки нарушений при работе с модулем
     */
    static violation = {
        // Здесь будут настройки нарушений
    };

    /**
     * Настройки контекстного меню
     * TODO: Добавить настройки контекстного меню при работе с модулем
     */
    static contextMenu = {
        // Здесь будут настройки контекстного меню
    };

    /**
     * Настройки горячих клавиш
     */
    static hotkeys = {
        save: {
            key: 'KeyS',
            ctrlOrMeta: true
        }
    };

    /**
     * Настройки API
     */
    static api = {
        // Поддерживаемые форматы экспорта
        supportedFormats: ['txt', 'docx', 'md'],

        // Эндпоинты API
        endpoints: {
            saveAct: '/api/v1/act_operations/save_act',
            downloadFile: '/api/v1/act_operations/download'
        }
    };
}
