import { readFile, writeFile, mkdir, rename, unlink, rmdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { emptyLifecycleState, OBSERVER_FRESH_MS } from './state.mjs';
import { normalizeLanguage, normalizeAmbientFrequency, validPreferences } from './preferences.mjs';

export { reconcileLifecycleTick, emptyLifecycleState, markStartFailure } from './state.mjs';
export const readJson = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
export function lifecyclePaths({ projectRoot, dataDir = join(projectRoot, 'windows', 'data') }) {
  return { root: resolve(projectRoot), data: resolve(dataDir), session: join(dataDir, 'lifecycle-session.json'),
    preferences: join(dataDir, 'plugin-config.json'), heartbeat: join(dataDir, 'lifecycle-observer.json'),
    task: join(dataDir, 'lifecycle-task.json'), lock: join(dataDir, '.lifecycle-lock') };
}
export async function atomicJson(file, value) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2)+'\n', { mode: 0o600 });
  await rename(temp, file);
}
export async function withLifecycleLock(options, operation) {
  const p = lifecyclePaths(options);
  await mkdir(p.data, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await mkdir(p.lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - (await stat(p.lock)).mtimeMs > 15000) {
          const owner = await readJson(join(p.lock, 'owner.json'));
          let alive = false;
          if (Number.isSafeInteger(owner?.pid)) { try { process.kill(owner.pid, 0); alive = true; } catch {} }
          if (!alive) { await unlink(join(p.lock, 'owner.json')).catch(() => {}); await rmdir(p.lock).catch(() => {}); }
        }
      } catch {}
      if (attempt === 99) throw new Error('lifecycle-state-busy');
      await sleep(30);
    }
  }
  try { await atomicJson(join(p.lock, 'owner.json'), { pid: process.pid }); return await operation(p); }
  finally { await unlink(join(p.lock, 'owner.json')).catch(() => {}); await rmdir(p.lock).catch(() => {}); }
}

export function parsePluginEnabled(text) {
  let selected = false, enabled = null;
  for (const original of String(text).split(/\r?\n/)) {
    const line = original.trim();
    if (/^\[/.test(line)) {
      selected = /^\[plugins\.(?:"shuangling-gpt@shuangling-local"|'shuangling-gpt@shuangling-local')\]\s*(?:#.*)?$/.test(line);
      continue;
    }
    if (selected && /^enabled\s*=/.test(line)) {
      const match = /^enabled\s*=\s*(true|false)\s*(?:#.*)?$/.exec(line);
      if (!match || enabled !== null) return false;
      enabled = match[1] === 'true';
    }
  }
  return enabled === true;
}
export async function pluginEnabled({ projectRoot, codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), pluginEnabledImpl } = {}) {
  if (pluginEnabledImpl) return !!await pluginEnabledImpl();
  const manifest = join(projectRoot, 'plugin-marketplace', 'plugins', 'shuangling-gpt', '.codex-plugin', 'plugin.json');
  if (!existsSync(manifest)) return false;
  try { return parsePluginEnabled(await readFile(join(codexHome, 'config.toml'), 'utf8')); } catch { return false; }
}
export async function getLifecycleSession(options) { return { ...emptyLifecycleState(), ...await readJson(lifecyclePaths(options).session) }; }
export async function markManualStop(options) {
  return withLifecycleLock(options, async p => {
    const state = { ...emptyLifecycleState(), ...await readJson(p.session), manualSuppressed: true, pendingStartAt: null, nextAttemptAt: null };
    await atomicJson(p.session, state); return { suppressed: true, epoch: state.epoch };
  });
}
export async function markManualStart(options) {
  return withLifecycleLock(options, async p => {
    const state = { ...emptyLifecycleState(), ...await readJson(p.session), manualSuppressed: false, attempts: 0, nextAttemptAt: Date.now(), pendingStartAt: null };
    await atomicJson(p.session, state); return { suppressed: false, epoch: state.epoch };
  });
}
export async function getLifecyclePreferences(options) {
  const p = lifecyclePaths(options);
  const [preference, heartbeat, task, state, enabled] = await Promise.all([readJson(p.preferences), readJson(p.heartbeat), readJson(p.task), getLifecycleSession(options), pluginEnabled(options)]);
  const observerRunning = Number.isFinite(heartbeat?.observedAt) && Date.now() - heartbeat.observedAt < OBSERVER_FRESH_MS && heartbeat.detectorAvailable === true;
  const autoLaunch = preference?.autoLaunch !== false;
  return { autoLaunch, language: normalizeLanguage(preference?.language), ambientEnabled: preference?.ambientEnabled !== false,
    ambientFrequency: normalizeAmbientFrequency(preference?.ambientFrequency), lifecycle: { available: autoLaunch && observerRunning && task?.installed === true && task?.enabled === true && enabled,
    observerRunning, taskInstalled: task?.installed === true, taskEnabled: task?.enabled === true, reason: !autoLaunch ? 'disabled' : !enabled ? 'plugin-disabled' : !observerRunning ? 'observer-not-ready' : !task?.installed || !task?.enabled ? 'login-task-not-ready' : null,
    lastObservedAt: heartbeat?.observedAt ? new Date(heartbeat.observedAt).toISOString() : null,
    windowCount: heartbeat?.windowCount ?? null, sessionActive: state.active, suppressed: state.manualSuppressed, pluginEnabled: enabled } };
}
async function runTask(options, action) {
  if (options.taskController) return options.taskController(action);
  const p = lifecyclePaths(options);
  const { runTaskCommand } = await import('../../windows/lifecycle/task.mjs');
  return runTaskCommand({ projectRoot: p.root, dataDir: p.data, action });
}
export async function setLifecyclePreferences(options, input) {
  if (!validPreferences(input)) throw new Error(Object.hasOwn(input ?? {}, 'autoLaunch') ? 'invalid-auto-launch' : 'invalid-preferences');
  await withLifecycleLock(options, async p => atomicJson(p.preferences, { ...await readJson(p.preferences), ...input }));
  if (!Object.hasOwn(input, 'autoLaunch')) return getLifecyclePreferences(options);
  try { await runTask(options, input.autoLaunch ? 'install' : 'disable'); } catch (error) {
    const p = lifecyclePaths(options); await atomicJson(p.task, { ...await readJson(p.task), error: 'login-task-unavailable', checkedAt: new Date().toISOString() });
  }
  if (input.autoLaunch) await ensureObserver(options);
  return getLifecyclePreferences(options);
}
export async function ensureObserver(options) {
  const p = lifecyclePaths(options);
  const preferences = await getLifecyclePreferences(options);
  if (!preferences.autoLaunch || !preferences.lifecycle.pluginEnabled) return preferences;
  if (preferences.lifecycle.observerRunning) return preferences;
  if (options.ensureObserverImpl) return options.ensureObserverImpl();
  const exe = join(p.root, 'windows', 'lifecycle', 'ShuanglingCodexWatcher.exe');
  if (process.platform !== 'win32' || !existsSync(exe)) return preferences;
  // Windows detached children can still inherit the Codex job object. Let
  // Task Scheduler own the persistent watcher, including the current logon,
  // so the next Codex window does not have to wait for an MCP connection.
  try {
    const task = await runTask(options, 'start');
    if (task?.started === true) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = await getLifecyclePreferences(options);
        if (current.lifecycle.observerRunning || !current.autoLaunch || !current.lifecycle.pluginEnabled) return current;
        await sleep(250);
      }
    }
  } catch { /* Keep the native fallback available if Task Scheduler is denied. */ }
  const current = await getLifecyclePreferences(options);
  if (!current.autoLaunch || !current.lifecycle.pluginEnabled) return current;
  const child = spawn(exe, ['--root', p.root, '--data', p.data], { cwd: p.root, windowsHide: true, detached: true, stdio: 'ignore' });
  await new Promise((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject); }); child.unref();
  return getLifecyclePreferences(options);
}
