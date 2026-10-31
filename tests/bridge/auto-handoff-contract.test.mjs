import test from 'node:test';
import assert from 'node:assert/strict';
import { PetController } from '../../src/bridge/controller.mjs';

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
const epoch = 1793000000000;
const status = (state, turnId = 'one-turn', extra = {}) => ({ state, threadId: 'codex', turnId, updatedAt: new Date().toISOString(), ...extra });
async function until(predicate, timeout = 1200) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'automatic handoff did not settle'); await tick(5); }
}
function heldFixture() {
  const events = [], records = new Map(); let serial = 0;
  const client = {
    lock: async id => { events.push({ kind: 'lock', id: id || null }); return { lockId: id || 'automatic-owner' }; },
    release: async id => { events.push({ kind: 'release', id }); },
    broadcast: async () => ({}),
    play: async name => { const playbackId = 'automatic-' + ++serial; events.push({ kind: 'play', name, playbackId }); records.set(playbackId, 'playing'); return { playbackId }; },
    playback: async playbackId => { await tick(5); return { status: records.get(playbackId) }; },
  };
  const controller = new PetController({ client });
  return { controller, client, events, records, plays: () => events.filter(row => row.kind === 'play') };
}

test('automatic status changes retain the real outgoing receipt and lease until its ended boundary', async t => {
  const f = heldFixture(); t.after(() => f.controller.close());
  f.controller.update(status('working')); await until(() => f.plays().length === 1);
  const outgoing = f.plays()[0]; f.controller.update(status('waiting'));
  await tick(100);
  assert.deepEqual(f.plays().map(row => row.name), ['running']);
  assert.equal(f.controller.status.state, 'waiting', 'status changes are visible while the old gesture finishes');
  assert.equal(f.controller.activePlayback.playbackId, outgoing.playbackId);
  assert.ok(!f.events.some(row => row.kind === 'release'), 'a task update must not thaw and refreeze the renderer');
  f.records.set(outgoing.playbackId, 'ended'); await until(() => f.plays().length === 2);
  assert.equal(f.plays()[1].name, 'waiting');
  assert.equal(f.events.filter(row => row.kind === 'lock' && row.id === null).length, 1);
  assert.ok(!f.events.some(row => row.kind === 'release'));
});

test('same state and turn metadata refreshes never restart the current automatic gesture', async t => {
  const f = heldFixture(); t.after(() => f.controller.close());
  f.controller.update(status('working')); await until(() => f.plays().length === 1);
  const generation = f.controller.generation;
  for (let i = 0; i < 12; i++) f.controller.update(status('working', 'one-turn', { updatedAt: new Date(Date.now() + i).toISOString(), workingCount: i + 1 }));
  await tick(100);
  assert.equal(f.controller.generation, generation);
  assert.deepEqual(f.plays().map(row => row.name), ['running']);
  assert.ok(!f.events.some(row => row.kind === 'release'));
});

test('rapid automatic updates coalesce to the latest task state without intermediate poses', async t => {
  const f = heldFixture(); t.after(() => f.controller.close());
  f.controller.update(status('working')); await until(() => f.plays().length === 1);
  const outgoing = f.plays()[0];
  for (const [state, turn] of [['waiting', 'one-turn'], ['idle', 'one-turn'], ['waiting', 'second-turn'], ['working', 'third-turn']]) {
    f.controller.update(status(state, turn)); await tick(20);
  }
  assert.equal(f.plays().length, 1);
  f.records.set(outgoing.playbackId, 'ended'); await until(() => f.plays().length === 2);
  assert.deepEqual(f.plays().map(row => row.name), ['running', 'running']);
  assert.equal(f.controller.status.turnId, 'third-turn');
  assert.ok(!f.events.some(row => row.kind === 'release'));
});

function virtualOne({ replies, options = {}, lock } = {}) {
  let time = epoch, serial = 0, index = 0;
  const calls = [], controller = new PetController({
    client: {
      lock: async id => { calls.push(['lock', id || null]); return lock ? lock(id) : { lockId: id || 'automatic-owner' }; },
      release: async id => { calls.push(['release', id]); },
      play: async name => { const playbackId = 'receipt-' + ++serial; calls.push(['play', name, playbackId, time - epoch]); return { playbackId }; },
      playback: async id => { const reply = replies[Math.min(index++, replies.length - 1)]; time += reply.advanceMs || 0; calls.push(['receipt', id, reply.status, time - epoch]); return { status: reply.status }; },
    }, now: () => time, sleepImpl: async ms => { time += ms; }, ...options,
  });
  controller.generation = 1;
  return { controller, calls, elapsed: () => time - epoch };
}

test('the default bounded start grace permits a genuine natural return longer than 2.5 seconds', async t => {
  const f = virtualOne({ replies: [{ status: 'accepted', advanceMs: 1800 }, { status: 'accepted', advanceMs: 1800 }, { status: 'playing', advanceMs: 100 }, { status: 'ended', advanceMs: 500 }] });
  t.after(() => f.controller.close());
  assert.equal(await f.controller.one('waiting', 1), true);
  assert.equal(f.calls.filter(row => row[0] === 'play').length, 1, 'a prepared return must not be replaced merely because 2.5 seconds elapsed');
  assert.ok(f.elapsed() > 3600 && f.elapsed() < 5000);
  assert.equal(f.controller.lastPlayback.status, 'ended');
  assert.equal(f.controller.activePlayback, null);
  assert.ok(!f.calls.some(row => row[0] === 'release'));
});

test('an explicitly configured start timeout retains bounded retries and never fabricates playback', async t => {
  const f = virtualOne({ replies: [{ status: 'accepted', advanceMs: 300 }], options: { startTimeoutMs: 400, maxStartRetries: 2 } });
  t.after(() => f.controller.close());
  await assert.rejects(f.controller.one('running', 1), error => error.reason === 'playback-not-started');
  assert.equal(f.calls.filter(row => row[0] === 'play').length, 3);
  assert.equal(f.controller.lastPlayback.status, 'accepted');
  assert.equal(f.calls.filter(row => row[0] === 'lock' && row[1] === null).length, 1);
  assert.equal(f.calls.filter(row => row[0] === 'lock' && row[1] === 'automatic-owner').length, 2, 'retries renew the same lease');
  assert.ok(f.elapsed() < 3000, 'an explicit short timeout is not silently widened');
});

test('the default natural-return grace still rejects a decoder that never actually starts', async t => {
  const f = virtualOne({ replies: [{ status: 'accepted', advanceMs: 1000 }], options: { maxStartRetries: 0 } });
  t.after(() => f.controller.close());
  await assert.rejects(f.controller.one('waiting', 1), error => error.reason === 'playback-not-started');
  assert.equal(f.calls.filter(row => row[0] === 'play').length, 1);
  assert.equal(f.controller.lastPlayback.status, 'accepted');
  assert.ok(f.elapsed() >= 5000 && f.elapsed() < 6500, 'default grace is finite and has not reverted to the old 2.5 second cutoff');
});

test('a lost lease at the retry edge cannot turn into a fresh acquisition or another automatic clip', async t => {
  const f = virtualOne({ replies: [{ status: 'accepted', advanceMs: 6000 }], options: { maxStartRetries: 1 }, lock: id => {
    if (id) throw Object.assign(new Error('lock-lost'), { reason: 'lock-lost' });
    return { lockId: 'automatic-owner' };
  } });
  t.after(() => f.controller.close());
  await assert.rejects(f.controller.one('running', 1), error => error.reason === 'lock-lost');
  assert.equal(f.calls.filter(row => row[0] === 'play').length, 1);
  assert.deepEqual(f.calls.filter(row => row[0] === 'lock').map(row => row[1]), [null, 'automatic-owner']);
});

test('user cancellation at an automatic boundary yields control instead of playing the queued state', async t => {
  const f = heldFixture(); t.after(() => f.controller.close());
  f.controller.update(status('working')); await until(() => f.plays().length === 1);
  f.controller.update(status('waiting')); await tick(30);
  f.records.set(f.plays()[0].playbackId, 'cancelled');
  await until(() => f.controller.preempted && f.events.some(row => row.kind === 'release'));
  assert.deepEqual(f.plays().map(row => row.name), ['running']);
  assert.equal(f.controller.issue, 'preempted');
  f.controller.update(status('idle')); await tick(80);
  assert.equal(f.plays().length, 1, 'new task status alone cannot revoke manual ownership');
});

test('working thought, idle breathing and automatic review remain separate complete receipts under one lease', async t => {
  let time = epoch, controller, serial = 0;
  const plays = [], events = [], records = new Map();
  const client = {
    lock: async id => { events.push(['lock', id || null]); return { lockId: id || 'automatic-owner' }; },
    release: async () => { events.push(['release']); },
    broadcast: async () => ({}),
    play: async name => { const playbackId = 'schedule-' + ++serial; const row = { name, playbackId, startedAt: time, endedAt: null }; plays.push(row); records.set(playbackId, row); return { playbackId }; },
    playback: async playbackId => {
      const row = records.get(playbackId); time += 4000; row.endedAt = time;
      if (row.name === 'review') controller.setPaused(true);
      return { status: 'ended' };
    },
  };
  controller = new PetController({ client, now: () => time, sleepImpl: async ms => { time += ms; }, random: () => 0 });
  t.after(() => controller.close());
  controller.update(status('working'));
  await until(() => controller.paused && events.some(row => row[0] === 'release'));
  assert.equal(plays[0].name, 'running'); assert.equal(plays.at(-1).name, 'review');
  assert.ok(plays.slice(1, -1).length > 0 && plays.slice(1, -1).every(row => row.name === 'idle'));
  for (let i = 1; i < plays.length; i++) assert.equal(plays[i].startedAt, plays[i - 1].endedAt, 'next actual receipt begins only after the previous real ended event');
  assert.equal(events.filter(row => row[0] === 'lock' && row[1] === null).length, 1);
});
