// static/js/acts-manager-page.js

async function loadActsList() {
    const container = document.getElementById('actsListContainer');

    try {
        const response = await fetch('/api/v1/acts/list', {
            headers: {'X-JupyterHub-User': window.env?.JUPYTERHUB_USER || ""}
        });

        if (!response.ok) throw new Error('Ошибка загрузки актов');

        const acts = await response.json();

        if (acts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <h3>У вас пока нет актов</h3>
                    <p>Создайте первый акт, чтобы начать работу</p>
                </div>
            `;
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'acts-grid';

        acts.forEach(act => {
            const card = document.createElement('div');
            card.className = 'act-card';
            card.innerHTML = `
                <div class="act-card-header">
                    <h3 class="act-card-title">${escapeHtml(act.inspection_name)}</h3>
                    <span class="act-card-role">${act.user_role}</span>
                </div>
                <div class="act-card-meta"><strong>КМ:</strong> ${act.km_number}</div>
                <div class="act-card-meta"><strong>Город:</strong> ${act.city}</div>
                <div class="act-card-meta"><strong>Изменено:</strong> ${new Date(act.updated_at).toLocaleString('ru-RU')}</div>
                <div class="act-card-actions">
                    <button class="btn btn-primary">Открыть</button>
                    <button class="btn btn-secondary">Дубликат</button>
                </div>
            `;

            card.querySelector('.btn-primary').onclick = () => window.location.href = `/constructor?act_id=${act.id}`;
            card.querySelector('.btn-secondary').onclick = () => duplicateAct(act.id);

            grid.appendChild(card);
        });

        container.innerHTML = '';
        container.appendChild(grid);

    } catch (err) {
        container.innerHTML = `<div class="empty-state"><p style="color:red;">Ошибка: ${err.message}</p></div>`;
    }
}

async function duplicateAct(actId) {
    const newKm = prompt('Введите новый номер КМ:');
    if (!newKm) return;

    try {
        const resp = await fetch(`/api/v1/acts/${actId}/duplicate?new_km_number=${encodeURIComponent(newKm)}`, {
            method: 'POST',
            headers: {'X-JupyterHub-User': window.env?.JUPYTERHUB_USER || ""}
        });
        if (!resp.ok) throw new Error('Ошибка');
        alert('Дубликат создан');
        loadActsList();
    } catch (err) {
        alert('Ошибка: ' + err.message);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    loadActsList();
    document.getElementById('createNewActBtn').onclick = () => CreateActDialog.show();
});
