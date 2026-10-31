import test from 'node:test';
import assert from 'node:assert/strict';
import { PetController } from '../../src/bridge/controller.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 1000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'controller transition timed out');
    await delay(5);
  }
}
const status = (state, turnId = 'turn-1') => ({ state, threadId: 'codex', turnId, updatedAt: new Date().toISOString() });
function fixture() {
  const plays = [], ended = new Set();
  let releases = 0;
  const client = {
    lock: async id => ({ lockId: id || 'continuity-owner' }),
    release: async () => { releases++; },
    broadcast: async () => ({}),
    play: async name => { const playbackId = 'clip-' + (plays.length + 1); plays.push({ name, playbackId }); return { playbackId }; },
    playback: async playbackId => ({ status: ended.has(playbackId) ? 'ended' : 'playing' }),
  };
  return { client, plays, ended, get releases() { return releases; } };
}

test('task changes keep a moving gesture until its real ended boundary', async t => {
  const f = fixture(), controller = new PetController({ client: f.client });
  t.after(() => controller.close());
  controller.update(status('working'));
  await until(() => f.plays.length === 1);
  controller.update(status('waiting'));
  await delay(150);
  assert.deepEqual(f.plays.map(row => row.name), ['running'], 'task status must not cut the previous pose mid-gesture');
  assert.equal(controller.status.state, 'waiting', 'status information updates without waiting for the visual boundary');
  f.ended.add(f.plays[0].playbackId);
  await until(() => f.plays.length === 2);
  assert.equal(f.plays[1].name, 'waiting');
});

test('rapid task updates choose the latest state at the same visual boundary', async t => {
  const f = fixture(), controller = new PetController({ client: f.client });
  t.after(() => controller.close());
  controller.update(status('working'));
  await until(() => f.plays.length === 1);
  controller.update(status('waiting'));
  await delay(80);
  controller.update(status('complete'));
  await delay(80);
  controller.update(status('working', 'turn-2'));
  await delay(80);
  assert.equal(f.plays.length, 1, 'obsolete task states must not create interrupted clips');
  f.ended.add(f.plays[0].playbackId);
  await until(() => f.plays.length === 2);
  assert.equal(f.plays[1].name, 'running');
  assert.equal(controller.status.turnId, 'turn-2');
});

test('explicit pause does not wait for a task transition boundary', async t => {
  const f = fixture(), controller = new PetController({ client: f.client });
  t.after(() => controller.close());
  controller.update(status('working'));
  await until(() => f.plays.length === 1);
  controller.update(status('waiting'));
  controller.setPaused(true);
  await until(() => f.releases > 0);
  assert.equal(controller.paused, true);
  assert.equal(f.plays.length, 1);
});

test('a cancelled native gesture yields user control instead of starting the queued task', async t => {
  const f = fixture(), controller = new PetController({ client: f.client });
  t.after(() => controller.close());
  let cancelled = false;
  f.client.playback = async () => ({ status: cancelled ? 'cancelled' : 'playing' });
  controller.update(status('working'));
  await until(() => f.plays.length === 1);
  controller.update(status('waiting'));
  await delay(80);
  cancelled = true;
  await until(() => controller.preempted);
  assert.equal(f.plays.length, 1);
  assert.equal(controller.issue, 'preempted');
  assert.ok(f.releases > 0);
});

test('dragging takes priority while an older task gesture is finishing', async t => {
  const f = fixture(), controller = new PetController({ client: f.client, interactionPollMs: 5 });
  t.after(() => controller.close());
  let interaction = null;
  f.client.interaction = async () => ({ interaction });
  controller.update(status('working'));
  await until(() => f.plays.length === 1);
  controller.update(status('waiting'));
  await delay(80);
  const now = Date.now();
  interaction = { id: 'real-drag', phase: 'dragging', kind: 'drag', revision: 1, startedAt: now, updatedAt: now, endedAt: null, resumable: false };
  await until(() => controller.preempted);
  assert.equal(f.plays.length, 1);
  assert.ok(f.releases > 0);
});

test('a local update can retain manual takeover before the first task is observed', async t => {
  const f = fixture(), controller = new PetController({ client: f.client, initialPreempted: true });
  t.after(() => controller.close());
  controller.update(status('working'));
  await delay(100);
  assert.equal(controller.snapshot().preempted, true);
  assert.equal(controller.snapshot().paused, false, 'takeover is distinct from the saved pause preference');
  assert.equal(f.plays.length, 0, 'startup must not take a lease before restoring user priority');
  controller.update(status('waiting'));
  await delay(80);
  assert.equal(f.plays.length, 0);
  controller.setPaused(false); // The existing explicit resume operation.
  await until(() => f.plays.length === 1);
  assert.equal(f.plays[0].name, 'waiting');
  assert.equal(controller.snapshot().preempted, false);
});

test('saved pause can be installed before startup without briefly playing an action', async t => {
  const f = fixture(), controller = new PetController({ client: f.client, initialPaused: true });
  t.after(() => controller.close());
  controller.update(status('working'));
  await delay(100);
  assert.equal(controller.snapshot().paused, true);
  assert.equal(f.plays.length, 0);
});
