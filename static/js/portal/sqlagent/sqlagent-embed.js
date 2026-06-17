/**
 * Встраивание SQL-агента: портал-страница AuditWorkstation с iframe на
 * отдельный процесс SQLAgent. iframe грузит родной UI SQLAgent как есть.
 * postMessage-handshake передаёт identity/тему встроенному UI. Под JupyterHub
 * хост и iframe — один origin, поэтому проверка event.origin тривиальна;
 * на dev (localhost:порт) — cross-origin.
 */
export const SqlAgentEmbed = {
    init() {
        const frame = document.getElementById('sqlagentFrame');
        if (!frame) return;

        // Приём сообщений от iframe (например, запрос динамической высоты).
        // Origin проверяем всегда — никаких '*'.
        window.addEventListener('message', (event) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data || {};
            if (data.type === 'sqlagent:resize' && typeof data.height === 'number') {
                frame.style.height = `${data.height}px`;
            }
        });

        // Передать identity/тему встроенному UI, когда iframe загрузится.
        frame.addEventListener('load', () => {
            let targetOrigin;
            try {
                targetOrigin = new URL(frame.src, window.location.href).origin;
            } catch (_) {
                return;
            }
            const user = (window.AuthManager && AuthManager.getCurrentUser)
                ? AuthManager.getCurrentUser()
                : null;
            frame.contentWindow.postMessage(
                { type: 'aw:init', user, theme: 'light' },
                targetOrigin,
            );
        });
    },
};

// Дублируем на window для inline-скриптов шаблонов (конвенция portal-зоны).
window.SqlAgentEmbed = SqlAgentEmbed;
