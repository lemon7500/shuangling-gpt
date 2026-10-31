import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { create } = require('../../vendor/dsh-pet/runtime/electron-helper/shuangling-drag.js');
const spriteSource = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
const base = 'dsh-pet-bridge://dsh-pet/dsh-pet-7340/thumb/shuangling/';
const seekInside = frame => frame > 0 ? (frame + .25) / 24 : 0;
const ptsOf = frame => Math.ceil(frame * 1000 / 24) / 1000;
const mediaHashes = {
  'drag-lift': '96c6f1202f7b7416d53ba9f268fa805117d68d2985a9725bd0bcd29ebf204cab',
  'drag-hover': '8b06861df760f0ff75a4efb13d1f1b4e11afd837c23795c5d1f1eb2e169afbcf',
  'drag-lower': '80806540fe1c05da5df17265e93568d10373f89e972eab858564fcf2d289ade8',
};
const profile = () => ({ dragAssetRoots: ['main', 'shuangling'], drag: { lift: 'drag-lift', hover: 'drag-hover', lower: 'drag-lower' }, outlineMaskRoi: { assetRoot: 'shuangling', webmSha256ByAnimation: { ...mediaHashes } } });
function visualClock() {
  let time = 0, sequence = 0;
  const callbacks = new Map(), reversed = [], allocated = [];
  const host = { performance: { now: () => time }, requestAnimationFrame(fn) { callbacks.set(++sequence, fn); return sequence; }, cancelAnimationFrame(id) { callbacks.delete(id); } };
  const document = { defaultView: host, createElement() {
    const canvas = { width: 0, height: 0, time: null, getContext: () => ({ drawImage(source) { canvas.time = source.time; } }) };
    allocated.push(canvas); return canvas;
  } };
  const surface = { ownerDocument: document, time: 0, getContext: () => ({ save() {}, restore() {}, drawImage(source, ...args) { assert.equal(args.length, 2, 'native cached draw never scales or blends'); reversed.push(source.time); surface.time = source.time; } }) };
  return { surface, reversed, allocated, advance(ms) { const end = time + ms; while (time < end) { time = Math.min(end, time + 1000 / 60); const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(fn => fn(time)); } } };
}
function fixture({ autoCommit = true } = {}) {
  const calls = [], phases = [], clock = visualClock();
  const p = { assetRoot: 'shuangling', assetBase: base, isShuanglingProfile: () => true,
    interaction: { id: 'drag-1', kind: 'drag', phase: 'dragging' }, dragState: { active: true },
    animations: { idle: ['idle'] }, frozen: false, front: 0,
    videoA: { readyState: 4, paused: false, ended: false, currentTime: 0, petPaintedMediaTime: 0, petPlaybackGeneration: 0,
      pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } }, videoB: {}, displayedAnim: 'idle', videoSurface: clock.surface,
    updateInteraction(phase, extra) { Object.assign(this.interaction, extra, { phase }); phases.push(phase); },
    resumeWorkStatusAnim() { calls.push({ resume: true }); return false; },
    playOnce(name) { this.switchTo(name, true); }, startVideoPaint() {}, stopVideoPaint() {},
    cancelPendingVideo() { calls.push({ cancel: this.pending?.anim }); this.pending = null; },
    switchTo(name, once, _id, _url, smooth = false) {
      this.dragVisual?.beforeSwitch(name); const playback = this.dragVisual?.playback(name); calls.push({ name, once, smooth, playback });
      this.pending = { anim: name, playback };
      if (autoCommit) commit();
    },
  };
  function frame(time) { p.videoA.currentTime = p.videoA.petPaintedMediaTime = clock.surface.time = time; p.dragVisual?.capture(p.videoA, time); }
  function commit() { const pending = p.pending; if (!pending) return; p.pending = null; p.displayedAnim = pending.anim; p.videoA.ended = false; p.videoA.petPlaybackGeneration++; p.videoA.loop = pending.anim === 'drag-hover'; p.videoA.playbackRate = pending.playback?.rate || 1; frame(pending.playback?.startTime || 0); p.dragVisual?.committed(pending.anim); }
  p.dragVisual = create(p, profile());
  return { p, calls, phases, clock, frame, commit, names: () => calls.filter(c => c.name).map(c => c.name), end() { frame(({ 'drag-lift': 31, 'drag-hover': 37, 'drag-lower': 32 }[p.displayedAnim] || 0) / 24); p.videoA.ended = true; return p.dragVisual.ended(p.displayedAnim); }, release(flight = false) { p.dragState.active = false; return p.dragVisual.release(flight); } };
}
test('pickup is opt-in only with the exact three clips, declared media hashes and matching character root', () => {
  const { p } = fixture();
  for (const invalid of [{}, { drag: profile().drag }, { ...profile(), drag: { ...profile().drag, hover: 'jumping' } }]) assert.equal(create(p, invalid), null);
  const missing = profile(); delete missing.outlineMaskRoi.webmSha256ByAnimation['drag-lower']; assert.equal(create(p, missing), null);
  const oldYoyo = profile(); oldYoyo.outlineMaskRoi.webmSha256ByAnimation['drag-hover'] = '69e63d309a973b9a82c656bceb85b8d527c02f359eee2acbe88d645edd8145a6';
  assert.equal(create(p, oldYoyo), null, 'the removed bidirectional held clip cannot inherit the forward-cycle timing contract');
  p.assetRoot = 'other'; assert.equal(create(p, profile()), null);
  p.assetRoot = 'main'; assert.ok(create(p, profile()), 'the actual upstream main root is explicitly bound');
  for (const roots of [undefined, ['main'], ['shuangling'], ['main', 'shuangling', 'other'], ['shuangling', 'main']]) assert.equal(create(p, { ...profile(), dragAssetRoots: roots }), null);
  p.assetRoot = 'shuangling'; p.isShuanglingProfile = () => false; assert.equal(create(p, profile()), null);
});
test('a long drag lifts once then loops genuine hover footage without repeating lift or freezing', () => {
  const f = fixture(); f.p.dragVisual.start(); assert.deepEqual(f.names(), ['drag-lift']);
  assert.equal(f.calls[0].smooth, false); assert.equal(f.calls[0].playback.rate, 1.25); f.end();
  assert.deepEqual(f.names(), ['drag-lift', 'drag-hover']); assert.equal(f.calls[1].once, false); assert.equal(f.calls[1].smooth, false);
  for (let i = 0; i < 30; i++) assert.equal(f.p.dragVisual.ended('idle'), false);
  assert.deepEqual(f.names(), ['drag-lift', 'drag-hover']); assert.deepEqual(f.phases, []);
  f.release(); assert.equal(f.p.interaction.phase, 'blocked'); assert.equal(f.names().at(-1), 'drag-lower', 'F0 lowers immediately without waiting a hover cycle');
  assert.equal(f.calls.filter(c => c.name).at(-1).smooth, false);
  f.end(); assert.equal(f.p.interaction.phase, 'settled'); assert.equal(f.names().at(-1), 'idle');
});
test('a short drag lowers immediately from the exact inverse of each actually painted lift frame', () => {
  for (const frame of [0, 6, 12, 30, 31]) {
    const f = fixture(); f.p.dragVisual.start(); f.frame(frame / 24); f.release();
    assert.deepEqual(f.names(), ['drag-lift', 'drag-lower']); assert.deepEqual(f.phases, ['blocked']);
    assert.equal(f.calls.at(-1).playback.startFrame, 32 - frame);
    assert.equal(f.calls.at(-1).playback.startTime, seekInside(32 - frame));
    assert.equal(f.calls.at(-1).playback.rate, 1.25);
    assert.equal(f.p.interaction.phase, 'blocked');
    f.end(); assert.equal(f.phases.at(-1), 'settled'); assert.equal(f.p.dragVisual.active(), false);
  }
});
test('release before a prepared lift ever paints cancels it without replaying a full delayed gesture', () => {
  const f = fixture({ autoCommit: false }); f.p.dragVisual.start(); f.release();
  assert.ok(f.calls.some(c => c.cancel === 'drag-lift')); assert.equal(f.p.dragVisual.active(), false);
  assert.equal(f.p.interaction.phase, 'settled'); assert.equal(f.p.dragVisual.ended('drag-lift'), false);
  assert.ok(!f.names().includes('drag-hover')); assert.ok(!f.names().includes('drag-lower'));
});
test('release before pickup paints preserves the existing idle phase while still honoring a changed work state', () => {
  for (const taskTakesOver of [false, true]) {
    const f = fixture({ autoCommit: false }); let resumed = 0;
    f.p.resumeWorkStatusAnim = () => { resumed++; return taskTakesOver; };
    f.p.dragVisual.start(); f.release();
    assert.equal(resumed, 1, 'new work state is considered before preserving an idle decoder');
    assert.equal(f.p.dragVisual.active(), false); assert.equal(f.p.interaction.phase, 'settled');
    assert.deepEqual(f.names(), ['drag-lift'], 'the still-visible idle must not be restarted at F0');
  }
  const task = fixture({ autoCommit: false }); task.p.displayedAnim = 'running'; task.p.dragVisual.start(); task.release();
  assert.equal(task.names().at(-1), 'idle', 'a stale non-idle task cannot inherit the idle-preservation shortcut');
});
test('a short throw that lands before the first prepared lift paints cancels the delayed pickup', () => {
  const f = fixture({ autoCommit: false }); f.p.dragVisual.start(); f.release(true);
  assert.equal(f.p.dragVisual.active(), true); assert.equal(f.p.pending.anim, 'drag-lift');
  assert.equal(f.p.dragVisual.landed(), true);
  assert.ok(f.calls.some(c => c.cancel === 'drag-lift')); assert.equal(f.p.dragVisual.active(), false);
  assert.equal(f.p.interaction.phase, 'settled'); assert.equal(f.p.dragVisual.ended('drag-lift'), false);
  f.commit(); assert.equal(f.p.displayedAnim, 'idle');
  assert.ok(!f.names().includes('drag-hover')); assert.ok(!f.names().includes('drag-lower'));
});
test('throwing keeps the genuine hover pose until physics lands, then lowers before settled', () => {
  const f = fixture(); f.p.dragVisual.start(); f.release(true); f.p.interaction.phase = 'throwing'; f.end();
  assert.equal(f.names().at(-1), 'drag-hover'); assert.equal(f.p.interaction.phase, 'throwing');
  assert.equal(f.p.dragVisual.landed(), true); assert.equal(f.names().at(-1), 'drag-lower'); assert.equal(f.p.interaction.phase, 'blocked');
  f.end(); assert.equal(f.p.interaction.phase, 'settled');
});
test('a regrab reverses a partial lower at its identical native lift frame without finishing the landing', () => {
  for (const frame of [1, 12, 24, 32]) {
    const f = fixture(); f.p.dragVisual.start(); f.end(); f.release(); f.frame(frame / 24);
    f.p.dragVisual.cancel(true); f.p.dragState.active = true; f.p.interaction = { id: 'drag-2', kind: 'drag', phase: 'dragging' }; f.p.dragVisual.start();
    assert.equal(f.names().at(-1), 'drag-lift'); assert.equal(f.calls.at(-1).playback.startFrame, 32 - frame);
    assert.equal(f.calls.at(-1).playback.startTime, seekInside(32 - frame));
    assert.ok(!f.phases.includes('settled'));
    f.release(); assert.equal(f.calls.at(-1).playback.startFrame, frame);
    assert.equal(f.calls.at(-1).playback.startTime, seekInside(frame)); assert.equal(f.names().at(-1), 'drag-lower');
  }
});
test('every nonzero held phase continues forward immediately, never allocates reversed canvases or adds a cycle', () => {
  for (const frame of [1, 8, 14, 24, 30, 34, 37]) {
    const f = fixture(); f.p.dragVisual.start(); f.end(); f.frame(frame / 24);
    f.release(); assert.equal(f.p.videoA.paused, false); assert.equal(f.p.videoA.loop, false); assert.equal(f.p.videoA.playbackRate, 2);
    assert.equal(f.p.videoA.currentTime, frame / 24, 'release never seeks backward');
    assert.equal(f.names().at(-1), 'drag-hover'); assert.equal(f.p.dragVisual.ownsPlayback('drag-hover'), true);
    f.frame((frame + .5) / 24); assert.ok(f.p.videoA.petPaintedMediaTime > frame / 24);
    assert.equal(f.clock.reversed.length, 0); assert.equal(f.clock.allocated.length, 0);
    assert.ok((38 - frame) / 24 / 2 * 1000 < 900, 'forward remainder is bounded below 0.9 seconds');
    f.end(); assert.equal(f.names().at(-1), 'drag-lower'); assert.equal(f.calls.at(-1).playback.startTime, 0);
    f.end(); assert.equal(f.p.interaction.phase, 'settled');
  }
});
test('release after decoder-clock wrap consumes the completed painted tail instead of an extra held cycle', () => {
  for (const paintedFrame of [36, 37]) {
    const f = fixture(); f.p.dragVisual.start(); f.end(); f.frame(paintedFrame / 24);
    f.p.videoA.currentTime = .005; f.release();
    assert.equal(f.names().at(-1), 'drag-lower'); assert.equal(f.calls.at(-1).playback.startFrame, 0);
    assert.equal(f.calls.filter(c => c.name === 'drag-hover').length, 1);
    f.end(); assert.equal(f.p.interaction.phase, 'settled');
  }
});
test('wrapped-clock shortcut requires both the owned generation and a genuine tail pose', () => {
  for (const invalid of ['new-generation', 'middle-pose']) {
    const f = fixture(); f.p.dragVisual.start(); f.end(); f.frame((invalid === 'middle-pose' ? 14 : 37) / 24);
    f.p.videoA.currentTime = .005;
    if (invalid === 'new-generation') f.p.videoA.petPlaybackGeneration++;
    f.release(); assert.equal(f.names().at(-1), 'drag-hover'); assert.equal(f.p.videoA.playbackRate, 2);
  }
});
test('the inactive decoder preloads the next real segment and switches to lower on an early release', () => {
  const f = fixture(); f.p.dragVisual.start(); assert.equal(f.p.dragVisual.preloadName(), 'drag-hover');
  f.release(); assert.equal(f.names().at(-1), 'drag-lower'); assert.equal(f.p.dragVisual.preloadName(), 'idle');
});
test('new interaction, external action, hide or disposal cancels callbacks instead of settling a newer owner', () => {
  for (const interruption of ['new-id', 'external', 'cancel']) {
    const f = fixture(); f.p.dragVisual.start(); f.end(); f.release();
    if (interruption === 'new-id') f.p.interaction = { id: 'menu-2', kind: 'menu', phase: 'blocked' };
    else if (interruption === 'external') f.p.dragVisual.beforeSwitch('waving');
    else f.p.dragVisual.cancel();
    assert.equal(f.p.dragVisual.ended('drag-lower'), false); assert.ok(!f.names().includes('idle'));
    assert.ok(!f.phases.includes('settled'));
  }
});
test('broken pickup or hover preserves dragging and throwing until physical release, then reliably settles', () => {
  for (const flight of [false, true]) {
    const f = fixture(); f.p.dragVisual.start(); f.p.dragVisual.failed('drag-lift');
    assert.equal(f.names().at(-1), 'idle'); assert.equal(f.calls.filter(c => c.name).at(-1).once, false); assert.ok(!f.phases.includes('settled'));
    f.release(flight); if (flight) { assert.ok(!f.phases.includes('settled')); f.p.dragVisual.landed(); }
    assert.equal(f.phases.at(-1), 'settled'); assert.equal(f.p.dragVisual.active(), false);
  }
  const f = fixture(); f.p.dragVisual.start(); f.end(); f.release(); f.p.dragVisual.failed('drag-lower');
  assert.equal(f.phases.at(-1), 'settled'); assert.equal(f.p.dragVisual.active(), false);
});

function pointerFixture() {
  const context = vm.createContext({ window: { __dshPetDebug: {} }, console: { log() {} }, SHUANGLING_PROFILE: true,
    performance: { now: () => 1000 }, setTimeout() {}, toLocal: x => x, VIEW: { w: 1920, h: 1080 },
    S: { DRAG_THRESHOLD: 5, trimTrail: x => x, pick: x => x[0], dockDrop: (_space, x, y) => ({ x, y }), estimateReleaseVelocity: () => null }, Promise });
  vm.runInContext(spriteSource + '\nthis.P=PetSprite.prototype;', context);
  const p = Object.create(context.P), events = [];
  Object.assign(p, { dragState: { active: true, dragging: false, sx: 0, sy: 0, petX: 50, petY: 60 },
    pos: { x: 50, y: 60 }, halfW: 100, halfH: 100, dragTrail: [], animations: { drag: ['jumping'], idle: ['idle'] }, physics: {},
    stage: { style: {} }, bottomPad: 0, hit: { classList: { remove() {} } }, margin: { l: 0, t: 0 },
    updateInteraction(phase) { events.push(phase); }, syncInputBusy() { events.push('input'); },
    syncFrostVisibility() {}, stopDragFollow() {}, startDragFollow() { events.push('follow'); },
    resumeWorkStatusAnim() { events.push('resume'); return false; }, playOnce(name) { events.push(name); },
    throwSpaceOf() {}, position() { events.push('save'); },
  });
  return { p, events, context };
}
test('native pointer threshold and legacy drag fallback preserve unchanged following and position saving', () => {
  const { p, events } = pointerFixture();
  p.onPointerMove({ screenX: 2, screenY: 0 }); assert.deepEqual(events, []);
  p.onPointerMove({ screenX: 20, screenY: 10 }); assert.ok(events.includes('jumping')); assert.ok(events.includes('follow'));
  p.onPointerUp({ type: 'pointercancel' }); assert.ok(events.includes('save')); assert.ok(events.includes('settled'));
});
test('dedicated pickup starts on actual drag and a gentle/cancel release saves position without early resume or settled', () => {
  for (const eventType of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    const { p, events } = pointerFixture();
    p.dragVisual = { start() { events.push('lift'); return true; }, active: () => true, release(flight) { events.push(`release:${flight}`); return true; } };
    p.onPointerMove({ screenX: 20, screenY: 10 }); p.onPointerUp({ type: eventType });
    assert.ok(events.includes('lift')); assert.ok(!events.includes('jumping')); assert.ok(!events.includes('resume')); assert.ok(!events.includes('settled'));
    assert.ok(events.indexOf('follow') < events.indexOf('lift'), 'physical following starts before any decoder preparation');
    assert.ok(events.indexOf('save') < events.indexOf('release:false')); assert.equal(p.customPos.rx, 150 / 1920);
    assert.equal(p.dragState.active, false); assert.equal(p.dragState.dragging, false);
  }
});
test('native throw preserves a pending lift and saves the unchanged rest position before visual landing', () => {
  const { p, events, context } = pointerFixture(); let frame;
  context.requestAnimationFrame = fn => { frame = fn; return 1; };
  context.S.throwStepRegion = state => ({ ...state, atRest: true, bounced: true, screen: 0 });
  Object.assign(p, { interaction: { kind: 'drag', phase: 'dragging' }, throwToken: 0, lastFlightReport: 0,
    clearManualAction(preserve) { events.push(`preserve:${preserve}`); }, stopMove() {}, startSquash() { events.push('squash'); },
    throwSpaceOf: () => ({ bounds: [{ maxY: 60 }] }), sendBounds(x, y) { this.pos = { x, y }; },
    updateInteraction(phase) { this.interaction.phase = phase; events.push(phase); },
    dragVisual: { active: () => true, landed() { events.push('visual-land'); return true; } },
  });
  const before = JSON.stringify(p.physics); p.startThrow(50, 60, 200, -100); assert.ok(events.includes('preserve:true'));
  frame(); assert.equal(p.throwState, null); assert.equal(p.throwRef, null);
  assert.equal(p.customPos.rx, 150 / 1920); assert.equal(p.customPos.ry, 160 / 1080);
  assert.ok(events.includes('visual-land')); assert.ok(!events.includes('settled')); assert.ok(!events.includes('squash')); assert.equal(JSON.stringify(p.physics), before);
});

class Video {
  constructor(name) { this.listeners = new Map(); this.frames = new Map(); this.frameSequence = 0; this.autoFrames = true; this.style = {}; this.classList = { add() {}, remove() {} }; this.readyState = 4; this.seeking = false; this.paused = false; this.ended = false; this.error = null; this._time = 0; this.duration = ({ 'drag-lift': 32, 'drag-hover': 38, 'drag-lower': 33 }[name] || 24) / 24; this.petAnimationSource = this.petPreloadedSource = base + name + '.webm'; }
  get currentTime() { return this._time; }
  set currentTime(value) { this.framesRegisteredBeforeSeek = this.frames.size; this._time = value; this.seeking = true; }
  pause() { this.paused = true; }
  play() { this.paused = false; this.ended = false; return Promise.resolve(); }
  load() { const name = this.src?.slice(base.length).replace('.webm', ''); this.duration = ({ 'drag-lift': 32, 'drag-hover': 38, 'drag-lower': 33 }[name] || 24) / 24; this._time = 0; this.seeking = false; this.emit('loadeddata'); }
  addEventListener(key, fn) { if (!this.listeners.has(key)) this.listeners.set(key, new Set()); this.listeners.get(key).add(fn); }
  removeEventListener(key, fn) { this.listeners.get(key)?.delete(fn); }
  emit(key) { for (const fn of [...this.listeners.get(key) || []]) fn(); }
  requestVideoFrameCallback(callback) { this.frames.set(++this.frameSequence, callback); return this.frameSequence; }
  cancelVideoFrameCallback(id) { this.frames.delete(id); }
  emitFrame(mediaTime) { const batch = [...this.frames.values()]; this.frames.clear(); batch.forEach(callback => callback(0, { mediaTime })); }
  finishSeek() { this.seeking = false; this.emit('seeked'); if (this.autoFrames) this.emitFrame(ptsOf(Math.round(this.currentTime * 24))); }
}
function decoderFixture({ deferGate = false } = {}) {
  const gates = [], paints = [], phases = [], starts = [], decodedFrames = [], timers = new Map(), clock = visualClock(); let timerSequence = 0;
  const context = vm.createContext({ window: { __dshPetDebug: {}, setTimeout(callback, ms) { timers.set(++timerSequence, { callback, ms }); return timerSequence; }, clearTimeout(id) { timers.delete(id); } }, SHUANGLING_PROFILE: true, console: { log() {}, warn() {} },
    S: { ANIMATION_EXT: '.webm', postAction: async () => true }, });
  vm.runInContext(spriteSource + '\nthis.P=PetSprite.prototype;', context);
  const p = Object.create(context.P);
  Object.assign(p, { pet: { id: 'shuangling' }, assetRoot: 'shuangling', assetBase: base, front: 0, videoA: new Video('idle'), videoB: new Video('drag-lift'),
    interaction: { id: 'native-drag', kind: 'drag', phase: 'dragging' }, dragState: { active: true }, animations: { idle: ['idle'] },
    gen: 0, pending: null, playback: null, idlePreload: null, squashRef: null, displayedAnim: 'idle', displayedOnce: true,
    videoSurface: Object.assign(clock.surface, { style: {} }), frozen: false, paintVideoFrame(video, time = video.currentTime) {
      paints.push([video.petOutlineAssetName, time, video.currentTime]);
      // Model a valid 1ms timebase that rounds PTS up. Merely declaring n/24
      // must not count as decoding n when the decoder still shows n-1.
      let frame = 0;
      for (let i = 0; i < Math.round(video.duration * 24); i++) if (Math.ceil(i * 1000 / 24) / 1000 <= video.currentTime) frame = i;
      decodedFrames.push({ name: video.petOutlineAssetName, frame });
      video.petPaintedMediaTime = clock.surface.time = time; if (video === (this.front === 0 ? this.videoA : this.videoB)) this.dragVisual?.capture(video, time);
    },
    startVideoPaint(video) { starts.push(video); }, stopVideoPaint() {}, stopMove() {}, preloadIdleFrame() {}, videoFacingTransform: () => '', syncFrostVisibility() {},
    updateInteraction(phase, extra) { Object.assign(this.interaction, extra, { phase }); phases.push(phase); }, reportPlayback() {}, resumeWorkStatusAnim: () => false,
    handoff: { cancel() {}, onCommit() {}, request(transaction, commit) { gates.push({ transaction, commit }); if (!deferGate) commit(); } },
  });
  p.dragVisual = create(p, profile());
  return { p, gates, paints, phases, starts, decodedFrames, timers, clock, frame(time) { const video = p.front === 0 ? p.videoA : p.videoB; video._time = time; p.paintVideoFrame(video, time); }, async prepare() { for (let i = 0; i < 4; i++) { await Promise.resolve(); for (const video of [p.videoA, p.videoB]) if (video.seeking) video.finishSeek(); } },
    end() { const video = p.front === 0 ? p.videoA : p.videoB; video._time = video.duration; video.ended = true; video.onended(); } };
}
test('native pickup requests a bounded real task return and partial landing keeps its exact internal cut', async () => {
  const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare();
  assert.equal(f.p.displayedAnim, 'drag-lift'); assert.equal(f.gates.length, 1); assert.equal(f.gates[0].transaction.nativeDragReturn, true); assert.equal(f.p.videoB.playbackRate, 1.25);
  f.frame(12 / 24);
  f.p.dragState.active = false; f.p.dragVisual.release(); await f.prepare();
  assert.equal(f.p.displayedAnim, 'drag-lower'); assert.equal(f.gates.length, 1); assert.equal(f.p.interaction.phase, 'blocked');
  assert.deepEqual(f.paints.at(-1), ['drag-lower', ptsOf(20), seekInside(20)], 'the verified decoded frame paints before playback, never lower F0');
  assert.equal(f.p.videoA.playbackRate, 1.25);
  f.end(); assert.equal(f.p.interaction.phase, 'settled');
});
test('cancelled native partial landing seeks and stale ended callbacks cannot settle a newer interaction', async () => {
  const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.frame(12 / 24);
  const oldEnded = (f.p.front === 0 ? f.p.videoA : f.p.videoB).onended;
  f.p.dragState.active = false; f.p.dragVisual.release();
  assert.equal(f.p.pending.anim, 'drag-lower');
  f.p.dragVisual.cancel(); f.p.interaction = { id: 'menu', kind: 'menu', phase: 'blocked' }; await f.prepare(); oldEnded();
  assert.equal(f.p.interaction.id, 'menu'); assert.equal(f.p.interaction.phase, 'blocked'); assert.ok(!f.phases.includes('settled'));
  assert.equal(f.p.displayedAnim, 'drag-lift');
});
test('native decode failure settles a released lower without leaving the controller blocked', async () => {
  const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.frame(12 / 24);
  f.p.dragState.active = false; f.p.dragVisual.release();
  const hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA; hidden.error = new Error('broken lower'); hidden.emit('error');
  assert.equal(f.p.interaction.phase, 'settled'); assert.equal(f.p.dragVisual.active(), false);
});
test('a late controller unlock does not replace the blocked genuine hover-to-lower tail', async () => {
  const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.end(); await f.prepare();
  f.p.dragState.active = false; f.p.dragVisual.release(); f.p.frozen = true; f.p.applyFreeze(false);
  assert.equal(f.p.frozen, false); assert.equal(f.p.interaction.phase, 'blocked');
  await f.prepare(); assert.equal(f.p.displayedAnim, 'drag-lower');
});

test('short release holds the exact painted lift pose while its inverse decoder prepares', async () => {
  const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.frame(12 / 24);
  const outgoing = f.p.front === 0 ? f.p.videoA : f.p.videoB;
  f.p.dragState.active = false; f.p.dragVisual.release();
  assert.equal(outgoing.paused, true); assert.equal(outgoing.petPaintedMediaTime, 12 / 24);
  assert.equal(f.p.dragVisual.ownsPlayback('drag-lift'), false);
  assert.equal(f.p.interaction.phase, 'blocked');
  await f.prepare(); assert.equal(f.p.displayedAnim, 'drag-lower');
  assert.deepEqual(f.paints.at(-1), ['drag-lower', ptsOf(20), seekInside(20)]);
});

test('a release during the native task return cancels its prepared lift and stale gate commit', async () => {
  const f = decoderFixture({ deferGate: true }); f.p.dragVisual.start(); await f.prepare();
  assert.equal(f.p.displayedAnim, 'idle'); assert.equal(f.p.pending.anim, 'drag-lift');
  const obsolete = f.gates[0]; f.p.dragState.active = false; f.p.dragVisual.release();
  assert.equal(f.p.dragVisual.active(), false); assert.equal(f.p.interaction.phase, 'settled');
  f.p.interaction = { id: 'menu', kind: 'menu', phase: 'blocked' };
  assert.equal(obsolete.commit(), false); await f.prepare();
  assert.equal(f.p.interaction.id, 'menu'); assert.equal(f.p.interaction.phase, 'blocked');
  assert.notEqual(f.p.displayedAnim, 'drag-lift');
});
test('a throw landing during the actual PetSprite native task return cancels its stale gate commit', async () => {
  const f = decoderFixture({ deferGate: true }); f.p.dragVisual.start(); await f.prepare();
  assert.equal(f.p.pending.anim, 'drag-lift'); const obsolete = f.gates[0];
  f.p.dragState.active = false; f.p.dragVisual.release(true); f.p.dragVisual.landed();
  assert.equal(f.p.dragVisual.active(), false); assert.equal(f.p.interaction.phase, 'settled');
  assert.equal(obsolete.commit(), false); await f.prepare(); assert.notEqual(f.p.displayedAnim, 'drag-lift');
  assert.ok(!f.paints.some(([name]) => name === 'drag-lift' || name === 'drag-hover' || name === 'drag-lower'));
});
test('actual PetSprite wrapped-clock release holds the painted tail while lower F0 prepares', async () => {
  const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.end(); await f.prepare();
  f.frame(37 / 24); const video = f.p.front === 0 ? f.p.videoA : f.p.videoB; video._time = .005;
  const lower = f.p.front === 0 ? f.p.videoB : f.p.videoA; lower.readyState = 1;
  f.p.dragState.active = false; f.p.dragVisual.release();
  assert.equal(video.paused, true); assert.equal(video.petPaintedMediaTime, 37 / 24);
  assert.equal(f.p.pending.anim, 'drag-lower'); assert.equal(f.p.dragVisual.ownsPlayback('drag-hover'), false);
  lower.readyState = 4; lower.emit('loadeddata'); await f.prepare(); assert.equal(f.p.displayedAnim, 'drag-lower');
  assert.equal(f.paints.at(-1)[1], 0); assert.equal(f.paints.at(-1)[0], 'drag-lower');
  f.end(); assert.equal(f.p.interaction.phase, 'settled');
});

test('actual PetSprite holds three forward loops and regrabs every tested release phase without rewinding', async () => {
  for (const phase of [1, 8, 17, 30, 34, 37]) {
    const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.end(); await f.prepare();
    const video = f.p.front === 0 ? f.p.videoA : f.p.videoB;
    const generation = video.petPlaybackGeneration, paintCount = f.paints.length;
    for (let loop = 0; loop < 3; loop++) {
      for (let frame = 0; frame < 38; frame++) f.frame(frame / 24);
      assert.equal(video.loop, true); assert.equal(video.playbackRate, 1);
      assert.equal(f.p.displayedAnim, 'drag-hover'); assert.equal(video.petPlaybackGeneration, generation);
    }
    assert.equal(f.paints.length - paintCount, 114); assert.equal(f.clock.allocated.length, 0);
    f.frame(phase / 24); f.p.dragState.active = false; f.p.dragVisual.release();
    assert.equal(video.playbackRate, 2); assert.equal(video.loop, false); assert.equal(video.currentTime, phase / 24);
    const obsolete = video.onended;
    f.frame((phase + .25) / 24); const visible = video.petPaintedMediaTime;
    f.p.dragVisual.cancel(true); f.p.dragState.active = true;
    f.p.interaction = { id: 'regrab', kind: 'drag', phase: 'dragging' }; f.p.dragVisual.start();
    assert.equal(video.seeking, false); assert.equal(video.currentTime, visible);
    assert.equal(video.loop, true); assert.equal(video.playbackRate, 1); assert.equal(video.onended, null);
    obsolete(); assert.equal(f.p.interaction.phase, 'dragging', 'the old release cannot lower a regrabbed pet');
    f.p.dragState.active = false; f.p.dragVisual.release();
    assert.equal(video.currentTime, visible); assert.equal(video.playbackRate, 2); assert.equal(video.paused, false);
    f.end(); await f.prepare(); assert.equal(f.p.displayedAnim, 'drag-lower');
    assert.ok(!f.phases.includes('settled')); f.end(); assert.equal(f.p.interaction.phase, 'settled');
  }
});

test('a deferred play rejection from a regrab cannot cancel the newer release return', async () => {
  const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.end(); await f.prepare();
  for (let frame = 1; frame <= 14; frame++) f.frame(frame / 24);
  f.p.dragState.active = false; f.p.dragVisual.release();
  const video = f.p.front === 0 ? f.p.videoA : f.p.videoB;
  f.p.dragVisual.cancel(true); f.p.dragState.active = true;
  f.p.interaction = { id: 'regrab-play', kind: 'drag', phase: 'dragging' };
  let rejectPlay; video.play = () => new Promise((_resolve, reject) => { rejectPlay = reject; });
  f.p.dragVisual.start(); assert.equal(typeof rejectPlay, 'function');
  f.p.dragState.active = false; f.p.dragVisual.release(); rejectPlay(new Error('obsolete resume'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.p.dragVisual.active(), true); assert.equal(f.p.interaction.phase, 'blocked');
  f.end(); await f.prepare(); assert.equal(f.p.displayedAnim, 'drag-lower');
});

test('regrabbing a playing held decoder preserves its native clock instead of seeking behind a queued frame', async () => {
  for (const lead of [.003, .025, .055]) {
    const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.end(); await f.prepare();
    f.frame(12 / 24); const video = f.p.front === 0 ? f.p.videoA : f.p.videoB;
    const painted = video.petPaintedMediaTime, running = painted + lead; video._time = running;
    f.p.dragVisual.cancel(true); f.p.dragState.active = true;
    f.p.interaction = { id: 'catch-running-' + lead, kind: 'drag', phase: 'dragging' };
    f.p.dragVisual.start();
    assert.equal(video.seeking, false, 'a still-playing decoder must not enter a backwards seek');
    assert.equal(video.currentTime, running, 'normal decoder lead over its latest paint is preserved');
    f.frame(13 / 24); assert.ok(video.petPaintedMediaTime > painted);
    assert.equal(video.loop, true); assert.equal(video.playbackRate, 1);
  }
});

test('regrabbing a paused held decoder still restores its exact painted pose before playing', async () => {
  const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.end(); await f.prepare();
  f.frame(12 / 24); const video = f.p.front === 0 ? f.p.videoA : f.p.videoB;
  video.pause(); video._time = 12 / 24 + .025;
  f.p.dragVisual.cancel(true); f.p.dragState.active = true;
  f.p.interaction = { id: 'catch-paused', kind: 'drag', phase: 'dragging' }; f.p.dragVisual.start();
  assert.equal(video.seeking, true); assert.equal(video.currentTime, 12 / 24);
  assert.equal(video.paused, true); video.finishSeek(); await f.prepare();
  assert.equal(video.paused, false); assert.equal(video.petPaintedMediaTime, 12 / 24);
});
test('a running regrab retains its existing paint callback instead of discarding a queued native frame', () => {
  const f = fixture(); f.p.dragVisual.start(); f.end(); f.frame(12 / 24);
  const v = f.p.videoA, paint = { video: v, frame: 41 }; f.p.videoPaint = paint; v.seeking = false;
  let restarts = 0; f.p.startVideoPaint = () => { restarts++; };
  f.p.dragVisual.cancel(); f.p.interaction = { id: 'paint-owner', kind: 'drag', phase: 'dragging' }; f.p.dragState.active = true;
  f.p.dragVisual.start();
  assert.equal(restarts, 0); assert.equal(f.p.videoPaint, paint); assert.equal(v.paused, false);
});

test('partial landing seeks inside millisecond PTS boundaries and records verified decoded media time', async () => {
  for (const liftFrame of [1, 2, 13, 31]) {
    const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.frame(liftFrame / 24);
    f.p.dragState.active = false; f.p.dragVisual.release();
    const video = f.p.front === 0 ? f.p.videoB : f.p.videoA;
    const targetFrame = 32 - liftFrame, target = seekInside(targetFrame);
    video._time = Math.round(target * 1e6) / 1e6; video.finishSeek(); await f.prepare();
    assert.equal(f.p.displayedAnim, 'drag-lower');
    assert.equal(f.paints.at(-1)[1], ptsOf(targetFrame), 'paintedTime records actual submitted-frame metadata instead of requested currentTime');
    assert.ok(Math.abs(f.paints.at(-1)[2] - target) <= .000001);
    assert.equal(f.decodedFrames.at(-1).frame, targetFrame, 'the real modeled decoder frame is the inverse lift pose');
    assert.equal(Math.round(video.petPaintedMediaTime * 24), targetFrame);
  }
});

test('seeked at the requested clock cannot commit stale pixels before matching native frame metadata', async () => {
  const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.frame(1 / 24);
  const hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA; hidden.autoFrames = false;
  f.p.dragState.active = false; f.p.dragVisual.release(); hidden.finishSeek();
  assert.equal(f.p.displayedAnim, 'drag-lift'); assert.equal(f.p.pending.anim, 'drag-lower');
  hidden.emitFrame(ptsOf(30)); assert.equal(f.p.displayedAnim, 'drag-lift');
  assert.equal(f.p.interaction.phase, 'blocked'); assert.equal(hidden.frames.size, 1);
  hidden.emitFrame(ptsOf(31));
  assert.equal(f.p.displayedAnim, 'drag-lower'); assert.equal(hidden.petPaintedMediaTime, ptsOf(31));
  assert.equal(hidden.frames.size, 0); assert.ok(![...f.timers.values()].some(timer => timer.ms === 750));
});

test('loaded and cached partial seeks observe old then target native metadata even before seeked', async () => {
  for (const cached of [false, true]) {
    const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.frame(1 / 24);
    const hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA; hidden.autoFrames = false;
    if (cached) {
      hidden.petAnimationSource = base + 'drag-lower.webm'; hidden.petPreloadedSource = null;
      hidden.duration = 33 / 24; hidden._time = 0;
    }
    f.p.dragState.active = false; f.p.dragVisual.release();
    assert.equal(hidden.framesRegisteredBeforeSeek, 1, 'the decoder observer is armed before both real seek paths');
    assert.equal(hidden.seeking, true); hidden.emitFrame(ptsOf(30));
    assert.equal(hidden.frames.size, 1, 'old metadata rearms while seeking, without waiting for seeked');
    hidden.emitFrame(ptsOf(31));
    assert.equal(hidden.frames.size, 0); assert.equal(f.p.displayedAnim, 'drag-lift');
    hidden.finishSeek(); assert.equal(f.p.displayedAnim, 'drag-lower');
    assert.equal(hidden.petPaintedMediaTime, ptsOf(31));
    assert.ok(![...f.timers.values()].some(timer => timer.ms === 750));
  }
});

test('cancelled nonzero native frame callbacks cannot commit or settle a newer owner', async () => {
  const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.frame(1 / 24);
  const hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA; hidden.autoFrames = false;
  f.p.dragState.active = false; f.p.dragVisual.release(); hidden.finishSeek();
  const obsolete = [...hidden.frames.values()][0]; assert.equal(typeof obsolete, 'function');
  f.p.dragVisual.cancel(); f.p.interaction = { id: 'new-menu', kind: 'menu', phase: 'blocked' };
  assert.equal(hidden.frames.size, 0); assert.ok(![...f.timers.values()].some(timer => timer.ms === 750));
  obsolete(0, { mediaTime: ptsOf(31) });
  assert.equal(f.p.displayedAnim, 'drag-lift'); assert.equal(f.p.interaction.id, 'new-menu');
  assert.ok(!f.phases.includes('settled'));
});

test('unsupported or timed-out native frame verification falls back without claiming a decoded landing', async () => {
  for (const failure of ['unsupported', 'timeout', 'decode-error']) {
    const f = decoderFixture(); f.p.dragVisual.start(); await f.prepare(); f.frame(1 / 24);
    const hidden = f.p.front === 0 ? f.p.videoB : f.p.videoA; hidden.autoFrames = false;
    if (failure === 'unsupported') hidden.requestVideoFrameCallback = undefined;
    f.p.dragState.active = false; f.p.dragVisual.release();
    if (failure === 'timeout') {
      hidden.finishSeek(); const timer = [...f.timers.values()].find(timer => timer.ms === 750);
      assert.ok(timer); timer.callback();
    } else if (failure === 'decode-error') hidden.emit('error');
    assert.equal(f.p.dragVisual.active(), false); assert.equal(f.p.interaction.phase, 'settled');
    assert.ok(!f.paints.some(([name]) => name === 'drag-lower'));
    assert.equal(hidden.frames.size, 0); assert.ok(![...f.timers.values()].some(timer => timer.ms === 750));
  }
});
