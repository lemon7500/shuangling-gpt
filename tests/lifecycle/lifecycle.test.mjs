import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emptyLifecycleState, reconcileLifecycleTick, markStartFailure } from '../../src/lifecycle/state.mjs';
import { parsePluginEnabled, markManualStart, markManualStop, getLifecycleSession, getLifecyclePreferences, setLifecyclePreferences, atomicJson, lifecyclePaths } from '../../src/lifecycle/index.mjs';
import { CompanionPlugin } from '../../src/plugin/companion.mjs';
import { PassThrough } from 'node:stream';
import { runObserver } from '../../src/lifecycle/observer.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const input = changes => ({ detectorAvailable: true, windows: ['100:200:300'], autoLaunch: true, pluginEnabled: true, manager: null, ...changes });
const tick = (state, changes, now) => reconcileLifecycleTick(state, input(changes), { now, epoch: () => 'test-epoch' });

test('verified first window starts once, extra windows, minimized window, and healthy hidden/paused pet stay in the same epoch', () => {
  let result = tick(null, {}, 1000);
  assert.deepEqual(result.effects, [{ type: 'start', epoch: 'test-epoch', attempt: 1 }]);
  const epoch = result.state.epoch;
  result = tick(result.state, { manager: { ready: true, instanceId: 'one', hidden: true, paused: true } }, 2000);
  assert.deepEqual(result.effects, []);
  result = tick(result.state, { windows: ['100:200:300', '100:200:301'], manager: { ready: true, instanceId: 'one' } }, 3000);
  assert.equal(result.state.epoch, epoch); assert.deepEqual(result.effects, []);
  assert.equal(result.state.ownerInstanceId, 'one');
});
test('all windows absent for three seconds closes only adopted authenticated singleton; brief absence does not close', () => {
  let { state } = tick(null, { manager: { ready: true, instanceId: 'owned' } }, 1000);
  let result = tick(state, { windows: [], manager: { ready: true, instanceId: 'owned' } }, 2000);
  assert.equal(result.state.zeroSince, 2000); assert.deepEqual(result.effects, []);
  result = tick(result.state, { windows: [], manager: { ready: true, instanceId: 'other' } }, 5000);
  assert.equal(result.state.active, false); assert.deepEqual(result.effects, []);
  result = tick(state, { windows: [], manager: { ready: true, instanceId: 'owned' } }, 2000);
  result = tick(result.state, { windows: [], manager: { ready: true, instanceId: 'owned' } }, 4999);
  assert.deepEqual(result.effects, []);
  result = tick(result.state, { windows: [], manager: { ready: true, instanceId: 'owned' } }, 5000);
  assert.deepEqual(result.effects, [{ type: 'stop', instanceId: 'owned' }]);
});
test('manual exit survives new windows and observer restart; confirmed all-closed boundary permits next session', () => {
  let { state } = tick(null, {}, 1000);
  state = { ...state, manualSuppressed: true, pendingStartAt: null };
  let result = tick(JSON.parse(JSON.stringify(state)), { windows: ['100:200:300', '400:500:600'] }, 50000);
  assert.equal(result.state.manualSuppressed, true); assert.deepEqual(result.effects, []);
  result = tick(result.state, { windows: [] }, 51000);
  result = tick(result.state, { windows: [] }, 54000);
  assert.equal(result.state.active, false);
  result = tick(result.state, {}, 55000);
  assert.equal(result.state.manualSuppressed, false); assert.equal(result.effects[0].type, 'start');
});
test('manual stop before first observer sample is respected', () => {
  const result = tick({ ...emptyLifecycleState(), manualSuppressed: true }, {}, 1000);
  assert.equal(result.state.manualSuppressed, true); assert.deepEqual(result.effects, []);
});
test('new Windows logon clears a stale prior-session manual exit; same logon watcher restart preserves it', () => {
  let { state } = tick(null, { logonId: '0:100' }, 1000);
  state = { ...state, manualSuppressed: true, pendingStartAt: null, nextAttemptAt: null };
  const restarted = tick(JSON.parse(JSON.stringify(state)), { logonId: '0:100' }, 100000);
  assert.equal(restarted.state.manualSuppressed, true); assert.deepEqual(restarted.effects, []);
  const relogged = reconcileLifecycleTick(state, input({ logonId: '0:200' }), { now: 100000, epoch: () => 'fresh-logon-epoch' });
  assert.equal(relogged.state.logonId, '0:200'); assert.equal(relogged.state.manualSuppressed, false);
  assert.equal(relogged.state.epoch, 'fresh-logon-epoch'); assert.equal(relogged.effects[0].type, 'start');
});
test('legacy missing logon marker seeds without lifting manual suppression', () => {
  const legacy = { ...emptyLifecycleState(), active: true, epoch: 'legacy-epoch', windows: ['100:200:300'], manualSuppressed: true, lastObservedAt: 1 };
  const result = tick(legacy, { logonId: '0:100' }, 100000);
  assert.equal(result.state.manualSuppressed, true); assert.equal(result.state.epoch, 'legacy-epoch');
  assert.equal(result.state.logonId, '0:100'); assert.deepEqual(result.effects, []);
});
test('offline app replacement needs stale observation, wholly replaced GUI owner identities and native proof old owners are gone', () => {
  let { state } = tick(null, { logonId: '0:100' }, 1000);
  state = { ...state, manualSuppressed: true, pendingStartAt: null, nextAttemptAt: null };
  const replacement = { logonId: '0:100', windows: ['400:500:600'], priorEpoch: 'test-epoch', priorEpochProcessesGone: true };
  const fresh = changes => reconcileLifecycleTick(state, input({ ...replacement, ...changes }), { now: 5000, epoch: () => 'new-app-epoch' });
  for (const changes of [{ priorEpochProcessesGone: false }, { priorEpochProcessesGone: null }, { priorEpoch: 'different-epoch' }, { windows: ['100:200:999'] }, { windows: ['100:200:300', '400:500:600'] }]) {
    const result = fresh(changes); assert.equal(result.state.manualSuppressed, true); assert.deepEqual(result.effects, []);
  }
  const tinyGap = reconcileLifecycleTick(state, input(replacement), { now: 3000, epoch: () => 'wrong-epoch' });
  assert.equal(tinyGap.state.manualSuppressed, true); assert.deepEqual(tinyGap.effects, []);
  const result = fresh({}); assert.equal(result.state.manualSuppressed, false); assert.equal(result.state.epoch, 'new-app-epoch'); assert.equal(result.effects[0].type, 'start');
});
test('start failures retry only at one, three and ten seconds, then stop', () => {
  let { state, effects } = tick(null, {}, 0);
  assert.equal(effects.length, 1);
  let now = 0;
  for (const delay of [1000, 3000, 10000]) {
    state = markStartFailure(state, now);
    assert.deepEqual(tick(state, {}, now + delay - 1).effects, []);
    now += delay;
    const next = tick(state, {}, now); state = next.state;
    assert.equal(next.effects.length, 1);
  }
  state = markStartFailure(state, now);
  assert.deepEqual(tick(state, {}, now + 100000).effects, []); assert.equal(state.attempts, 4);
});
test('unknown detector never starts or closes; disabled preference/plugin blocks automatic start', () => {
  assert.deepEqual(tick(null, { detectorAvailable: false }, 1000).effects, []);
  assert.deepEqual(tick(null, { autoLaunch: false }, 1000).effects, []);
  assert.deepEqual(tick(null, { pluginEnabled: false }, 1000).effects, []);
  let { state } = tick(null, { manager: { ready: true, instanceId: 'one' } }, 1000);
  const result = tick(state, { detectorAvailable: false, windows: [] }, 100000);
  assert.equal(result.state.active, true); assert.deepEqual(result.effects, []);
});
test('plugin config parser requires explicit enabled true in exact plugin table, rejects malformed and duplicate values', () => {
  assert.equal(parsePluginEnabled('[plugins."shuangling-gpt@shuangling-local"]\nenabled = true # yes\n[next]\nenabled=false'), true);
  for (const text of ['', '[plugins."other"]\nenabled=true', '[plugins."shuangling-gpt@shuangling-local"]\nenabled="true"', '[plugins."shuangling-gpt@shuangling-local"]\nenabled=true\nenabled=false']) assert.equal(parsePluginEnabled(text), false);
});
test('manual marks persist across independent clients and preferences merge without touching settings', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-lifecycle-'));
  const calls = [];
  const options = { projectRoot: 'unused', dataDir, pluginEnabledImpl: () => true, taskController: async action => calls.push(action), ensureObserverImpl: async () => ({ testing: true }) };
  const p = lifecyclePaths(options);
  await atomicJson(p.preferences, { autoLaunch: true, retained: 'yes' });
  await atomicJson(join(dataDir, 'bridge-config.json'), { threadId: 'the-chat', paused: true });
  const baseline = await readFile(join(dataDir, 'bridge-config.json'));
  await markManualStop(options); assert.equal((await getLifecycleSession(options)).manualSuppressed, true);
  await markManualStart(options); assert.equal((await getLifecycleSession(options)).manualSuppressed, false);
  await setLifecyclePreferences(options, { autoLaunch: false });
  assert.deepEqual(JSON.parse(await readFile(p.preferences)), { autoLaunch: false, retained: 'yes' });
  assert.deepEqual(calls, ['disable']);
  await setLifecyclePreferences(options, { autoLaunch: true });
  assert.deepEqual(calls, ['disable', 'install']); assert.deepEqual(await readFile(join(dataDir, 'bridge-config.json')), baseline);
  await assert.rejects(setLifecyclePreferences(options, { autoLaunch: 'yes' }), /invalid-auto-launch/);
});
test('readiness requires fresh detector heartbeat plus enabled scheduled task and plugin', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-ready-'));
  const options = { projectRoot: 'unused', dataDir, pluginEnabledImpl: () => true };
  const p = lifecyclePaths(options);
  await atomicJson(p.heartbeat, { observedAt: Date.now(), detectorAvailable: true, windowCount: 1 });
  await atomicJson(p.task, { installed: true, enabled: false });
  assert.equal((await getLifecyclePreferences(options)).lifecycle.available, false);
  await atomicJson(p.task, { installed: true, enabled: true });
  assert.equal((await getLifecyclePreferences(options)).lifecycle.available, true);
  await atomicJson(p.heartbeat, { observedAt: Date.now()-7000, detectorAvailable: true });
  assert.equal((await getLifecyclePreferences(options)).lifecycle.available, false);
});
test('MCP reconnect only ensures observer and never directly launches pet or clears manual suppression', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-mcp-lifecycle-'));
  let observerCalls = 0, petStarts = 0;
  const options = { projectRoot: 'unused', dataDir, startImpl: async () => petStarts++, lifecycle: { pluginEnabledImpl: () => true, ensureObserverImpl: async () => { observerCalls++; } } };
  await markManualStop(options);
  await new CompanionPlugin(options).automaticStart(); await new CompanionPlugin(options).automaticStart();
  assert.equal(petStarts, 0); assert.equal(observerCalls, 2); assert.equal((await getLifecycleSession(options)).manualSuppressed, true);
});
test('observer routes synthetic verified snapshots without pet processes, disables task once, and closes owned manager after grace', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-observer-'));
  let clock = 1000, enabled = true, manager = { ready: true, instanceId: 'fixture-manager' };
  const inputStream = new PassThrough(), tasks = [], stops = [];
  const options = { projectRoot: 'unused', dataDir, pluginEnabledImpl: () => enabled };
  const running = runObserver(options, { input: inputStream, now: () => clock,
    managerImpl: async () => manager, spawnImpl: async () => assert.fail('healthy pet must not spawn'),
    taskImpl: async mode => tasks.push(mode), stopImpl: async id => { stops.push(id); manager = null; return true; } });
  const sample = windows => inputStream.write(JSON.stringify({ schemaVersion: 1, source: 'OpenAI.Codex_2p2nqsd0c76g0', detectorAvailable: true, windows })+'\n');
  async function until(predicate) { for (let count = 0; count < 100; count++) { if (await predicate()) return; await new Promise(accept => setTimeout(accept, 5)); } assert.fail('observer fixture timeout'); }
  sample(['100:200:300']); await until(async () => (await getLifecycleSession(options)).ownerInstanceId === 'fixture-manager');
  enabled = false; clock = 2000; sample(['100:200:300']); await until(() => tasks.includes('disable'));
  clock = 3000; sample([]); await until(async () => (await getLifecycleSession(options)).zeroSince === 3000);
  clock = 6000; sample([]); await until(() => stops.length === 1);
  await running;
  assert.deepEqual(tasks, ['install', 'disable']); assert.deepEqual(stops, ['fixture-manager']);
  assert.equal((await getLifecycleSession(options)).active, false);
});
test('scheduler failure is attempted once for a stable mode, rather than once per native snapshot', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-task-failure-'));
  let clock = 1, attempts = 0;
  const stream = new PassThrough();
  const options = { projectRoot: 'unused', dataDir, pluginEnabledImpl: () => true };
  const running = runObserver(options, { input: stream, now: () => clock, managerImpl: async () => null,
    taskImpl: async () => { attempts++; throw new Error('fixture-access-denied'); }, spawnImpl: async () => {} });
  const sample = () => stream.write(JSON.stringify({ schemaVersion: 1, source: 'OpenAI.Codex_2p2nqsd0c76g0', detectorAvailable: true, windows: [] })+'\n');
  sample(); await new Promise(accept => setTimeout(accept, 30)); clock = 2; sample();
  await new Promise(accept => setTimeout(accept, 30)); stream.end(); await running;
  assert.equal(attempts, 1);
});
test('launcher rechecks manual suppression, disabled preference and ended session before any automatic runtime starts', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'shuangling-launch-guard-'));
  const codexHome = join(fixture, 'codex-home'); await mkdir(codexHome);
  await writeFile(join(codexHome, 'config.toml'), '[plugins."shuangling-gpt@shuangling-local"]\nenabled=true\n');
  const entry = fileURLToPath(new URL('../../windows/start.mjs', import.meta.url));
  const cases = [ { active: true, manualSuppressed: true, autoLaunch: true }, { active: true, manualSuppressed: false, autoLaunch: false }, { active: false, manualSuppressed: false, autoLaunch: true } ];
  for (let index = 0; index < cases.length; index++) {
    const dataDir = join(fixture, String(index)); await mkdir(dataDir);
    const item = cases[index];
    await atomicJson(join(dataDir, 'plugin-config.json'), { autoLaunch: item.autoLaunch });
    await atomicJson(join(dataDir, 'lifecycle-session.json'), { ...emptyLifecycleState(), active: item.active, manualSuppressed: item.manualSuppressed });
    await promisify(execFile)(process.execPath, [entry, 'start'], { windowsHide: true, timeout: 10000,
      env: { ...process.env, SHUANGLING_DATA_DIR: dataDir, SHUANGLING_LIFECYCLE_INTENT: 'auto', SHUANGLING_NO_OPEN: '1', SHUANGLING_SILENT_ERRORS: '1', CODEX_HOME: codexHome } });
    const files = await readdir(dataDir);
    assert.deepEqual(files.sort(), ['lifecycle-session.json', 'plugin-config.json']);
  }
});
