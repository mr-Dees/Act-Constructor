// static/js/create-act-dialog.js
/**
 * Диалог создания и редактирования акта
 */

const CreateActDialog = {
    /**
     * Текущий активный диалог
     * @private
     * @type {Element|null}
     */
    _currentDialog: null,

    /**
     * Показывает диалог создания нового акта
     */
    show() {
        this._showDialog(null);
    },

    /**
     * Показывает диалог редактирования существующего акта
     * @param {Object} actData - Данные акта для редактирования
     */
    showEdit(actData) {
        this._showDialog(actData);
    },

    /**
     * Клонирует template
     * @private
     */
    _cloneTemplate(templateId) {
        const template = document.getElementById(templateId);
        if (!template) {
            console.error(`Template ${templateId} не найден`);
            return null;
        }
        return template.content.cloneNode(true);
    },

    /**
     * Заполняет поля формы данными
     * @private
     */
    _fillField(element, fieldName, value) {
        const field = element.querySelector(`[data-field="${fieldName}"]`);
        if (!field) return;

        if (field.type === 'checkbox') {
            field.checked = !!value;
        } else if (field.type === 'number') {
            field.value = value !== null && value !== undefined ? value : '';
        } else if (field.tagName === 'BUTTON') {
            field.textContent = value;
        } else {
            if (field.textContent !== undefined && field.tagName !== 'INPUT') {
                field.textContent = value;
            } else {
                field.value = value || '';
            }
        }
    },

    /**
     * Закрывает текущий диалог
     * @private
     */
    _closeDialog() {
        if (this._currentDialog) {
            this._currentDialog.remove();
            this._currentDialog = null;
        }
    },

    /**
     * Настраивает обработчик закрытия по Escape
     * @private
     */
    _setupEscapeHandler() {
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this._closeDialog();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    },

    /**
     * Отображает диалог
     * @private
     */
    _showDialog(actData) {
        const isEdit = !!actData;
        const currentUser = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";

        const modal = this._cloneTemplate('createActDialogTemplate');
        if (!modal) return;

        // Заполняем заголовок и кнопку
        this._fillField(modal, 'title', isEdit ? 'Редактирование акта' : 'Создание нового акта');
        this._fillField(modal, 'submitText', isEdit ? 'Сохранить изменения' : 'Создать акт');

        // Заполняем поля формы если редактирование
        if (isEdit && actData) {
            this._fillField(modal, 'km_number', actData.km_number);
            this._fillField(modal, 'part_number', actData.part_number || 1);
            this._fillField(modal, 'total_parts', actData.total_parts || 1);
            this._fillField(modal, 'inspection_name', actData.inspection_name);
            this._fillField(modal, 'city', actData.city);
            this._fillField(modal, 'created_date', actData.created_date);
            this._fillField(modal, 'order_number', actData.order_number);
            this._fillField(modal, 'order_date', actData.order_date);
            this._fillField(modal, 'inspection_start_date', actData.inspection_start_date);
            this._fillField(modal, 'inspection_end_date', actData.inspection_end_date);
            this._fillField(modal, 'is_process_based', actData.is_process_based !== false);
        } else {
            // Для нового акта ставим значения по умолчанию
            this._fillField(modal, 'part_number', 1);
            this._fillField(modal, 'total_parts', 1);
            this._fillField(modal, 'is_process_based', true);
        }

        document.body.appendChild(modal);

        // Теперь работаем с добавленным в DOM элементом
        const addedModal = document.body.lastElementChild;
        this._currentDialog = addedModal;

        // Настраиваем обработчик Escape
        this._setupEscapeHandler();

        // УДАЛЕНЫ inline-стили - теперь работает через CSS [readonly]

        // Скрываем/показываем секцию поручений
        const directivesSection = addedModal.querySelector('fieldset:has(#directivesContainer)');
        if (directivesSection) {
            if (isEdit) {
                directivesSection.style.display = '';
            } else {
                directivesSection.style.display = 'none';
            }
        }

        // Инициализируем аудиторскую группу и поручения
        this._initializeAuditTeam(addedModal, actData, currentUser);
        this._initializeDirectives(addedModal, actData);

        // Обработчики кнопок
        const addTeamBtn = addedModal.querySelector('#addTeamMemberBtn');
        const addDirectiveBtn = addedModal.querySelector('#addDirectiveBtn');
        const closeBtn = addedModal.querySelector('.dialog-create-act-close');
        const cancelBtn = addedModal.querySelector('.dialog-cancel');
        const form = addedModal.querySelector('#actForm');
        const overlay = addedModal.querySelector('.custom-dialog-overlay');
        const dialog = addedModal.querySelector('.custom-dialog');

        if (addTeamBtn) {
            addTeamBtn.onclick = () => this._addTeamMember(addedModal);
        }

        if (addDirectiveBtn) {
            addDirectiveBtn.onclick = () => this._addDirective(addedModal);
        }

        if (closeBtn) {
            closeBtn.onclick = () => this._closeDialog();
        }

        if (cancelBtn) {
            cancelBtn.onclick = () => this._closeDialog();
        }

        // Закрытие по клику на оверлей
        if (overlay && dialog) {
            overlay.addEventListener('click', (e) => {
                console.log('Click on overlay:', e.target);
                console.log('Is overlay?', e.target === overlay);
                console.log('Is inside dialog?', dialog.contains(e.target));

                if (e.target === overlay) {
                    this._closeDialog();
                }
            });
        }

        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                await this._handleFormSubmit(e.target, isEdit, actData?.id, currentUser, addedModal);
            };
        }
    },

    /**
     * Инициализирует аудиторскую группу
     * @private
     */
    _initializeAuditTeam(modal, actData, currentUser) {
        if (actData && actData.audit_team) {
            actData.audit_team.forEach(member => {
                this._addTeamMember(modal, member.role, member.full_name, member.position, member.username);
            });
        } else {
            // 3 строки по умолчанию:
            // 1. Куратор (пустой)
            this._addTeamMember(modal, 'Куратор', '', '', '');

            // 2. Руководитель (текущий пользователь)
            this._addTeamMember(modal, 'Руководитель', '', '', currentUser);

            // 3. Участник (пустой)
            this._addTeamMember(modal, 'Участник', '', '', '');
        }
    },

    /**
     * Инициализирует поручения
     * @private
     */
    _initializeDirectives(modal, actData) {
        if (actData && actData.directives) {
            actData.directives.forEach(dir => {
                this._addDirective(modal, dir.point_number, dir.directive_number);
            });
        }
    },

    /**
     * Добавляет члена аудиторской группы
     * @private
     */
    _addTeamMember(modal, role = 'Руководитель', fullName = '', position = '', username = '') {
        const container = modal.querySelector('#auditTeamContainer');
        if (!container) return;

        const memberRow = this._cloneTemplate('teamMemberRowTemplate');
        if (!memberRow) return;

        const rowElement = memberRow.querySelector('.team-member-row');

        // Заполняем данные
        const roleSelect = rowElement.querySelector('[name="role"]');
        if (roleSelect) roleSelect.value = role;

        this._fillField(rowElement, 'full_name', fullName);
        this._fillField(rowElement, 'position', position);
        this._fillField(rowElement, 'username', username);

        // Обработчик удаления
        const deleteBtn = rowElement.querySelector('.delete-member-btn');
        if (deleteBtn) {
            deleteBtn.onclick = () => rowElement.remove();
        }

        container.appendChild(memberRow);
    },

    /**
     * Добавляет поручение
     * @private
     */
    _addDirective(modal, pointNumber = '', directiveNumber = '') {
        const container = modal.querySelector('#directivesContainer');
        if (!container) return;

        const directiveRow = this._cloneTemplate('directiveRowTemplate');
        if (!directiveRow) return;

        const rowElement = directiveRow.querySelector('.directive-row');

        // Заполняем данные
        this._fillField(rowElement, 'point_number', pointNumber);
        this._fillField(rowElement, 'directive_number', directiveNumber);

        // Обработчик удаления
        const deleteBtn = rowElement.querySelector('.delete-directive-btn');
        if (deleteBtn) {
            deleteBtn.onclick = () => rowElement.remove();
        }

        container.appendChild(directiveRow);
    },

    /**
     * Валидирует форму перед отправкой
     * @private
     */
    _validateForm(modal, isEdit) {
        // Собираем аудиторскую группу
        const teamMembers = Array.from(modal.querySelectorAll('.team-member-row'));

        if (teamMembers.length === 0) {
            if (typeof Notifications !== 'undefined') {
                Notifications.warning('Добавьте хотя бы одного члена группы');
            } else {
                alert('Добавьте хотя бы одного члена группы');
            }
            return false;
        }

        // Проверяем наличие куратора и руководителя
        const roles = teamMembers.map(row => row.querySelector('[name="role"]').value);
        const hasCurator = roles.includes('Куратор');
        const hasLeader = roles.includes('Руководитель');

        if (!hasCurator) {
            if (typeof Notifications !== 'undefined') {
                Notifications.warning('В аудиторской группе должен быть хотя бы один куратор');
            } else {
                alert('В аудиторской группе должен быть хотя бы один куратор');
            }
            return false;
        }

        if (!hasLeader) {
            if (typeof Notifications !== 'undefined') {
                Notifications.warning('В аудиторской группе должен быть хотя бы один руководитель');
            } else {
                alert('В аудиторской группе должен быть хотя бы один руководитель');
            }
            return false;
        }

        // Валидируем поручения только при редактировании
        if (isEdit) {
            const directives = Array.from(modal.querySelectorAll('.directive-row'));

            for (const row of directives) {
                const pointNumber = row.querySelector('[name="point_number"]').value.trim();

                if (!pointNumber) continue; // Пропускаем пустые строки

                if (!pointNumber.startsWith('5.')) {
                    if (typeof Notifications !== 'undefined') {
                        Notifications.warning(`Поручения могут быть только в разделе 5 (указан пункт: ${pointNumber})`);
                    } else {
                        alert(`Поручения могут быть только в разделе 5 (указан пункт: ${pointNumber})`);
                    }
                    return false;
                }

                // Проверяем формат
                const parts = pointNumber.split('.');
                if (parts.length < 3) {
                    if (typeof Notifications !== 'undefined') {
                        Notifications.warning(`Неверный формат пункта: ${pointNumber}. Ожидается формат 5.X.Y`);
                    } else {
                        alert(`Неверный формат пункта: ${pointNumber}. Ожидается формат 5.X.Y`);
                    }
                    return false;
                }
            }
        }

        return true;
    },

    /**
     * Обрабатывает отправку формы
     * @private
     */
    async _handleFormSubmit(form, isEdit, actId, currentUser, modal) {
        try {
            // Валидация перед отправкой
            if (!this._validateForm(modal, isEdit)) {
                return;
            }

            const fd = new FormData(form);

            // Собираем аудиторскую группу
            const auditTeam = Array.from(
                modal.querySelectorAll('.team-member-row')
            ).map(row => ({
                role: row.querySelector('[name="role"]').value,
                full_name: row.querySelector('[name="full_name"]').value,
                position: row.querySelector('[name="position"]').value,
                username: row.querySelector('[name="username"]').value
            }));

            // Собираем поручения
            const directives = Array.from(
                modal.querySelectorAll('.directive-row')
            ).map(row => ({
                point_number: row.querySelector('[name="point_number"]').value,
                directive_number: row.querySelector('[name="directive_number"]').value
            }));

            // Вспомогательная функция для обработки дат
            const getDateOrNull = (fieldName) => {
                const value = fd.get(fieldName);
                return value && value.trim() !== '' ? value : null;
            };

            // Вспомогательная функция для чисел
            const getNumberOrDefault = (fieldName, defaultValue) => {
                const value = fd.get(fieldName);
                const parsed = parseInt(value, 10);
                return !isNaN(parsed) && parsed > 0 ? parsed : defaultValue;
            };

            const body = {
                km_number: fd.get('km_number'),
                part_number: getNumberOrDefault('part_number', 1),
                total_parts: getNumberOrDefault('total_parts', 1),
                inspection_name: fd.get('inspection_name'),
                city: fd.get('city'),
                created_date: getDateOrNull('created_date'),
                order_number: fd.get('order_number'),
                order_date: fd.get('order_date'),
                inspection_start_date: fd.get('inspection_start_date'),
                inspection_end_date: fd.get('inspection_end_date'),
                is_process_based: !!fd.get('is_process_based'),
                audit_team: auditTeam,
                directives: directives
            };

            const endpoint = isEdit
                ? `/api/v1/acts/${actId}`
                : '/api/v1/acts/create';
            const method = isEdit ? 'PATCH' : 'POST';

            const resp = await fetch(endpoint, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-JupyterHub-User': currentUser
                },
                body: JSON.stringify(body)
            });

            if (!resp.ok) {
                const errData = await resp.json();

                // Проверяем специальный случай: КМ уже существует
                if (resp.status === 409 && errData.detail?.type === 'km_exists') {
                    const kmData = errData.detail;

                    // Показываем диалог подтверждения
                    const confirmed = await DialogManager.show({
                        title: 'КМ уже существует',
                        message: `Акт с КМ "${kmData.km_number}" уже существует (частей: ${kmData.current_parts}).\n\nСоздать новую часть ${kmData.next_part} для этого акта?`,
                        icon: '❓',
                        confirmText: 'Да, создать новую часть',
                        cancelText: 'Отмена'
                    });

                    if (confirmed) {
                        // Повторяем запрос с force_new_part=true
                        await this._createWithNewPart(endpoint, body, currentUser);
                    }
                    return;
                }

                // Обычная ошибка
                throw new Error(errData.detail || 'Ошибка сервера');
            }

            const data = await resp.json();
            this._closeDialog();

            if (typeof Notifications !== 'undefined') {
                Notifications.success(isEdit ? 'Акт обновлен' : 'Акт создан успешно');
            }

            if (isEdit) {
                // При редактировании перезагружаем список актов если на странице управления
                if (window.ActsManagerPage && typeof window.ActsManagerPage.loadActs === 'function') {
                    window.ActsManagerPage.loadActs();
                }

                // Перезагружаем список в меню актов если оно открыто
                if (window.ActsMenuManager && typeof window.ActsMenuManager.renderActsList === 'function') {
                    window.ActsMenuManager.renderActsList();
                }
                return;
            }

            // При создании переходим к новому акту
            window.location.href = `/constructor?act_id=${data.id}`;

        } catch (err) {
            console.error('Ошибка сохранения акта:', err);
            if (typeof Notifications !== 'undefined') {
                Notifications.error('Не удалось сохранить акт: ' + err.message);
            } else {
                alert('Ошибка: ' + err.message);
            }
        }
    },

    /**
     * Создает акт как новую часть существующего КМ
     * @private
     */
    async _createWithNewPart(endpoint, body, currentUser) {
        try {
            const resp = await fetch(`${endpoint}?force_new_part=true`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-JupyterHub-User': currentUser
                },
                body: JSON.stringify(body)
            });

            if (!resp.ok) {
                const errData = await resp.json();
                throw new Error(errData.detail || 'Ошибка сервера');
            }

            const data = await resp.json();
            this._closeDialog();

            if (typeof Notifications !== 'undefined') {
                Notifications.success(`Создана новая часть ${data.part_number} акта`);
            }

            window.location.href = `/constructor?act_id=${data.id}`;

        } catch (err) {
            console.error('Ошибка создания новой части:', err);
            if (typeof Notifications !== 'undefined') {
                Notifications.error('Не удалось создать новую часть: ' + err.message);
            } else {
                alert('Ошибка: ' + err.message);
            }
        }
    }
};

// Глобальный доступ
window.CreateActDialog = CreateActDialog;
