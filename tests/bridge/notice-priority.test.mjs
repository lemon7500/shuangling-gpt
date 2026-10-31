import test from 'node:test';
import assert from 'node:assert/strict';
import { PetController } from '../../src/bridge/controller.mjs';
function fixture() {
  const calls = [];
  const controller = new PetController({ client: {
    appearance: async () => ({ display: 'desktop' }),
    interaction: async () => ({ interaction: null }),
    broadcast: async () => calls.push('bubble'),
  }, availableAnimations: ['stretching-wings'] });
  controller.status = { state: 'idle' }; controller.lockId = 'original-lease';
  controller.kick = () => {};
  return { controller, calls, send: () => controller.companionNotice('Focus ended', 'stretching-wings', { idleOnly: true, requireVisible: true }) };
}
for (const [name, change] of [
  ['manual takeover', c => { c.preempted = true; }], ['pause', c => { c.paused = true; }],
  ['reload', c => { c.surfaceReloading = true; }], ['lost lease', c => { c.lockId = null; }],
  ['replaced lease', c => { c.lockId = 'different-lease'; }], ['closed', c => { c.closed = true; }],
  ['new task', c => c.update({ state: 'working', threadId: 'codex', turnId: 'new' })],
  ['new idle generation', c => { c.update({ state: 'working', turnId: 'new' }); c.update({ state: 'idle', turnId: 'new' }); }],
]) test(`in-flight notice cannot queue a gesture after ${name}`, async () => {
  const f = fixture();
  f.controller.client.broadcast = async () => { f.calls.push('bubble'); change(f.controller); };
  assert.equal(await f.send(), false); assert.equal(f.controller.cue, null); assert.deepEqual(f.calls, ['bubble']);
});
test('hidden before dispatch or hidden while acknowledging cannot queue a later gesture', async () => {
  const f = fixture(); f.controller.client.appearance = async () => ({ display: 'none' });
  assert.equal(await f.send(), false); assert.deepEqual(f.calls, []); assert.equal(f.controller.cue, null);
  let display = 'desktop'; f.controller.client.appearance = async () => ({ display });
  f.controller.client.broadcast = async () => { f.calls.push('bubble'); display = 'none'; };
  assert.equal(await f.send(), false); assert.deepEqual(f.calls, ['bubble']); assert.equal(f.controller.cue, null);
});
test('unknown visibility and a work transition during visibility sampling fail closed', async () => {
  const f = fixture(); f.controller.client.appearance = async () => { throw Error('offline'); };
  assert.equal(await f.send(), false); assert.deepEqual(f.calls, []);
  f.controller.client.appearance = async () => { f.controller.update({ state: 'working', turnId: 'new' }); return { display: 'desktop' }; };
  assert.equal(await f.send(), false); assert.deepEqual(f.calls, []); assert.equal(f.controller.cue, null);
});
test('an idle visible notice uses its retained lease without playing or showing a window directly', async () => {
  const f = fixture();
  f.controller.client.play = async () => assert.fail('notice must use normal scheduling');
  f.controller.client.lock = async () => assert.fail('notice must not acquire control');
  assert.equal(await f.send(), true); assert.deepEqual(f.calls, ['bubble']);
  assert.equal(f.controller.lockId, 'original-lease'); assert.equal(f.controller.cue.name, 'stretching-wings');
});

test('focus cue yields to active ambient gestures, existing cues, repetition and wing cooldown', async () => {
  for (const change of [c => { c.activePlayback = { name: 'reading' }; }, c => { c.activePlayback = { name: 'stretching-wings' }; },
    c => { c.previousAmbient = 'stretching-wings'; }, c => { c.lastAmbientEnded['stretching-wings'] = 199999; }]) {
    const f = fixture(); f.controller.now = () => 200000; change(f.controller);
    assert.equal(await f.controller.companionNotice('Focus ended', 'stretching-wings', { idleOnly: true, requireVisible: true, cuePolicy: 'focus' }), true);
    assert.deepEqual(f.calls, ['bubble']); assert.equal(f.controller.cue, null, 'optional gesture is dropped, not deferred');
  }
  const f = fixture(), existing = { name: 'reading', generation: 0, expiresAt: Infinity };
  f.controller.cue = existing;
  await f.controller.companionNotice('Focus ended', 'stretching-wings', { idleOnly: true, cuePolicy: 'focus' });
  assert.equal(f.controller.cue, existing, 'completion cannot overwrite a user-requested journal cue');
});
test('focus cue becomes eligible at exact cooldown and uses normal gesture scheduling', async () => {
  const f = fixture(); f.controller.now = () => 200000; f.controller.lastAmbientEnded['stretching-wings'] = 80000;
  f.controller.previousAmbient = 'looking-around';
  assert.equal(await f.controller.companionNotice('Focus ended', 'stretching-wings', { idleOnly: true, cuePolicy: 'focus' }), true);
  assert.equal(f.controller.cue.source, 'focus');
  const calls = []; let now = 200000; f.controller.now = () => now; f.controller.random = () => 0;
  f.controller.one = async (name, generation, options) => { calls.push({ name, options }); now += name === 'idle' ? 1000 : 4500; return true; };
  await f.controller.restUntil(now + 500, 0);
  assert.equal(calls[0].name, 'stretching-wings'); assert.equal(calls[0].options.optionalCue, true);
  assert.equal(f.controller.lastAmbientEnded['stretching-wings'], 204500);
  assert.ok(now >= 229500, 'the next ambient gesture receives a full new quiet interval');
});
test('focus cue is rechecked at playback and cannot repeat a recently completed wing gesture', async () => {
  const f = fixture(); let now = 200000; f.controller.now = () => now;
  f.controller.cue = { name: 'stretching-wings', source: 'focus', generation: 0, expiresAt: now + 6000 };
  f.controller.lastAmbientEnded['stretching-wings'] = now - 1;
  const played = []; f.controller.one = async name => { played.push(name); now += 1000; return true; };
  await f.controller.restUntil(now + 500, 0);
  assert.deepEqual(played, ['idle']); assert.equal(f.controller.cue, null);
});
