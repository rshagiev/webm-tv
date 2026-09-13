import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const isolatedData = await mkdtemp(join(tmpdir(), "webmtv-smoke-"));
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const url = 'http://localhost:4173';
async function launch() {
  const child = spawn(process.execPath, ['scripts/desktop.mjs'], { env: { ...process.env, WEBMTV_DATA_DIR: isolatedData, WEBMTV_NO_OPEN: '1', HOST: '127.0.0.1' }, stdio: 'inherit' });
  const result = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })); });
  assert.equal(result.code, 0, JSON.stringify(result));
}
let token;
try {
  await launch();
  const first = await (await fetch(url + '/api/system')).json();
  token = first.shutdownToken;
  assert.ok(token);
  await launch();
  const second = await (await fetch(url + '/api/system')).json();
  assert.equal(second.shutdownToken, token, 'second launch must reuse the server');
  const stopped = await fetch(url + '/api/shutdown', { method: 'POST', headers: { 'X-WebMTV-Shutdown': token } });
  assert.equal(stopped.status, 200);
  const deadline = Date.now() + 10000;
  let closed = false;
  while (Date.now() < deadline) {
    try { await fetch(url + '/api/health', { signal: AbortSignal.timeout(1000) }); }
    catch { closed = true; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(closed, 'background server must stop');
  token = undefined;
  console.log('PASS: background launch, duplicate reuse, shutdown');
} finally {
  if (token) await fetch(url + '/api/shutdown', { method: 'POST', headers: { 'X-WebMTV-Shutdown': token } }).catch(() => {});
}
