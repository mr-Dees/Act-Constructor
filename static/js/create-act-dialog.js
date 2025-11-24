// static/js/create-act-dialog.js
/**
 * Диалог создания и редактирования акта
 *
 * Поддерживает как создание нового акта, так и редактирование метаданных существующего.
 */

const CreateActDialog = {
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
     * Отображает диалог
     * @private
     * @param {Object|null} actData - Данные акта (null для создания нового)
     */
    _showDialog(actData) {
        const isEdit = !!actData;
        const currentUser = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";

        const modal = document.createElement('div');
        modal.className = 'custom-dialog-overlay';
        modal.innerHTML = `
            <div class="custom-dialog" style="max-width:700px;max-height:90vh;overflow-y:auto;">
                <h3 class="dialog-title">${isEdit ? 'Редактирование акта' : 'Создание нового акта'}</h3>
                <form id="actForm" autocomplete="off">
                    <label>
                        Наименование проверки *
                        <input name="inspection_name" required value="${actData?.inspection_name || ''}">
                    </label>
                    
                    <label>
                        Город *
                        <input name="city" required value="${actData?.city || ''}">
                    </label>
                    
                    <label>
                        Дата составления *
                        <input type="date" name="created_date" required 
                               value="${actData?.created_date || ''}">
                    </label>
                    
                    <label>
                        Номер приказа *
                        <input name="order_number" required value="${actData?.order_number || ''}">
                    </label>
                    
                    <label>
                        Дата приказа *
                        <input type="date" name="order_date" required 
                               value="${actData?.order_date || ''}">
                    </label>
                    
                    <label>
                        Срок проверки: начало *
                        <input type="date" name="inspection_start_date" required 
                               value="${actData?.inspection_start_date || ''}">
                    </label>
                    
                    <label>
                        Срок проверки: окончание *
                        <input type="date" name="inspection_end_date" required 
                               value="${actData?.inspection_end_date || ''}">
                    </label>
                    
                    ${!isEdit ? `
                        <label>
                            Номер КМ *
                            <input name="km_number" required>
                        </label>
                    ` : ''}
                    
                    <label style="display:flex;align-items:center;gap:8px;">
                        <input type="checkbox" name="is_process_based" 
                               ${actData?.is_process_based !== false ? 'checked' : ''}>
                        <span>Процессная проверка</span>
                    </label>
                    
                    <fieldset>
                        <legend>Состав аудиторской группы *</legend>
                        <div id="auditTeamContainer"></div>
                        <button type="button" id="addTeamMemberBtn" class="btn btn-secondary" 
                                style="margin-top:8px;">
                            + Добавить члена группы
                        </button>
                    </fieldset>
                    
                    <fieldset>
                        <legend>Действующие поручения</legend>
                        <div id="directivesContainer"></div>
                        <button type="button" id="addDirectiveBtn" class="btn btn-secondary" 
                                style="margin-top:8px;">
                            + Добавить поручение
                        </button>
                    </fieldset>
                    
                    <div style="margin-top:16px;display:flex;gap:8px;">
                        <button type="submit" class="btn btn-primary">
                            ${isEdit ? 'Сохранить изменения' : 'Создать акт'}
                        </button>
                        <button type="button" class="btn btn-secondary dialog-cancel">
                            Отмена
                        </button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        // Функция добавления члена группы
        const addTeamMember = (role = 'Участник', fio = '', pos = '', username = '') => {
            const container = document.getElementById('auditTeamContainer');
            const member = document.createElement('div');
            member.className = "team-member-row";
            member.style.cssText = "display:flex;gap:8px;margin-bottom:8px;";
            member.innerHTML = `
                <select name="role" required style="flex:1;">
                    <option value="Куратор">Куратор</option>
                    <option value="Руководитель">Руководитель</option>
                    <option value="Участник">Участник</option>
                </select>
                <input name="full_name" placeholder="ФИО *" required value="${fio}" style="flex:2;">
                <input name="position" placeholder="Должность *" required value="${pos}" style="flex:2;">
                <input name="username" placeholder="Логин *" required value="${username}" style="flex:1;">
                <button type="button" class="delete-member-btn btn btn-secondary" 
                        title="Удалить" style="padding:4px 12px;">×</button>
            `;
            member.querySelector('.delete-member-btn').onclick = () => member.remove();
            container.appendChild(member);
            member.querySelector('[name="role"]').value = role;
        };

        // Функция добавления поручения
        const addDirective = (point = '', num = '') => {
            const container = document.getElementById('directivesContainer');
            const directive = document.createElement('div');
            directive.className = "directive-row";
            directive.style.cssText = "display:flex;gap:8px;margin-bottom:8px;";
            directive.innerHTML = `
                <input name="point_number" placeholder="№ пункта (5.1.1) *" required 
                       value="${point}" style="flex:1;">
                <input name="directive_number" placeholder="№ поручения *" required 
                       value="${num}" style="flex:2;">
                <button type="button" class="delete-directive-btn btn btn-secondary" 
                        title="Удалить" style="padding:4px 12px;">×</button>
            `;
            directive.querySelector('.delete-directive-btn').onclick = () => directive.remove();
            container.appendChild(directive);
        };

        // Заполняем существующие данные или добавляем текущего пользователя
        if (actData && actData.audit_team) {
            actData.audit_team.forEach(member => {
                addTeamMember(member.role, member.full_name, member.position, member.username);
            });
        } else {
            // Автоматически добавляем текущего пользователя при создании
            addTeamMember('Участник', '', '', currentUser);
        }

        if (actData && actData.directives) {
            actData.directives.forEach(dir => {
                addDirective(dir.point_number, dir.directive_number);
            });
        }

        // Обработчики кнопок
        document.getElementById('addTeamMemberBtn').onclick = () => addTeamMember();
        document.getElementById('addDirectiveBtn').onclick = () => addDirective();
        modal.querySelector('.dialog-cancel').onclick = () => modal.remove();

        // Обработка отправки формы
        modal.querySelector('#actForm').onsubmit = async (e) => {
            e.preventDefault();
            await this._handleFormSubmit(e.target, isEdit, actData?.id, currentUser, modal);
        };
    },

    /**
     * Обрабатывает отправку формы
     * @private
     */
    async _handleFormSubmit(form, isEdit, actId, currentUser, modal) {
        try {
            const fd = new FormData(form);

            // Собираем аудиторскую группу
            const auditTeam = Array.from(
                document.getElementById('auditTeamContainer').children
            ).map(row => ({
                role: row.querySelector('[name="role"]').value,
                full_name: row.querySelector('[name="full_name"]').value,
                position: row.querySelector('[name="position"]').value,
                username: row.querySelector('[name="username"]').value
            }));

            if (auditTeam.length === 0) {
                alert('Добавьте хотя бы одного члена группы');
                return;
            }

            // Собираем поручения
            const directives = Array.from(
                document.getElementById('directivesContainer').children
            ).map(row => ({
                point_number: row.querySelector('[name="point_number"]').value,
                directive_number: row.querySelector('[name="directive_number"]').value
            }));

            const body = {
                inspection_name: fd.get('inspection_name'),
                city: fd.get('city'),
                created_date: fd.get('created_date'),
                order_number: fd.get('order_number'),
                order_date: fd.get('order_date'),
                inspection_start_date: fd.get('inspection_start_date'),
                inspection_end_date: fd.get('inspection_end_date'),
                is_process_based: !!fd.get('is_process_based'),
                audit_team: auditTeam,
                directives: directives
            };

            if (!isEdit) {
                body.km_number = fd.get('km_number');
            }

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
                throw new Error(errData.detail || 'Ошибка сервера');
            }

            const data = await resp.json();
            modal.remove();

            if (typeof Notifications !== 'undefined') {
                Notifications.success(isEdit ? 'Акт обновлен' : 'Акт создан успешно');
            }

            if (isEdit) {
                // При редактировании просто закрываем диалог
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
    }
};

// Глобальный доступ
window.CreateActDialog = CreateActDialog;
