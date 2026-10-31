import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const helper = new URL('../../vendor/dsh-pet/runtime/electron-helper/', import.meta.url);
const source = readFileSync(new URL('sprite.js', helper), 'utf8');
const shared = readFileSync(new URL('shared-core.js', helper), 'utf8');

function fixture({ profile = true, reducedMotion = false } = {}) {
  let time = 1000, sequence = 0;
  const frames = new Map(), cancelled = [], calls = [], gestures = [];
  const context = vm.createContext({ SHUANGLING_PROFILE: profile, BASE: 'fixture://never-contacted',
    console: { log() {} }, performance: { now: () => time },
    window: { matchMedia: () => ({ matches: reducedMotion }), clearTimeout() {}, __dshPetDebug: {} },
    requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { cancelled.push(id); frames.delete(id); }, toLocal: x => x });
  vm.runInContext(shared, context); context.S = context.PetShared;
  context.S.postAction = () => { calls.push('lease-request'); return new Promise(() => {}); };
  vm.runInContext(source + '\nthis.P=PetSprite.prototype;', context);
  const p = Object.assign(Object.create(context.P), {
    pet: { id: 'isolated-click', size: 367 }, size: 367, pos: { x: 20, y: 30 },
    hit: { classList: { add() {}, remove() {} }, setPointerCapture() {} },
    margin: { l: 0, t: 0 }, hitRect: { x: 0, y: 0, w: 300, h: 300 }, stage: { style: {} }, bottomPad: 0,
    videoSurface: { style: { transform: '', transformOrigin: '50% 50%' } }, front: 0,
    videoA: { style: {} }, videoB: { style: {} }, frozen: false, lockTimer: null,
    squashRef: null, squashToken: 0, squashStyle: null, pendingSquash: false,
    dragState: { active: false, dragging: false }, throwState: null, interactionSequence: 0,
    interactionSession: 'isolated', pending: null, animations: { clicks: ['waving'] },
    reportPose() { calls.push('pose'); }, stopThrow() {}, stopDragFollow() {}, stopMove() {},
    setTip() {}, syncInputBusy() {}, syncFrostVisibility() {}, videoFacingTransform: () => '',
    playOnce(name) { gestures.push(name); }, playIdle() { gestures.push('idle'); },
    dragVisual: { cancel() {}, start() { calls.push('drag-art'); return true; } },
    startDragFollow() { calls.push('drag-follow'); },
  });
  const original = p.startSquash;
  p.startSquash = function (...args) { calls.push('bounce'); return original.apply(this, args); };
  const down = (button = 0) => p.onPointerDown({ button, pointerId: 1, screenX: 100, screenY: 100, clientX: 100, clientY: 100 });
  const up = type => p.onPointerUp({ type: type || 'pointerup', screenX: 100, screenY: 100, clientX: 100, clientY: 100 });
  const step = delta => { time += delta; const batch = [...frames]; frames.clear(); for (const [, fn] of batch) fn(time); };
  return { p, down, up, step, frames, cancelled, calls, gestures };
}

test('first press bounces locally before an unresolved host lease or video preparation', () => {
  const f = fixture(); f.down();
  assert.ok(f.calls.indexOf('bounce') < f.calls.indexOf('lease-request'));
  assert.equal(f.gestures.length, 0, 'the feedback does not wait for or start a video');
  assert.equal(f.p.pendingSquash, false);
  f.step(16); assert.match(f.p.videoSurface.style.transform, /scaleY\(0\./);
  assert.equal(f.p.dragState.active, true);
});

test('each rapid double-click and later click re-triggers one local driver within the long-gesture cooldown', () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) {
    f.down(); f.step(16); f.up(); f.p.onClick();
    assert.equal(f.frames.size, 1, 'a repeated press replaces rather than stacks drivers');
    assert.equal(f.p.pendingSquash, false);
  }
  assert.equal(f.calls.filter(x => x === 'bounce').length, 5, 'mouseup/click must not add a second bounce');
  assert.equal(f.gestures.filter(x => x === 'waving').length, 1, 'the longer companion gesture keeps its existing cadence');
  assert.equal(f.cancelled.length, 4);
  f.step(240);
  assert.equal(f.frames.size, 0); assert.equal(f.p.squashRef, null);
  assert.equal(f.p.videoSurface.style.transform, '');
  assert.equal(f.p.videoSurface.style.transformOrigin, '50% 50%');
});

test('crossing the drag threshold restores normal scale before following or pickup artwork', () => {
  const f = fixture(); f.down(); f.step(75);
  const staleFrame = [...f.frames.values()][0];
  f.p.onPointerMove({ screenX: 120, screenY: 110 });
  assert.equal(f.p.videoSurface.style.transform, '');
  assert.equal(f.p.videoSurface.style.transformOrigin, '50% 50%');
  assert.equal(f.p.squashRef, null); assert.equal(f.p.clickFeedbackOnPress, false);
  assert.deepEqual(f.calls.slice(-3), ['pose', 'drag-follow', 'drag-art']);
  staleFrame(); assert.equal(f.p.videoSurface.style.transform, '', 'an already queued frame cannot distort the drag');
  assert.equal(f.p.dragState.dragging, true);
});

test('a cancelled press clears recoil while a real release lets its short feedback finish', () => {
  for (const cancelled of [false, true]) {
    const f = fixture(); f.down(); f.step(60); f.up(cancelled ? 'pointercancel' : 'pointerup');
    assert.equal(f.p.squashRef === null, cancelled);
    if (cancelled) assert.equal(f.p.videoSurface.style.transform, '');
    else { f.p.onClick(); f.step(240); assert.equal(f.p.videoSurface.style.transform, ''); }
    assert.equal(f.p.interaction.phase, cancelled ? 'settled' : 'blocked');
  }
});

test('a synthetic click has immediate feedback even when the pet has no companion clips', () => {
  const f = fixture(); f.p.animations.clicks = []; f.p.onClick(); f.step(16);
  assert.equal(f.calls.filter(x => x === 'bounce').length, 1);
  assert.match(f.p.videoSurface.style.transform, /scaleY\(/); assert.equal(f.gestures.length, 0);
});

test('right-button input, reduced motion and upstream click semantics remain unchanged', () => {
  const right = fixture(); right.down(2); assert.deepEqual(right.calls, []); assert.equal(right.frames.size, 0);
  const reduced = fixture({ reducedMotion: true }); reduced.down(); reduced.up(); reduced.p.onClick();
  assert.equal(reduced.frames.size, 0); assert.equal(reduced.p.videoSurface.style.transform, '');
  const upstream = fixture({ profile: false }); upstream.down(); upstream.up(); upstream.p.onClick();
  assert.equal(upstream.calls.filter(x => x === 'bounce').length, 0); assert.equal(upstream.p.pendingSquash, true);
  assert.deepEqual(upstream.gestures, ['waving']);
});
