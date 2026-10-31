import test from 'node:test';
import assert from 'node:assert/strict';
import { completionCaptions, statusCaption } from '../../src/bridge/captions.mjs';
import { PetController } from '../../src/bridge/controller.mjs';

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 1800) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) assert.fail('timed out');
    await tick(5);
  }
}
const status = (state, turnId = 'turn-1', extra = {}) => ({ state, turnId, threadId: 'codex', updatedAt: new Date().toISOString(), ...extra });
function fixture(options = {}) {
  const captions = [], plays = [];
  const client = {
    lock: async id => ({ lockId: id || 'owned-lease' }),
    release: async () => ({ ok: true }),
    broadcast: async (text, lockId) => { captions.push({ text, lockId }); return { ok: true }; },
    play: async name => { plays.push(name); return { playbackId: 'play-' + plays.length }; },
    playback: async () => ({ status: 'ended' }),
  };
  const controller = new PetController({ client, ...options });
  return { controller, client, captions, plays };
}

test('completion copy has six distinct aligned translations and no claims about inspection results', () => {
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    const rows = completionCaptions[language];
    assert.equal(rows.length, 6);
    assert.equal(new Set(rows).size, 6);
    assert.ok(rows.every(text => text.length > 0 && !text.includes('\uFFFD')));
    assert.ok(rows.every(text => !/全部通过|檢查通過|检查通过|all tests pass|project is complete|saved your work/i.test(text)));
    for (let index = 0; index < 12; index++) assert.equal(statusCaption('complete', language, index), rows[index % 6]);
  }
  assert.equal(statusCaption('complete', 'unknown'), completionCaptions['zh-CN'][0]);
  assert.equal(statusCaption('complete', 'en', NaN), completionCaptions.en[0]);
  assert.ok(completionCaptions.en.every(text => [...text].length <= 25), 'completion captions must fit the minimum-size native note at desktop corners');
  assert.equal(statusCaption('working', 'en'), null);
  assert.equal(statusCaption('idle', 'zh-CN'), null);
  assert.match(statusCaption('waiting', 'zh-TW'), /回來.*這裡/);
  for (const state of ['waiting', 'interrupted', 'unknown']) assert.doesNotMatch(statusCaption(state, 'en'), /[\u3400-\u9fff]/u);
});

test('confirmed turns rotate without adjacent repeats and read the current language on each turn', async t => {
  let language = 'zh-CN';
  const { controller, captions, plays } = fixture({ getLanguage: () => language });
  t.after(() => controller.close());
  for (let index = 0; index < 8; index++) {
    language = ['zh-CN', 'zh-TW', 'en'][index % 3];
    controller.update(status('complete', `turn-${index}`));
    await until(() => captions.length === index + 1 && controller.schedule.phase === 'rest');
    assert.equal(captions[index].text, completionCaptions[language][index % 6]);
    assert.equal(captions[index].lockId, 'owned-lease');
    assert.equal(controller.completionCaptionIndex, (index + 1) % 6);
    assert.deepEqual(plays.filter(name => name !== 'idle'), Array.from({ length: index + 1 }, () => ['waving', 'jumping']).flat(), 'copy cannot add or replace an action');
    controller.update(status('complete', `turn-${index}`));
    await tick(15);
    assert.equal(captions.length, index + 1, 'a timestamp-only refresh is not a new completion');
  }
});

test('a completion seen again after idle and historic startup completions do not show another caption', async t => {
  const { controller, captions } = fixture();
  t.after(() => controller.close());
  controller.update(status('complete', 'confirmed-turn'));
  await until(() => captions.length === 1 && controller.schedule.phase === 'rest');
  controller.update(status('idle', 'quiet'));
  await until(() => controller.schedule.state === 'idle' && controller.schedule.phase === 'rest');
  controller.update(status('complete', 'confirmed-turn'));
  await tick(40);
  assert.equal(captions.length, 1);
  assert.equal(controller.completionCaptionIndex, 1);
  const old = fixture(); t.after(() => old.controller.close());
  old.controller.update(status('complete', 'historic', { updatedAt: '2020-01-01T00:00:00Z' }));
  await until(() => old.controller.schedule.phase === 'rest');
  assert.deepEqual(old.captions, []);
  assert.equal(old.controller.completionCaptionIndex, 0);
});

test('waiting, interrupted and unknown captions use the same live language source', async t => {
  const { controller, captions } = fixture({ getLanguage: () => 'en' });
  t.after(() => controller.close());
  for (const state of ['waiting', 'interrupted', 'unknown']) {
    const count = captions.length;
    controller.update(status(state, state));
    await until(() => captions.length === count + 1);
    assert.equal(captions.at(-1).text, statusCaption(state, 'en'));
  }
  assert.equal(controller.completionCaptionIndex, 0, 'other states cannot consume completion variations');
});

test('pause, manual ownership and a hidden host suppress text before reading language', async t => {
  for (const mode of ['pause', 'manual', 'hidden']) {
    let languageReads = 0;
    const { controller, client, captions } = fixture({
      initialPaused: mode === 'pause', initialPreempted: mode === 'manual',
      getLanguage: () => { languageReads++; return 'en'; }, retryMs: 5,
    });
    if (mode === 'hidden') client.lock = async () => { throw Object.assign(new Error('pet-not-displayed'), { reason: 'pet-not-displayed' }); };
    t.after(() => controller.close());
    controller.update(status('complete', mode));
    await until(() => mode === 'hidden' ? controller.preempted : controller.handledGeneration === controller.generation);
    assert.equal(languageReads, 0, mode);
    assert.deepEqual(captions, []);
    assert.equal(controller.completionCaptionIndex, 0);
    await controller.close();
  }
});

test('a task change or user pause during language lookup discards the old completion without deferring it', async t => {
  for (const change of ['task', 'pause']) {
    let resolveLanguage, reading = false;
    const pending = new Promise(resolve => { resolveLanguage = resolve; });
    const { controller, captions } = fixture({ getLanguage: () => { reading = true; return pending; } });
    t.after(() => controller.close());
    controller.update(status('complete', 'old'));
    await until(() => reading);
    if (change === 'task') controller.update(status('working', 'new'));
    else controller.setPaused(true);
    resolveLanguage('en');
    await until(() => change === 'task' ? controller.schedule.state === 'working' && controller.schedule.phase === 'rest' : controller.schedule.phase === 'paused');
    assert.deepEqual(captions, [], change);
    assert.equal(controller.completionCaptionIndex, 0);
    if (change === 'pause') {
      controller.setPaused(false);
      await until(() => controller.schedule.phase === 'rest');
      assert.deepEqual(captions, [], 'resuming cannot replay the discarded terminal event');
    }
    await controller.close();
  }
});

test('a failed send retries the same variation; language lookup failure does not block task actions', async t => {
  const { controller, client, captions } = fixture({ getLanguage: () => 'en', retryMs: 1 });
  t.after(() => controller.close());
  const attempts = []; let failed = false;
  client.broadcast = async (text, lockId) => {
    attempts.push(text);
    if (!failed) { failed = true; throw Object.assign(new Error('runtime-unreachable'), { reason: 'runtime-unreachable' }); }
    captions.push({ text, lockId }); return { ok: true };
  };
  controller.update(status('complete', 'one'));
  await until(() => captions.length === 1 && controller.schedule.phase === 'rest');
  assert.deepEqual(attempts, [completionCaptions.en[0], completionCaptions.en[0]]);
  controller.update(status('complete', 'two'));
  await until(() => captions.length === 2 && controller.schedule.phase === 'rest');
  assert.equal(captions[1].text, completionCaptions.en[1]);
  const unavailable = fixture({ getLanguage: async () => { throw Error('preferences-unavailable'); } });
  t.after(() => unavailable.controller.close());
  unavailable.controller.update(status('complete'));
  await until(() => unavailable.controller.schedule.phase === 'rest');
  assert.equal(unavailable.captions[0].text, completionCaptions['zh-CN'][0]);
  assert.deepEqual(unavailable.plays.slice(0, 3), ['waving', 'jumping', 'idle']);
  assert.ok(unavailable.plays.slice(3).every(name => name === 'idle'));
});
