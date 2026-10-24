// A short-lived native Codex account reader. It cannot create chats, execute
// turns, modify login/configuration, or invoke a model. Credentials stay in
// Codex's own authentication implementation.
import { spawn } from 'node:child_process';
import { readdir, stat, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

export async function findAccountCli({ env = process.env, fs = { readdir, stat, access } } = {}) {
  if (env.SHUANGLING_CODEX_EXE) {
    const path = resolve(env.SHUANGLING_CODEX_EXE); await fs.access(path); return path;
  }
  if (!env.LOCALAPPDATA) throw Error('account-cli-unavailable');
  const directory = join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  const candidates = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name, 'codex.exe');
    try { const info = await fs.stat(path); if (info.isFile()) candidates.push({ path, at: info.mtimeMs }); } catch { /* incomplete update */ }
  }
  if (!candidates.length) throw Error('account-cli-unavailable');
  return candidates.sort((a, b) => b.at - a.at)[0].path;
}

export async function openNativeAccountClient({ signal, codexHome, findCli = findAccountCli, spawnFn = spawn, timeoutMs = 8000 } = {}) {
  if (signal?.aborted) throw Error('account-query-cancelled');
  const executable = await findCli();
  if (signal?.aborted) throw Error('account-query-cancelled');
  const child = spawnFn(executable, ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    ...(codexHome ? { env: { ...process.env, CODEX_HOME: codexHome } } : {}) });
  const pending = new Map();
  let sequence = 0, closed = false, closeReason = 'account-transport-closed';
  const input = createInterface({ input: child.stdout });
  function close(reason = 'account-transport-closed') {
    if (closed) return;
    closed = true; closeReason = reason;
    signal?.removeEventListener('abort', aborted);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error(reason)); }
    pending.clear(); input.close();
    child.stdin.end(); child.kill();
  }
  function aborted() { close('account-query-cancelled'); }
  signal?.addEventListener('abort', aborted, { once: true });
  child.stderr.on('data', () => {}); // Native diagnostics can contain private data.
  child.on('error', () => close('account-cli-unavailable'));
  child.on('exit', () => close());
  child.stdin.on('error', () => close());
  input.on('line', line => {
    // Unrelated notifications are ignored before parsing their parameters.
    if (!/^\s*\{\s*"id"\s*:/.test(line)) return;
    if (line.length > 128 * 1024) { close('account-response-invalid'); return; }
    let message; try { message = JSON.parse(line); } catch { close('account-response-invalid'); return; }
    const entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    message.error ? entry.reject(Error('account-rpc-rejected')) : entry.resolve(message.result);
  });
  function request(method, params) {
    if (closed || signal?.aborted) return Promise.reject(Error('account-query-cancelled'));
    const id = ++sequence;
    return new Promise((resolveCall, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('account-query-timeout')); close(); }, timeoutMs);
      pending.set(id, { resolve: resolveCall, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  try {
    await request('initialize', { clientInfo: { name: 'shuangling_account_usage', version: '1.8.1' }, capabilities: { experimentalApi: true } });
    if (closed) throw Error(closeReason);
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  } catch (error) { close(); throw error; }
  return {
    call(method, params) {
      const keys = params && typeof params === 'object' && !Array.isArray(params) ? Object.keys(params) : null;
      if (method === 'account/read' && keys?.length === 1 && keys[0] === 'refreshToken' && params.refreshToken === false) return request(method, { refreshToken: false });
      if (method === 'account/rateLimits/read' && keys?.length === 0) return request(method, {});
      return Promise.reject(Error('account-method-not-allowed'));
    },
    close,
  };
}
