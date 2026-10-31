import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { createDeskService, validDeskCommand } from '../../src/desk/service.mjs';
import focusSleep from '../../vendor/dsh-pet/runtime/electron-helper/focus-sleep.cjs';
import panelMain from '../../vendor/dsh-pet/runtime/electron-helper/panel-main.cjs';

const main = (await readFile(new URL('../../vendor/dsh-pet/runtime/electron-helper/main.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const listenerStart = main.indexOf("    powerMonitor.on('suspend', () => {");
const listenerEnd = main.indexOf('\n  }\n\n  // 宠物窗口跟随', listenerStart);
assert.ok(listenerStart > 0 && listenerEnd > listenerStart);
const listenerSource = main.slice(listenerStart, listenerEnd);
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, nearDeadline = false) {
  const directory = await mkdtemp(join(tmpdir(), 'shuangling-sleep-intent-'));
  let at = 1_800_000_000_000;
  const notices = [], errors = [], pending = [];
  const options = { dataDir: directory, now: () => at, autoTick: false, detectSleep: true, onNotice: notice => notices.push(notice) };
  let service = await createDeskService(options);
  t.after(() => service.close());
  await service.command({ type: 'focus.configure', focusMinutes: 10, breakMinutes: 1 });
  await service.command({ type: 'focus.start', phase: nearDeadline ? 'break' : 'focus' });
  for (const step of nearDeadline ? [25_000, 25_000, 5_000] : [5_000]) { at += step; await service.tick(); }
  const before = await service.snapshot();
  const managerPath = join(directory, 'manager-state.json');
  await writeFile(managerPath, JSON.stringify({ settingsUrl: 'http://127.0.0.1:18888/#isolated-sleep-fixture' }));
  let listener;
  vm.runInNewContext(listenerSource, {
    powerMonitor: { on: (name, callback) => { assert.equal(name, 'suspend'); listener = callback; } },
    recordFocusSleepSync: path => focusSleep.recordFocusSleepSync(path, at),
    managerClient: path => panelMain.managerClient(path, async (url, options) => {
      assert.equal(url.pathname, '/api/desk'); pending.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({}) };
    }),
    process: { env: { SHUANGLING_MANAGER_STATE: managerPath } }, console: { error: message => errors.push(message) },
  });
  return { directory, managerPath, before, notices, pending, errors, options,
    get service() { return service; }, set service(value) { service = value; },
    now: () => at, advance: ms => { at += ms; }, sleep: () => listener(),
    stored: async () => JSON.parse(await readFile(join(directory, 'desk.json'), 'utf8')) };
}

for (const delay of [20_000, 30_000, 45_000]) {
  test(`actual suspend listener checkpoints before a ${delay}ms delayed request`, async t => {
    const f = await fixture(t); f.sleep(); assert.equal(f.pending.length, 1);
    f.advance(delay);
    const value = await f.service.command(f.pending[0]); await flush();
    assert.equal(value.focus.status, 'paused'); assert.equal(value.focus.pauseReason, 'sleep');
    assert.equal(value.focus.remainingMs, f.before.focus.remainingMs);
    assert.deepEqual(f.notices, []); assert.equal((await f.stored()).focus.status, 'paused');
  });
}

for (const wakeFirst of [false, true]) {
  test(`remaining 5s, 10s sleep cannot complete (wake tick first: ${wakeFirst})`, async t => {
    const f = await fixture(t, true); f.sleep(); f.advance(10_000);
    if (wakeFirst) {
      const wake = await f.service.tick(); assert.equal(wake.snapshot.focus.status, 'paused');
      assert.equal(wake.snapshot.focus.remainingMs, 5_000);
    }
    const value = await f.service.command(f.pending[0]); await flush();
    assert.equal(value.focus.status, 'paused'); assert.equal(value.focus.remainingMs, 5_000);
    assert.equal(value.focus.completedAt, null); assert.deepEqual(f.notices, []);
  });
}

test('a stale forwarded event or repeated intent cannot pause a resumed or newly started timer', async t => {
  const f = await fixture(t); f.sleep(); const request = f.pending[0];
  f.advance(20_000); await f.service.tick();
  const oldRun = (await f.stored()).focus.runId;
  await f.service.command({ type: 'focus.resume' }); assert.notEqual((await f.stored()).focus.runId, oldRun);
  f.advance(1_000); let value = await f.service.command(request);
  assert.equal(value.focus.status, 'running'); assert.equal(value.focus.remainingMs, f.before.focus.remainingMs - 1_000);
  await f.service.command({ type: 'focus.stop' }); await f.service.command({ type: 'focus.start' });
  value = await f.service.command(request); assert.equal(value.focus.status, 'running');
});

test('duplicate native suspend events retain the earliest checkpoint and pause only once', async t => {
  const f = await fixture(t); f.sleep(); f.advance(3_000); f.sleep();
  assert.deepEqual(f.pending[0], f.pending[1]); f.advance(10_000);
  const first = await f.service.command(f.pending[0]);
  const second = await f.service.command(f.pending[1]);
  assert.equal(first.focus.remainingMs, f.before.focus.remainingMs);
  assert.deepEqual(second.focus, first.focus); assert.deepEqual(f.notices, []);
});

test('failed durable pause replays its intent before any later progress or completion', async t => {
  const f = await fixture(t, true); f.sleep();
  const desk = join(f.directory, 'desk.json'), retained = join(f.directory, 'retained-desk.json');
  await rename(desk, retained); await mkdir(desk);
  f.advance(10_000);
  await assert.rejects(f.service.tick(), { reason: 'desk-storage-unavailable' }); await flush();
  assert.deepEqual(f.notices, []);
  await rename(desk, join(f.directory, 'retained-blocker')); await rename(retained, desk);
  const value = await f.service.snapshot();
  assert.equal(value.focus.status, 'paused'); assert.equal(value.focus.remainingMs, 5_000);
  assert.equal((await f.stored()).focus.status, 'paused'); assert.deepEqual(f.notices, []);
});

test('invalid event times and identities are rejected without changing the current timer', async t => {
  const f = await fixture(t); const state = await f.stored();
  const event = { id: randomUUID(), sessionId: state.sleepSessionId, runId: state.focus.runId, at: f.now() };
  for (const variant of [{ ...event, at: f.now() + 1 }, { ...event, at: state.sleepRunStartedAt - 1 },
    { ...event, sessionId: randomUUID() }, { ...event, runId: randomUUID() }]) {
    const value = await f.service.command({ type: 'focus.suspend', reason: 'sleep', event: variant });
    assert.equal(value.focus.status, 'running'); assert.equal(value.focus.remainingMs, f.before.focus.remainingMs);
  }
  for (const bad of [{ ...event, at: -1 }, { ...event, extra: true }, { ...event, runId: 'x' }])
    assert.equal(validDeskCommand({ type: 'focus.suspend', event: bad }), false);
  assert.equal(validDeskCommand({ type: 'focus.suspend', reason: 'app-exit', event }), false);
  f.advance(-10_000); const rewound = await f.service.snapshot();
  assert.equal(rewound.focus.status, 'paused'); assert.equal(rewound.focus.pauseReason, 'sleep');
});

test('close consumes sleep intent, restart remains paused and old-session HTTP cannot affect a resumed timer', async t => {
  const f = await fixture(t, true); f.sleep(); f.advance(10_000); await f.service.close();
  let state = await f.stored(); assert.equal(state.focus.status, 'paused');
  assert.equal(state.focus.pauseReason, 'sleep'); assert.equal(state.focus.remainingMs, 5_000);
  const oldSession = state.sleepSessionId;
  f.service = await createDeskService(f.options); const restored = await f.service.snapshot();
  assert.equal(restored.focus.status, 'paused'); assert.equal(restored.focus.remainingMs, 5_000);
  state = await f.stored(); assert.notEqual(state.sleepSessionId, oldSession);
  await f.service.command({ type: 'focus.resume' });
  assert.equal((await f.service.command(f.pending[0])).focus.status, 'running');
});

test('a rejected future or too-early disk intent cannot become valid later in the same session', async t => {
  const f = await fixture(t); const state = await f.stored();
  const file = join(f.directory, 'focus-sleep-intent.json');
  const future = { id: randomUUID(), sessionId: state.sleepSessionId, runId: state.focus.runId, at: f.now() + 1_000 };
  await writeFile(file, JSON.stringify(future));
  assert.equal((await f.service.snapshot()).focus.status, 'running');
  f.advance(2_000); assert.equal((await f.service.snapshot()).focus.status, 'running');
  assert.equal((await f.service.command({ type: 'focus.suspend', event: future })).focus.status, 'running');
  const early = { ...future, id: randomUUID(), at: state.sleepRunStartedAt - 1 };
  await writeFile(file, JSON.stringify(early));
  assert.equal((await f.service.snapshot()).focus.status, 'running');
  await writeFile(file, JSON.stringify({ ...early, at: f.now() }));
  assert.equal((await f.service.snapshot()).focus.status, 'running');
});

test('an unsuccessful transaction does not commit rejected intent IDs', async t => {
  const f = await fixture(t); const state = await f.stored();
  const event = { id: randomUUID(), sessionId: state.sleepSessionId, runId: state.focus.runId, at: f.now() + 1_000 };
  await writeFile(join(f.directory, 'focus-sleep-intent.json'), JSON.stringify(event));
  const file = join(f.directory, 'desk.json'), retained = join(f.directory, 'retained-desk.json');
  await rename(file, retained); await mkdir(file);
  await assert.rejects(f.service.command({ type: 'focus.pause' }), { reason: 'desk-storage-unavailable' });
  await rename(file, join(f.directory, 'retained-blocker')); await rename(retained, file);
  f.advance(2_000);
  const value = await f.service.snapshot();
  assert.equal(value.focus.status, 'paused'); assert.equal(value.focus.pauseReason, 'sleep');
  assert.equal(value.focus.remainingMs, f.before.focus.remainingMs - 1_000);
});

test('a failed synchronous native checkpoint reports degradation and does not send an unscoped suspend', async t => {
  const f = await fixture(t); await mkdir(join(f.directory, 'focus-sleep-intent.json'));
  f.sleep(); assert.equal(f.pending.length, 0);
  assert.match(f.errors[0], /gap fallback only/);
  f.advance(10_000); await assert.rejects(f.service.tick(), { reason: 'desk-storage-unavailable' });
  assert.deepEqual(f.notices, []);
  await rename(join(f.directory, 'focus-sleep-intent.json'), join(f.directory, 'retained-intent-blocker'));
});

test('legacy suspend shape is still accepted and internal sleep IDs never appear in a snapshot', async t => {
  const f = await fixture(t); const value = await f.service.command({ type: 'focus.suspend', reason: 'sleep' });
  assert.equal(value.focus.status, 'paused');
  const text = JSON.stringify(value);
  assert.equal(text.includes('sleepSessionId'), false); assert.equal(text.includes('runId'), false);
  assert.equal(text.includes('sleepRunStartedAt'), false);
});

for (const command of ['focus.start', 'focus.resume']) {
  test(`suspend during the first asynchronous ${command} checkpoint protects its pending run`, async t => {
    const f = await fixture(t, true);
    if (command === 'focus.start') await f.service.command({ type: 'focus.stop' });
    else await f.service.command({ type: 'focus.pause' });
    const activation = f.service.command({ type: command, ...(command === 'focus.start' ? { phase: 'break' } : {}) });
    await Promise.resolve(); // Inside persist, before its first asynchronous mkdir completes.
    const disk = JSON.parse(readFileSync(join(f.directory, 'desk.json'), 'utf8'));
    assert.notEqual(disk.focus.status, 'running');
    f.sleep(); assert.equal(f.pending.length, 1);
    f.advance(command === 'focus.start' ? 20_000 : 10_000);
    await activation;
    const wake = await f.service.tick();
    assert.equal(wake.snapshot.focus.status, 'paused'); assert.equal(wake.snapshot.focus.pauseReason, 'sleep');
    assert.equal(wake.snapshot.focus.remainingMs, command === 'focus.start' ? 60_000 : 5_000);
    await f.service.command(f.pending[0]); await flush(); assert.deepEqual(f.notices, []);
  });
}

test('failed activation marker publication refuses a start and leaves existing timer state unchanged', async t => {
  const f = await fixture(t); await f.service.command({ type: 'focus.stop' });
  const file = join(f.directory, 'focus-sleep-activation.json');
  await rename(file, join(f.directory, 'retained-activation-marker')); await mkdir(file);
  await assert.rejects(f.service.command({ type: 'focus.start' }), { reason: 'desk-storage-unavailable' });
  assert.equal((await f.stored()).focus.status, 'idle');
  await rename(file, join(f.directory, 'retained-activation-blocker'));
  assert.equal((await f.service.snapshot()).focus.status, 'idle');
});

test('a stale activation marker expires on commit, pause, restart and later explicit starts', async t => {
  const f = await fixture(t); await f.service.command({ type: 'focus.pause' });
  assert.equal(focusSleep.recordFocusSleepSync(f.managerPath, f.now()), null);
  await f.service.command({ type: 'focus.stop' });
  assert.equal(focusSleep.recordFocusSleepSync(f.managerPath, f.now()), null);
  await f.service.command({ type: 'focus.start' }); f.sleep();
  const old = f.pending[0]; await f.service.tick(); await f.service.close();
  f.service = await createDeskService(f.options);
  assert.equal(focusSleep.recordFocusSleepSync(f.managerPath, f.now()), null);
  await f.service.command({ type: 'focus.resume' });
  assert.equal((await f.service.command(old)).focus.status, 'running');
});
