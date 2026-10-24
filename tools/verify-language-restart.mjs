import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, link, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Full-process language persistence check. Uses a private data directory and
// fake Codex home, never installs a task/plugin, and never cleans user files.
if (process.platform !== 'win32' || !process.argv[2]) throw Error('Usage: node tools/verify-language-restart.mjs <staged-package>');
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = await realpath(resolve(process.argv[2]));
const version = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version;
const reportRoot = join(sourceRoot, 'reports', 'i18n-audit', 'restart-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 6));
const dataDir = join(reportRoot, 'isolated-data'), codexHome = join(reportRoot, 'fake-codex-home');
await mkdir(dataDir, { recursive: true }); await mkdir(join(codexHome, 'sessions'), { recursive: true });
await writeFile(join(codexHome, 'config.toml'), '# Synthetic language restart audit. No credentials or enabled plugins.\n');
const savedThread = 'fixture-saved-chat', selectedThread = 'fixture-selected-chat';
const at = new Date().toISOString();
for (const id of [savedThread, selectedThread]) {
  await writeFile(join(codexHome, 'sessions', 'rollout-' + id + '.jsonl'), JSON.stringify({ type: 'session_meta', timestamp: at, payload: { id, thread_source: 'user', timestamp: at, cwd: reportRoot } }) + '\n');
}
await writeFile(join(codexHome, 'session_index.jsonl'), [savedThread, selectedThread].map(id => JSON.stringify({ id, thread_name: id, updated_at: at })).join('\n') + '\n');
const preferencesFile = join(dataDir, 'plugin-config.json');
await writeFile(preferencesFile, JSON.stringify({ autoLaunch: false, language: 'zh-CN', auditRetained: 'unchanged' }));
await writeFile(join(dataDir, 'bridge-config.json'), JSON.stringify({ threadId: savedThread, paused: true }));
await writeFile(join(dataDir, 'lifecycle-session.json'), JSON.stringify({ active: false, manualSuppressed: true, auditRetained: 'unchanged' }));
const petHome = join(dataDir, 'dsh-home', 'dsh-pet');
const config = JSON.parse(await readFile(join(packageRoot, 'windows/default-config.json'), 'utf8'));
config.pets[0].size = 600; config.pets[0].position = { corner: 'top-left', marginX: 55, marginY: 30 };
await mkdir(join(petHome, 'main-animation', 'webm'), { recursive: true });
await writeFile(join(petHome, 'main-config.jsonc'), JSON.stringify(config, null, 2));
const media = JSON.parse(await readFile(join(packageRoot, 'reports/windows-assets.json'), 'utf8')).animations;
for (const row of media) await link(join(packageRoot, 'windows/assets/shuangling', row.name + '.webm'), join(petHome, 'main-animation/webm', row.name + '.webm'));
const env = { ...process.env, CODEX_HOME: codexHome, SHUANGLING_DATA_DIR: dataDir,
  SHUANGLING_NO_OPEN: '1', SHUANGLING_SILENT_ERRORS: '1', SHUANGLING_LIFECYCLE_INTENT: 'restart',
  SHUANGLING_CODEX_EXE: join(codexHome, 'no-account-reader.exe') };
for (const key of ['CODEX_THREAD_ID', 'ELECTRON_RUN_AS_NODE']) delete env[key];
const node = join(packageRoot, 'windows/runtime/node/node.exe'), launcher = join(packageRoot, 'windows/start.mjs');
const lockFile = join(dataDir, 'desktop-runtime.json'), nativeFile = join(petHome, 'standalone-runtime.json');
const execFileAsync = promisify(execFile), delay = ms => new Promise(done => setTimeout(done, ms));
const json = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(operation, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await operation(); if (result) return result; await delay(80); }
  throw Error('isolated-restart-timeout');
}
let managed, identity, host;
function base(port) { assert.ok(Number.isSafeInteger(port) && port > 0 && port < 65536); return 'http://127.0.0.1:' + port; }
async function fetchJson(url, token, body, moreHeaders = {}) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-shuangling-token': token, ...moreHeaders, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  assert.ok(response.ok, 'isolated capability request succeeds'); return response.json();
}
async function settings(route, body) {
  assert.equal(identity.pid, managed.pid, 'only the manager started by this audit is addressed');
  const url = new URL(identity.settingsUrl); assert.equal(url.hostname, '127.0.0.1');
  return fetchJson(url.origin + '/api/' + route, url.hash.slice(1), body);
}
async function start() {
  managed = spawn(node, [launcher, 'start'], { cwd: packageRoot, env, windowsHide: true, stdio: 'ignore' });
  managed.once('error', () => {});
  identity = await until(async () => {
    const candidate = await json(lockFile);
    if (candidate?.pid !== managed.pid || !candidate.settingsUrl) return null;
    const health = await fetchJson(base(candidate.managerPort) + '/health', candidate.token).catch(() => null);
    return health?.ready && health.instanceId === candidate.instanceId ? candidate : null;
  });
  host = await json(nativeFile); assert.ok(Number.isSafeInteger(host?.pid));
}
async function stop() {
  if (!managed || !identity || !alive(managed.pid)) return;
  assert.equal(identity.pid, managed.pid, 'only the audit manager can be stopped');
  await fetchJson(base(identity.managerPort) + '/stop', identity.token, {}, { 'x-shuangling-intent': 'restart' });
  await until(() => !alive(managed.pid) && !alive(host.pid));
  const exe = join(packageRoot, 'windows/runtime/electron/electron.exe').replaceAll("'", "''");
  await until(async () => {
    const command = "@(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.ExecutablePath -eq '" + exe + "' }).Count";
    const result = await execFileAsync(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000 });
    return Number(result.stdout.trim()) === 0;
  });
}
const report = { version, startedAt: new Date().toISOString(), isolated: true, realCodexHomeUsed: false,
  currentPetTouched: false, animationCopies: 0, languageRestarts: [], checks: {} };
try {
  // Injected task/observer controllers exercise the exact production preference
  // function while making native registration impossible in this separate check.
  const spyData = join(reportRoot, 'task-spy'); await mkdir(spyData);
  const { setLifecyclePreferences } = await import(pathToFileURL(join(packageRoot, 'src/lifecycle/index.mjs')));
  await writeFile(join(spyData, 'plugin-config.json'), JSON.stringify({ autoLaunch: false, retained: 'yes' }));
  await writeFile(join(spyData, 'lifecycle-session.json'), JSON.stringify({ manualSuppressed: true, active: false }));
  const spySession = await readFile(join(spyData, 'lifecycle-session.json'));
  let taskCalls = 0, observerCalls = 0;
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    const value = await setLifecyclePreferences({ projectRoot: packageRoot, dataDir: spyData, codexHome,
      taskController: () => { taskCalls++; throw Error('native-task-forbidden'); },
      ensureObserverImpl: () => { observerCalls++; throw Error('observer-forbidden'); } }, { language });
    assert.equal(value.language, language); assert.equal(value.autoLaunch, false);
    assert.deepEqual(await readFile(join(spyData, 'lifecycle-session.json')), spySession);
  }
  assert.equal(taskCalls, 0); assert.equal(observerCalls, 0);
  report.checks.languageOnlyLifecycleEffects = { taskCalls, observerCalls, manualSuppressionPreserved: true };
  await start();
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    const previousIdentity = identity.instanceId;
    const baselineAppearance = await settings('appearance');
    const sessionBytes = await readFile(join(dataDir, 'lifecycle-session.json'));
    await settings('usage-target', { threadId: selectedThread });
    const selectedState = await settings('state'); assert.equal(selectedState.usageThreadId, selectedThread);
    const bridgeBytes = await readFile(join(dataDir, 'bridge-config.json'));
    const saved = await settings('preferences', { language });
    assert.equal(saved.language, language); assert.equal(saved.autoLaunch, false);
    const during = await settings('state');
    assert.equal(during.usageThreadId, selectedThread); assert.equal(during.control.paused, true);
    assert.deepEqual(await settings('appearance'), baselineAppearance);
    assert.deepEqual(await readFile(join(dataDir, 'bridge-config.json')), bridgeBytes);
    assert.deepEqual(await readFile(join(dataDir, 'lifecycle-session.json')), sessionBytes);
    assert.equal((await json(preferencesFile)).auditRetained, 'unchanged');
    assert.equal(await json(join(dataDir, 'lifecycle-task.json')), null);
    await stop(); await start();
    assert.notEqual(identity.instanceId, previousIdentity, 'a new complete manager process was started');
    const restartedPreferences = await settings('preferences'), restartedState = await settings('state');
    assert.equal(restartedPreferences.language, language); assert.equal(restartedPreferences.autoLaunch, false);
    assert.equal(restartedState.control.paused, true); assert.equal(restartedState.defaultUsageThreadId, savedThread);
    assert.ok([savedThread, selectedThread].includes(restartedState.usageThreadId), 'restart retains the selected or saved default fixture chat');
    assert.deepEqual(await settings('appearance'), baselineAppearance);
    assert.deepEqual(await readFile(join(dataDir, 'bridge-config.json')), bridgeBytes);
    assert.deepEqual(await readFile(join(dataDir, 'lifecycle-session.json')), sessionBytes);
    assert.equal(await json(join(dataDir, 'lifecycle-task.json')), null);
    report.languageRestarts.push({ language, persistedAfterFullRestart: true, oldManagerHostAndElectronExited: true,
      otherPersistentSettingsPreserved: true, explicitSelectionPreservedDuringLanguageSave: true,
      explicitUsageSelectionPersistedAfterRestart: restartedState.usageThreadId === selectedThread,
      existingTransientUsageSelectionReturnsToSavedDefaultAfterRestart: restartedState.usageThreadId === savedThread });
  }
  await stop();
  report.checks.completeShutdown = true;
  report.checks.settingsPreserved = ['autoLaunch', 'paused', 'savedDefaultUsageThread', 'size', 'dockPosition', 'margins', 'manualSuppression', 'unrelatedPreferenceFields'];
  report.checks.languageSwitchDidNotCreateLoginTaskFile = true;
  if (report.languageRestarts.some(row => row.existingTransientUsageSelectionReturnsToSavedDefaultAfterRestart)) report.existingBehavior = 'The explicit usage chat picker is currently in-memory. It stays unchanged during language switching, but a full application restart returns it to the saved default chat. This is independent of language persistence.';
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = String(error.message).split('\n')[0].slice(0, 220);
} finally {
  try { await stop(); } catch { report.cleanupExited = false; if (managed && identity?.pid === managed.pid && alive(managed.pid)) managed.kill(); }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(reportRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ...report, reportDirectory: reportRoot }, null, 2));
process.exitCode = report.ok ? 0 : 1;
