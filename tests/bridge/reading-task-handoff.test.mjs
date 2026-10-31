import test from 'node:test';
import assert from 'node:assert/strict';
import { PetController } from '../../src/bridge/controller.mjs';
import { PetClient } from '../../src/bridge/pet-client.mjs';

const tick = ms => new Promise(done => setTimeout(done, ms));
async function until(predicate) {
  const deadline = Date.now() + 1200;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'reading handoff did not settle'); await tick(3); }
}

function fixture(t, { outgoing = 'reading', outgoingStatus = 'playing', state = 'working', ageMs = 300 } = {}) {
  const calls = [], receipts = new Map([['outgoing', { status: outgoingStatus }]]), operations = [];
  let serial = 0, activeId = 'outgoing';
  const client = {
    lock: async id => { calls.push({ kind: 'lock', id }); return { lockId: id || 'same-owner' }; },
    release: async id => { calls.push({ kind: 'release', id }); },
    play: async (name, lockId) => {
      const playbackId = 'successor-' + ++serial;
      // The upstream host cancels the old receipt on acceptance, before the
      // native renderer has returned to neutral or committed the new F0.
      if (activeId) receipts.set(activeId, { status: 'cancelled', reason: 'superseded' });
      activeId = playbackId; receipts.set(playbackId, { status: 'accepted' });
      calls.push({ kind: 'play', name, lockId, playbackId }); return { playbackId };
    },
    playback: async (id, options) => { calls.push({ kind: 'receipt', id, options }); await tick(2); return { ...receipts.get(id) }; },
  };
  const controller = new PetController({ client, sleepImpl: () => tick(2) });
  controller.lockId = 'same-owner'; controller.renewAt = Infinity;
  controller.generation = 2; controller.status = { state, threadId: 'codex', turnId: 'latest' };
  controller.activePlayback = { playbackId: 'outgoing', name: outgoing, generation: 1, requestedAt: Date.now() - ageMs };
  const run = name => { const promise = controller.one(name, controller.generation); operations.push(promise); return promise; };
  t.after(async () => { controller.closed = true; controller.generation++; await Promise.allSettled(operations); await controller.release(); });
  return { controller, client, calls, receipts, run, plays: () => calls.filter(row => row.kind === 'play') };
}

test('entry and late reading can prepare a known task before old ended without treating acceptance as completion', async t => {
  for (const ageMs of [300, 8400]) {
    const f = fixture(t, { ageMs });
    let completed = false; const operation = f.run('running').then(value => { completed = true; return value; });
    await until(() => f.plays().length === 1 && f.controller.lastPlayback?.status === 'accepted');
    const id = f.plays()[0].playbackId;
    assert.equal(f.receipts.get('outgoing').status, 'cancelled');
    assert.equal(completed, false, 'old superseded receipt cannot stand in for native neutral/F0 commit');
    assert.deepEqual(f.controller.activePlayback.readingReturn, { playbackId: 'outgoing', generation: 1 });
    assert.equal(f.plays()[0].lockId, 'same-owner');
    assert.ok(!f.calls.some(row => row.kind === 'lock' || row.kind === 'release'));
    f.receipts.set(id, { status: 'playing' });
    await until(() => !f.controller.activePlayback.readingReturn);
    assert.equal(completed, false, 'real playing confirms the handoff, not the full task gesture');
    f.receipts.set(id, { status: 'ended' }); assert.equal(await operation, true);
    assert.equal(f.controller.activePlayback, null);
  }
});

test('only known automatic states and neutral-compatible task names can use early reading return', async t => {
  for (const [state, name] of [['idle', 'idle'], ['working', 'running'], ['working', 'review'], ['waiting', 'waiting'], ['complete', 'waving'], ['complete', 'jumping'], ['interrupted', 'failed']]) {
    const f = fixture(t, { state }); const operation = f.run(name);
    await until(() => f.plays().length === 1);
    f.receipts.set(f.plays()[0].playbackId, { status: 'ended' }); assert.equal(await operation, true);
  }
  for (const [state, name] of [['unknown', 'idle'], ['idle', 'reading'], ['working', 'running-classic'], ['working', 'running-right'], ['working', 'external-url']]) {
    const f = fixture(t, { state }); const operation = f.run(name);
    await tick(25); assert.equal(f.plays().length, 0, `${state}/${name} still requires actual ended`);
    f.receipts.set('outgoing', { status: 'ended' }); await until(() => f.plays().length === 1);
    assert.equal(f.controller.activePlayback.readingReturn, undefined);
    f.receipts.set(f.plays()[0].playbackId, { status: 'ended' }); assert.equal(await operation, true);
  }
});

test('latest task can redirect an actually accepted successor while it shares the reading return', async t => {
  const f = fixture(t); const first = f.run('running');
  await until(() => f.plays().length === 1 && f.controller.lastPlayback?.status === 'accepted');
  const firstId = f.plays()[0].playbackId;
  f.controller.generation++; f.controller.status = { ...f.controller.status, state: 'waiting' };
  assert.equal(await first, false);
  const latest = f.run('waiting'); await until(() => f.plays().length === 2);
  assert.deepEqual(f.plays().map(row => row.name), ['running', 'waiting']);
  assert.ok(f.calls.some(row => row.kind === 'receipt' && row.id === firstId), 'redirect rechecks the actual successor receipt');
  assert.deepEqual(f.controller.activePlayback.readingReturn, { playbackId: 'outgoing', generation: 1 });
  assert.equal(f.receipts.get(firstId).status, 'cancelled');
  const latestId = f.plays()[1].playbackId;
  f.receipts.set(latestId, { status: 'playing' }); await until(() => !f.controller.activePlayback.readingReturn);
  f.receipts.set(latestId, { status: 'ended' }); assert.equal(await latest, true);
  assert.equal(f.controller.preempted, false);
});

test('a successor already playing restores its ordinary complete-gesture boundary', async t => {
  const f = fixture(t); const first = f.run('running'); await until(() => f.plays().length === 1);
  const firstId = f.plays()[0].playbackId;
  f.receipts.set(firstId, { status: 'playing' }); await until(() => !f.controller.activePlayback.readingReturn);
  f.controller.generation++; f.controller.status = { ...f.controller.status, state: 'waiting' }; assert.equal(await first, false);
  const latest = f.run('waiting'); await tick(30); assert.equal(f.plays().length, 1);
  f.receipts.set(firstId, { status: 'ended' }); await until(() => f.plays().length === 2);
  assert.equal(f.controller.activePlayback.readingReturn, undefined);
  f.receipts.set(f.plays()[1].playbackId, { status: 'ended' }); assert.equal(await latest, true);
});

test('a playing receipt seen by the latest boundary clears stale accepted lineage before redirect', async t => {
  const f = fixture(t, { outgoing: 'running' });
  f.controller.activePlayback.readingReturn = { playbackId: 'old-reading', generation: 0 };
  const operation = f.run('waiting'); await tick(25); assert.equal(f.plays().length, 0);
  assert.equal(f.controller.activePlayback.readingReturn, undefined);
  f.receipts.set('outgoing', { status: 'ended' }); await until(() => f.plays().length === 1);
  f.receipts.set(f.plays()[0].playbackId, { status: 'ended' }); assert.equal(await operation, true);
});

test('other outgoing gestures still require a real ended receipt', async t => {
  for (const outgoing of ['idle', 'running', 'review', 'waiting', 'waving', 'running-right', 'stretching-wings']) {
    const f = fixture(t, { outgoing }); const operation = f.run('waiting');
    await tick(20); assert.equal(f.plays().length, 0, outgoing);
    f.receipts.set('outgoing', { status: 'ended' }); await until(() => f.plays().length === 1);
    f.receipts.set(f.plays()[0].playbackId, { status: 'ended' }); assert.equal(await operation, true);
  }
});

test('cancelled, failed or expired reading receipts never authorize a successor', async t => {
  for (const [outgoingStatus, expected] of [['cancelled', 'preempted'], ['failed', 'playback-failed'], ['accepted', 'playback-not-started']]) {
    const f = fixture(t, { outgoingStatus, ageMs: 6000 });
    await assert.rejects(f.run('running'), error => error.reason === expected);
    assert.equal(f.plays().length, 0);
  }
});

test('a new accepted task cancelled or failed during return cannot fabricate success', async t => {
  for (const [status, expected] of [['cancelled', 'preempted'], ['failed', 'playback-failed']]) {
    const f = fixture(t); const operation = f.run('running'); const rejected = assert.rejects(operation, error => error.reason === expected);
    await until(() => f.plays().length === 1);
    f.receipts.set(f.plays()[0].playbackId, { status, reason: status === 'cancelled' ? 'superseded' : 'decode-error' });
    await rejected; assert.equal(f.plays().length, 1);
  }
});

test('an accepted reading successor can finish a safe tail beyond five seconds without being restarted', async t => {
  const f = fixture(t); let now = Date.now(), polls = 0;
  f.controller.now = () => now;
  f.client.playback = async id => {
    if (id === 'outgoing') return { status: 'playing' };
    if (++polls === 1) { now += 6500; return { status: 'accepted' }; }
    return { status: polls === 2 ? 'playing' : 'ended' };
  };
  assert.equal(await f.run('waiting'), true);
  assert.equal(f.plays().length, 1, 'a late safe commit cannot be followed by a duplicate task gesture');
  assert.equal(f.controller.activePlayback, null);
});

test('a reading successor that never commits fails after a bounded grace without replaying the accepted command', async t => {
  const f = fixture(t); let now = Date.now();
  f.controller.now = () => now;
  f.client.playback = async id => { if (id === 'outgoing') return { status: 'playing' }; now += 12500; return { status: 'accepted' }; };
  await assert.rejects(f.run('waiting'), error => error.reason === 'playback-not-started');
  assert.equal(f.plays().length, 1);
  assert.equal(f.controller.lastPlayback.status, 'accepted', 'elapsed time is never turned into a success receipt');
});

test('latest accepted-lineage redirect uses the reading grace instead of the generic five-second timeout', async t => {
  const f = fixture(t, { outgoing: 'running', outgoingStatus: 'accepted', ageMs: 6500 });
  f.controller.activePlayback.readingReturn = { playbackId: 'old-reading', generation: 0 };
  const operation = f.run('waiting'); await until(() => f.plays().length === 1);
  f.receipts.set(f.plays()[0].playbackId, { status: 'ended' }); assert.equal(await operation, true);
});

test('pause, preemption, close and reload prevent early reading return', async t => {
  for (const flag of ['paused', 'preempted', 'closed', 'surfaceReloading']) {
    const f = fixture(t); f.controller[flag] = true;
    assert.equal(await f.run('running'), false); assert.equal(f.plays().length, 0, flag);
  }
  const f = fixture(t); f.client.playback = async () => { f.controller.preempted = true; return { status: 'playing' }; };
  assert.equal(await f.run('running'), false); assert.equal(f.plays().length, 0, 'takeover during receipt lookup');
});

test('an observed user interaction or lost/hidden lease prevents the queued task', async t => {
  const f = fixture(t);
  f.client.interaction = async () => ({ interaction: { id: 'manual-menu', kind: 'menu', phase: 'blocked', startedAt: Date.now(), updatedAt: Date.now(), endedAt: null, revision: 1, resumable: false } });
  await assert.rejects(f.run('running'), error => error.reason === 'preempted'); assert.equal(f.plays().length, 0);
  for (const reason of ['lock-lost', 'pet-hidden', 'pet-not-displayed']) {
    const lost = fixture(t); lost.controller.renewAt = 0;
    lost.client.lock = async () => { throw Object.assign(new Error(reason), { reason }); };
    await assert.rejects(lost.run('running'), error => error.reason === reason); assert.equal(lost.plays().length, 0);
  }
});

test('short receipt waits are scoped to reading and its accepted successor', async t => {
  const f = fixture(t); const operation = f.run('waiting');
  await until(() => f.controller.lastPlayback?.status === 'accepted');
  const id = f.plays()[0].playbackId;
  assert.ok(f.calls.filter(row => row.kind === 'receipt').every(row => row.options?.waitTimeoutMs === 150));
  f.receipts.set(id, { status: 'playing' }); await until(() => !f.controller.activePlayback.readingReturn);
  await until(() => f.calls.some(row => row.kind === 'receipt' && row.id === id && row.options === undefined));
  f.receipts.set(id, { status: 'ended' }); assert.equal(await operation, true);
});

test('PetClient keeps default receipt routing and adds only a bounded optional wait', async () => {
  const calls = [], client = new PetClient({ dshHome: 'unused' });
  client.request = async (route, options) => { calls.push({ route, options }); return { status: 'accepted' }; };
  await client.playback('owned/id'); await client.playback('owned/id', { waitTimeoutMs: 150 });
  assert.equal(calls[0].route, 'playback/owned%2Fid?wait=ended,failed,cancelled&timeout=1000');
  assert.equal(calls[1].route, 'playback/owned%2Fid?wait=ended,failed,cancelled&timeout=150');
  assert.deepEqual(calls[0].options, { timeoutMs: 4000, surface: false });
  for (const waitTimeoutMs of [-1, 1001, NaN, 1.5, '150']) assert.throws(() => client.playback('x', { waitTimeoutMs }), error => error.reason === 'invalid-playback-wait');
  assert.equal(calls.length, 2);
});
