import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
const variantsSource = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/shuangling-manual-variants.js', import.meta.url), 'utf8');
const base = 'dsh-pet-bridge://dsh-pet/dsh-pet-7340/thumb/main/';
class Video {
  constructor(name = 'idle') {
    this.listeners = new Map(); this.style = {}; this.classList = { add() {}, remove() {} };
    this.readyState = 4; this.seeking = false; this.error = null; this._time = 0;
    this.paused = true; this.ended = false; this.loop = false; this.duration = 4.916667;
    this.playCalls = 0; this.pauseCalls = 0;
    this.petAnimationSource = this.petPreloadedSource = base + name + '.webm';
  }
  get currentTime() { return this._time; }
  set currentTime(value) { this._time = value; this.seeking = true; }
  pause() { this.pauseCalls++; this.paused = true; }
  play() { this.playCalls++; this.paused = false; this.ended = false; return Promise.resolve(); }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name) { for (const callback of [...(this.listeners.get(name) || [])]) callback(); }
  load() { this.readyState = 4; this.emit('loadeddata'); }
  finishSeek() { this.seeking = false; this.emit('seeked'); }
}
function fixture({ variants = false, random = () => 0, noMirror = () => false } = {}) {
  let randomCalls = 0;
  const noMirrorQueries = [];
  const animationFrames = new Map(), cancelledFrames = [];
  let frameSequence = 0, now = 0;
  const scheduleFrame = callback => { const id = ++frameSequence; animationFrames.set(id, callback); return id; };
  const cancelFrame = id => { cancelledFrames.push(id); animationFrames.delete(id); };
  const context = vm.createContext({
    window: { __dshPetDebug: {}, setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: false }), petBridge: { closePanel() {} } },
    requestAnimationFrame: scheduleFrame, cancelAnimationFrame: cancelFrame, performance: { now: () => now },
    SHUANGLING_PROFILE: true, BASE: '', S: { ANIMATION_EXT: '.webm', postAction: () => Promise.resolve(true), isNoMirrorAnimation: (_categories, name) => { noMirrorQueries.push(name); return noMirror(name); }, isEventAnim: () => false, pick: values => values[0], SQ_DURATION_MS: 500, SQ_SQUASH: .55, squashScale: (u, depth) => 1 - depth * Math.sin(Math.PI * u) },
    Math: Object.assign(Object.create(Math), { random() { randomCalls++; return random(); } }),
    console: { log() {}, warn() {} },
  });
  if (variants) vm.runInContext(variantsSource, context);
  vm.runInContext(source + '\nthis.P=PetSprite.prototype;', context);
  const p = Object.create(context.P), paints = [], paintStarts = [], receipts = [], interactionUpdates = [];
  let stops = 0;
  Object.assign(p, {
    pet: { id: 'shuangling' }, assetBase: base, front: 0, videoA: new Video(), videoB: new Video('waving'),
    pending: null, idlePreload: null, gen: 0, playback: null, displayedOnce: true,
    videoSurface: { style: {} }, dragState: { active: false }, interactionSession: 'test', interactionSequence: 0,
    animations: { idle: ['idle'], categories: [], moves: { actions: [] }, events: {}, drag: [], clicks: [], turn: [] },
    frozen: false, lockTimer: null, nativePanelSession: null, nativePanelInteraction: null,
    squashToken: 0, squashRef: null, pendingSquash: false,
    paintVideoFrame(video, time) { paints.push({ name: video.petOutlineAssetName, time, decoderTime: video.currentTime }); },
    startVideoPaint(video) { paintStarts.push(video); }, stopVideoPaint() {}, preloadIdleFrame() {}, videoFacingTransform: () => '',
    reportPlayback(id, status, reason) { receipts.push({ id, status, reason }); },
    stopMove() { stops++; }, stopThrow() {}, closeMenu() {}, reportPose() {},
    setTip() {}, syncInputBusy() {}, setInteractive() {}, resumeWorkStatusAnim: () => false, playIdle() {},
    updateInteraction(phase, extra = {}) { this.interaction = { ...this.interaction, ...extra, phase }; interactionUpdates.push(phase); },
  });
  p.switchTo('waving', true);
  const wave = p.videoB; wave._time = 1.25;
  return { p, wave, paints, paintStarts, receipts, interactionUpdates, noMirrorQueries, animationFrames, cancelledFrames,
    runFrame(time) { now = time; const [id, callback] = animationFrames.entries().next().value; animationFrames.delete(id); callback(time); },
    get randomCalls() { return randomCalls; }, get stops() { return stops; }, context };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
async function finishPrepared(f) {
  for (let attempt = 0; attempt < 3 && f.p.pending; attempt++) {
    await settle();
    const hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA;
    if (hidden.seeking) hidden.finishSeek();
  }
  await settle();
  assert.equal(f.p.pending, null, 'a completed real zero-time seek must commit the newest request');
}
async function finishVisible(f) {
  f.wave._time = f.wave.duration; f.wave.paused = true; f.wave.ended = true;
  f.wave.onended(); await settle();
  const hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA;
  if (hidden.seeking) hidden.finishSeek();
  await settle();
}

function installHandoffGate(f) {
  const offers = [], commits = [];
  let cancels = 0;
  f.p.handoff = {
    request(transaction, commit) { offers.push({ transaction, commit }); },
    cancel() { cancels++; },
    onCommit(video, generation) { commits.push({ video, generation }); },
  };
  return { offers, commits, get cancels() { return cancels; } };
}

async function prepareForGate(f) {
  for (let attempt = 0; attempt < 3 && !f.p.pending?.ready; attempt++) {
    await settle();
    const hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA;
    if (hidden.seeking) hidden.finishSeek();
  }
  await settle();
  assert.equal(f.p.pending?.ready, true, 'the hidden decoder must be ready without becoming visible');
}

test('a prepared manual target is offered to the pose gate without painting until the gate releases it', async () => {
  const f = fixture(), gate = installHandoffGate(f);
  f.p.onMenuAction({ anim: 'review' });
  assert.equal(gate.offers.length, 0, 'loading is not a pose-safe commit');
  await prepareForGate(f);
  const pending = f.p.pending;
  assert.equal(gate.offers.length, 1); assert.equal(gate.offers[0].transaction, pending);
  assert.equal(f.p.displayedAnim, 'waving'); assert.equal(f.wave.currentTime, 1.25);
  assert.equal(f.paints.length, 1, 'target F0 must not hard-cut across an unfinished outgoing pose');
  assert.equal(f.p.videoA.paused, true); assert.equal(f.p.videoA.currentTime, 0);
  assert.equal(gate.offers[0].commit(), true, 'the recovery may release its saved return state only after a real commit');
  assert.equal(f.p.pending, null); assert.equal(f.p.displayedAnim, 'review');
  assert.equal(f.paints.at(-1).decoderTime, 0); assert.equal(f.paints.at(-1).time, 0);
  assert.equal(gate.commits.length, 1); assert.equal(gate.commits[0].video, f.p.videoA);
  assert.equal(gate.commits[0].generation, pending.gen);
  const count = f.paints.length; assert.equal(gate.offers[0].commit(), false);
  assert.equal(f.paints.length, count, 'a duplicate gate callback cannot paint or start the chosen action twice');
});

test('an already decoded target still waits for the outgoing pose gate rather than bypassing it', () => {
  const f = fixture(), gate = installHandoffGate(f);
  f.p.videoA.petAnimationSource = f.p.videoA.petPreloadedSource = base + 'review.webm';
  f.p.onMenuAction({ anim: 'review' });
  assert.equal(f.p.pending.ready, true); assert.equal(gate.offers.length, 1);
  assert.equal(f.p.displayedAnim, 'waving'); assert.equal(f.paints.length, 1);
  assert.equal(f.p.videoA.playCalls, 0, 'a decoded F0 may remain paused during the actual-frame recovery');
  gate.offers[0].commit();
  assert.equal(f.p.displayedAnim, 'review'); assert.equal(f.p.videoA.playCalls, 1);
});

test('a ready manual preparation can be reused by an external owner without getting stranded behind the old gate', async () => {
  const f = fixture(), gate = installHandoffGate(f);
  f.p.onMenuAction({ anim: 'review' }); await prepareForGate(f);
  const pending = f.p.pending, generation = f.p.gen, obsoleteCommit = gate.offers[0].commit;
  f.p.onMenuAction({ anim: 'review', playbackId: 'external-owner' });
  assert.equal(f.p.gen, generation, 'ownership reuse must not reload or re-seek the same decoded take');
  assert.equal(pending.manualAction, false); assert.equal(pending.playbackId, 'external-owner');
  assert.equal(f.p.pending, null); assert.equal(f.p.displayedAnim, 'review');
  assert.ok(gate.cancels > 0, 'external control cancels local recovery ownership');
  assert.equal(f.receipts.filter(row => row.id === 'external-owner' && row.status === 'playing').length, 1);
  const count = f.paints.length; assert.equal(obsoleteCommit(), false); assert.equal(f.paints.length, count);
});

test('a repeated local choice reoffers its already ready preparation without drawing or selecting a second take', async () => {
  const f = fixture({ variants: true, random: () => .8 }), gate = installHandoffGate(f);
  f.p.onMenuAction({ anim: 'review' }); await prepareForGate(f);
  const pending = f.p.pending, generation = f.p.gen;
  // Reuse the exact chosen take without requesting another logical random draw.
  f.p.switchTo(pending.anim, true, undefined, undefined, true);
  assert.equal(f.p.pending, pending); assert.equal(f.p.gen, generation); assert.equal(f.randomCalls, 1);
  assert.equal(gate.offers.length, 2); assert.equal(gate.offers[1].transaction, pending);
  assert.equal(f.paints.length, 1); assert.equal(f.p.displayedAnim, 'waving');
  gate.offers[1].commit(); assert.equal(f.p.displayedAnim, 'review-classic');
});

test('an obsolete pose-gate callback cannot commit over a newer prepared local action', async () => {
  const f = fixture(), gate = installHandoffGate(f);
  f.p.onMenuAction({ anim: 'review' }); await prepareForGate(f);
  const obsolete = gate.offers[0].commit;
  f.p.onMenuAction({ anim: 'waiting' }); await prepareForGate(f);
  const latest = f.p.pending;
  assert.equal(obsolete(), false, 'a superseded return must retain its safe exit until the newer target is ready');
  assert.equal(f.p.pending, latest); assert.equal(f.p.displayedAnim, 'waving'); assert.equal(f.paints.length, 1);
  assert.equal(gate.offers.at(-1).commit(), true); assert.equal(f.p.displayedAnim, 'waiting');
  assert.equal(obsolete(), false); assert.ok(!f.paints.some(row => row.name === 'review'));
});

test('a pointer takeover cancels the pose gate and invalidates its deferred target commit', async () => {
  const f = fixture(), gate = installHandoffGate(f);
  f.p.onMenuAction({ anim: 'review' }); await prepareForGate(f);
  const obsolete = gate.offers[0].commit, cancels = gate.cancels;
  f.p.beginInteraction('drag', 'dragging', true);
  assert.ok(gate.cancels > cancels); assert.equal(f.p.pending, null);
  assert.equal(obsolete(), false); assert.equal(f.p.displayedAnim, 'waving'); assert.equal(f.paints.length, 1);
});

test('a newly prepared target resets inherited decoder speed before its gate is offered', async () => {
  const f = fixture(), gate = installHandoffGate(f);
  f.p.videoA.playbackRate = 2.5;
  f.p.onMenuAction({ anim: 'review' });
  assert.equal(f.p.videoA.playbackRate, 1, 'old recovery speed cannot accelerate the next action');
  await prepareForGate(f); assert.equal(gate.offers.length, 1);
  gate.offers[0].commit(); assert.equal(f.p.videoA.playbackRate, 1);
});

test('neutral predecode resets a reused hidden decoder speed without changing the visible animation', () => {
  const f = fixture(); f.p.videoA.playbackRate = 2.5;
  f.context.P.preloadIdleFrame.call(f.p);
  assert.equal(f.p.videoA.playbackRate, 1); assert.equal(f.p.videoA.paused, true);
  assert.equal(f.p.displayedAnim, 'waving'); assert.equal(f.wave.currentTime, 1.25); assert.equal(f.paints.length, 1);
});

test('a failed successor lets a genuinely ended outgoing clip take its normal completion path once', () => {
  const f = fixture(); f.p.onMenuAction({ anim: 'review' });
  const pending = f.p.pending; f.wave.paused = true; f.wave.ended = true;
  let completions = 0;
  f.p.handleEnded = () => {
    completions++;
    assert.equal(f.p.pending, null, 'the failed preparation must be cleared before resuming the ordinary chain');
    assert.equal(f.p.anim, 'waving', 'normal completion must see the outgoing animation, not the failed request');
  };
  pending.failHandoff('decode-error');
  assert.equal(completions, 1, 'an ended outgoing decoder cannot resume with play() alone');
  pending.failHandoff('duplicate-error'); assert.equal(completions, 1);
});

test('a failed successor cannot use ended recovery to override freeze, drag, or a newer preparation', () => {
  for (const block of ['freeze', 'drag', 'new-pending']) {
    const f = fixture(); f.p.onMenuAction({ anim: 'review' });
    const pending = f.p.pending; f.wave.paused = true; f.wave.ended = true;
    f.p.handleEnded = () => assert.fail(block + ' must retain priority over a failed successor');
    if (block === 'freeze') f.p.frozen = true;
    if (block === 'drag') f.p.dragState.active = true;
    if (block === 'new-pending') {
      f.p.onMenuAction({ anim: 'waiting' });
      const latest = f.p.pending;
      pending.failHandoff('obsolete-error');
      assert.equal(f.p.pending, latest); assert.equal(f.p.pending.anim, 'waiting');
    } else {
      pending.failHandoff('decode-error'); assert.equal(f.p.pending, null);
    }
  }
});

test('a local choice prepares before the old finite action ends and commits only its real F0', async () => {
  const f = fixture(), oldEnded = f.wave.onended, generation = f.p.gen;
  f.p.beginInteraction('menu', 'blocked', false);
  f.p.onMenuAction({ anim: 'review' });
  assert.equal(f.p.gen, generation + 1, 'preparation must begin during the click, not at old ended');
  assert.equal(f.p.pending.anim, 'review'); assert.equal(f.p.displayedAnim, 'waving');
  assert.equal(f.wave.currentTime, 1.25); assert.equal(f.wave.ended, false); assert.equal(f.wave.paused, false);
  assert.equal(f.paints.length, 1, 'the old canvas remains the only visible character until decoding is ready');
  await settle();
  assert.equal(f.p.videoA.seeking, true); assert.equal(f.paints.length, 1, 'a zero timestamp while seeking is not a decoded F0');
  await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'review'); assert.equal(f.wave.ended, false); assert.equal(f.wave.currentTime, 1.25);
  assert.equal(f.p.interaction.phase, 'blocked', 'old ended must not settle the new manual action');
  assert.equal(f.p.interaction.resumable, false);
  assert.equal(f.paints.at(-1).time, 0); assert.equal(f.paints.at(-1).decoderTime, 0);
  const count = f.paints.length; oldEnded();
  assert.equal(f.paints.length, count, 'the old generation cannot end or repaint the new clip');
});

test('an already predecoded target reacts immediately while the old action remains unfinished', () => {
  const f = fixture();
  f.p.videoA.petAnimationSource = f.p.videoA.petPreloadedSource = base + 'review.webm';
  f.p.beginInteraction('menu', 'blocked', false);
  f.p.onMenuAction({ anim: 'review' });
  assert.equal(f.p.pending, null); assert.equal(f.p.displayedAnim, 'review');
  assert.equal(f.wave.ended, false); assert.equal(f.wave.currentTime, 1.25);
  assert.equal(f.paints.length, 2); assert.deepEqual(f.paints.at(-1), { name: 'review', time: 0, decoderTime: 0 });
});

test('rapid local choices replace preparations immediately and obsolete callbacks cannot commit', async () => {
  const f = fixture(), generation = f.p.gen, oldEnded = f.wave.onended;
  f.p.beginInteraction('menu', 'blocked', false);
  f.p.onMenuAction({ anim: 'review' });
  const obsoleteReady = [...f.p.videoA.listeners.get('loadeddata')];
  const obsoleteErrors = [...f.p.videoA.listeners.get('error')];
  f.p.onMenuAction({ anim: 'waiting' });
  const latest = f.p.pending;
  assert.equal(f.p.gen, generation + 2); assert.equal(latest.anim, 'waiting');
  assert.equal(f.p.displayedAnim, 'waving'); assert.equal(f.wave.ended, false);
  for (const callback of [...obsoleteReady, ...obsoleteErrors]) callback();
  oldEnded();
  assert.equal(f.p.pending, latest); assert.equal(f.p.displayedAnim, 'waving');
  await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'waiting'); assert.equal(f.p.interaction.resumable, false);
  assert.ok(!f.paints.some(row => row.name === 'review'));
  const count = f.paints.length;
  for (const callback of [...obsoleteReady, ...obsoleteErrors]) callback();
  oldEnded(); assert.equal(f.paints.length, count); assert.equal(f.p.displayedAnim, 'waiting');
});

test('readonly panel open preserves an active finite clip and an existing manual preparation', () => {
  const f = fixture(); f.p.frozen = true;
  f.p.onNativePanelEvent({ kind: 'opened', session: 1, allowResume: true });
  assert.equal(f.p.frozen, false); assert.equal(f.wave.currentTime, 1.25); assert.equal(f.wave.paused, false);
  assert.equal(f.p.displayedAnim, 'waving'); assert.equal(f.stops, 0);
  f.p.onMenuAction({ anim: 'review' });
  const prepared = f.p.pending;
  f.p.onNativePanelEvent({ kind: 'opened', session: 2, allowResume: false });
  f.p.onNativePanelEvent({ kind: 'closed', session: 2 });
  assert.equal(f.p.pending, prepared); assert.equal(f.p.displayedAnim, 'waving');
});

test('a genuinely frozen finite clip resumes the same decoder when its readonly panel yields control', async () => {
  const f = fixture(), generation = f.p.gen, source = f.wave.petAnimationSource, time = f.wave.currentTime;
  f.p.applyFreeze(true);
  assert.equal(f.p.frozen, true); assert.equal(f.wave.paused, true);
  const plays = f.wave.playCalls, paintStarts = f.paintStarts.length;
  f.p.onNativePanelEvent({ kind: 'opened', session: 1, allowResume: true });
  await settle();
  assert.equal(f.p.frozen, false); assert.equal(f.wave.paused, false);
  assert.equal(f.p.gen, generation, 'opening a readonly panel must not insert an idle or work clip');
  assert.equal(f.p.displayedAnim, 'waving'); assert.equal(f.p.pending, null);
  assert.equal(f.wave.petAnimationSource, source); assert.equal(f.wave.currentTime, time);
  assert.equal(f.wave.playCalls, plays + 1);
  assert.equal(f.paintStarts.length, paintStarts + 1); assert.equal(f.paintStarts.at(-1), f.wave);
  f.p.onNativePanelEvent({ kind: 'closed', session: 1 });
  assert.equal(f.p.displayedAnim, 'waving'); assert.equal(f.wave.currentTime, time);
});

test('the explicit preserve flag accepts a paused finite decoder but rejects ended, looping or invalid clips', () => {
  const f = fixture(); f.wave.paused = true;
  assert.equal(f.p.isFiniteClipPlaying(), false, 'normal playing checks must still reject paused media');
  assert.equal(f.p.isFiniteClipPlaying(true), true);
  for (const change of [{ ended: true }, { loop: true }, { error: { code: 3 } }, { readyState: 1 }, { duration: Infinity }]) {
    const invalid = fixture(); Object.assign(invalid.wave, change, { paused: true });
    assert.equal(invalid.p.isFiniteClipPlaying(true), false);
  }
});

test('ordinary unlock retains the normal work or idle selection rather than using readonly preservation', () => {
  const f = fixture(), generation = f.p.gen;
  f.p.applyFreeze(true); assert.equal(f.wave.paused, true);
  f.p.applyFreeze(false);
  assert.equal(f.p.gen, generation + 1);
  assert.equal(f.p.displayedAnim, 'idle'); assert.equal(f.p.frozen, false);
});

test('a late rejected readonly resume cannot stop a newer playback that reused the same decoder slot', async () => {
  const f = fixture(); f.p.applyFreeze(true);
  const generation = f.wave.petPlaybackGeneration;
  let rejectResume;
  f.wave.play = function () { this.paused = false; return new Promise((_resolve, reject) => { rejectResume = reject; }); };
  f.p.onNativePanelEvent({ kind: 'opened', session: 1, allowResume: true });
  let paintStops = 0; f.p.stopVideoPaint = () => { paintStops++; };
  // Two later switches may bring this same video element back to the front.
  f.wave.petPlaybackGeneration = generation + 2;
  f.p.videoPaint = { video: f.wave, generation: generation + 2 };
  rejectResume(new Error('obsolete-play-rejected'));
  await settle();
  assert.equal(paintStops, 0, 'element identity alone cannot establish resume callback ownership');
});

test('a rejected readonly resume still stops its own current paint clock', async () => {
  const f = fixture(); f.p.applyFreeze(true);
  let rejectResume;
  f.wave.play = function () { return new Promise((_resolve, reject) => { rejectResume = reject; }); };
  f.p.onNativePanelEvent({ kind: 'opened', session: 1, allowResume: true });
  let paintStops = 0; f.p.stopVideoPaint = () => { paintStops++; };
  rejectResume(new Error('current-play-rejected'));
  await settle();
  assert.equal(paintStops, 1);
  assert.equal(f.p.pending, null, 'a failed preserve resume must not flash an unrelated idle/work source');
});

test('a preserved decoder whose external receipt was cancelled still completes without reviving that receipt', async () => {
  const f = fixture();
  f.p.switchTo('review', true, 'cancelled-before-preserve');
  await finishPrepared(f);
  const current = f.p.front === 0 ? f.p.videoA : f.p.videoB;
  current._time = 1.25;
  f.p.applyFreeze(true);
  assert.equal(current.paused, true); assert.equal(f.p.playback, null);
  assert.equal(f.receipts.filter(row => row.id === 'cancelled-before-preserve' && row.status === 'cancelled').length, 1);
  f.p.onNativePanelEvent({ kind: 'opened', session: 1, allowResume: true });
  await settle();
  assert.equal(current.paused, false); assert.equal(f.p.displayedAnim, 'review');
  let completions = 0; f.p.handleEnded = () => { completions++; };
  current._time = current.duration; current.paused = true; current.ended = true;
  current.onended(); current.onended();
  assert.equal(completions, 1, 'a cancelled external receipt must not strand its preserved visible decoder');
  assert.equal(f.receipts.filter(row => row.id === 'cancelled-before-preserve' && row.status === 'ended').length, 0);
});

test('an outgoing squash callback cannot resize a newly committed manual action', async () => {
  const f = fixture();
  f.p.startSquash(f.wave);
  f.runFrame(100);
  assert.match(f.p.videoSurface.style.transform, /scaleY\(/);
  const oldRef = f.p.squashRef, lateFrame = f.animationFrames.get(oldRef);
  assert.equal(typeof lateFrame, 'function');
  f.p.onMenuAction({ anim: 'review' });
  await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'review');
  assert.ok(f.cancelledFrames.includes(oldRef), 'the outgoing scale driver must be cancelled at handoff');
  assert.equal(f.p.squashRef, null);
  const transform = f.p.videoSurface.style.transform;
  assert.equal(transform, '', 'the new neutral frame must use its normal transform');
  lateFrame(200);
  assert.equal(f.p.videoSurface.style.transform, transform, 'even a queued old callback cannot touch the new canvas');
  assert.equal(f.animationFrames.size, 0);
});

test('a deliberate menu animation cannot inherit a superseded click squash that never started', async () => {
  const f = fixture();
  f.p.pendingSquash = true;
  let squashes = 0; f.p.startSquash = () => { squashes++; };
  f.p.onMenuAction({ anim: 'review' });
  await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'review');
  assert.equal(squashes, 0, 'the new gesture is independent of an earlier click bounce');
  assert.equal(f.p.pendingSquash, false);
  assert.equal(f.p.videoSurface.style.transform, '');
});

test('a Shuangling click clip commits without replaying feedback already shown on press', async () => {
  const f = fixture();
  f.p.animations.clicks = ['review'];
  let squashes = 0; f.p.startSquash = () => { squashes++; };
  f.p.startClickFeedback(); f.p.clickFeedbackOnPress = true;
  f.p.onClick();
  assert.equal(squashes, 1); assert.equal(f.p.pendingSquash, false);
  await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'review');
  assert.equal(squashes, 1, 'decoding and handoff cannot replay the completed local recoil');
  assert.equal(f.p.pendingSquash, false);
});

test('a fast release and ready click video preserve the whole surface recoil through decoder commit', async () => {
  const f = fixture(); f.p.animations.clicks = ['review'];
  f.p.interaction = { id: 'same-click', kind: 'click', phase: 'pointer' };
  f.p.startClickFeedback(); f.p.clickFeedbackOnPress = true;
  f.runFrame(16); const transform = f.p.videoSurface.style.transform;
  assert.match(transform, /scaleY\(/);
  f.p.interaction.phase = 'blocked'; f.p.onClick();
  await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'review');
  assert.notEqual(f.p.squashRef, null, 'fast video preparation cannot cut the feedback short');
  assert.equal(f.p.videoSurface.style.transform, transform);
  f.runFrame(120); assert.match(f.p.videoSurface.style.transform, /scaleY\(/);
  f.runFrame(520);
  assert.equal(f.p.squashRef, null); assert.equal(f.p.videoSurface.style.transform, '');
});

test('a new menu interaction does not inherit the previous click surface driver', async () => {
  const f = fixture(); f.p.interaction = { id: 'old-click', kind: 'click', phase: 'blocked' };
  f.p.startClickFeedback(); f.runFrame(16);
  const old = f.p.squashRef;
  f.p.interaction = { id: 'new-menu', kind: 'menu', phase: 'blocked' };
  f.p.onMenuAction({ anim: 'review' }); await finishPrepared(f);
  assert.equal(f.p.squashRef, null); assert.ok(f.cancelledFrames.includes(old));
  assert.equal(f.p.videoSurface.style.transform, '');
});

test('all current video states permit a new manual preparation without awaiting an ended event', () => {
  for (const change of [{}, { paused: true }, { ended: true }, { loop: true }, { readyState: 1 }, { duration: Infinity }]) {
    const f = fixture(); Object.assign(f.wave, change);
    const generation = f.p.gen;
    f.p.onMenuAction({ anim: 'review' });
    assert.equal(f.p.gen, generation + 1); assert.equal(f.p.pending.anim, 'review');
    assert.equal(f.p.displayedAnim, 'waving');
  }
});

test('external playback commands supersede manual preparation immediately with their exact receipt', () => {
  const f = fixture();
  f.p.onMenuAction({ anim: 'review' });
  assert.equal(f.p.pending.anim, 'review');
  f.p.onMenuAction({ anim: 'waiting', playbackId: 'external-command' });
  assert.equal(f.p.pending.anim, 'waiting');
  assert.equal(f.p.pending.playbackId, 'external-command');
});

test('the native panel animation command prepares its selected take during the command itself', async () => {
  const f = fixture({ variants: true, random: () => .8 });
  const generation = f.p.gen;
  f.p.nativePanelSession = 7;
  f.p.onNativePanelEvent({ kind: 'command', session: 7, command: { type: 'animation', name: 'review' } });
  assert.equal(f.p.gen, generation + 1); assert.equal(f.p.pending.anim, 'review-classic');
  assert.equal(f.randomCalls, 1); assert.equal(f.wave.ended, false); assert.equal(f.wave.currentTime, 1.25);
  assert.equal(f.p.displayedAnim, 'waving');
  assert.equal(f.p.interaction.kind, 'menu'); assert.equal(f.p.interaction.resumable, false);
  await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'review-classic'); assert.equal(f.randomCalls, 1);
  assert.deepEqual(f.paints.at(-1), { name: 'review-classic', time: 0, decoderTime: 0 });
});

test('a newly applied freeze cancels prepared manual playback before it can commit', async () => {
  const f = fixture(); f.p.onMenuAction({ anim: 'review' });
  const obsoleteReady = [...f.p.videoA.listeners.get('loadeddata')];
  assert.equal(f.p.pending.anim, 'review'); f.p.applyFreeze(true);
  assert.equal(f.p.pending, null); assert.equal(f.p.frozen, true);
  for (const callback of obsoleteReady) callback();
  await settle();
  assert.equal(f.p.displayedAnim, 'waving'); assert.ok(!f.paints.some(row => row.name === 'review'));
});

for (const [name, revoke] of [
  ['pointer', p => p.beginInteraction('click', 'pointer', true)],
  ['drag', p => p.beginInteraction('drag', 'dragging', true)],
  ...['pause', 'resume', 'quit'].map(type => [type, p => {
    p.nativePanelSession = 7;
    p.onNativePanelEvent({ kind: 'command', session: 7, command: { type } });
  }]),
]) {
  test(`a newer ${name} intent cancels local preparation and stale ready callbacks cannot replace it`, async () => {
    const f = fixture(); f.p.onMenuAction({ anim: 'review' });
    assert.equal(f.p.pending.manualAction, true);
    const oldReady = [...f.p.videoA.listeners.get('loadeddata')];
    const oldErrors = [...f.p.videoA.listeners.get('error')];
    revoke(f.p);
    assert.equal(f.p.pending, null);
    for (const callback of [...oldReady, ...oldErrors]) callback();
    await settle(); f.p.videoA.finishSeek(); await settle();
    assert.equal(f.p.displayedAnim, 'waving');
    assert.ok(!f.paints.some(row => row.name === 'review'));
  });
}

test('repeated choices of an already preparing take reuse the same decoder transaction', async () => {
  const f = fixture();
  f.p.beginInteraction('menu', 'blocked', false);
  f.p.onMenuAction({ anim: 'review' });
  const pending = f.p.pending, generation = f.p.gen;
  f.p.onMenuAction({ anim: 'review' });
  assert.equal(f.p.pending, pending); assert.equal(f.p.gen, generation);
  assert.equal(f.p.pending.manualAction, true);
  await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'review');
  assert.equal(f.paints.filter(row => row.name === 'review').length, 1);
});

test('an external owner of the same prepared take loses the old local-cancel marker', async () => {
  const f = fixture(); f.p.onMenuAction({ anim: 'review' });
  const pending = f.p.pending, generation = f.p.gen;
  assert.equal(pending.manualAction, true);
  f.p.onMenuAction({ anim: 'review', playbackId: 'same-source-task' });
  assert.equal(f.p.pending, pending); assert.equal(f.p.gen, generation);
  assert.notEqual(f.p.pending.manualAction, true); assert.equal(f.p.pending.playbackId, 'same-source-task');
  f.p.clearManualAction();
  assert.equal(f.p.pending, pending, 'clearing a local intent cannot revoke its new external owner');
  await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'review');
  assert.ok(f.receipts.some(row => row.id === 'same-source-task' && row.status === 'playing'));
});

test('a newer local choice of the same prepared external take gains local cancellation ownership', () => {
  const f = fixture(); f.p.onMenuAction({ anim: 'review', playbackId: 'external' });
  const pending = f.p.pending, generation = f.p.gen;
  assert.notEqual(pending.manualAction, true);
  f.p.onMenuAction({ anim: 'review' });
  assert.equal(f.p.pending, pending); assert.equal(f.p.gen, generation);
  assert.equal(f.p.pending.manualAction, true); assert.equal(f.p.pending.playbackId, null);
  assert.ok(f.receipts.some(row => row.id === 'external' && row.status === 'cancelled'));
  f.p.beginInteraction('drag', 'dragging', true);
  assert.equal(f.p.pending, null);
});

test('a prepared local run is cancelled with its pending movement when a newer drag takes over', () => {
  const f = fixture(); f.p.animations.moves.actions = [{ name: 'running-right' }];
  f.p.tryMove = (name, id) => { f.p.pendingMove = { name }; f.p.playOnce(name, id); return name; };
  f.p.onMenuAction({ anim: 'running-right' });
  assert.equal(f.p.pending.anim, 'running-right'); assert.equal(f.p.pending.manualAction, true);
  const stops = f.stops;
  f.p.beginInteraction('drag', 'dragging', true);
  assert.equal(f.p.pending, null); assert.equal(f.stops, stops + 1);
});

test('a prepared obsolete external decoder cannot commit after a local manual choice', () => {
  const f = fixture(); let cancelled = 0;
  f.p.pending = { playbackId: 'obsolete', cancel() { cancelled++; } };
  f.p.onMenuAction({ anim: 'review' });
  assert.equal(cancelled, 1); assert.equal(f.p.pending.anim, 'review');
  assert.ok(f.receipts.some(row => row.id === 'obsolete' && row.status === 'cancelled' && row.reason === 'superseded'));
});

test('closing readonly info defers resumable handback until the same finite video truly ends', async () => {
  const f = fixture(); f.p.frozen = true;
  f.p.onNativePanelEvent({ kind: 'opened', session: 1, allowResume: true });
  const id = f.p.interaction.id;
  f.p.onNativePanelEvent({ kind: 'closed', session: 1 });
  assert.equal(f.p.interaction.phase, 'blocked'); assert.equal(f.p.pendingInfoBoundary.interactionId, id);
  assert.equal(f.wave.currentTime, 1.25); assert.equal(f.wave.paused, false);
  await finishVisible(f);
  assert.equal(f.p.pendingInfoBoundary, null); assert.equal(f.p.interaction.id, id);
  assert.equal(f.p.interaction.phase, 'settled'); assert.equal(f.p.interaction.resumable, true);
});

test('reopening readonly info retains its boundary and cannot hand back while the panel is still open', async () => {
  const f = fixture(); f.p.onNativePanelEvent({ kind: 'opened', session: 1, allowResume: true });
  const id = f.p.interaction.id;
  f.p.onNativePanelEvent({ kind: 'closed', session: 1 });
  f.p.onNativePanelEvent({ kind: 'opened', session: 2, allowResume: false });
  assert.equal(f.p.nativePanelInteraction, id); assert.equal(f.p.pendingInfoBoundary, null);
  await finishVisible(f);
  assert.equal(f.p.interaction.phase, 'blocked');
  f.p.onNativePanelEvent({ kind: 'closed', session: 2 });
  assert.equal(f.p.interaction.phase, 'settled'); assert.equal(f.p.interaction.resumable, true);
});

test('a stale info boundary cannot mark a newer manual interaction resumable', async () => {
  const f = fixture(); f.p.onNativePanelEvent({ kind: 'opened', session: 1, allowResume: true });
  f.p.onNativePanelEvent({ kind: 'closed', session: 1 });
  const stale = f.p.pendingInfoBoundary;
  f.p.beginInteraction('menu', 'blocked', false); const id = f.p.interaction.id;
  f.p.pendingInfoBoundary = stale; f.p.menuOpen = true;
  await finishVisible(f);
  assert.equal(f.p.pendingInfoBoundary, null); assert.equal(f.p.interaction.id, id);
  assert.equal(f.p.interaction.phase, 'blocked'); assert.equal(f.p.interaction.resumable, false);
});

test('external replacement cancels only its matching deferred info without granting automatic resume', () => {
  const f = fixture(); f.p.onNativePanelEvent({ kind: 'opened', session: 1, allowResume: true });
  f.p.onNativePanelEvent({ kind: 'closed', session: 1 });
  f.p.switchTo('waiting', true, 'external');
  assert.equal(f.p.pendingInfoBoundary, null); assert.equal(f.p.interaction.phase, 'settled');
  assert.equal(f.p.interaction.resumable, false); assert.equal(f.p.pending.playbackId, 'external');
});

test('a stale allowResume snapshot cannot replace locally confirmed manual control', () => {
  const f = fixture(); f.p.beginInteraction('menu', 'blocked', false); const id = f.p.interaction.id;
  f.p.onMenuAction({ anim: 'review' });
  f.p.onNativePanelEvent({ kind: 'opened', session: 2, allowResume: true });
  assert.equal(f.p.interaction.id, id); assert.equal(f.p.interaction.kind, 'menu');
  assert.equal(f.p.interaction.resumable, false); assert.equal(f.p.pending.anim, 'review');
});

test('an explicitly resumed controller lease distinguishes an old settled menu receipt from current manual ownership', () => {
  const f = fixture(); f.p.beginInteraction('menu', 'settled', false); f.p.frozen = true;
  f.p.onNativePanelEvent({ kind: 'opened', session: 2, allowResume: true });
  assert.equal(f.p.interaction.kind, 'info'); assert.equal(f.p.interaction.resumable, true);
  assert.equal(f.p.frozen, false); assert.equal(f.p.displayedAnim, 'waving'); assert.equal(f.wave.currentTime, 1.25);
});

for (const [kind, phase] of [['click', 'pointer'], ['drag', 'dragging'], ['drag', 'throwing']]) {
  test(`a delayed panel opening cannot replace a newer active ${phase} interaction`, () => {
    const f = fixture(); f.p.beginInteraction(kind, phase, true);
    f.p.dragState.active = phase === 'dragging';
    const before = JSON.stringify(f.p.interaction);
    f.p.stopThrow = () => assert.fail('new input must not be stopped');
    f.p.stopMove = () => assert.fail('new input must not be stopped');
    f.p.yieldUserControl = () => assert.fail('new input must not be yielded');
    f.p.onNativePanelEvent({ kind: 'opened', session: 2, allowResume: true });
    assert.equal(JSON.stringify(f.p.interaction), before);
    assert.equal(f.p.nativePanelInteraction, null);
    f.p.onNativePanelEvent({ kind: 'closed', session: 2 });
    assert.equal(JSON.stringify(f.p.interaction), before);
  });
}

for (const logical of ['running', 'review', 'waiting']) {
  for (const classic of [false, true]) {
    test(`${logical} manual ${classic ? 'classic' : 'current'} choice is prepared immediately and draws only once`, async () => {
      let draws = 0;
      const f = fixture({ variants: true, random: () => draws++ === 0 ? (classic ? .75 : .25) : (classic ? .25 : .75) });
      const expected = logical + (classic ? '-classic' : '');
      f.p.beginInteraction('menu', 'blocked', false);
      f.p.onMenuAction({ anim: logical });
      assert.equal(f.randomCalls, 1); assert.equal(f.p.pending.anim, expected);
      assert.equal(f.p.displayedAnim, 'waving');
      assert.equal(f.wave.currentTime, 1.25); assert.equal(f.wave.ended, false);
      await finishPrepared(f);
      assert.equal(f.p.displayedAnim, expected); assert.equal(f.p.pending, null);
      assert.equal(f.randomCalls, 1, 'decoder readiness must not re-randomize the concrete chosen take');
      assert.equal(f.paints.at(-1).decoderTime, 0); assert.equal(f.paints.at(-1).time, 0);
      assert.equal(f.p.interaction.resumable, false);
    });
  }
}

test('external playback preserves the exact logical name immediately without drawing from manual variants', () => {
  for (const logical of ['running', 'review', 'waiting']) {
    const f = fixture({ variants: true, random: () => .8 });
    f.p.onMenuAction({ anim: 'running' });
    assert.equal(f.randomCalls, 1); assert.equal(f.p.pending.anim, 'running-classic');
    f.p.onMenuAction({ anim: logical, playbackId: 'task-' + logical });
    assert.equal(f.p.pending.anim, logical);
    assert.equal(f.p.pending.playbackId, 'task-' + logical); assert.equal(f.randomCalls, 1);
  }
});

test('rapid variant clicks keep only the latest concrete choice and do not re-roll when it starts', async () => {
  const values = [.9, .1, .9];
  const f = fixture({ variants: true, random: () => values.shift() });
  f.p.beginInteraction('menu', 'blocked', false);
  f.p.onMenuAction({ anim: 'review' });
  assert.equal(f.p.pending.anim, 'review-classic');
  f.p.onMenuAction({ anim: 'waiting' });
  assert.equal(f.p.pending.anim, 'waiting');
  assert.equal(f.randomCalls, 2);
  await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'waiting'); assert.equal(f.randomCalls, 2);
  assert.ok(!f.paints.some(row => row.name === 'review-classic'));
  assert.equal(f.p.interaction.resumable, false);
});

test('classic takes inherit noMirror from their logical category while explicit facing remains authoritative', () => {
  for (const logical of ['running', 'review', 'waiting']) {
    for (const keepFacing of [false, true]) {
      const f = fixture({ variants: true, random: () => .9, noMirror: name => name === logical });
      f.wave.paused = true;
      f.p.facing = 'right';
      f.p.onMenuAction({ anim: logical }, keepFacing);
      assert.equal(f.p.pending.anim, logical + '-classic');
      assert.equal(f.randomCalls, 1);
      assert.equal(f.p.facing, keepFacing ? 'right' : 'left');
      assert.deepEqual(f.noMirrorQueries, keepFacing ? [] : [logical]);
    }
  }
});

for (const logical of ['running', 'review', 'waiting']) {
  for (const draw of [.1, .9]) {
    test(`${logical} actual manual starts force an alternate after two equal takes (${draw})`, async () => {
      const f = fixture({ variants: true, random: () => draw });
      const first = logical + (draw >= .5 ? '-classic' : '');
      const alternate = logical + (draw >= .5 ? '' : '-classic');
      const started = [];
      for (let i = 0; i < 3; i++) {
        f.p.onMenuAction({ anim: logical });
        await finishPrepared(f);
        started.push(f.p.displayedAnim);
        // Let another real clip occupy the decoder between deliberate replays.
        f.p.playOnce('idle'); await finishPrepared(f);
      }
      assert.deepEqual(started, [first, first, alternate]);
      assert.equal(f.randomCalls, 3);
    });
  }
}

test('cancelled preparation and a rejected play do not consume a variant start', async () => {
  const f = fixture({ variants: true, random: () => .1 });
  f.p.onMenuAction({ anim: 'review' });
  f.p.onMenuAction({ anim: 'waiting' }); // supersedes review before its seek completes
  await finishPrepared(f);
  f.p.playOnce('idle'); await finishPrepared(f);
  const target = f.p.front === 0 ? f.p.videoB : f.p.videoA;
  const originalPlay = target.play;
  target.play = function () { this.playCalls++; return Promise.reject(Error('decoder failure')); };
  f.p.onMenuAction({ anim: 'review' }); await finishPrepared(f);
  target.play = originalPlay;
  f.p.playOnce('idle'); await finishPrepared(f);
  const started = [];
  for (let i = 0; i < 3; i++) {
    f.p.onMenuAction({ anim: 'review' }); await finishPrepared(f);
    started.push(f.p.displayedAnim);
    f.p.playOnce('idle'); await finishPrepared(f);
  }
  assert.deepEqual(started, ['review', 'review', 'review-classic']);
});

test('explicit playback remains exact after two manual starts and does not reset that history', async () => {
  const f = fixture({ variants: true, random: () => .1 });
  for (let i = 0; i < 2; i++) {
    f.p.onMenuAction({ anim: 'waiting' }); await finishPrepared(f);
    f.p.playOnce('idle'); await finishPrepared(f);
  }
  f.p.onMenuAction({ anim: 'waiting', playbackId: 'explicit-wait' }); await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'waiting'); assert.equal(f.randomCalls, 2);
  f.p.playOnce('idle'); await finishPrepared(f);
  f.p.onMenuAction({ anim: 'waiting' }); await finishPrepared(f);
  assert.equal(f.p.displayedAnim, 'waiting-classic'); assert.equal(f.randomCalls, 3);
});
