import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createPipeServer } from 'node:net';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, statSync, renameSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { verifyOutlineAssetContract } from './outline-contract.mjs';
import { getLifecyclePreferences, getLifecycleSession, markManualStart, markManualStop } from '../src/lifecycle/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const dataDir = process.env.SHUANGLING_DATA_DIR ? resolve(process.env.SHUANGLING_DATA_DIR) : join(here, 'data');
const dshHome = join(dataDir, 'dsh-home');
const lockFile = join(dataDir, 'desktop-runtime.json');
const runtimeFile = join(dshHome, 'dsh-pet', 'standalone-runtime.json');
const config = JSON.parse(readFileSync(join(here, 'runtime-config.json'), 'utf8'));
const mode = process.argv[2] || 'start';
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
let child, bridge, manager, singletonGuard, identity, closing = false, released = false;
mkdirSync(dataDir, { recursive: true });

function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
function alive(pid) { try { if (!Number.isSafeInteger(pid) || pid <= 0) return false; process.kill(pid, 0); return true; } catch { return false; } }
function sameToken(actual, expected) {
  const a = Buffer.from(typeof actual === 'string' ? actual : '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function log(message) {
  const file = join(dataDir, 'desktop.log');
  try {
    if (existsSync(file) && statSync(file).size > 2_000_000) {
      try { unlinkSync(`${file}.1`); } catch {}
      renameSync(file, `${file}.1`);
    }
    const safe = String(message).replace(/(#token=|"token"\s*:\s*"|x-dsh-pet-token[=: ]+)[^\s"&]+/gi, '$1[redacted]');
    appendFileSync(file, `${new Date().toISOString()} ${safe.trimEnd()}\n`);
  } catch {}
}
function openSettings(url) {
  if (process.env.SHUANGLING_NO_OPEN === '1') return;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('Invalid local settings URL');
  const opener = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', parsed.href], { detached: true, stdio: 'ignore', windowsHide: true });
  opener.on('error', error => log(`设置页打开失败：${error.message}`));
  opener.unref();
}
async function contact(existing, action = 'health') {
  if (!existing?.managerPort || !existing?.token) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${existing.managerPort}/${action}`, {
      method: action === 'health' ? 'GET' : 'POST', headers: {
        'x-shuangling-token': existing.token,
        ...(action === 'stop' && ['auto-close', 'restart'].includes(process.env.SHUANGLING_LIFECYCLE_INTENT)
          ? { 'x-shuangling-intent': process.env.SHUANGLING_LIFECYCLE_INTENT } : {}),
      }, signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result.instanceId === existing.instanceId ? result : null;
  } catch { return null; }
}
async function currentInstance() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const current = readJson(lockFile);
    if (!current || !alive(current.pid)) return null;
    const status = await contact(current);
    if (status) return { ...current, ...status };
    await delay(200);
  }
  // A stale PID can belong to an unrelated process after PID reuse. Only the
  // OS-owned pipe decides ownership; never let this discovery file block it.
  return null;
}
function writeIdentity(extra = {}) {
  Object.assign(identity, extra);
  writeFileSync(lockFile, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  restrictPrivateFile(lockFile);
}
function restrictPrivateFile(file) {
  if (process.platform !== 'win32') return;
  const system32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const result = execFileSync(join(system32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = result.match(/\bS-1-\d+(?:-\d+)+\b/)?.[0];
  if (!sid) throw new Error('无法确认本地数据所有者。');
  execFileSync(join(system32, 'icacls.exe'), [file, '/inheritance:r', '/grant:r', `*${sid}:F`], { stdio: 'pipe', windowsHide: true });
}
function prepare() {
  const defaultConfig = join(here, 'default-config.json');
  const petHome = join(dshHome, 'dsh-pet');
  mkdirSync(join(petHome, 'main-animation', 'webm'), { recursive: true });
  if (!existsSync(join(petHome, 'main-config.jsonc'))) copyFileSync(defaultConfig, join(petHome, 'main-config.jsonc'));
  const names = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'];
  const provenanceRoot = existsSync(join(projectRoot, 'reports', 'windows-assets.json')) ? 'reports' : 'provenance';
  const assets = readJson(join(projectRoot, provenanceRoot, 'windows-assets.json'));
  const motionName = basename(assets?.motionManifest ?? '');
  if (!/^windows-action-frames(?:-v\d{3,6})?\.json$/.test(motionName)) throw Error('Invalid animation manifest');
  const outlineContract = {
    profile: createRequire(import.meta.url)(join(projectRoot, 'vendor/dsh-pet/runtime/electron-helper/shuangling-motion.js')),
    manifestPath: join(projectRoot, provenanceRoot, motionName),
    animations: assets?.animations,
  };
  verifyOutlineAssetContract({
    ...outlineContract, assetDirectory: join(here, 'assets', 'shuangling'),
  });
  for (const name of names) {
    const source = join(here, 'assets', 'shuangling', `${name}.webm`);
    if (!existsSync(source)) throw new Error(`缺少霜铃动画 ${name}.webm；请先运行素材构建。`);
    const target = join(petHome, 'main-animation', 'webm', `${name}.webm`);
    const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
    if (!existsSync(target) || sha(target) !== sha(source)) copyFileSync(source, target);
  }
  verifyOutlineAssetContract({
    ...outlineContract, assetDirectory: join(petHome, 'main-animation', 'webm'),
  });
  // Electron must use the portable data directory too, never the user's general app data.
  mkdirSync(join(dataDir, 'electron'), { recursive: true });
}
async function shutdown(reason = '用户关闭', exitCode = 0) {
  if (closing) return;
  closing = true;
  log(`正在退出：${reason}`);
  try { await bridge?.close(); } catch (error) { log(error.message); }
  const upstream = readJson(runtimeFile);
  if (upstream?.pid === child?.pid && upstream?.token) {
    try { await fetch(`http://127.0.0.1:${upstream.port}/shutdown`, { method: 'POST', headers: { 'x-dsh-pet-token': upstream.token }, signal: AbortSignal.timeout(4000) }); } catch {}
  }
  if (child && child.exitCode === null) {
    for (let count = 0; count < 30 && child.exitCode === null; count++) await delay(100);
    if (child.exitCode === null) child.kill();
  }
  await new Promise(resolveClose => manager ? manager.close(resolveClose) : resolveClose());
  await new Promise(resolveClose => singletonGuard ? singletonGuard.close(resolveClose) : resolveClose());
  release();
  process.exit(exitCode);
}
function release() {
  if (released) return;
  released = true;
  if (readJson(lockFile)?.instanceId === identity?.instanceId) { try { unlinkSync(lockFile); } catch {} }
}
async function main() {
  const existing = await currentInstance();
  const automaticIntent = ['auto', 'restart', 'auto-close'].includes(process.env.SHUANGLING_LIFECYCLE_INTENT);
  if (process.env.SHUANGLING_LIFECYCLE_INTENT === 'auto') {
    const preferences = await getLifecyclePreferences({ projectRoot, dataDir });
    const session = await getLifecycleSession({ projectRoot, dataDir });
    if (!preferences.autoLaunch || !preferences.lifecycle.pluginEnabled || session.manualSuppressed || !session.active) return;
  }
  if (mode === 'stop') {
    if (!automaticIntent) await markManualStop({ projectRoot, dataDir });
    if (existing) await contact(existing, 'stop');
    return;
  }
  if (['start', 'settings'].includes(mode) && !automaticIntent) await markManualStart({ projectRoot, dataDir });
  if (existing) {
    // Repeated launch never unhides a pet the user has hidden or closed.
    if (existing.settingsUrl) openSettings(existing.settingsUrl);
    return;
  }
  if (!['start', 'settings'].includes(mode)) throw new Error('Supported commands: start, settings, stop');
  // A named pipe is an OS-owned singleton lease and disappears after a crash.
  // The JSON file is discovery only; an incomplete or stale file cannot spawn
  // a second pet or permanently prevent recovery.
  const pipeName = `\\\\.\\pipe\\ShuanglingGPT-${createHash('sha256').update(`${projectRoot}|${dataDir}`.toLowerCase()).digest('hex').slice(0, 20)}`;
  singletonGuard = createPipeServer(socket => socket.destroy());
  const acquired = await new Promise((resolveGuard, rejectGuard) => {
    singletonGuard.once('error', error => error.code === 'EADDRINUSE' ? resolveGuard(false) : rejectGuard(error));
    singletonGuard.listen(pipeName, () => resolveGuard(true));
  });
  if (!acquired) {
    singletonGuard = null;
    const winner = await currentInstance();
    if (winner?.settingsUrl) openSettings(winner.settingsUrl);
    return;
  }
  identity = { pid: process.pid, instanceId: randomUUID(), token: randomUUID(), startedAt: new Date().toISOString() };
  writeIdentity();
  process.on('exit', release);
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  manager = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.host !== `127.0.0.1:${identity.managerPort}` || request.headers.origin && request.headers.origin !== `http://127.0.0.1:${identity.managerPort}` || request.headers['sec-fetch-site'] === 'cross-site') { response.writeHead(403).end('{}'); return; }
    if (!sameToken(request.headers['x-shuangling-token'], identity.token)) { response.writeHead(401).end('{}'); return; }
    if (request.url === '/health' && request.method === 'GET') { response.end(JSON.stringify({ instanceId: identity.instanceId, settingsUrl: identity.settingsUrl || null, ready: !!identity.settingsUrl })); return; }
    if (request.url === '/stop' && request.method === 'POST') {
      const intent = request.headers['x-shuangling-intent'];
      response.end(JSON.stringify({ instanceId: identity.instanceId, stopping: true }));
      setImmediate(async () => {
        try { if (!['auto-close', 'restart'].includes(intent)) await markManualStop({ projectRoot, dataDir }); }
        catch (error) { log(`退出偏好保存失败：${error.message}`); }
        await shutdown(intent === 'auto-close' ? 'Codex 已关闭' : intent === 'restart' ? '版本更新' : '用户关闭');
      });
      return;
    }
    response.writeHead(404).end('{}');
  });
  await new Promise((resolveListen, rejectListen) => { manager.once('error', rejectListen); manager.listen(0, '127.0.0.1', resolveListen); });
  writeIdentity({ managerPort: manager.address().port });
  prepare();
  const node = join(here, 'runtime', 'node', 'node.exe');
  const electron = join(here, 'runtime', 'electron', 'electron.exe');
  const entry = join(projectRoot, 'vendor', 'dsh-pet', 'lib', 'standalone.js');
  for (const file of [node, electron, entry]) if (!existsSync(file)) throw new Error(`运行组件缺失：${file}`);
  child = spawn(node, [entry, '--port', '3080'], {
    cwd: dirname(entry), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    // Production launches never inherit the helper's synthetic input/screenshot
    // selftest mode from a shell used for asset verification.
    env: { ...process.env, DSH_PET_SMOKE: '0', DSH_PET_CADENCE_TEST: '0', DSH_PET_INTERACTION_TEST: '0', DSH_HOME: dshHome, DSH_PET_ELECTRON_PATH: electron, SHUANGLING_ELECTRON_DATA: join(dataDir, 'electron'), SHUANGLING_PROFILE: '1', SHUANGLING_MANAGER_STATE: lockFile }
  });
  child.stdout.on('data', data => log(data.toString('utf8')));
  child.stderr.on('data', data => log(data.toString('utf8')));
  child.once('error', error => { log(error.message); void shutdown('桌宠宿主启动失败'); });
  child.once('exit', code => { if (!closing) {
    log(`桌宠宿主已退出 (${code})`);
    void (async () => { if (code === 0) await markManualStop({ projectRoot, dataDir }); await shutdown('桌宠宿主退出'); })()
      .catch(() => void shutdown('桌宠宿主退出'));
  } });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (closing) return;
    const runtime = readJson(runtimeFile);
    if (runtime?.pid === child.pid && Number.isInteger(runtime.port) && runtime.token) break;
    if (attempt === 149) throw new Error('桌宠宿主启动超时；请查看 windows/data/desktop.log。');
    await delay(100);
  }
  const { startBridge } = await import('../src/bridge/index.mjs');
  bridge = await startBridge({ projectRoot, dataDir, dshHome, threadId: config.defaultThreadId, petId: config.petId, animationMap: config.animationMap, onShutdown: () => void shutdown() });
  writeIdentity({ settingsUrl: bridge.settingsUrl });
  log('霜铃 GPT 已启动；聊天联动与设置页就绪。');
  if (mode === 'settings') openSettings(bridge.settingsUrl);
}
main().catch(async error => {
  log(`启动失败：${error.message}`);
  console.error(error.message);
  // The launcher shows this local error file if startup fails.
  writeFileSync(join(dataDir, 'last-error.txt'), `霜铃 GPT 启动失败\r\n${error.message}\r\n\r\n详情：${join(dataDir, 'desktop.log')}\r\n`, 'utf8');
  if (process.platform === 'win32' && process.env.SHUANGLING_SILENT_ERRORS !== '1') {
    const viewer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe'), [join(dataDir, 'last-error.txt')], { detached: true, stdio: 'ignore', windowsHide: true });
    viewer.on('error', () => {}); viewer.unref();
  }
  if (identity) await shutdown('启动失败', 1);
  process.exitCode = 1;
});
