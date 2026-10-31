import test from 'node:test';
import assert from 'node:assert/strict';
import { PetClient, PetApiError } from '../../src/bridge/pet-client.mjs';
import { PetController } from '../../src/bridge/controller.mjs';

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 1500) { const end = Date.now() + timeout; while (!predicate()) { if (Date.now() > end) assert.fail('timed out'); await tick(5); } }

test('runtime token auth, desktop/lock routing, checked receipts and sanitized errors', async () => {
  const calls = [];
  let response = { ok: true, playbackId: 'p1' };
  const client = new PetClient({ dshHome: 'portable-data', readFileImpl: async () => JSON.stringify({ port: 43999, token: 'T'.repeat(43) }), fetchImpl: async (url, opts) => { calls.push({ url: new URL(url), opts }); return { ok: true, json: async () => response }; } });
  await client.play('running', 'own-lock');
  const call = calls[0];
  assert.equal(call.url.origin, 'http://127.0.0.1:43999');
  assert.equal(call.url.searchParams.get('surface'), 'desktop');
  assert.equal(call.url.searchParams.get('lock'), 'own-lock');
  assert.equal(call.opts.headers['x-dsh-pet-token'], 'T'.repeat(43));
  await client.interaction();
  assert.equal(calls[1].url.pathname, '/dsh-pet-7340/interaction');
  assert.equal(calls[1].url.searchParams.get('surface'), 'desktop');
  response = { ok: false, reason: 'lock-lost', message: 'PRIVATE BODY' };
  await assert.rejects(client.play('running', 'own-lock'), e => e.reason === 'lock-lost' && !String(e).includes('PRIVATE BODY'));
  response = { ok: false, reason: 'PRIVATE BODY' };
  await assert.rejects(client.lock(), e => e.reason === 'api-rejected');
});

test('appearance uses upstream main config and preserves hidden display and other pets', async () => {
  let aggregate = { main: { notificationsEnabled: false, pets: [{ id: 'shuangling', name: '霜铃', size: 360, display: 'none', balanceEnabled: false, position: { corner: 'bottom-right', marginX: 20, marginY: 20 } }, { id: 'other', size: 400 }] } };
  let saved;
  const client = new PetClient({ dshHome: 'unused' });
  client.request = async (route, opts) => { if (opts?.method === 'PUT') { saved = opts.body; aggregate.main = saved; } return aggregate; };
  await client.updateAppearance({ size: 400, corner: 'top-left', marginX: 14, marginY: 18 });
  assert.equal(saved.pets[0].display, 'none');
  assert.deepEqual(saved.pets[1], { id: 'other', size: 400 });
  assert.equal(saved.notificationsEnabled, false);
  await assert.rejects(client.updateAppearance({ size: 1, corner: 'top-left', marginX: 0, marginY: 0 }), e => e.reason === 'invalid-appearance');
});

function mockClient() {
  const calls = [];
  const client = {
    lock: async id => { calls.push(['lock', id]); return { ok: true, lockId: id || 'own-lock' }; },
    release: async id => { calls.push(['release', id]); return { ok: true }; },
    play: async name => { calls.push(['play', name]); return { ok: true, playbackId: `play-${calls.length}` }; },
    playback: async id => { calls.push(['receipt', id]); return { status: 'ended' }; },
    broadcast: async text => { calls.push(['caption', text]); return { ok: true }; },
  };
  return { client, calls };
}
const status = state => ({ state, threadId: 'root', turnId: 'turn', updatedAt: new Date().toISOString() });

test('completion plays wave, jump and idle in receipt order, then breathes; historic completion stays calm', async t => {
  const { client, calls } = mockClient();
  const c = new PetController({ client }); t.after(() => c.close());
  c.update(status('complete'));
  await until(() => c.schedule.phase === 'rest');
  const names = calls.filter(c => c[0] === 'play').map(c => c[1]);
  assert.deepEqual(names.slice(0, 3), ['waving', 'jumping', 'idle']);
  assert.ok(names.slice(3).every(name => name === 'idle'), 'quiet time continues with breathing, without repeating celebration');
  const wave = calls.findIndex(c => c[0] === 'play');
  assert.equal(calls[wave + 1][0], 'receipt');
  const old = mockClient(); const oldController = new PetController({ client: old.client }); t.after(() => oldController.close());
  oldController.update({ ...status('complete'), updatedAt: '2020-01-01T00:00:00Z' });
  await until(() => oldController.schedule.phase === 'rest');
  assert.ok(old.calls.some(c => c[0] === 'play'));
  assert.ok(old.calls.filter(c => c[0] === 'play').every(c => c[1] === 'idle'));
});

test('user preemption stops loops until explicit resume or new state; hidden pet is never reopened', async t => {
  const { client, calls } = mockClient();
  let hidden = true;
  client.lock = async () => { calls.push(['lock']); if (hidden) throw new PetApiError('pet-not-displayed'); return { lockId: 'own-lock' }; };
  client.playback = async () => ({ status: 'playing' });
  const c = new PetController({ client, retryMs: 10 }); t.after(() => c.close());
  c.update(status('working')); await until(() => c.preempted);
  const n = calls.length; await tick(40); assert.equal(calls.length, n);
  hidden = false; c.setPaused(false); await until(() => calls.some(c => c[0] === 'play'));
  c.setPaused(true); await until(() => calls.some(c => c[0] === 'release'));
  assert.equal(c.snapshot().paused, true);
  assert.ok(!calls.some(c => ['display', 'reload', 'launch'].includes(c[0])));
});

test('API failure retries without changing task state; cancelled receipt yields user control', async t => {
  const { client, calls } = mockClient();
  let attempts = 0;
  client.lock = async () => { if (!attempts++) throw new PetApiError('runtime-unreachable'); return { lockId: 'own-lock' }; };
  client.playback = async () => ({ status: 'cancelled' });
  const c = new PetController({ client, retryMs: 5 }); t.after(() => c.close());
  c.update(status('waiting')); await until(() => c.preempted);
  assert.ok(attempts >= 2);
  assert.equal(c.status.state, 'waiting');
  assert.equal(c.issue, 'preempted');
  assert.ok(calls.some(c => c[0] === 'release'));
});

test('a state change during playback replaces the loop without replaying terminal animation twice', async t => {
  const { client, calls } = mockClient(); let ended = false;
  client.playback = async () => ({ status: ended ? 'ended' : 'playing' });
  const c = new PetController({ client }); t.after(() => c.close());
  c.update(status('working')); await until(() => calls.some(c => c[0] === 'play'));
  ended = true; c.update(status('complete'));
  await until(() => c.schedule.phase === 'rest'); await tick(40);
  const names = calls.filter(c => c[0] === 'play').map(c => c[1]);
  assert.deepEqual(names.slice(0, 4), ['running', 'waving', 'jumping', 'idle']);
  assert.ok(names.slice(4).every(name => name === 'idle'));
});

test('missed native startup command is resent only after renewing its existing lease', async t => {
  const { client, calls } = mockClient(); let plays = 0;
  client.play = async name => { calls.push(['play', name]); plays++; return { playbackId: `p${plays}` }; };
  client.playback = async id => ({ status: id === 'p1' ? 'accepted' : 'ended' });
  const c = new PetController({ client, startTimeoutMs: 1 }); t.after(() => c.close());
  c.update(status('idle')); await until(() => c.schedule.phase === 'rest');
  assert.ok(plays >= 2);
  const playIndices = calls.flatMap((call, index) => call[0] === 'play' ? [index] : []);
  assert.ok(calls.slice(playIndices[0] + 1, playIndices[1]).some(call => call[0] === 'lock' && call[1] === 'own-lock'), 'the missed first start is resent only after renewal of that lease');
  assert.equal(c.lastPlayback.status, 'ended');
  const lost = mockClient(); let locks = 0; let lostPlays = 0;
  lost.client.lock = async id => { if (locks++) throw new PetApiError('lock-lost'); return { lockId: 'original' }; };
  lost.client.play = async () => { lostPlays++; return { playbackId: 'missed' }; };
  lost.client.playback = async () => ({ status: 'accepted' });
  const preempted = new PetController({ client: lost.client, startTimeoutMs: 1 }); t.after(() => preempted.close());
  preempted.update(status('working')); await until(() => preempted.preempted);
  assert.equal(lostPlays, 1, 'takeover must prevent the resend');
});

const interaction = (phase, kind = 'drag', extra = {}) => ({ id: 'gesture-1', phase, kind, startedAt: Date.now(), updatedAt: Date.now(), endedAt: phase === 'settled' ? Date.now() : null, revision: 1, resumable: kind === 'drag' && phase === 'settled', ...extra });

test('drag and throw yield until the same native interaction confirms settled, then restore following', async t => {
  const { client, calls } = mockClient(); let receipt = null; let plays = 0;
  client.interaction = async () => ({ ok: true, interaction: receipt });
  client.play = async name => { calls.push(['play', name]); plays++; if (plays === 1) receipt = interaction('dragging'); return { playbackId: `p${plays}` }; };
  client.playback = async id => ({ status: id === 'p1' ? 'cancelled' : 'playing', reason: id === 'p1' ? 'superseded' : null });
  const c = new PetController({ client, interactionPollMs: 5 }); t.after(() => c.close());
  c.update(status('working')); await until(() => c.preempted);
  await tick(30); assert.equal(plays, 1);
  receipt = { ...receipt, phase: 'throwing', revision: 2, updatedAt: Date.now() };
  await tick(30); assert.equal(plays, 1, 'flight is still a user interaction');
  receipt = { ...receipt, phase: 'settled', revision: 3, updatedAt: Date.now(), endedAt: Date.now(), resumable: true };
  await until(() => plays === 2);
  assert.equal(c.preempted, false);
  assert.equal(c.status.state, 'working');
  assert.equal(c.snapshot().interaction.id, 'gesture-1');
});

test('a fast completed drag is recoverable from its retained native receipt without an elapsed-time guess', async t => {
  const { client } = mockClient(); let receipt = null; let plays = 0;
  client.interaction = async () => ({ ok: true, interaction: receipt });
  client.play = async () => { plays++; if (plays === 1) receipt = interaction('settled'); return { playbackId: `p${plays}` }; };
  client.playback = async id => ({ status: id === 'p1' ? 'cancelled' : 'playing' });
  const c = new PetController({ client, interactionPollMs: 5 }); t.after(() => c.close());
  c.update(status('working')); await until(() => plays === 2);
  assert.equal(c.preempted, false);
  assert.equal(c.interaction.phase, 'settled');
});

test('late pose reporting after forced release is observed without taking a lease from stale metadata', async t => {
  const { client, calls } = mockClient(); let receipt = null; let plays = 0;
  client.interaction = async () => ({ ok: true, interaction: receipt });
  client.play = async () => { plays++; if (plays === 1) receipt = interaction('settled', 'drag', { startedAt: Date.now() - 60000, endedAt: Date.now() - 59000 }); return { playbackId: `p${plays}` }; };
  client.playback = async id => ({ status: id === 'p1' ? 'cancelled' : 'playing' });
  const c = new PetController({ client, interactionPollMs: 5, interactionProbeMs: 250 }); t.after(() => c.close());
  c.update(status('working')); await until(() => c.preempted);
  const lockCount = calls.filter(c => c[0] === 'lock').length;
  await tick(40); assert.equal(calls.filter(c => c[0] === 'lock').length, lockCount);
  receipt = interaction('settled', 'drag', { id: 'late-real-drag' });
  await until(() => plays === 2);
  assert.equal(c.preempted, false);
});

test('click and menu actions do not auto-resume; explicit resume waits for their real end', async t => {
  const { client, calls } = mockClient(); let receipt = null; let plays = 0;
  client.interaction = async () => ({ ok: true, interaction: receipt });
  client.play = async name => { calls.push(['play', name]); plays++; if (plays === 1) receipt = interaction('settled', 'click'); return { playbackId: `p${plays}` }; };
  client.playback = async id => ({ status: id === 'p1' ? 'cancelled' : 'playing' });
  const c = new PetController({ client, interactionPollMs: 5 }); t.after(() => c.close());
  c.update(status('working')); await until(() => c.preempted); await tick(30);
  assert.equal(plays, 1);
  receipt = interaction('blocked', 'menu', { id: 'menu-2' });
  c.setPaused(false); await until(() => c.issue === 'interaction-active');
  await tick(30); assert.equal(plays, 1, 'explicit resume cannot interrupt an active menu action');
  receipt = { ...receipt, phase: 'settled', revision: 2, endedAt: Date.now(), updatedAt: Date.now() };
  await until(() => plays === 2);
});

test('a natural tap returns to prior following only after its resumable native end receipt', async t => {
  const { client } = mockClient(); let receipt = null; let plays = 0;
  client.interaction = async () => ({ ok: true, interaction: receipt });
  client.play = async () => { plays++; if (plays === 1) receipt = interaction('blocked', 'click', { resumable: true }); return { playbackId: `p${plays}` }; };
  client.playback = async id => ({ status: id === 'p1' ? 'cancelled' : 'playing' });
  const c = new PetController({ client, interactionPollMs: 5 }); t.after(() => c.close());
  c.update(status('working')); await until(() => c.preempted);
  await tick(25); assert.equal(plays, 1, 'a gesture still in progress owns the surface');
  receipt = { ...receipt, phase: 'settled', revision: 2, endedAt: Date.now(), updatedAt: Date.now() };
  await until(() => plays === 2);
  assert.equal(c.preempted, false); assert.equal(c.status.state, 'working');
  c.setPaused(true); const pausedPlays = plays;
  c.update({ ...status('working'), turnId: 'next-turn' });
  await tick(25); assert.equal(plays, pausedPlays, 'a new task never unpauses prior user control');
});

test('task changes retain only resumable native handoffs, including tap, drag and read-only info', async t => {
  for (const kind of ['click', 'drag', 'info', 'menu', 'hidden']) {
    const { client } = mockClient(); let receipt = null; let plays = 0; let hidden = false;
    client.interaction = async () => { if (hidden) throw new PetApiError('pet-not-displayed'); return { ok: true, interaction: receipt }; };
    client.play = async () => { plays++; if (plays === 1) receipt = interaction('blocked', kind === 'hidden' ? 'click' : kind, { resumable: kind !== 'menu' }); return { playbackId: `p${plays}` }; };
    client.playback = async id => ({ status: id === 'p1' ? 'cancelled' : 'playing' });
    const c = new PetController({ client, interactionPollMs: 5 }); t.after(() => c.close());
    c.update(status('working')); await until(() => c.preempted);
    c.update({ ...status('waiting'), turnId: 'changed-during-gesture' });
    await tick(25); assert.equal(plays, 1, `${kind}: task change cannot cut a native gesture short`);
    if (kind === 'hidden') hidden = true;
    receipt = { ...receipt, phase: 'settled', revision: 2, endedAt: Date.now(), updatedAt: Date.now() };
    if (['click', 'drag', 'info'].includes(kind)) {
      await until(() => plays === 2); assert.equal(c.preempted, false); assert.equal(c.status.state, 'waiting');
    } else {
      await tick(35); assert.equal(plays, 1); assert.equal(c.preempted, true);
      c.update({ ...status('working'), turnId: 'another-turn' }); await tick(20); assert.equal(plays, 1);
    }
    await c.close();
  }
});

test('the explicit read-only info receipt resumes after usage is ready without generalizing manual menus', async t => {
  const { client } = mockClient(); let receipt = null; let plays = 0;
  client.interaction = async () => ({ ok: true, interaction: receipt });
  client.play = async () => { plays++; if (plays === 1) receipt = interaction('blocked', 'menu'); return { playbackId: `p${plays}` }; };
  client.playback = async id => ({ status: id === 'p1' ? 'cancelled' : 'playing' });
  const c = new PetController({ client, interactionPollMs: 5 }); t.after(() => c.close());
  c.update(status('working')); await until(() => c.preempted);
  await tick(25); assert.equal(plays, 1);
  receipt = { ...receipt, kind: 'info', revision: 2, resumable: true, updatedAt: Date.now() };
  await tick(25); assert.equal(plays, 1, 'usage preparation still owns the interaction');
  receipt = { ...receipt, phase: 'settled', revision: 3, endedAt: Date.now(), updatedAt: Date.now() };
  await until(() => plays === 2);
  assert.equal(c.preempted, false);
});

test('old interaction receipts, pause and hidden/API failures cannot re-acquire after user takeover', async t => {
  for (const mode of ['old', 'paused', 'hidden']) {
    const { client, calls } = mockClient(); let receipt = null; let plays = 0; let hidden = false;
    client.interaction = async () => { if (hidden) throw new PetApiError('pet-not-displayed'); return { ok: true, interaction: receipt }; };
    client.play = async name => { calls.push(['play', name]); plays++; receipt = interaction(mode === 'old' ? 'settled' : 'throwing', 'drag', mode === 'old' ? { startedAt: Date.now() - 60000, endedAt: Date.now() - 59000 } : {}); return { playbackId: `p${plays}` }; };
    client.playback = async () => ({ status: 'cancelled' });
    const c = new PetController({ client, interactionPollMs: 5 }); t.after(() => c.close());
    c.update(status('working')); await until(() => c.preempted);
    if (mode === 'paused') c.setPaused(true);
    if (mode === 'hidden') hidden = true;
    await tick(20);
    receipt = { ...receipt, phase: 'settled', revision: 2, endedAt: Date.now(), resumable: true };
    await tick(30);
    assert.equal(plays, 1, mode);
    assert.ok(!calls.some(c => ['display', 'reload', 'launch'].includes(c[0])));
  }
});

test('an interaction endpoint failure cannot grant a fresh lease over unknown user activity', async t => {
  const { client, calls } = mockClient(); let healthy = false;
  client.interaction = async () => { if (!healthy) throw new PetApiError('api-http-error', 500); return { ok: true, interaction: null }; };
  client.playback = async () => ({ status: 'playing' });
  const c = new PetController({ client, retryMs: 5 }); t.after(() => c.close());
  c.update(status('working')); await until(() => c.issue === 'api-http-error');
  await tick(25); assert.ok(!calls.some(c => c[0] === 'lock'));
  healthy = true; await until(() => calls.some(c => c[0] === 'play'));
  assert.equal(c.status.state, 'working');
});

test('a new task in the same interaction read cannot erase confirmed manual or hidden preemption', async t => {
  for (const mode of ['manual', 'hidden', 'pause', 'click', 'drag', 'transient']) {
    let now = 1_792_600_000_000, controller, reads = 0;
    const calls = [];
    let receipt = { id: 'initial-pose', kind: 'click', phase: 'settled', startedAt: now, updatedAt: now, endedAt: now, revision: 0, resumable: false };
    const client = {
      interaction: async () => {
        if (++reads === 2) {
          now++;
          controller.update({ ...status('waiting'), turnId: 'changed-in-interaction-read', updatedAt: new Date(now).toISOString() });
          if (mode === 'hidden') throw new PetApiError('pet-hidden');
          if (mode === 'transient') throw new PetApiError('runtime-unreachable');
          receipt = { id: 'new-user-gesture', kind: ['click', 'drag'].includes(mode) ? mode : 'menu', phase: ['click', 'drag'].includes(mode) ? 'blocked' : 'settled',
            startedAt: now, updatedAt: now, endedAt: ['click', 'drag'].includes(mode) ? null : now, revision: 1, resumable: ['click', 'drag'].includes(mode) };
          if (mode === 'pause') controller.setPaused(true);
        }
        return { interaction: receipt };
      },
      lock: async id => { calls.push(['lock', id]); return { lockId: id || 'existing-lease' }; },
      release: async () => { calls.push(['release']); return { ok: true }; },
      broadcast: async () => ({ ok: true }),
      play: async name => { calls.push(['play', name]); return { playbackId: name }; },
      playback: async id => { now += 1000; return { status: id === 'waiting' ? 'playing' : 'ended' }; },
    };
    controller = new PetController({ client, now: () => now, interactionPollMs: 5, random: () => 0,
      sleepImpl: async milliseconds => { now += milliseconds; await tick(1); } });
    t.after(() => controller.close());
    controller.update({ ...status('working'), updatedAt: new Date(now).toISOString() });
    if (mode === 'transient') {
      await until(() => calls.some(call => call[0] === 'play' && call[1] === 'waiting'));
      assert.equal(controller.preempted, false, 'ordinary stale errors still yield to the new task');
    } else {
      await until(() => controller.preempted || controller.paused);
      await tick(15);
      assert.deepEqual(calls.filter(call => call[0] === 'play').map(call => call[1]), ['running', 'idle'], mode);
      assert.equal(calls.filter(call => call[0] === 'lock' && !call[1]).length, 1, mode + ': task update cannot grant a new lease');
      if (['click', 'drag'].includes(mode)) {
        receipt = { ...receipt, phase: 'settled', endedAt: now, updatedAt: now, revision: 2, resumable: true };
        await until(() => calls.some(call => call[0] === 'play' && call[1] === 'waiting'));
        assert.equal(controller.preempted, false, mode + ': a real resumable end receipt still restores following');
      } else {
        controller.update({ ...status('working'), turnId: 'later-task', updatedAt: new Date(now).toISOString() });
        await tick(15);
        assert.deepEqual(calls.filter(call => call[0] === 'play').map(call => call[1]), ['running', 'idle'], mode + ': later tasks preserve user priority');
      }
    }
    await controller.close();
  }
});
