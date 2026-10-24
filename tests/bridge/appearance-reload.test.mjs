import test from 'node:test';
import assert from 'node:assert/strict';
import { PetController } from '../../src/bridge/controller.mjs';
import { PetClient } from '../../src/bridge/pet-client.mjs';

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 1000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) assert.fail('timed out'); await tick(5); }
}
const state = value => ({ state: value, threadId: 'root', turnId: 'one-turn', updatedAt: new Date().toISOString() });
const initial = (id, startedAt = Date.now()) => ({ id, phase: 'settled', kind: 'click', startedAt, updatedAt: startedAt, endedAt: startedAt, revision: 0, resumable: false });
function fixture({ ended = false, surfaceReadyTimeoutMs = 100, now } = {}) {
  const calls = [];
  let interaction = initial('old-renderer-0', Date.now() - 1000);
  let nextInteraction = null;
  const client = {
    interaction: async () => ({ interaction: nextInteraction ? nextInteraction() : interaction }),
    lock: async id => { calls.push(['lock', id]); return { lockId: id || 'lease' }; },
    release: async () => { calls.push(['release']); return { ok: true }; },
    play: async name => { const id = `p${calls.filter(c => c[0] === 'play').length + 1}`; calls.push(['play', name, id]); return { playbackId: id }; },
    playback: async () => { await tick(5); return { status: ended ? 'ended' : 'playing', updatedAt: Date.now() }; },
    broadcast: async () => ({ ok: true }),
  };
  const controller = new PetController({ client, surfaceReadyTimeoutMs, interactionPollMs: 5, interactionProbeMs: 20, now });
  return { controller, client, calls, setEnded: value => { ended = value; }, setInteraction: value => { interaction = value; }, setInteractionSource: value => { nextInteraction = value; }, plays: () => calls.filter(c => c[0] === 'play') };
}

test('appearance invalidates an old playing generation and waits for a real new renderer pose', async t => {
  const f = fixture(); t.after(() => f.controller.close());
  f.controller.update(state('working'));
  await until(() => f.controller.lastPlayback?.status === 'playing');
  let applied = false;
  const changing = f.controller.withSurfaceReload(async () => { applied = true; return { display: 'desktop' }; });
  await until(() => applied);
  assert.equal(f.controller.surfaceReloading, true);
  assert.ok(f.calls.some(c => c[0] === 'release'));
  // A newly polled timestamp on the same old pose is still not a new helper.
  f.setInteraction({ ...initial('old-renderer-0', Date.now() - 1000), updatedAt: Date.now() + 10000 });
  await tick(25);
  assert.equal(f.plays().length, 1);
  f.setInteraction(initial('new-renderer-0'));
  await changing;
  await until(() => f.plays().length === 2);
  assert.deepEqual(f.plays().map(p => p[1]), ['running', 'running']);
  assert.equal(f.controller.preempted, false);
  assert.equal(f.controller.issue, null);
  assert.equal(f.controller.lastPlayback.status, 'playing', 'no fabricated ended is needed to replace the dead helper');
});

test('manual interaction during reload, including between ready probe and lease, keeps priority', async t => {
  for (const race of ['during', 'before-lock', 'after-lock']) {
    const f = fixture(); t.after(() => f.controller.close());
    f.controller.update(state('working'));
    await until(() => f.controller.lastPlayback?.status === 'playing');
    let applied = false;
    const changing = f.controller.withSurfaceReload(async () => { applied = true; return { display: 'desktop' }; });
    await until(() => applied);
    const fresh = initial(`new-${race}-0`);
    const manual = { ...initial(`manual-${race}`), startedAt: fresh.startedAt + 1, endedAt: fresh.startedAt + 2, revision: 2, kind: 'menu' };
    let reads = 0;
    if (race !== 'during') f.setInteractionSource(() => ++reads <= (race === 'before-lock' ? 1 : 2) ? fresh : manual);
    else f.setInteraction(manual);
    await changing;
    await until(() => f.controller.preempted);
    await tick(25);
    assert.equal(f.plays().length, 1, 'appearance cannot recover through a settled non-resumable manual receipt');
  }
});

test('an accepted initial pose shares a lease timestamp safely, while a new click in that millisecond wins', async t => {
  const stamp = Date.now();
  let clock = stamp;
  const f = fixture({ ended: true, now: () => clock }); t.after(() => f.controller.close());
  f.setInteraction(initial('accepted-initial-0', stamp));
  f.controller.update(state('idle'));
  await until(() => f.controller.schedule.phase === 'rest');
  assert.equal(f.controller.preempted, false);
  const count = f.plays().length;
  f.setInteraction({ ...initial('manual-same-millisecond', stamp), revision: 2 });
  clock += 10;
  await until(() => f.controller.preempted);
  await tick(25);
  assert.equal(f.plays().length, count);
  assert.equal(f.controller.issue, 'preempted');
});

test('switching root chats does not replay an already consumed terminal turn', async t => {
  const f = fixture({ ended: true }); t.after(() => f.controller.close());
  f.controller.update(state('complete'));
  await until(() => f.controller.schedule.phase === 'rest');
  const firstCount = f.plays().length;
  f.controller.update({ ...state('complete'), threadId: 'second-root' });
  await until(() => f.plays().length > firstCount && f.controller.schedule.phase === 'rest');
  const secondCount = f.plays().length;
  f.controller.update(state('complete'));
  await until(() => f.plays().length > secondCount && f.controller.schedule.phase === 'rest');
  assert.equal(f.plays().filter(p => p[1] === 'waving').length, 2, 'one celebration for each distinct root chat/turn');
  assert.equal(f.plays().at(-1)[1], 'idle');
});

test('appearance preserves prior pause/preemption and a pause requested during reload', async t => {
  for (const mode of ['paused', 'preempted', 'pause-during']) {
    const f = fixture(); t.after(() => f.controller.close());
    if (mode === 'paused') f.controller.setPaused(true);
    f.controller.update(state('working'));
    if (mode !== 'paused') await until(() => f.controller.lastPlayback?.status === 'playing');
    if (mode === 'preempted') { f.controller.preempted = true; f.controller.issue = 'preempted'; }
    let applied = false;
    const count = f.plays().length;
    const changing = f.controller.withSurfaceReload(async () => { applied = true; return { display: 'desktop' }; });
    await until(() => applied);
    if (mode === 'pause-during') f.controller.setPaused(true);
    if (mode === 'preempted') f.controller.update({ ...state('waiting'), turnId: 'arrived-during-reload' });
    f.setInteraction(initial(`fresh-${mode}-0`));
    await changing;
    await tick(25);
    assert.equal(f.plays().length, count);
    if (mode === 'preempted') assert.equal(f.controller.preempted, true);
    else assert.equal(f.controller.paused, true);
  }
});

test('unchanged appearance and invalid input never enter the reload barrier or write config', async () => {
  const current = { id: 'shuangling', size: 396, display: 'desktop', position: { corner: 'bottom-right', marginX: 20, marginY: 12 } };
  const client = new PetClient({ dshHome: 'unused' });
  const requests = [];
  client.request = async (route, options) => { requests.push({ route, method: options?.method }); return { main: { pets: [current] } }; };
  let reloads = 0;
  const hook = { apply: operation => { reloads++; return operation(); } };
  const result = await client.updateAppearance({ size: 396, ...current.position }, hook);
  assert.deepEqual(result, { size: current.size, display: current.display, position: current.position });
  await assert.rejects(client.updateAppearance({ size: 0, ...current.position }, hook), error => error.reason === 'invalid-appearance');
  assert.equal(reloads, 0);
  assert.deepEqual(requests, [{ route: 'config', method: undefined }]);
});

test('a rejected configuration write resumes the unchanged task without claiming a new pose', async t => {
  const f = fixture(); t.after(() => f.controller.close());
  f.controller.update(state('working'));
  await until(() => f.controller.lastPlayback?.status === 'playing');
  await assert.rejects(f.controller.withSurfaceReload(async () => { throw Object.assign(new Error('conflict'), { reason: 'config-conflict' }); }), error => error.reason === 'config-conflict');
  await until(() => f.plays().length === 2);
  assert.equal(f.controller.status.state, 'working');
  assert.equal(f.controller.preempted, false);
  assert.equal(f.controller.paused, false);
});

test('hidden or missing fresh renderer never resumes from an old playing receipt', async t => {
  for (const hidden of [true, false]) {
    const f = fixture({ surfaceReadyTimeoutMs: 35 }); t.after(() => f.controller.close());
    f.controller.update(state('working'));
    await until(() => f.controller.lastPlayback?.status === 'playing');
    await f.controller.withSurfaceReload(async () => ({ display: hidden ? 'none' : 'desktop' }));
    await until(() => f.controller.preempted);
    assert.equal(f.controller.issue, hidden ? 'pet-not-displayed' : 'surface-not-ready');
    assert.equal(f.plays().length, 1);
    assert.equal(f.controller.lastPlayback.status, 'playing');
    assert.ok(!f.calls.some(c => ['show', 'display', 'launch'].includes(c[0])));
  }
});

test('fresh completion or interruption is consumed once across appearance reload', async t => {
  for (const [terminal, ended] of [['complete', true], ['interrupted', true], ['complete', false], ['interrupted', false]]) {
    const f = fixture({ ended }); t.after(() => f.controller.close());
    f.controller.update(state(terminal));
    await until(() => ended ? f.controller.schedule.phase === 'rest' : f.controller.lastPlayback?.status === 'playing');
    const before = f.plays().map(p => p[1]);
    await f.controller.withSurfaceReload(async () => { f.setEnded(true); f.setInteraction(initial(`fresh-${terminal}-${ended}-0`)); return { display: 'desktop' }; });
    await until(() => f.plays().length > before.length && f.controller.schedule.phase === 'rest');
    const names = f.plays().map(p => p[1]);
    assert.deepEqual(names.slice(0, before.length), before);
    assert.ok(names.length > before.length && names.slice(before.length).every(name => name === 'idle'), 'reload resumes breathing only, including any further quiet clips');
    assert.equal(f.plays().filter(p => p[1] === (terminal === 'complete' ? 'waving' : 'failed')).length, 1);
  }
});
