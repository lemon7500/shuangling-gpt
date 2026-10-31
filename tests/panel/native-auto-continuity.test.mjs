import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
const base = 'dsh-pet-bridge://dsh-pet/dsh-pet-7340/thumb/main/';
const states = ['idle', 'running', 'review', 'waiting'];
const handoffApi = createRequire(import.meta.url)('../../vendor/dsh-pet/runtime/electron-helper/shuangling-handoff.js');
class Video {
  constructor(name) {
    this.listeners = new Map(); this.style = {}; this.classList = { add() {}, remove() {} };
    this.readyState = 4; this.seeking = false; this.error = null; this._time = 0;
    this.paused = true; this.ended = false; this.loop = false; this.duration = 5.125;
    this.playbackRate = 1; this.playCalls = 0; this.pauseCalls = 0; this.loadCalls = 0;
    this.petAnimationSource = this.petPreloadedSource = base + name + '.webm';
  }
  get currentTime() { return this._time; }
  set currentTime(value) { this._time = value; this.seeking = true; }
  pause() { this.pauseCalls++; this.paused = true; }
  play() { this.playCalls++; this.paused = false; this.ended = false; return Promise.resolve(); }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name) { for (const callback of [...(this.listeners.get(name) || [])]) callback(); }
  load() { this.loadCalls++; this.readyState = 4; this.emit('loadeddata'); }
  finishSeek() { this.seeking = false; this.emit('seeked'); }
}
function fixture(name = 'running') {
  const context = vm.createContext({
    window: { __dshPetDebug: {}, setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: false }), petBridge: { closePanel() {} } },
    performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    SHUANGLING_PROFILE: true, BASE: '', ShuanglingHandoff: { policies: Object.fromEntries(states.map(name => [name, {}])) },
    S: { ANIMATION_EXT: '.webm', postAction: () => Promise.resolve(true), isNoMirrorAnimation: () => false, isEventAnim: () => false, pick: values => values[0] },
    console: { log() {}, warn() {} },
  });
  vm.runInContext(source + '\nthis.P=PetSprite.prototype;', context);
  const p = Object.create(context.P), paints = [], receipts = [], starts = [];
  Object.assign(p, {
    pet: { id: 'shuangling' }, assetBase: base, front: 0, videoA: new Video('idle'), videoB: new Video(name),
    pending: null, idlePreload: null, gen: 0, playback: null, displayedOnce: true,
    videoSurface: { style: {} }, dragState: { active: false }, interactionSession: 'auto-test', interactionSequence: 0,
    animations: { idle: ['idle'], categories: [], moves: { actions: [] }, events: {}, drag: [], clicks: [], turn: [] },
    frozen: false, lockTimer: null, nativePanelSession: null, nativePanelInteraction: null,
    squashToken: 0, squashRef: null, pendingSquash: false,
    paintVideoFrame(video, time) { video.petPaintedMediaTime = time ?? video.currentTime; paints.push({ name: video.petOutlineAssetName, time: video.petPaintedMediaTime, decoderTime: video.currentTime }); },
    startVideoPaint(video) { starts.push(video); }, stopVideoPaint() {}, preloadIdleFrame() {}, videoFacingTransform: () => '',
    reportPlayback(id, status, reason) { receipts.push({ id, status, reason }); },
    stopMove() {}, stopThrow() {}, closeMenu() {}, reportPose() {},
    setTip() {}, syncInputBusy() {}, setInteractive() {}, resumeWorkStatusAnim: () => false, playIdle() {},
  });
  p.switchTo(name, true, 'old-state');
  const visible = p.front === 0 ? p.videoA : p.videoB;
  visible._time = visible.petPaintedMediaTime = 1.25;
  receipts.length = 0;
  const offers = [], commits = []; let cancels = 0;
  p.handoff = {
    request(transaction, commit) { offers.push({ transaction, commit }); },
    cancel() { cancels++; },
    onCommit(video, generation) { commits.push({ video, generation }); },
  };
  return { p, visible, paints, receipts, starts, offers, commits, get cancels() { return cancels; } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
async function decode(f) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await settle();
    const hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA;
    if (hidden.seeking) hidden.finishSeek();
    if (f.p.pending?.ready || !f.p.pending) break;
  }
  await settle();
}
// This is the authenticated path currently used by the Codex controller. It
// deliberately has a receipt and must not draw a random manual classic take.
function automatic(f, name, id = 'task-' + name) { f.p.onMenuAction({ anim: name, playbackId: id }); }

for (const from of states) for (const to of states) {
  if (from === to) continue;
  test(`automatic ${from} → ${to} prepares true F0 but waits for the outgoing natural pose`, async () => {
    const f = fixture(from); automatic(f, to); await decode(f);
    assert.equal(f.offers.length, 1, 'the authenticated task transition must use the actual-pose gate');
    assert.equal(f.p.displayedAnim, from); assert.equal(f.visible.currentTime, 1.25);
    assert.equal(f.paints.length, 1, 'a prepared target must not hard-cut across a gesture in progress');
    assert.equal(f.receipts.some(row => row.id === 'task-' + to && row.status === 'playing'), false);
    assert.equal(f.receipts.some(row => row.id === 'old-state' && row.status === 'cancelled'), false, 'outgoing playback remains real until its replacement is committed');
    const pending = f.p.pending;
    assert.equal(pending.playbackId, 'task-' + to);
    const hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA;
    assert.equal(hidden.paused, true); assert.equal(hidden.currentTime, 0);
    assert.equal(f.offers[0].commit(), true);
    assert.equal(f.p.displayedAnim, to); assert.equal(f.p.pending, null);
    assert.equal(f.paints.at(-1).time, 0); assert.equal(f.paints.at(-1).decoderTime, 0);
    assert.deepEqual(f.receipts, [
      { id: 'old-state', status: 'cancelled', reason: 'superseded' },
      { id: 'task-' + to, status: 'playing', reason: undefined },
    ]);
    assert.equal(f.offers[0].commit(), false, 'an old neutral callback cannot play this state twice');
  });
}

test('rapid task states cancel only obsolete receipts and retain only the latest natural handoff', async () => {
  const f = fixture('running'); automatic(f, 'review', 'task-review'); await decode(f);
  assert.equal(f.offers.length, 1); const obsolete = f.offers[0].commit;
  automatic(f, 'waiting', 'task-wait'); await decode(f);
  assert.equal(obsolete(), false); assert.equal(f.p.displayedAnim, 'running');
  assert.equal(f.p.pending.playbackId, 'task-wait');
  assert.deepEqual(f.receipts, [{ id: 'task-review', status: 'cancelled', reason: 'superseded' }]);
  assert.equal(f.offers.at(-1).commit(), true);
  assert.equal(f.p.displayedAnim, 'waiting');
  assert.equal(f.receipts.some(row => row.id === 'task-review' && row.status === 'playing'), false);
  assert.equal(f.receipts.some(row => row.id === 'task-review' && row.status === 'ended'), false);
  assert.equal(f.receipts.filter(row => row.id === 'task-wait' && row.status === 'playing').length, 1);
});

test('a repeated already-ready state reuses its decoder and recovery while the newest receipt owns playback', async () => {
  const f = fixture(); automatic(f, 'waiting', 'wait-1'); await decode(f);
  assert.equal(f.offers.length, 1);
  const pending = f.p.pending, generation = f.p.gen, hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA;
  const loads = hidden.loadCalls, cancels = f.cancels;
  automatic(f, 'waiting', 'wait-2');
  assert.equal(f.p.pending, pending); assert.equal(f.p.gen, generation); assert.equal(hidden.loadCalls, loads);
  assert.equal(f.cancels, cancels, 'same target may retarget its receipt but cannot restart the safe return');
  assert.equal(f.p.displayedAnim, 'running'); assert.equal(pending.playbackId, 'wait-2');
  assert.deepEqual(f.receipts, [{ id: 'wait-1', status: 'cancelled', reason: 'superseded' }]);
  f.offers.at(-1).commit();
  assert.equal(f.receipts.filter(row => row.id === 'wait-2' && row.status === 'playing').length, 1);
  assert.equal(f.receipts.some(row => row.id === 'wait-1' && row.status === 'playing'), false);
});

test('a controller lock may freeze the previous finite clip without inserting idle before the prepared task state', async () => {
  const f = fixture('review'); f.p.applyFreeze(true);
  assert.equal(f.visible.paused, true); assert.equal(f.p.frozen, true);
  f.receipts.length = 0;
  automatic(f, 'waiting'); await decode(f);
  assert.equal(f.offers.length, 1); assert.equal(f.p.displayedAnim, 'review');
  assert.equal(f.visible.currentTime, 1.25); assert.equal(f.paints.length, 1);
  assert.equal(f.p.frozen, true, 'authenticated playback must not release a controller lease to choose idle');
  f.offers[0].commit();
  assert.equal(f.p.displayedAnim, 'waiting'); assert.equal(f.p.frozen, true);
  assert.equal(f.paints.some(row => row.name === 'idle'), false);
  assert.deepEqual(f.receipts, [{ id: 'task-waiting', status: 'playing', reason: undefined }]);
});

test('a newer drag cancels a prepared automatic state and its deferred commit with an honest receipt', async () => {
  const f = fixture(); automatic(f, 'waiting'); await decode(f);
  assert.equal(f.offers.length, 1); const obsolete = f.offers[0].commit, cancels = f.cancels;
  f.p.beginInteraction('drag', 'dragging', true); f.p.dragState.active = true;
  assert.ok(f.cancels > cancels); assert.equal(f.p.pending, null);
  assert.equal(obsolete(), false); assert.equal(f.p.displayedAnim, 'running');
  assert.deepEqual(f.receipts, [{ id: 'task-waiting', status: 'cancelled', reason: 'user-interaction' }]);
});

test('a fresh pause cancels a prepared automatic transition before its F0 can appear', async () => {
  const f = fixture(); automatic(f, 'review'); await decode(f);
  assert.equal(f.offers.length, 1); const obsolete = f.offers[0].commit;
  f.p.applyFreeze(true);
  assert.equal(f.p.pending, null); assert.equal(f.visible.paused, true);
  assert.equal(obsolete(), false); assert.equal(f.p.displayedAnim, 'running');
  assert.equal(f.receipts.some(row => row.id === 'task-review' && row.status === 'playing'), false);
  assert.equal(f.receipts.filter(row => row.id === 'task-review' && row.status === 'cancelled').length, 1);
});

test('renewing an existing controller freeze preserves the already prepared natural return', async () => {
  const f = fixture(); f.p.applyFreeze(true);
  automatic(f, 'waiting'); await decode(f);
  assert.equal(f.offers.length, 1); const pending = f.p.pending, cancels = f.cancels;
  f.p.applyFreeze(true); f.p.applyFreeze(true);
  assert.equal(f.p.pending, pending); assert.equal(f.cancels, cancels);
  assert.equal(f.p.displayedAnim, 'running'); assert.equal(f.p.frozen, true);
  assert.equal(f.offers[0].commit(), true); assert.equal(f.p.displayedAnim, 'waiting');
});

test('explicit user pause cancels an automatic return even when the controller freeze is already active', async () => {
  const f = fixture(); f.p.applyFreeze(true);
  automatic(f, 'review'); await decode(f);
  assert.equal(f.offers.length, 1); const obsolete = f.offers[0].commit;
  f.p.nativePanelSession = 9;
  f.p.onNativePanelEvent({ kind: 'command', session: 9, command: { type: 'pause' } });
  assert.equal(f.p.pending, null); assert.equal(obsolete(), false);
  assert.equal(f.p.displayedAnim, 'running'); assert.equal(f.p.frozen, true);
  assert.equal(f.receipts.filter(row => row.id === 'task-review' && row.status === 'cancelled').length, 1);
});

test('external custom video URLs retain immediate upstream semantics rather than receiving local pose assumptions', async () => {
  const f = fixture(); automatic(f, 'waiting'); await decode(f);
  assert.equal(f.offers.length, 1); const obsolete = f.offers[0].commit, cancels = f.cancels;
  const url = 'https://example.invalid/custom.webm'; f.p.playUrlOnce(url, 'custom'); await decode(f);
  assert.equal(f.offers.length, 1, 'a foreign clip cannot inherit the hash-bound local return policy');
  assert.ok(f.cancels > cancels); assert.equal(obsolete(), false);
  assert.equal(f.p.displayedAnim, url);
  assert.equal(f.receipts.filter(row => row.id === 'custom' && row.status === 'playing').length, 1);
});

test('failure of a task target after the previous real ended event resumes that prior chain once', async () => {
  const f = fixture('review'); automatic(f, 'waiting'); await decode(f);
  assert.equal(f.offers.length, 1); const pending = f.p.pending;
  let recovered = 0; f.p.handleEnded = () => { recovered++; };
  f.visible.ended = true; f.visible.paused = true;
  pending.failHandoff('asset-load');
  assert.equal(f.p.pending, null); assert.equal(f.p.anim, 'review'); assert.equal(recovered, 1);
  assert.equal(f.p.displayedAnim, 'review'); assert.equal(f.offers[0].commit(), false);
  assert.equal(f.receipts.filter(row => row.id === 'task-waiting' && row.status === 'failed').length, 1);
  pending.failHandoff('asset-load'); assert.equal(recovered, 1);
});

test('a real ended idle → idle handoff preserves the existing frost phase while idle → task retires it', async () => {
  for (const target of ['idle', 'running']) {
    let retired = 0, committed = 0;
    const raf = new Map(); let sequence = 0;
    const host = { requestAnimationFrame(callback) { const id = ++sequence; raf.set(id, callback); return id; }, cancelAnimationFrame(id) { raf.delete(id); }, performance: { now: () => 0 } };
    const document = { defaultView: host, createElement() { assert.fail('an already ended neutral handoff needs no new frame cache'); } };
    const video = new Video('idle');
    Object.assign(video, { petOutlineAssetName: 'idle', petPlaybackGeneration: 5, videoWidth: 1280, videoHeight: 720,
      petPaintedMediaTime: 115 / 24, _time: 115 / 24, ended: true });
    const sprite = { assetBase: base, front: 0, videoA: video, videoB: new Video('running'),
      videoSurface: { width: 1280, height: 720, ownerDocument: document }, stage: { ownerDocument: document },
      isShuanglingProfile: () => true, squashRef: null,
      frost: { beginTransition() { retired++; } },
      stopVideoPaint() {}, stopMove() {}, startVideoPaint() {},
    };
    const handoff = handoffApi.create(sprite);
    handoff.request({ anim: target }, () => { committed++; return true; });
    assert.equal(committed, 0, 'even neutral delivery is deferred outside the old frame/ended stack');
    await settle();
    assert.equal(committed, 1);
    assert.equal(retired, target === 'idle' ? 0 : 1, 'a repeat of continuous idle must not reset its existing frost phase');
    handoff.dispose(); assert.equal(raf.size, 0);
  }
});

function realReturnFixture() {
  let now = 0, sequence = 0;
  const raf = new Map();
  const host = { requestAnimationFrame(callback) { const id = ++sequence; raf.set(id, callback); return id; },
    cancelAnimationFrame(id) { raf.delete(id); }, performance: { now: () => now } };
  const document = { defaultView: host, createElement(type) {
    assert.equal(type, 'canvas');
    const canvas = { width: 0, height: 0, frame: null, ownerDocument: document };
    const context = { save() {}, restore() {}, drawImage(input) { canvas.frame = input.frame; } };
    canvas.getContext = () => context; return canvas;
  } };
  const integrated = fixture('running'), sprite = integrated.p, video = integrated.visible;
  Object.assign(video, { petOutlineAssetName: 'running', petPlaybackGeneration: sprite.gen, videoWidth: 1280, videoHeight: 720,
    petPaintedMediaTime: 0, _time: 0, paused: false, playCalls: 0, pauseCalls: 0 });
  const surface = { width: 1280, height: 720, frame: 0, ownerDocument: document };
  const context = { save() {}, restore() {}, drawImage(input) { surface.frame = input.frame; } };
  surface.getContext = () => context;
  Object.assign(sprite, { videoSurface: surface, stage: { ownerDocument: document }, squashRef: null,
    frozen: false, dragState: { active: false }, interaction: null, startPaints: 0,
    stopVideoPaint() {}, stopMove() {}, startVideoPaint() { this.startPaints++; },
    paintVideoFrame(item, time) { surface.frame = time * 24; item.petPaintedMediaTime = time; },
  });
  const handoff = handoffApi.create(sprite); handoff.onCommit(video, video.petPlaybackGeneration);
  sprite.handoff = handoff;
  for (let frame = 1; frame <= 24; frame++) {
    video._time = video.petPaintedMediaTime = frame / 24; surface.frame = frame;
    handoff.capture(video, frame / 24);
  }
  return { sprite, video, handoff,
    async reverse(withPreparedTask = false) {
      if (withPreparedTask) {
        automatic({ p: sprite }, 'waiting'); await decode({ p: sprite });
        assert.equal(sprite.pending?.ready, true, 'the actual automatic target must own a prepared sprite transaction');
      } else handoff.request({ anim: 'waiting' }, () => assert.fail('a canceled task return must not commit its target'));
      for (let elapsed = 0; elapsed < 330; elapsed += 10) {
        now += 10; const callbacks = [...raf.values()]; raf.clear();
        for (const callback of callbacks) callback(now);
        await settle();
      }
    },
  };
}

for (const [name, newInput] of [
  ['freeze', sprite => { sprite.applyFreeze(true); }],
  ['active drag', sprite => { sprite.beginInteraction('drag', 'dragging', true); sprite.dragState.active = true; }],
  ['pointer', sprite => { sprite.beginInteraction('click', 'pointer', true); }],
  ['throwing', sprite => { sprite.beginInteraction('drag', 'throwing', true); }],
  ['explicit panel pause', sprite => {
    sprite.nativePanelSession = 19;
    sprite.onNativePanelEvent({ kind: 'command', session: 19, command: { type: 'pause' } });
  }],
]) {
  test(`a late real decoder recovery cannot resume playback across a newer ${name}`, async () => {
    const f = realReturnFixture(); await f.reverse(true);
    const generation = f.video.petPlaybackGeneration;
    newInput(f.sprite);
    // Real input clears the recovery and then its prepared sprite command.
    // The second cancellation invalidates the first cancellation's seeked
    // listener, so completing that decoder seek cannot revive old playback.
    assert.equal(f.sprite.pending, null, 'the real input cancels the automatic sprite transaction');
    assert.equal(f.video.seeking, true); assert.equal(f.video.paused, true); assert.equal(f.sprite.startPaints, 0);
    f.video.finishSeek(); await settle();
    assert.equal(f.video.paused, true, 'the newer input owns playback after the saved seek was requested');
    assert.equal(f.video.playCalls, 0); assert.equal(f.sprite.startPaints, 0);
    assert.equal(f.video.petPlaybackGeneration, generation); assert.equal(f.sprite.displayedAnim, 'running');
    f.handoff.dispose();
  });
}

test('a real canceled return still resumes its actual saved frame when no newer input took over', async () => {
  const f = realReturnFixture(); await f.reverse();
  const shownTime = f.video.petPaintedMediaTime;
  f.handoff.cancel(); assert.equal(f.video.currentTime, shownTime); assert.equal(f.video.seeking, true);
  f.video.finishSeek(); await settle();
  assert.equal(f.video.paused, false); assert.equal(f.video.playCalls, 1); assert.equal(f.sprite.startPaints, 1);
  assert.equal(f.video.petPaintedMediaTime, shownTime);
  f.handoff.dispose();
});

for (const [name, ownInput] of [
  ['active drag', sprite => { sprite.dragState.active = true; }],
  ['pointer', sprite => { sprite.beginInteraction('click', 'pointer', true); }],
  ['dragging', sprite => { sprite.beginInteraction('drag', 'dragging', true); }],
  ['throwing', sprite => { sprite.beginInteraction('drag', 'throwing', true); }],
]) {
  test(`a controller unlock cannot insert an automatic work or idle gesture during ${name}`, () => {
    const f = fixture('review'); f.p.applyFreeze(true); ownInput(f.p);
    const generation = f.p.gen, source = f.visible.petAnimationSource;
    let workResumes = 0; const idleResumes = [];
    f.p.resumeWorkStatusAnim = () => { workResumes++; return false; };
    f.p.playOnce = name => idleResumes.push(name);
    f.p.applyFreeze(false);
    assert.equal(f.p.frozen, false, 'the obsolete controller lease is still released');
    assert.equal(workResumes, 0, 'lease release does not own a newer pointer or motion operation');
    assert.deepEqual(idleResumes, []); assert.equal(f.p.gen, generation);
    assert.equal(f.p.pending, null); assert.equal(f.visible.petAnimationSource, source);
    assert.equal(f.visible.paused, true);
  });
}

test('an ordinary settled controller unlock still restores work or idle through the existing path', () => {
  for (const hasWork of [true, false]) {
    const f = fixture('review'); f.p.applyFreeze(true);
    f.p.beginInteraction('click', 'settled', true);
    let workResumes = 0; const idleResumes = [];
    f.p.resumeWorkStatusAnim = () => { workResumes++; return hasWork; };
    f.p.playOnce = name => idleResumes.push(name);
    f.p.applyFreeze(false);
    assert.equal(f.p.frozen, false); assert.equal(workResumes, 1);
    assert.deepEqual(idleResumes, hasWork ? [] : ['idle']);
  }
});
