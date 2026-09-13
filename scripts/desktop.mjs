import { spawn, execFile } from 'node:child_process';
import { mkdir, open, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = 'http://localhost:4173';
const lock = resolve(root, 'data/desktop-start.lock');
const log = resolve(root, 'data/desktop.log');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function running() {
  try { const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1000) }); const d = await r.json(); return d.ok && d.app === 'webm-tv'; } catch { return false; }
}
function openBrowser() {
  if (process.env.WEBMTV_NO_OPEN === '1') return;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }); c.on('error', () => {}); c.unref();
}
let ownsLock = false;
try {
  if (await running()) { openBrowser(); process.exit(0); }
  await mkdir(resolve(root, 'data'), { recursive: true });
  try { await mkdir(lock); ownsLock = true; } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let pid; try { pid = Number(await readFile(resolve(lock, 'pid'), 'utf8')); } catch {}
    if (!pid && Date.now() - (await stat(lock)).mtimeMs > 10000) { await rm(lock, { recursive: true, force: true }); await mkdir(lock); ownsLock = true; }
    if (pid) {
      let alive = true; try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
      if (!alive) { await rm(lock, { recursive: true, force: true }); await mkdir(lock); ownsLock = true; }
    }
  }
  let child;
  let spawnError;
  if (ownsLock) {
    await writeFile(resolve(lock, 'pid'), String(process.pid));
    const output = await open(log, 'w');
    child = spawn(process.execPath, ['scripts/start.mjs'], { cwd: root, detached: true, stdio: ['ignore', output.fd, output.fd], windowsHide: true, env: { ...process.env, PATH: dirname(process.execPath) + (process.platform === 'win32' ? ';' : ':') + process.env.PATH } });
    child.on('error', e => { spawnError = e; }); child.unref(); await output.close();
  }
  const deadline = Date.now() + 180000;
  while (!await running()) {
    if (spawnError) throw spawnError;
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error('WebM TV не запустился. Подробности: ' + log);
    if (Date.now() > deadline) throw new Error('Запуск ещё не завершён. Откройте файл запуска повторно через минуту. Журнал: ' + log);
    await delay(500);
  }
  openBrowser();
} catch (e) {
  console.error(e.message);
  if (process.platform === 'darwin') execFile('osascript', ['-e', 'on run argv\ndisplay alert "WebM TV" message (item 1 of argv)\nend run', e.message]);
  process.exitCode = 1;
} finally { if (ownsLock) await rm(lock, { recursive: true, force: true }); }
