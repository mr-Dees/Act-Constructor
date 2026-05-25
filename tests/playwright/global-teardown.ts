import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const PID_FILE = path.join(__dirname, '.uvicorn.pid');

/**
 * Останавливает uvicorn, поднятый в global-setup.
 *
 * Windows: `taskkill /F /T /PID <pid>` (нативный SIGTERM на Windows не
 * убивает дочерние procs uvicorn-а; /T = с деревом).
 * Linux/macOS: process.kill SIGTERM → SIGKILL fallback.
 */
export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(PID_FILE)) {
    // eslint-disable-next-line no-console
    console.log('[playwright global-teardown] PID-файл не найден, пропуск');
    return;
  }
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  if (!Number.isFinite(pid)) {
    // eslint-disable-next-line no-console
    console.warn('[playwright global-teardown] PID не читается, пропуск');
    return;
  }

  if (process.platform === 'win32') {
    const res = spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      encoding: 'utf-8',
    });
    // eslint-disable-next-line no-console
    console.log(`[playwright global-teardown] taskkill PID=${pid} → exit=${res.status}`);
  } else {
    try {
      process.kill(pid, 'SIGTERM');
      await new Promise((r) => setTimeout(r, 2000));
      try {
        process.kill(pid, 0); // ещё жив?
        process.kill(pid, 'SIGKILL');
      } catch { /* уже мёртв */ }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[playwright global-teardown] kill PID=${pid} провалился: ${(e as Error).message}`);
    }
  }

  try { fs.unlinkSync(PID_FILE); } catch {}
}
