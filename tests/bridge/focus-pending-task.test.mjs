import test from 'node:test';
import assert from 'node:assert/strict';
import { PetController } from '../../src/bridge/controller.mjs';

const tick = ms => new Promise(done => setTimeout(done, ms));
async function until(check) {
  const deadline = Date.now() + 1500;
  while (!check()) { assert.ok(Date.now() < deadline, 'focus handoff did not settle'); await tick(2); }
}

function fixture(t, { active = false, marked = true, status = 'accepted', state = 'working', ageMs = 100 } = {}) {
  const calls = [], receipts = new Map(), operations = [];
  let serial = 0, activeId = active ? 'focus-cue' : null;
  if (active) receipts.set(activeId, { status });
  const client = {
    lock: async id => { calls.push({ kind: 'lock', id }); return { lockId: id || 'existing-owner' }; },
    release: async id => { calls.push({ kind: 'release', id }); },
    play: async (name, lockId) => {
      if (activeId) receipts.set(activeId, { status: 'cancelled', reason: 'superseded' });
      activeId = 'playback-' + ++serial;
      receipts.set(activeId, { status: 'accepted' });
      calls.push({ kind: 'play', name, lockId, playbackId: activeId });
      return { playbackId: activeId };
    },
    playback: async id => { calls.push({ kind: 'receipt', id }); await tick(2); return { ...receipts.get(id) }; },
  };
  const controller = new PetController({ client, sleepImpl: () => tick(2) });
  controller.kick = () => {};
  controller.lockId = 'existing-owner'; controller.renewAt = Infinity;
  controller.generation = active ? 2 : 1;
  controller.status = { state: active ? state : 'idle', threadId: 'codex', turnId: 'before' };
  if (active) controller.activePlayback = { playbackId: activeId, name: 'stretching-wings', generation: 1,
    requestedAt: Date.now() - ageMs, ...(marked ? { optionalCue: true } : {}) };
  const run = (name, options) => { const operation = controller.one(name, controller.generation, options); operations.push(operation); return operation; };
  t.after(async () => { controller.closed = true; controller.generation++; await Promise.allSettled(operations); await controller.release(); });
  return { controller, client, calls, receipts, run, plays: () => calls.filter(row => row.kind === 'play') };
}

test('a newer task supersedes an actually accepted optional focus cue without waiting for it to display or finish', async t => {
  const f = fixture(t);
  let completed = false;
  const cue = f.run('stretching-wings', { optionalCue: true }).then(value => { completed = true; return value; });
  await until(() => f.controller.lastPlayback?.status === 'accepted');
  const firstId = f.plays()[0].playbackId;
  assert.equal(f.controller.activePlayback.optionalCue, true); assert.equal(completed, false);
  f.controller.update({ state: 'working', threadId: 'codex', turnId: 'new-work' });
  assert.equal(await cue, false);
  const task = f.run('running');
  await until(() => f.plays().length === 2);
  assert.deepEqual(f.plays().map(row => row.name), ['stretching-wings', 'running']);
  assert.ok(f.calls.some(row => row.kind === 'receipt' && row.id === firstId), 'superseding requires a real accepted receipt');
  assert.deepEqual(f.receipts.get(firstId), { status: 'cancelled', reason: 'superseded' });
  assert.equal(f.controller.activePlayback.optionalCue, undefined, 'task playback cannot inherit optional focus authority');
  assert.ok(!f.calls.some(row => row.kind === 'lock' || row.kind === 'release'), 'existing ownership is retained');
  f.receipts.set(f.plays()[1].playbackId, { status: 'ended' }); assert.equal(await task, true);
});

test('once optional focus wings really start, a newer task waits for their genuine ending', async t => {
  const f = fixture(t);
  const cue = f.run('stretching-wings', { optionalCue: true });
  await until(() => f.controller.lastPlayback?.status === 'accepted');
  const cueId = f.plays()[0].playbackId;
  f.receipts.set(cueId, { status: 'playing' });
  await until(() => f.controller.activePlayback.optionalCue === undefined);
  f.controller.update({ state: 'working', threadId: 'codex', turnId: 'new-work' });
  assert.equal(await cue, false);
  const task = f.run('running'); await tick(25);
  assert.equal(f.plays().length, 1, 'playing cannot be treated as a neutral/end receipt');
  f.receipts.set(cueId, { status: 'ended' }); await until(() => f.plays().length === 2);
  f.receipts.set(f.plays()[1].playbackId, { status: 'ended' }); assert.equal(await task, true);
});

test('the newer boundary itself discovers playing and clears a stale optional marker before making any task request', async t => {
  const f = fixture(t, { active: true, status: 'playing' });
  const task = f.run('review'); await tick(25);
  assert.equal(f.controller.activePlayback.optionalCue, undefined); assert.equal(f.plays().length, 0);
  f.receipts.set('focus-cue', { status: 'ended' }); await until(() => f.plays().length === 1);
  f.receipts.set(f.plays()[0].playbackId, { status: 'ended' }); assert.equal(await task, true);
});

test('ordinary unmarked accepted wings retain their existing ended boundary', async t => {
  const f = fixture(t, { active: true, marked: false });
  const task = f.run('running'); await tick(25); assert.equal(f.plays().length, 0);
  f.receipts.set('focus-cue', { status: 'ended' }); await until(() => f.plays().length === 1);
  f.receipts.set(f.plays()[0].playbackId, { status: 'ended' }); assert.equal(await task, true);
});

test('unknown states and non-task destinations cannot use optional focus retargeting', async t => {
  for (const [state, name] of [['unknown', 'idle'], ['working', 'reading'], ['working', 'running-right'], ['working', 'external-url']]) {
    const f = fixture(t, { active: true, state });
    const task = f.run(name); await tick(20); assert.equal(f.plays().length, 0, state + '/' + name);
    f.receipts.set('focus-cue', { status: 'ended' }); await until(() => f.plays().length === 1);
    f.receipts.set(f.plays()[0].playbackId, { status: 'ended' }); assert.equal(await task, true);
  }
});

test('pause, manual takeover, shutdown and reload prevent optional retargeting before and during the receipt read', async t => {
  for (const flag of ['paused', 'preempted', 'closed', 'surfaceReloading']) {
    const initial = fixture(t, { active: true }); initial.controller[flag] = true;
    assert.equal(await initial.run('running'), false); assert.equal(initial.plays().length, 0, flag);
    const raced = fixture(t, { active: true });
    raced.client.playback = async () => { raced.controller[flag] = true; return { status: 'accepted' }; };
    assert.equal(await raced.run('running'), false); assert.equal(raced.plays().length, 0, flag + ' during lookup');
  }
});

test('native manual ownership and hidden or lost leases cannot be converted into an optional-cue task start', async t => {
  const manual = fixture(t, { active: true });
  manual.client.interaction = async () => ({ interaction: { id: 'native-menu', kind: 'menu', phase: 'blocked',
    startedAt: Date.now(), updatedAt: Date.now(), endedAt: null, revision: 1, resumable: false } });
  await assert.rejects(manual.run('running'), error => error.reason === 'preempted'); assert.equal(manual.plays().length, 0);
  for (const reason of ['lock-lost', 'pet-hidden', 'pet-not-displayed']) {
    const f = fixture(t, { active: true }); f.controller.renewAt = 0;
    f.client.lock = async () => { throw Object.assign(new Error(reason), { reason }); };
    await assert.rejects(f.run('running'), error => error.reason === reason); assert.equal(f.plays().length, 0);
  }
});

test('cancelled, failed and timed-out pending focus receipts never fabricate a successful successor', async t => {
  for (const [status, reason, ageMs] of [['cancelled', 'preempted', 100], ['failed', 'playback-failed', 100], ['accepted', 'playback-not-started', 6000]]) {
    const f = fixture(t, { active: true, status, ageMs });
    await assert.rejects(f.run('running'), error => error.reason === reason); assert.equal(f.plays().length, 0);
  }
});

test('a pending optional focus reminder expires without retrying or renewing its lease', async t => {
  const f = fixture(t);
  let now = 1000;
  f.controller.now = () => now;
  f.controller.startTimeoutMs = 10;
  f.controller.maxStartRetries = 3;
  f.client.playback = async () => { now += 20; return { status: 'accepted' }; };
  await assert.rejects(f.run('stretching-wings', { optionalCue: true, cueExpiresAt: 7000 }),
    error => error.reason === 'playback-not-started');
  assert.equal(f.plays().length, 1, 'a delayed reminder must never become a newly replayed reminder');
  assert.equal(f.calls.filter(row => row.kind === 'lock').length, 0, 'no forced renewal/retry is allowed for an optional cue');
});

test('focus cue expiry is checked after each asynchronous pre-play stage', async t => {
  for (const stage of ['lease', 'boundary', 'interaction']) {
    const f = fixture(t);
    let now = 1000;
    f.controller.now = () => now;
    if (stage === 'lease') f.controller.lease = async () => { now = 1200; };
    if (stage === 'boundary') f.controller.waitForPlaybackBoundary = async () => { now = 1200; return true; };
    if (stage === 'interaction') f.controller.observeRestInteraction = async () => { now = 1200; };
    assert.equal(await f.run('stretching-wings', {
      optionalCue: true, cueExpiresAt: 1100, observeInteraction: true,
    }), 'skipped', stage);
    assert.equal(f.plays().length, 0, stage + ' must not dispatch an expired reminder');
    assert.equal(f.controller.activePlayback, null, stage + ' must not invent a playback/end receipt');
  }
});

test('rest skips a focus cue that expires during its native check without consuming cooldown or extending quiet time', async t => {
  const f = fixture(t);
  let now = 1000, observed = false;
  f.controller.now = () => now;
  f.controller.previousAmbient = 'looking-around';
  f.controller.lastAmbientEnded['looking-around'] = 900;
  f.controller.cue = { source: 'focus', name: 'stretching-wings', generation: 1, expiresAt: 1100 };
  const schedule = { ...f.controller.schedule };
  f.controller.observeRestInteraction = async () => {
    if (!observed) { observed = true; now = 1200; }
  };
  f.client.playback = async () => { now += 1000; return { status: 'ended' }; };
  assert.equal(await f.controller.restUntil(1500, 1), true);
  assert.deepEqual(f.plays().map(row => row.name), ['idle'], 'the original breathing interval continues, with no reminder playback');
  assert.equal(now, 2200, 'the discarded cue must not restart the 25–45 second quiet interval');
  assert.equal(f.controller.cue, null, 'the discarded cue is consumed once rather than queued for later');
  assert.equal(f.controller.previousAmbient, 'looking-around', 'discarding is not a completed gesture');
  assert.deepEqual(f.controller.lastAmbientEnded, { 'looking-around': 900 });
  assert.deepEqual(f.controller.schedule, schedule, 'an unplayed reminder cannot report a new autonomous action deadline');
});
