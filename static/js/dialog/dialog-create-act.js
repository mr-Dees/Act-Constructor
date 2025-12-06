// static/js/dialog/dialog-create-act.js
/**
 * Диалог создания и редактирования акта
 *
 * Управляет сложной формой с динамическими списками (аудиторская группа, поручения).
 * Наследует базовый функционал от DialogBase.
 */
class CreateActDialog extends DialogBase {
    /**
     * Текущий активный диалог (overlay элемент)
     * @private
     * @type {HTMLElement|null}
     */
    static _currentDialog = null;

    /**
     * Показывает диалог создания нового акта
     */
    static show() {
        this._showActDialog(null);
    }

    /**
     * Показывает диалог редактирования существующего акта
     * @param {Object} actData - Данные акта для редактирования
     */
    static showEdit(actData) {
        this._showActDialog(actData);
    }

    /**
     * Отображает диалог создания/редактирования
     * @private
     * @param {Object|null} actData - Данные акта (null для создания нового)
     */
    static _showActDialog(actData) {
        const isEdit = !!actData;
        const currentUser = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";

        // Клонируем template
        const fragment = this._cloneTemplate('createActDialogTemplate');
        if (!fragment) return;

        // Создаём overlay
        const overlay = this._createOverlay();

        // Переносим содержимое template в overlay
        const dialogElement = fragment.querySelector('.custom-dialog');
        if (dialogElement) {
            overlay.appendChild(dialogElement);
        } else {
            // Fallback: добавляем всё содержимое fragment
            overlay.appendChild(fragment);
        }

        // Сохраняем ссылку на текущий диалог
        this._currentDialog = overlay;

        // Находим внутренний диалог для правильной обработки кликов
        const dialog = overlay.querySelector('.acts-modal');
        if (!dialog) {
            console.error('Не найден .acts-modal в template');
            return;
        }

        // Заполняем заголовок и кнопку
        this._fillField(dialog, 'title', isEdit ? 'Редактирование акта' : 'Создание нового акта');
        this._fillField(dialog, 'submitText', isEdit ? 'Сохранить изменения' : 'Создать акт');

        // Заполняем поля формы
        if (isEdit && actData) {
            this._fillFormFields(dialog, actData);
            // Сохраняем исходный КМ для проверки изменений
            const form = dialog.querySelector('#actForm');
            if (form) {
                form.dataset.originalKm = actData.km_number;
            }
        } else {
            // Значения по умолчанию для нового акта
            this._fillField(dialog, 'part_number', 1);
            this._fillField(dialog, 'total_parts', 1);
            this._fillField(dialog, 'is_process_based', true);
        }

        // Настраиваем закрытие
        this._setupCloseHandlers(overlay, dialog);

        // Скрываем/показываем секции
        this._toggleSections(dialog, isEdit);

        // Инициализируем динамические списки
        this._initializeAuditTeam(dialog, actData, currentUser);
        this._initializeDirectives(dialog, actData);

        // Привязываем обработчики
        this._setupEventHandlers(dialog, isEdit, actData, currentUser);

        // Инициализируем маски ввода
        this._initInputMasks(dialog);

        // Показываем диалог с базовыми эффектами
        super._showDialog(overlay);
    }

    /**
     * Заполняет поля формы данными акта
     * @private
     */
    static _fillFormFields(dialog, actData) {
        this._fillField(dialog, 'km_number', actData.km_number);
        this._fillField(dialog, 'part_number', actData.part_number || 1);
        this._fillField(dialog, 'total_parts', actData.total_parts || 1);
        this._fillField(dialog, 'inspection_name', actData.inspection_name);
        this._fillField(dialog, 'city', actData.city);
        this._fillField(dialog, 'created_date', actData.created_date);
        this._fillField(dialog, 'order_number', actData.order_number);
        this._fillField(dialog, 'order_date', actData.order_date);
        this._fillField(dialog, 'inspection_start_date', actData.inspection_start_date);
        this._fillField(dialog, 'inspection_end_date', actData.inspection_end_date);
        this._fillField(dialog, 'is_process_based', actData.is_process_based !== false);

        // Новые поля для служебной записки
        if (actData.service_note) {
            this._fillField(dialog, 'service_note', actData.service_note);
        }
        if (actData.service_note_date) {
            this._fillField(dialog, 'service_note_date', actData.service_note_date);
        }
    }

    /**
     * Показывает/скрывает секции в зависимости от режима
     * @private
     */
    static _toggleSections(dialog, isEdit) {
        // При редактировании КМ можно изменять - НЕ скрываем
        const kmField = dialog.querySelector('#kmNumberField');
        if (kmField) {
            kmField.style.display = ''; // Всегда показываем
        }

        // Служебная записка: только при редактировании
        const serviceNoteSection = dialog.querySelector('#serviceNoteFieldset');
        if (serviceNoteSection) {
            serviceNoteSection.style.display = isEdit ? '' : 'none';
        }

        // Поручения: только при редактировании
        const directivesSection = dialog.querySelector('#directivesFieldset');
        if (directivesSection) {
            directivesSection.style.display = isEdit ? '' : 'none';
        }
    }

    /**
     * Настраивает обработчики закрытия диалога
     * @private
     */
    static _setupCloseHandlers(overlay, dialog) {
        const closeBtn = dialog.querySelector('.acts-modal-close');
        const cancelBtn = dialog.querySelector('.dialog-cancel');

        if (closeBtn) {
            closeBtn.onclick = () => this._closeDialog();
        }

        if (cancelBtn) {
            cancelBtn.onclick = () => this._closeDialog();
        }

        // Закрытие по клику вне диалога
        this._setupOverlayClickHandler(overlay, dialog, () => this._closeDialog());

        // Закрытие по Escape
        this._setupEscapeHandler(overlay, () => this._closeDialog());
    }

    /**
     * Настраивает обработчики событий формы
     * @private
     */
    static _setupEventHandlers(dialog, isEdit, actData, currentUser) {
        const addTeamBtn = dialog.querySelector('#addTeamMemberBtn');
        const addDirectiveBtn = dialog.querySelector('#addDirectiveBtn');
        const form = dialog.querySelector('#actForm');

        if (addTeamBtn) {
            addTeamBtn.onclick = () => this._addTeamMember(dialog);
        }

        if (addDirectiveBtn) {
            addDirectiveBtn.onclick = () => this._addDirective(dialog);
        }

        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                await this._handleFormSubmit(e.target, isEdit, actData?.id, currentUser, dialog);
            };
        }
    }

    /**
     * Инициализирует маски ввода для КМ и служебной записки
     * @private
     */
    static _initInputMasks(dialog) {
        this._initKmNumberMask(dialog);
        this._initServiceNoteMask(dialog);
        this._initDateFieldsClearValidation(dialog);
    }

    /**
     * Сбрасывает валидацию для полей дат при их изменении
     * @private
     */
    static _initDateFieldsClearValidation(dialog) {
        const dateFields = dialog.querySelectorAll('input[type="date"]');

        dateFields.forEach(field => {
            field.addEventListener('input', () => {
                field.setCustomValidity('');
            });

            field.addEventListener('change', () => {
                field.setCustomValidity('');
            });
        });
    }

    /**
     * Инициализация маски ввода для КМ номера
     * @private
     */
    static _initKmNumberMask(dialog) {
        const kmInput = dialog.querySelector('input[name="km_number"]');
        if (!kmInput) return;

        kmInput.addEventListener('input', (e) => {
            // Сбрасываем валидацию при изменении
            e.target.setCustomValidity('');

            let value = e.target.value;

            // Удаляем все кроме цифр и дефисов
            let cleaned = value.replace(/[^\dКМ\-]/g, '');

            // Извлекаем только цифры
            let digits = cleaned.replace(/[^\d]/g, '');

            // Ограничиваем до 6 цифр
            digits = digits.substring(0, 6);

            // Форматируем: КМ-XX-XXXX
            let formatted = 'КМ-';

            if (digits.length > 0) {
                formatted += digits.substring(0, 2);
            }

            if (digits.length > 2) {
                formatted += '-' + digits.substring(2, 6);
            }

            e.target.value = formatted;
        });

        // Валидация при потере фокуса
        kmInput.addEventListener('blur', (e) => {
            const value = e.target.value;
            const pattern = /^КМ-\d{2}-\d{4}$/;

            // Сбрасываем предыдущую ошибку
            e.target.setCustomValidity('');

            if (value && !pattern.test(value)) {
                e.target.setCustomValidity('КМ номер должен быть в формате КМ-XX-XXXX (например, КМ-75-9475)');
                e.target.reportValidity();
            }
        });
    }

    /**
     * Инициализация маски ввода для служебной записки
     * @private
     */
    static _initServiceNoteMask(dialog) {
        const serviceNoteInput = dialog.querySelector('input[name="service_note"]');
        const serviceDateInput = dialog.querySelector('input[name="service_note_date"]');

        if (!serviceNoteInput) return;

        // Обработчик изменения для автоматического обновления части
        serviceNoteInput.addEventListener('input', () => {
            // Сбрасываем валидацию при изменении
            serviceNoteInput.setCustomValidity('');
            this._handleServiceNoteChange(dialog);
        });

        // Сбрасываем валидацию даты при её изменении
        if (serviceDateInput) {
            serviceDateInput.addEventListener('input', () => {
                serviceDateInput.setCustomValidity('');
            });
        }

        // Валидация при потере фокуса
        serviceNoteInput.addEventListener('blur', (e) => {
            const value = e.target.value.trim();

            // Сбрасываем предыдущую ошибку
            e.target.setCustomValidity('');

            if (!value) {
                return;
            }

            const pattern = /^.+\/\d{4}$/;

            if (!pattern.test(value)) {
                e.target.setCustomValidity(
                    'Служебная записка должна быть в формате Текст/XXXX (4 цифры после /)'
                );
                e.target.reportValidity();
            } else {
                const parts = value.split('/');
                if (parts[0].trim().length === 0) {
                    e.target.setCustomValidity('Служебная записка должна содержать текст до символа "/"');
                    e.target.reportValidity();
                }
            }
        });
    }

    /**
     * Обработчик изменения служебной записки
     * Обновляет метку поля "Часть акта"
     * @private
     */
    static _handleServiceNoteChange(dialog) {
        const serviceNoteInput = dialog.querySelector('input[name="service_note"]');
        const partNumberLabel = dialog.querySelector('#partNumberLabel');
        const partNumberInput = dialog.querySelector('input[name="part_number"]');
        const totalPartsLabel = dialog.querySelector('#totalPartsLabel');

        if (!serviceNoteInput || !partNumberLabel) return;

        const serviceNote = serviceNoteInput.value.trim();

        if (serviceNote && serviceNote.includes('/')) {
            // Извлекаем 4 цифры после "/"
            const parts = serviceNote.split('/');
            if (parts.length === 2 && /^\d{4}$/.test(parts[1])) {
                const suffix = parseInt(parts[1], 10);
                partNumberLabel.textContent = 'Часть акта (из СЗ)';
                if (partNumberInput) {
                    partNumberInput.value = suffix;
                    partNumberInput.readOnly = true;
                }

                if (totalPartsLabel) {
                    totalPartsLabel.textContent = 'Всего частей (не применимо)';
                }
                return;
            }
        }

        // Возвращаем к автоматической нумерации
        partNumberLabel.textContent = 'Часть акта (автоматически)';
        if (partNumberInput) {
            partNumberInput.readOnly = true;
        }

        if (totalPartsLabel) {
            totalPartsLabel.textContent = 'Всего частей (автоматически)';
        }
    }

    /**
     * Закрывает текущий диалог
     * @private
     */
    static _closeDialog() {
        if (this._currentDialog) {
            this._removeEscapeHandler(this._currentDialog);
            super._hideDialog(this._currentDialog);
            this._currentDialog = null;
        }
    }

    /**
     * Инициализирует аудиторскую группу
     * @private
     */
    static _initializeAuditTeam(dialog, actData, currentUser) {
        if (actData && actData.audit_team && actData.audit_team.length > 0) {
            actData.audit_team.forEach(member => {
                this._addTeamMember(dialog, member.role, member.full_name, member.position, member.username);
            });
        } else {
            // 3 строки по умолчанию
            this._addTeamMember(dialog, 'Куратор', '', '', '');
            this._addTeamMember(dialog, 'Руководитель', '', '', currentUser);
            this._addTeamMember(dialog, 'Участник', '', '', '');
        }
    }

    /**
     * Инициализирует поручения
     * @private
     */
    static _initializeDirectives(dialog, actData) {
        if (actData && actData.directives && actData.directives.length > 0) {
            actData.directives.forEach(dir => {
                this._addDirective(dialog, dir.point_number, dir.directive_number);
            });
        }
    }

    /**
     * Добавляет члена аудиторской группы
     * @private
     */
    static _addTeamMember(dialog, role = 'Руководитель', fullName = '', position = '', username = '') {
        const container = dialog.querySelector('#auditTeamContainer');
        if (!container) return;

        const memberRow = this._cloneTemplate('teamMemberRowTemplate');
        if (!memberRow) return;

        const rowElement = memberRow.querySelector('.team-member-row');
        if (!rowElement) return;

        // Заполняем данные
        const roleSelect = rowElement.querySelector('[name="role"]');
        if (roleSelect) roleSelect.value = role;

        const fullNameInput = rowElement.querySelector('[name="full_name"]');
        if (fullNameInput) fullNameInput.value = fullName;

        const positionInput = rowElement.querySelector('[name="position"]');
        if (positionInput) positionInput.value = position;

        const usernameInput = rowElement.querySelector('[name="username"]');
        if (usernameInput) usernameInput.value = username;

        // Обработчик удаления
        const deleteBtn = rowElement.querySelector('.delete-member-btn');
        if (deleteBtn) {
            deleteBtn.onclick = () => rowElement.remove();
        }

        container.appendChild(memberRow);
    }

    /**
     * Добавляет поручение
     * @private
     */
    static _addDirective(dialog, pointNumber = '', directiveNumber = '') {
        const container = dialog.querySelector('#directivesContainer');
        if (!container) return;

        const directiveRow = this._cloneTemplate('directiveRowTemplate');
        if (!directiveRow) return;

        const rowElement = directiveRow.querySelector('.directive-row');
        if (!rowElement) return;

        // Заполняем данные
        const pointInput = rowElement.querySelector('[name="point_number"]');
        if (pointInput) pointInput.value = pointNumber;

        const directiveInput = rowElement.querySelector('[name="directive_number"]');
        if (directiveInput) directiveInput.value = directiveNumber;

        // Обработчик удаления
        const deleteBtn = rowElement.querySelector('.delete-directive-btn');
        if (deleteBtn) {
            deleteBtn.onclick = () => rowElement.remove();
        }

        container.appendChild(directiveRow);
    }

    /**
     * Валидирует взаимосвязь служебной записки и даты
     * @private
     */
    static _validateServiceNoteFields(dialog) {
        const serviceNoteInput = dialog.querySelector('input[name="service_note"]');
        const serviceDateInput = dialog.querySelector('input[name="service_note_date"]');

        if (!serviceNoteInput || !serviceDateInput) return true;

        const hasNote = serviceNoteInput.value.trim() !== '';
        const hasDate = serviceDateInput.value.trim() !== '';

        // Сначала очищаем все ошибки
        serviceNoteInput.setCustomValidity('');
        serviceDateInput.setCustomValidity('');

        if (hasNote && !hasDate) {
            serviceDateInput.setCustomValidity('При указании служебной записки необходимо указать дату');
            serviceDateInput.reportValidity();
            return false;
        }

        if (hasDate && !hasNote) {
            serviceNoteInput.setCustomValidity('При указании даты служебной записки необходимо указать саму записку');
            serviceNoteInput.reportValidity();
            return false;
        }

        return true;
    }

    /**
     * Валидирует форму перед отправкой
     * @private
     */
    static _validateForm(dialog, isEdit) {
        // Сначала сбрасываем все кастомные ошибки валидации
        dialog.querySelectorAll('input, textarea, select').forEach(field => {
            field.setCustomValidity('');
        });

        // Проверяем служебную записку
        if (!this._validateServiceNoteFields(dialog)) {
            return false;
        }

        // Собираем аудиторскую группу
        const teamMembers = Array.from(dialog.querySelectorAll('.team-member-row'));

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
            const directives = Array.from(dialog.querySelectorAll('.directive-row'));

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
    }

    /**
     * Обрабатывает отправку формы
     * @private
     */
    static async _handleFormSubmit(form, isEdit, actId, currentUser, dialog) {
        let body = null; // Объявляем выше try-catch

        try {
            // Валидация
            if (!this._validateForm(dialog, isEdit)) {
                return;
            }

            // Проверка изменения КМ
            if (isEdit && !await this._confirmKmChange(form, dialog)) {
                return;
            }

            // Сбор данных
            body = this._collectFormData(form, dialog, isEdit, actId);

            // Отправка
            const response = await this._submitActData(body, isEdit, actId, currentUser);

            // Обработка успеха
            await this._handleSubmitSuccess(response, isEdit, actId, dialog);

        } catch (err) {
            // Обработка ошибок
            await this._handleSubmitError(err, isEdit, currentUser, body, dialog);
        }
    }

    /**
     * Проверяет и подтверждает изменение КМ при редактировании
     * @private
     */
    static async _confirmKmChange(form, dialog) {
        const originalKm = form.dataset.originalKm;
        const kmInput = dialog.querySelector('input[name="km_number"]');
        const newKm = kmInput?.value;

        if (!originalKm || !newKm || originalKm === newKm) {
            return true; // КМ не изменился
        }

        return await DialogManager.show({
            title: 'Изменение КМ',
            message: `Вы изменяете КМ с ${originalKm} на ${newKm}. Акт будет перемещен в новую группу КМ. Продолжить?`,
            icon: '⚠️',
            confirmText: 'Продолжить',
            cancelText: 'Отмена'
        });
    }

    /**
     * Собирает данные из формы
     * @private
     */
    static _collectFormData(form, dialog, isEdit, actId) {
        const fd = new FormData(form);

        // Вспомогательные функции
        const getDateOrNull = (fieldName) => {
            const value = fd.get(fieldName);
            return value && value.trim() !== '' ? value : null;
        };

        const getStringOrNull = (fieldName) => {
            const value = fd.get(fieldName);
            return value && value.trim() !== '' ? value.trim() : null;
        };

        const getNumberOrDefault = (fieldName, defaultValue) => {
            const value = fd.get(fieldName);
            const parsed = parseInt(value, 10);
            return !isNaN(parsed) && parsed > 0 ? parsed : defaultValue;
        };

        // Собираем аудиторскую группу
        const auditTeam = this._collectAuditTeam(dialog);

        // Собираем поручения (только при редактировании)
        const directives = isEdit ? this._collectDirectives(dialog) : [];

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
            directives: directives,
            service_note: getStringOrNull('service_note'),
            service_note_date: getDateOrNull('service_note_date')
        };

        return body;
    }

    /**
     * Собирает данные аудиторской группы
     * @private
     */
    static _collectAuditTeam(dialog) {
        return Array.from(dialog.querySelectorAll('.team-member-row')).map(row => ({
            role: row.querySelector('[name="role"]').value,
            full_name: row.querySelector('[name="full_name"]').value,
            position: row.querySelector('[name="position"]').value,
            username: row.querySelector('[name="username"]').value
        }));
    }

    /**
     * Собирает данные поручений
     * @private
     */
    static _collectDirectives(dialog) {
        return Array.from(dialog.querySelectorAll('.directive-row'))
            .map(row => ({
                point_number: row.querySelector('[name="point_number"]').value,
                directive_number: row.querySelector('[name="directive_number"]').value
            }))
            .filter(dir => dir.point_number.trim() !== '');
    }

    /**
     * Отправляет данные акта на сервер
     * @private
     */
    static async _submitActData(body, isEdit, actId, currentUser) {
        const endpoint = isEdit ? `/api/v1/acts/${actId}` : '/api/v1/acts/create';
        const method = isEdit ? 'PATCH' : 'POST';

        const response = await fetch(endpoint, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'X-JupyterHub-User': currentUser
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw {response, errData}; // Бросаем объект для обработки в _handleSubmitError
        }

        return await response.json();
    }

    /**
     * Обрабатывает успешную отправку формы
     * @private
     */
    static async _handleSubmitSuccess(data, isEdit, actId, dialog) {
        this._closeDialog();

        if (typeof Notifications !== 'undefined') {
            Notifications.success(isEdit ? 'Акт обновлен' : 'Акт создан успешно');
        }

        // Инвалидируем кеш меню
        this._invalidateCache();

        if (isEdit) {
            await this._refreshAfterEdit(actId);
        } else {
            await this._navigateToNewAct(data.id);
        }
    }

    /**
     * Обрабатывает ошибки при отправке формы
     * @private
     */
    static async _handleSubmitError(err, isEdit, currentUser, body, dialog) {
        // Проверяем специальный случай: КМ уже существует (только при создании)
        if (!isEdit && err.response?.status === 409 && err.errData?.detail?.type === 'km_exists') {
            await this._handleKmExistsError(err.errData.detail, body, currentUser);
            return;
        }

        // Обычная ошибка
        console.error('Ошибка сохранения акта:', err);

        const errorMessage = err.errData?.detail || err.message || 'Неизвестная ошибка';

        if (typeof Notifications !== 'undefined') {
            Notifications.error('Не удалось сохранить акт: ' + errorMessage);
        } else {
            alert('Ошибка: ' + errorMessage);
        }
    }

    /**
     * Обрабатывает ошибку существования КМ
     * @private
     */
    static async _handleKmExistsError(kmData, body, currentUser) {
        const message = this._buildKmExistsMessage(kmData);

        const confirmed = await DialogManager.show({
            title: 'КМ уже существует',
            message: message,
            icon: '❓',
            confirmText: 'Да, создать новую часть',
            cancelText: 'Отмена'
        });

        if (confirmed) {
            await this._createWithNewPart('/api/v1/acts/create', body, currentUser);
        }
    }

    /**
     * Формирует сообщение об существующем КМ
     * @private
     */
    static _buildKmExistsMessage(kmData) {
        let message = `Акт с КМ "${kmData.km_number}" уже существует.\n\n`;
        message += `Текущее количество частей: ${kmData.current_parts}\n\n`;
        message += `Создать новую часть ${kmData.next_part} для этого акта?`;
        return message;
    }

    /**
     * Инвалидирует кеш меню актов
     * @private
     */
    static _invalidateCache() {
        if (window.ActsMenuManager && typeof window.ActsMenuManager._clearCache === 'function') {
            window.ActsMenuManager._clearCache();
        }
    }

    /**
     * Обновляет интерфейс после редактирования
     * @private
     */
    static async _refreshAfterEdit(actId) {
        // Перезагружаем список актов
        if (window.ActsManagerPage && typeof window.ActsManagerPage.loadActs === 'function') {
            await window.ActsManagerPage.loadActs();
        }

        // Перезагружаем меню актов
        if (window.ActsMenuManager && typeof window.ActsMenuManager.renderActsList === 'function') {
            await window.ActsMenuManager.renderActsList(true);
        }

        // Если редактируется текущий акт - перезагружаем его
        if (window.currentActId === actId && window.APIClient) {
            await window.APIClient.loadActContent(actId);

            if (window.StorageManager && typeof window.StorageManager.markAsSyncedWithDB === 'function') {
                window.StorageManager.markAsSyncedWithDB();
            }

            if (typeof Notifications !== 'undefined') {
                Notifications.info('Данные акта обновлены');
            }
        }
    }

    /**
     * Переходит на страницу нового акта
     * @private
     */
    static async _navigateToNewAct(actId) {
        window.location.href = `/constructor?act_id=${actId}`;
    }

    /**
     * Создает акт как новую часть существующего КМ
     * @private
     */
    static async _createWithNewPart(endpoint, body, currentUser) {
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
}

// Глобальный доступ
window.CreateActDialog = CreateActDialog;
