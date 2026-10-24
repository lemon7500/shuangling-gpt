import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, lifecyclePaths, readJson, pluginEnabled, withLifecycleLock } from './index.mjs';
import { reconcileLifecycleTick, markStartFailure } from './state.mjs';

export async function authenticatedManager(dataDir) {
  const identity = await readJson(join(dataDir, 'desktop-runtime.json'));
  if (!Number.isInteger(identity?.managerPort) || identity.managerPort < 1 || identity.managerPort > 65535 || typeof identity.token !== 'string' || typeof identity.instanceId !== 'string') return null;
  try {
    const response = await fetch(`http://127.0.0.1:${identity.managerPort}/health`, { headers: { 'x-shuangling-token': identity.token }, signal: AbortSignal.timeout(1200) });
    if (!response.ok) return null;
    const result = await response.json();
    return result.instanceId === identity.instanceId ? { ...identity, ready: result.ready === true } : null;
  } catch { return null; }
}
export async function closeOwnedManager(dataDir, expectedId) {
  const manager = await authenticatedManager(dataDir);
  if (!manager || manager.instanceId !== expectedId) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${manager.managerPort}/stop`, { method: 'POST', headers: { 'x-shuangling-token': manager.token, 'x-shuangling-intent': 'auto-close' }, signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch { return false; }
}
export async function runObserver(options, { input = process.stdin, now = Date.now, managerImpl, spawnImpl, stopImpl, taskImpl } = {}) {
  const p = lifecyclePaths(options);
  let pending = Promise.resolve(), lastTaskMode = null, latest = null, processing = false;
  const inspectManager = managerImpl || (() => authenticatedManager(p.data));
  const startManager = spawnImpl || (async () => {
    const child = spawn(join(p.root, 'windows', 'runtime', 'node', 'node.exe'), [join(p.root, 'windows', 'start.mjs'), 'start'], {
      cwd: p.root, windowsHide: true, detached: true, stdio: 'ignore',
      env: { ...process.env, SHUANGLING_DATA_DIR: p.data, SHUANGLING_NO_OPEN: '1', SHUANGLING_SILENT_ERRORS: '1', SHUANGLING_LIFECYCLE_INTENT: 'auto' },
    });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); }); child.unref();
  });
  const setTask = taskImpl || (async mode => {
    const { runTaskCommand } = await import('../../windows/lifecycle/task.mjs');
    return runTaskCommand({ projectRoot: p.root, dataDir: p.data, action: mode });
  });
  const lines = createInterface({ input, crlfDelay: Infinity });
  async function processSnapshot(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.source !== 'OpenAI.Codex_2p2nqsd0c76g0' || typeof snapshot.detectorAvailable !== 'boolean' || !Array.isArray(snapshot.windows) || snapshot.windows.length > 100 || snapshot.windows.some(id => typeof id !== 'string' || !/^[0-9]+:[0-9]+:[0-9]+$/.test(id))) return;
    if (snapshot.logonId !== undefined && snapshot.logonId !== null && (typeof snapshot.logonId !== 'string' || !/^[0-9]+:[0-9]+$/.test(snapshot.logonId))) return;
    if (snapshot.priorEpoch !== undefined && snapshot.priorEpoch !== null && (typeof snapshot.priorEpoch !== 'string' || !/^[A-Za-z0-9-]{1,120}$/.test(snapshot.priorEpoch))) return;
    if (snapshot.priorEpochProcessesGone !== undefined && snapshot.priorEpochProcessesGone !== null && typeof snapshot.priorEpochProcessesGone !== 'boolean') return;
    const clock = now();
    const [manager, preference, enabled] = await Promise.all([inspectManager(), readJson(p.preferences), pluginEnabled(options)]);
    const autoLaunch = preference?.autoLaunch !== false;
    const taskMode = autoLaunch && enabled ? 'install' : 'disable';
    if (lastTaskMode !== taskMode) {
      lastTaskMode = taskMode;
      try { await setTask(taskMode); } catch { /* Do not spawn a failing scheduler command on every native tick. */ }
    }
    const effects = await withLifecycleLock(options, async paths => {
      const previous = await readJson(paths.session);
      const result = reconcileLifecycleTick(previous, { ...snapshot, autoLaunch, pluginEnabled: enabled, manager }, { now: clock });
      await atomicJson(paths.session, result.state);
      await atomicJson(paths.heartbeat, { schemaVersion: 1, pid: process.pid, observedAt: clock, detectorAvailable: snapshot.detectorAvailable, windowCount: snapshot.windows.length, pluginEnabled: enabled, autoLaunch });
      return result.effects;
    });
    for (const effect of effects) {
      if (effect.type === 'stop') {
        const accepted = await (stopImpl || (id => closeOwnedManager(p.data, id)))(effect.instanceId);
        if (!accepted) await withLifecycleLock(options, async paths => {
          const state = await readJson(paths.session); if (state?.ownerInstanceId === effect.instanceId) await atomicJson(paths.session, { ...state, stopRequested: false });
        });
      } else if (effect.type === 'start') {
        // Re-read suppression under the shared lock: a menu exit or manual
        // preference change between snapshot and spawn always takes priority.
        await withLifecycleLock(options, async paths => {
          const state = await readJson(paths.session);
          const latestPreference = await readJson(paths.preferences);
          if (state?.epoch !== effect.epoch || state.manualSuppressed || !state.active || latestPreference?.autoLaunch === false || !await pluginEnabled(options)) return;
          try { await startManager(); }
          catch { await atomicJson(paths.session, markStartFailure(state, now())); }
        });
      }
    }
    if (!enabled || !autoLaunch) {
      const state = await readJson(p.session);
      if (!state?.active && !await inspectManager()) lines.close();
    }
  }
  lines.on('line', line => {
    if (line.length > 32000) return;
    let snapshot; try { snapshot = JSON.parse(line); } catch { return; }
    // Slow first-run Task Scheduler access must not build a queue of obsolete
    // desktop snapshots. Keep only the newest native observation.
    latest = snapshot;
    if (processing) return;
    processing = true;
    pending = (async () => {
      while (latest) { const next = latest; latest = null; await processSnapshot(next); }
    })().catch(() => {}).finally(() => { processing = false; });
  });
  await new Promise(accept => lines.once('close', accept));
  await pending;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[process.argv.indexOf('--root') + 1];
  const data = process.argv[process.argv.indexOf('--data') + 1];
  if (!process.argv.includes('--root') || !process.argv.includes('--data') || !root || !data) process.exitCode = 2;
  else runObserver({ projectRoot: resolve(root), dataDir: resolve(data) }).then(() => process.exit(0)).catch(() => process.exit(1));
}
