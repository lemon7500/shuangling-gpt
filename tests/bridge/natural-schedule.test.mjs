import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PetController } from '../../src/bridge/controller.mjs';
import { quietDelay, naturalAnimation, quietIntervals } from '../../src/bridge/natural-schedule.mjs';

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const end = Date.now() + 1500; while (!predicate()) { if (Date.now() > end) assert.fail('scheduler did not settle'); await tick(1); } }
const epoch = 1792600000000;
const duration = { idle: 6000, running: 4000, review: 3600, waiting: 3800, waving: 2500, jumping: 2000, failed: 3500, reading: 10000, 'looking-around': 5000, 'stretching-wings': 5000 };
const maps = { idle: 'idle', working: 'running', waiting: 'waiting' };
const fixtures = [];
const status = state => ({ state, threadId: 'root', turnId: 'turn', updatedAt: new Date(epoch).toISOString() });
const seedRandom = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

function virtualController(state, { stopAt = 60000, onAdvance, onInteraction, holdPlayback = () => false, random = seedRandom(7) } = {}) {
  let now = epoch, controller, serial = 0, interaction = null;
  const events = [], plays = new Map();
  const advance = async milliseconds => {
    now = Math.min(epoch + stopAt, now + milliseconds);
    await onAdvance?.({ at: now - epoch, controller, setInteraction: value => { interaction = value; } });
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
  controller = new PetController({ client, availableAnimations: ['reading', 'looking-around', 'stretching-wings'], now: () => now, sleepImpl: advance, random });
  controller.update(status(state));
  return { controller, events, elapsed: () => now - epoch };
}

test('quiet cadence has bounded randomness and excludes unsafe or repeated autonomous gestures', () => {
  assert.equal(quietDelay('working', () => 0), 7000);
  assert.equal(quietDelay('working', () => 1), 12000);
  assert.equal(quietDelay('waiting', () => 0), 60000);
  assert.equal(quietDelay('idle', () => 1), 45000);
  assert.equal(quietDelay('idle', () => NaN), 35000);
  assert.equal(quietDelay('idle', () => 0, 'quiet'), 45000);
  assert.equal(quietDelay('idle', () => 1, 'lively'), 25000);
  for (const state of ['idle', 'working', 'waiting']) {
    let previous = null;
    const random = seedRandom(12);
    for (let i = 0; i < 100; i++) {
      const next = naturalAnimation(state, maps, previous, random);
      if (state !== 'waiting') assert.notEqual(next, previous, `${state} should not repeat a gesture`);
      if (state === 'idle') assert.ok(['reading', 'looking-around', 'stretching-wings'].includes(next));
      if (state === 'waiting') assert.equal(next, 'waiting');
      assert.ok(!['failed', 'jumping', 'waving', 'running-left', 'running-right'].includes(next));
      previous = next;
    }
  }
});

test('thirty-minute seeded replays fill every interval and observe ambient cooldowns without false task gestures', async t => {
  for (const state of ['working', 'waiting', 'idle']) {
    const run = virtualController(state, { stopAt: 1800000 });
    t.after(() => run.controller.close());
    await until(() => run.controller.paused && run.events.some(item => item.type === 'release'));
    const plays = run.events.filter(item => item.type === 'play');
    const gestures = plays.filter(item => item.name !== 'idle');
    assert.ok(gestures.length >= 10, `${state}: ${gestures.length} gestures/30min`);
    if (state === 'idle') assert.deepEqual([...new Set(gestures.map(item => item.name))].sort(), ['looking-around', 'reading', 'stretching-wings']);
    assert.equal(plays[0].name, state === 'working' ? 'running' : state === 'waiting' ? 'waiting' : 'idle');
    for (let i = 1; i < plays.length; i++) {
      if (plays[i - 1].endedAt !== null) assert.equal(plays[i].at, plays[i - 1].endedAt, 'confirmed clips leave no static quiet gap');
    }
    for (let i = 1; i < gestures.length; i++) {
      if (state !== 'waiting') assert.notEqual(gestures[i].name, gestures[i - 1].name);
      const minimum = quietIntervals[state][0];
      assert.ok(gestures[i].at - gestures[i - 1].endedAt >= minimum);
      const between = plays.filter(item => item.at >= gestures[i - 1].endedAt && item.at < gestures[i].at);
      assert.ok(between.some(item => item.name === 'idle' && item.endedAt - item.at === duration.idle), 'each pair has one full breathing clip');
      if (state !== 'idle') assert.ok(gestures[i].at - gestures[i - 1].endedAt < quietIntervals[state][1] + duration.idle, 'only the final full idle may extend the sampled quiet interval');
    }
    if (state === 'idle') for (const [name, cooldown] of [['reading', 180000], ['looking-around', 45000], ['stretching-wings', 120000]]) {
      const matching = gestures.filter(item => item.name === name);
      for (let i = 1; i < matching.length; i++) assert.ok(matching[i].at - matching[i - 1].endedAt >= cooldown);
    }
    assert.ok(!plays.some(item => ['failed', 'jumping', 'waving', 'running-left', 'running-right'].includes(item.name)));
    assert.ok(run.events.some(item => item.type === 'lock' && item.renewal), 'lease stays renewed during calm rest');
    assert.equal(run.events.filter(item => item.type === 'lock' && !item.renewal).length, 1, 'quiet replay keeps the existing lease');
    fixtures.push({ state, simulatedMs: run.elapsed(), gestures: gestures.length, eventCount: run.events.length, firstEvents: run.events.slice(0, 30) });
  }
  writeFileSync(process.env.SHUANGLING_AMBIENT_REPORT || fileURLToPath(new URL('../../reports/ambient-schedule-verification.json', import.meta.url)), JSON.stringify({ verifiedAt: new Date().toISOString(), ok: true, virtualClock: true, observationMsPerState: 1800000, fixtures }, null, 2) + '\n');
});

test('journal reading waits for its real ended receipt before quiet time and the three-minute cooldown begin', async t => {
  let run, queuedAt = null, checkedNominalEnd = false;
  run = virtualController('idle', { stopAt: 300000, random: () => 0,
    async onAdvance({ at, controller }) {
      if (queuedAt === null && at >= 7000 && controller.schedule.phase === 'rest') {
        queuedAt = at;
        assert.equal(await controller.companionNotice(null, 'reading', { idleOnly: true }), true);
        assert.equal(controller.lastAmbientEnded.reading, undefined, 'queue acceptance is not a playback end');
      }
      const reading = run?.events.find(event => event.type === 'play' && event.name === 'reading');
      if (reading && !checkedNominalEnd && at >= reading.at + duration.reading) {
        checkedNominalEnd = true;
        assert.equal(reading.endedAt, null);
        assert.equal(controller.lastAmbientEnded.reading, undefined, 'ten elapsed seconds cannot replace an ended receipt');
      }
    },
    // Deliberately keep the first reading receipt playing three seconds past
    // the nominal ten-second asset, as a slow/blocked renderer could do.
    holdPlayback: event => event.name === 'reading' && event.endedAt === null && run.elapsed() < event.at + 13000,
  });
  t.after(() => run.controller.close());
  await until(() => run.controller.paused && run.events.some(event => event.type === 'release'));
  const readings = run.events.filter(event => event.type === 'play' && event.name === 'reading');
  const first = readings[0];
  assert.ok(checkedNominalEnd); assert.ok(first.at > queuedAt);
  assert.ok(first.endedAt - first.at >= 13000);
  assert.ok(first.endedAt - first.at < 14060, 'the held receipt is observed on the following bounded host poll');
  const following = run.events.find(event => event.type === 'play' && event.name !== 'idle' && event.at >= first.endedAt);
  assert.ok(following, 'the controller eventually resumes autonomous company');
  assert.ok(following.at - first.endedAt >= 25000);
  assert.ok(following.at - first.endedAt <= 45000 + duration.idle, 'only a complete final idle may extend the interval');
  assert.ok(readings.length >= 2, 'the reading cooldown eventually expires');
  for (let index = 1; index < readings.length; index++) {
    assert.ok(readings[index].at - readings[index - 1].endedAt >= 180000,
      'reading must cool down from its actual end, not queue or start time');
  }
});

test('a queued journal reading that never ends cannot start cooldown or another autonomous action', async t => {
  let queued = false;
  const run = virtualController('idle', { stopAt: 60000, random: () => 0,
    async onAdvance({ at, controller }) {
      if (!queued && at >= 7000 && controller.schedule.phase === 'rest') {
        queued = true;
        assert.equal(await controller.companionNotice(null, 'reading', { idleOnly: true }), true);
      }
    },
    holdPlayback: event => event.name === 'reading',
  });
  t.after(() => run.controller.close());
  await until(() => run.controller.paused && run.events.some(event => event.type === 'release'));
  const plays = run.events.filter(event => event.type === 'play');
  assert.equal(plays.at(-1).name, 'reading'); assert.equal(plays.at(-1).endedAt, null);
  assert.equal(plays.filter(event => event.name === 'reading').length, 1);
  assert.equal(run.controller.lastAmbientEnded.reading, undefined);
  assert.equal(run.controller.status.state, 'idle', 'a playback delay does not invent a task outcome');
});

test('a task arriving after a journal cue was queued discards it instead of interrupting the task', async t => {
  let queuedAt = null, changedAt = null;
  const run = virtualController('idle', { stopAt: 60000, random: () => 0,
    async onAdvance({ at, controller }) {
      if (queuedAt === null && at >= 7000 && controller.schedule.phase === 'rest') {
        queuedAt = at;
        assert.equal(await controller.companionNotice(null, 'reading', { idleOnly: true }), true);
      } else if (queuedAt !== null && changedAt === null && at >= 8000) {
        changedAt = at;
        controller.update({ ...status('working'), updatedAt: new Date(epoch + at).toISOString() });
      }
    },
  });
  t.after(() => run.controller.close());
  await until(() => run.controller.paused && run.events.some(event => event.type === 'release'));
  assert.ok(queuedAt !== null && changedAt > queuedAt);
  assert.ok(run.events.some(event => event.type === 'play' && event.name === 'running'));
  assert.ok(!run.events.some(event => event.type === 'play' && event.name === 'reading'));
  assert.equal(run.controller.lastAmbientEnded.reading, undefined);
  assert.equal(run.controller.status.state, 'working');
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
  const previousIdle = plays.filter(item => item.name === 'idle' && item.at < changedAt).at(-1);
  assert.ok(running && previousIdle && running.at > changedAt);
  assert.equal(running.at, previousIdle.endedAt, 'a new task starts at the real end of the current idle, rather than cutting its pose');
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
  assert.ok(names.slice(3).every(name => ['idle', 'reading', 'looking-around', 'stretching-wings'].includes(name)));
});

test('disabled, missing, previous and cooling ambient assets leave dynamic idle as the safe fallback', () => {
  assert.equal(naturalAnimation('idle', maps, null, () => 0, { enabled: false }), 'idle');
  assert.equal(naturalAnimation('idle', maps, null, () => 0, { available: [] }), 'idle');
  assert.equal(naturalAnimation('idle', maps, 'reading', () => 0, { available: ['reading'] }), 'idle');
  assert.equal(naturalAnimation('idle', maps, null, () => 0, { now: epoch + 1000, lastEnded: { reading: epoch, 'looking-around': epoch, 'stretching-wings': epoch } }), 'idle');
});
