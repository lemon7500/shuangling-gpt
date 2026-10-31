import test from 'node:test';
import assert from 'node:assert/strict';
import { PetController } from '../../src/bridge/controller.mjs';

function fixture() {
  const calls = [];
  const controller = new PetController({ client: {
    interaction: async () => ({ interaction: null }),
    broadcast: async (...args) => calls.push(args),
  }, availableAnimations: ['reading', 'stretching-wings'] });
  controller.status = { state: 'idle' };
  controller.lockId = 'existing-lease';
  return { controller, calls };
}

test('local notices retain the existing lease and only offer accepted ambient media while idle', async () => {
  const { controller, calls } = fixture();
  assert.equal(await controller.companionNotice('A focus session has ended.', 'stretching-wings'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'existing-lease');
  assert.equal(controller.cue.name, 'stretching-wings');
  controller.cue = null;
  controller.status = { state: 'working' };
  await controller.companionNotice('A focus session has ended.', 'stretching-wings');
  assert.equal(controller.cue, null, 'a timer cannot replace an actual work animation');
  controller.status = { state: 'idle' };
  await controller.companionNotice(null, 'missing-media');
  assert.equal(controller.cue, null);
});

test('journal reading queues only during idle with its existing lease and never requests control or playback directly', async () => {
  for (const state of ['working', 'waiting', 'unknown', 'complete', 'interrupted']) {
    const { controller, calls } = fixture();
    controller.status = { state };
    controller.client.lock = async () => assert.fail('a journal notice must never acquire control');
    controller.client.play = async () => assert.fail('a journal notice must not bypass the playback boundary');
    assert.equal(await controller.companionNotice(null, 'reading', { idleOnly: true }), false, state);
    assert.equal(controller.cue, null); assert.deepEqual(calls, []);
    assert.equal(controller.status.state, state);
  }
  const { controller, calls } = fixture();
  controller.client.lock = async () => assert.fail('the existing lease must be retained');
  controller.client.play = async () => assert.fail('reading should be queued for a safe playback boundary');
  assert.equal(await controller.companionNotice(null, 'reading', { idleOnly: true }), true);
  assert.equal(controller.lockId, 'existing-lease'); assert.equal(controller.cue.name, 'reading');
  assert.equal(controller.lastAmbientEnded.reading, undefined);
  assert.deepEqual(calls, []);
});

test('pause, manual ownership, missing lease and surface reload discard notices without any request', async () => {
  for (const values of [{ paused: true }, { preempted: true }, { lockId: null }, { surfaceReloading: true }, { closed: true }]) {
    const { controller, calls } = fixture();
    Object.assign(controller, values);
    assert.equal(await controller.companionNotice(null, 'reading', { idleOnly: true }), false);
    assert.deepEqual(calls, []);
    assert.equal(controller.cue, null);
  }
});

test('a native takeover between timer completion and dispatch suppresses both bubble and action', async () => {
  const { controller, calls } = fixture();
  controller.client.interaction = async () => ({ interaction: { id: 'user', phase: 'blocked', kind: 'menu', startedAt: 1000, updatedAt: 1000, endedAt: null, revision: 1, resumable: false } });
  assert.equal(await controller.companionNotice('Finished', 'reading'), false);
  assert.equal(calls.length, 0);
  assert.equal(controller.cue, null);
});

test('hidden surfaces and native pointer, drag and throw ownership reject a journal reading cue', async () => {
  for (const phase of ['pointer', 'dragging', 'throwing']) {
    const { controller, calls } = fixture();
    controller.client.interaction = async () => ({ interaction: { id: `native-${phase}`, phase, kind: 'drag',
      startedAt: 1000, updatedAt: 1000, endedAt: null, revision: 1, resumable: false } });
    assert.equal(await controller.companionNotice(null, 'reading', { idleOnly: true }), false, phase);
    assert.equal(controller.cue, null); assert.deepEqual(calls, []);
  }
  const { controller, calls } = fixture();
  controller.client.interaction = async () => { throw Object.assign(new Error('pet-hidden'), { reason: 'pet-hidden' }); };
  assert.equal(await controller.companionNotice(null, 'reading', { idleOnly: true }), false);
  assert.equal(controller.cue, null); assert.deepEqual(calls, []);
  assert.equal(controller.lockId, 'existing-lease', 'a rejected notice neither acquires nor modifies the host lease');
});

test('idle-only journal reading rechecks work and surface state after the native interaction probe', async () => {
  for (const change of [c => { c.status.state = 'working'; }, c => { c.status.state = 'waiting'; },
    c => { c.paused = true; }, c => { c.preempted = true; }, c => { c.lockId = null; }, c => { c.surfaceReloading = true; }]) {
    const { controller, calls } = fixture();
    controller.observeRestInteraction = async () => change(controller);
    assert.equal(await controller.companionNotice(null, 'reading', { idleOnly: true }), false);
    assert.deepEqual(calls, []);
  }
});

test('new task events and ambient preference edits cannot clear existing user ownership', () => {
  const { controller } = fixture();
  controller.preempted = true;
  controller.kick = () => {};
  controller.update({ state: 'working', threadId: 'codex', turnId: 'new-turn' });
  controller.setAmbientPreferences({ ambientEnabled: false, ambientFrequency: 'quiet' });
  assert.equal(controller.preempted, true);
  assert.equal(controller.ambient.enabled, false);
  assert.equal(controller.ambient.frequency, 'quiet');
});

test('a played local cue receives a fresh quiet interval measured from its real end', async () => {
  const { controller } = fixture();
  let now = 1000;
  controller.now = () => now;
  controller.random = () => 0;
  controller.cue = { name: 'stretching-wings', generation: 0, expiresAt: now + 6000 };
  const played = [];
  controller.one = async name => { played.push(name); now += 5000; return true; };
  await controller.restUntil(1500, 0);
  assert.equal(played[0], 'stretching-wings');
  assert.equal(controller.lastAmbientEnded['stretching-wings'], 6000);
  assert.ok(now >= 31000, 'the next autonomous action cannot follow a notice cue after only one idle clip');
});

test('a queued local cue is discarded when a native interaction takes over before playback', async () => {
  const { controller } = fixture();
  controller.cue = { name: 'stretching-wings', generation: 0, expiresAt: Date.now() + 6000 };
  controller.lease = async () => {};
  controller.one = async () => { throw Object.assign(new Error('interaction-active'), { reason: 'interaction-active' }); };
  controller.waitForHandoff = async () => {
    assert.equal(controller.cue, null, 'a short drag must not replay an earlier queued cue after release');
    controller.closed = true;
    return false;
  };
  await controller.run();
});
