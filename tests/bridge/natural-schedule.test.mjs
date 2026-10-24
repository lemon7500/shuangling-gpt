import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PetController } from '../../src/bridge/controller.mjs';
import { quietDelay, naturalAnimation, quietIntervals } from '../../src/bridge/natural-schedule.mjs';

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const end = Date.now() + 1500; while (!predicate()) { if (Date.now() > end) assert.fail('scheduler did not settle'); await tick(1); } }
const epoch = 1792600000000;
const duration = { idle: 6000, running: 4000, review: 3600, waiting: 3800, waving: 2500, jumping: 2000, failed: 3500 };
const maps = { idle: 'idle', working: 'running', waiting: 'waiting' };
const fixtures = [];
const status = state => ({ state, threadId: 'root', turnId: 'turn', updatedAt: new Date(epoch).toISOString() });
const seedRandom = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

function virtualController(state, { stopAt = 60000, onAdvance, onInteraction, holdPlayback = () => false, random = seedRandom(7) } = {}) {
  let now = epoch, controller, serial = 0, interaction = null;
  const events = [], plays = new Map();
  const advance = async milliseconds => {
    now = Math.min(epoch + stopAt, now + milliseconds);
    onAdvance?.({ at: now - epoch, controller, setInteraction: value => { interaction = value; } });
    if (now >= epoch + stopAt) controller.setPaused(true);
    await Promise.resolve();
  };
  const client = {
    lock: async id => { events.push({ type: 'lock', at: now - epoch, renewal: !!id }); return { lockId: id || 'test-lease' }; },
    release: async () => { events.push({ type: 'release', at: now - epoch }); return { ok: true }; },
    interaction: async () => { const error = onInteraction?.({ at: now - epoch, controller }); if (error) throw error; return { interaction }; },
    broadcast: async () => ({ ok: true }),
    play: async name => {
      const id = `receipt-${++serial}`;
      const event = { type: 'play', name, at: now - epoch, endedAt: null, generation: controller.generation };
      events.push(event); plays.set(id, event); return { playbackId: id };
    },
    playback: async id => {
      const event = plays.get(id);
      if (holdPlayback(event)) { await advance(1000); return { status: 'playing' }; }
      if (event.endedAt === null) {
        // Model the real host's bounded receipt wait, allowing state changes
        // and manual interaction while a complete clip is still playing.
        await advance(Math.min(1000, Math.max(0, event.at + duration[event.name] - (now - epoch))));
        if (now - epoch - event.at >= duration[event.name]) event.endedAt = now - epoch;
      }
      return { status: event.endedAt === null ? 'playing' : 'ended' };
    },
  };
  controller = new PetController({ client, now: () => now, sleepImpl: advance, random });
  controller.update(status(state));
  return { controller, events, elapsed: () => now - epoch };
}

test('quiet cadence has bounded randomness and excludes unsafe or repeated autonomous gestures', () => {
  assert.equal(quietDelay('working', () => 0), 7000);
  assert.equal(quietDelay('working', () => 1), 12000);
  assert.equal(quietDelay('waiting', () => 0), 8000);
  assert.equal(quietDelay('idle', () => 1), 18000);
  assert.equal(quietDelay('idle', () => NaN), 14000);
  for (const state of ['idle', 'working', 'waiting']) {
    let previous = null;
    const random = seedRandom(12);
    for (let i = 0; i < 100; i++) {
      const next = naturalAnimation(state, maps, previous, random);
      assert.notEqual(next, previous, `${state} should not repeat a gesture`);
      assert.ok(!['failed', 'jumping', 'waving', 'running-left', 'running-right'].includes(next));
      previous = next;
    }
  }
});

test('sixty-second seeded replays fill quiet intervals with complete breathing and vary calm poses', async t => {
  for (const state of ['working', 'waiting', 'idle']) {
    const run = virtualController(state);
    t.after(() => run.controller.close());
    await until(() => run.controller.paused && run.events.some(item => item.type === 'release'));
    const plays = run.events.filter(item => item.type === 'play');
    const gestures = plays.filter(item => item.name !== 'idle');
    assert.ok(gestures.length >= 2 && gestures.length <= 6, `${state}: ${gestures.length} gestures/60s`);
    assert.equal(plays[0].name, state === 'working' ? 'running' : state === 'waiting' ? 'waiting' : 'idle');
    for (let i = 1; i < plays.length; i++) {
      if (plays[i - 1].endedAt !== null) assert.equal(plays[i].at, plays[i - 1].endedAt, 'confirmed clips leave no static quiet gap');
    }
    for (let i = 1; i < gestures.length; i++) {
      assert.notEqual(gestures[i].name, gestures[i - 1].name);
      const minimum = state === 'working' ? 7000 : state === 'waiting' ? 8000 : 10000;
      assert.ok(gestures[i].at - gestures[i - 1].endedAt >= minimum);
      const between = plays.filter(item => item.at >= gestures[i - 1].endedAt && item.at < gestures[i].at);
      assert.ok(between.some(item => item.name === 'idle' && item.endedAt - item.at === duration.idle), 'each pair has one full breathing clip');
      assert.ok(gestures[i].at - gestures[i - 1].endedAt < quietIntervals[state][1] + duration.idle, 'only the final full idle may extend the sampled quiet interval');
    }
    assert.ok(!plays.some(item => ['failed', 'jumping', 'waving', 'running-left', 'running-right'].includes(item.name)));
    assert.ok(run.events.some(item => item.type === 'lock' && item.renewal), 'lease stays renewed during calm rest');
    assert.equal(run.events.filter(item => item.type === 'lock' && !item.renewal).length, 1, 'quiet replay keeps the existing lease');
    fixtures.push({ state, simulatedMs: run.elapsed(), gestures: gestures.length, events: run.events });
  }
  writeFileSync(fileURLToPath(new URL('../../reports/animation-schedule-verification.json', import.meta.url)), JSON.stringify({ verifiedAt: new Date().toISOString(), ok: true, virtualClock: true, observationMsPerState: 60000, fixtures }, null, 2) + '\n');
});

test('a click completed during quiet rest wins control without a fresh lease or later automatic gesture', async t => {
  let insertedAt = null;
  const run = virtualController('working', { onAdvance({ at, controller, setInteraction }) {
    if (insertedAt === null && at >= 10500 && controller.schedule.phase === 'rest') {
      insertedAt = at;
      setInteraction({ id: 'real-click', phase: 'settled', kind: 'click', startedAt: epoch + at, updatedAt: epoch + at, endedAt: epoch + at, revision: 1, resumable: false });
    }
  } });
  t.after(() => run.controller.close());
  await until(() => run.controller.preempted && run.events.some(item => item.type === 'release'));
  const end = run.events.length;
  await tick(20);
  assert.equal(run.events.length, end);
  assert.equal(run.controller.issue, 'preempted');
  assert.ok(!run.events.some(item => item.type === 'play' && item.at > insertedAt));
});

test('a click arriving with the preceding ended receipt prevents the next quiet idle', async t => {
  let insertedAt = null;
  const run = virtualController('working', { onAdvance({ at, controller, setInteraction }) {
    if (insertedAt === null && at >= 10000 && controller.schedule.phase === 'breathing') {
      insertedAt = at;
      setInteraction({ id: 'ended-edge-click', phase: 'settled', kind: 'click', startedAt: epoch + at, updatedAt: epoch + at, endedAt: epoch + at, revision: 1, resumable: false });
    }
  } });
  t.after(() => run.controller.close());
  await until(() => run.controller.preempted && run.events.some(item => item.type === 'release'));
  assert.deepEqual(run.events.filter(item => item.type === 'play').map(item => item.name), ['running', 'idle']);
  assert.equal(run.events.filter(item => item.type === 'lock' && !item.renewal).length, 1);
  assert.equal(run.controller.issue, 'preempted');
});

test('new task state and pause interrupt quiet rest before a scheduled gesture can start', async t => {
  let changedAt = null, pausedAt = null;
  const run = virtualController('idle', { stopAt: 40000, onAdvance({ at, controller }) {
    if (changedAt === null && at >= 8000 && controller.schedule.phase === 'rest') {
      changedAt = at;
      controller.update({ ...status('working'), updatedAt: new Date(epoch + at).toISOString() });
    }
    if (changedAt !== null && at >= 18000 && controller.schedule.phase === 'rest') { pausedAt = at; controller.setPaused(true); }
  } });
  t.after(() => run.controller.close());
  await until(() => run.controller.paused && run.events.some(item => item.type === 'release'));
  const plays = run.events.filter(item => item.type === 'play');
  const running = plays.find(item => item.name === 'running');
  assert.ok(plays.filter(item => item.at < changedAt).every(item => item.name === 'idle'));
  assert.ok(running && running.at === changedAt, 'new state replaces the still-playing old idle after its bounded receipt wait');
  assert.ok(plays.filter(item => item.at >= changedAt).every(item => item.generation === running.generation), 'no old generation starts another quiet clip');
  assert.ok(!plays.some(item => item.at >= pausedAt), 'pause prevents all later idle or gesture requests');
});

test('a quiet deadline never truncates the final idle or substitutes time for an ended receipt', async t => {
  // Working's minimum rest is 7s, so two complete 6s idles must fill it.
  const run = virtualController('working', { stopAt: 21000, random: () => 0 });
  t.after(() => run.controller.close());
  await until(() => run.controller.paused && run.events.some(item => item.type === 'release'));
  const plays = run.events.filter(item => item.type === 'play');
  assert.deepEqual(plays.slice(0, 4).map(item => item.name), ['running', 'idle', 'idle', 'review']);
  assert.equal(plays[2].at, 10000);
  assert.equal(plays[2].endedAt, 16000);
  assert.equal(plays[3].at, plays[2].endedAt, 'next gesture waits for the full last idle, beyond the 11s deadline');
});

test('quiet playback silence past the deadline cannot finish a clip or the current root task', async t => {
  const run = virtualController('working', { stopAt: 30000, random: () => 0, holdPlayback: event => event.name === 'idle' && event.at >= 10000 });
  t.after(() => run.controller.close());
  await until(() => run.controller.paused && run.events.some(item => item.type === 'release'));
  const plays = run.events.filter(item => item.type === 'play');
  assert.deepEqual(plays.map(item => item.name), ['running', 'idle', 'idle']);
  assert.equal(plays.at(-1).endedAt, null, 'a still-playing receipt remains unfinished after the quiet deadline');
  assert.equal(run.controller.status.state, 'working');
  assert.equal(run.controller.status.threadId, 'root');
  assert.equal(run.controller.status.turnId, 'turn');
  assert.equal(run.controller.terminalEntries.size, 0, 'no completion or interruption is inferred from silence');
});

test('a hidden surface during quiet playback releases control and never starts another idle', async t => {
  let hiddenAt = null;
  const run = virtualController('idle', { onAdvance({ at, controller }) {
    if (hiddenAt === null && at >= 8000 && controller.schedule.phase === 'rest') {
      hiddenAt = at;
    }
  }, onInteraction: () => hiddenAt === null ? null : Object.assign(new Error('pet-hidden'), { reason: 'pet-hidden' }) });
  t.after(() => run.controller.close());
  await until(() => run.controller.preempted && run.events.some(item => item.type === 'release'));
  const count = run.events.filter(item => item.type === 'play').length;
  await tick(20);
  assert.equal(run.events.filter(item => item.type === 'play').length, count);
  assert.ok(run.events.filter(item => item.type === 'play').every(item => item.at < hiddenAt));
  assert.equal(run.events.filter(item => item.type === 'lock' && !item.renewal).length, 1);
  assert.equal(run.controller.issue, 'pet-hidden');
});

test('completion celebration occurs once, then a sixty-second replay uses only calm companion variations', async t => {
  const run = virtualController('complete'); t.after(() => run.controller.close());
  await until(() => run.controller.paused && run.events.some(item => item.type === 'release'));
  const names = run.events.filter(item => item.type === 'play').map(item => item.name);
  assert.deepEqual(names.slice(0, 3), ['waving', 'jumping', 'idle']);
  assert.equal(names.filter(name => name === 'waving').length, 1);
  assert.equal(names.filter(name => name === 'jumping').length, 1);
  assert.ok(names.slice(3).every(name => ['idle', 'review', 'waiting'].includes(name)));
});
