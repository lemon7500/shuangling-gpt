import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const spriteSource = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
const handoffApi = createRequire(import.meta.url)('../../vendor/dsh-pet/runtime/electron-helper/shuangling-handoff.js');
const base = 'dsh-pet-bridge://dsh-pet/dsh-pet-7340/thumb/main/';
const targets = ['idle', 'running', 'review', 'waiting', 'waving', 'jumping', 'failed'];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

class PreparedVideo {
  constructor(name) {
    this.listeners = new Map(); this.style = {}; this.classList = { add() {}, remove() {} };
    this.currentTime = 0; this.readyState = 4; this.seeking = false; this.paused = true;
    this.error = null; this.loop = false; this.duration = 5; this.playbackRate = 1;
    this.petAnimationSource = this.petPreloadedSource = base + name + '.webm';
  }
  pause() { this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
  addEventListener(event, callback) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(callback); }
  removeEventListener(event, callback) { this.listeners.get(event)?.delete(callback); }
  load() { for (const callback of [...(this.listeners.get('loadeddata') || [])]) callback(); }
}

function markerFixture({ from = 'reading', profile = true, dragging = false, next = 'waiting' } = {}) {
  const context = vm.createContext({
    window: { __dshPetDebug: {}, setTimeout: () => 1, clearTimeout() {} }, console: { warn() {} },
    SHUANGLING_PROFILE: true, BASE: '', ShuanglingHandoff: { policies: Object.fromEntries([...targets, 'reading', 'running-right'].map(name => [name, {}])) },
    S: { ANIMATION_EXT: '.webm' },
  });
  vm.runInContext(spriteSource + '\nthis.P=PetSprite.prototype;', context);
  const p = Object.create(context.P), offers = [], receipts = [];
  Object.assign(p, {
    pet: { id: 'shuangling' }, assetBase: base, front: 0, videoA: new PreparedVideo(from), videoB: new PreparedVideo(next),
    displayedAnim: from, displayedOnce: true, gen: 1, pending: null, playback: 'reading-owner',
    dragState: { active: dragging, dragging }, throwRef: null, pendingSquash: false,
    isShuanglingProfile: () => profile, clearManualAction() {}, stopMove() {}, cancelIdlePreload() {},
    reportPlayback(id, status, reason) { receipts.push({ id, status, reason }); },
    handoff: { request(transaction, callback) { offers.push({ transaction, callback }); }, cancel() {} },
  });
  p.videoA.petOutlineAssetName = from;
  return { p, offers, receipts };
}

function transaction(name = 'waiting', extra = {}) {
  return { anim: name, source: base + name + '.webm', outlineAssetName: name, playbackId: 'task-1', manualAction: false, nativeTaskReturn: true, ...extra };
}

function gateFixture(name = 'reading', originalRate = 1) {
  let now = 0, sequence = 0; const raf = new Map(), seeks = [], copies = [];
  const host = { performance: { now: () => now }, requestAnimationFrame(callback) { const id = ++sequence; raf.set(id, callback); return id; }, cancelAnimationFrame(id) { raf.delete(id); } };
  const doc = { defaultView: host, createElement() {
    const canvas = { width: 0, height: 0, frame: null };
    const ctx = { globalCompositeOperation: 'copy', drawImage(input) { canvas.frame = input.frame; } };
    canvas.getContext = () => ctx; return canvas;
  } };
  const surface = { width: 1280, height: 720, frame: 0, ownerDocument: doc };
  const ctx = { globalCompositeOperation: 'copy', save() {}, restore() {}, drawImage(input, ...coordinates) { assert.equal(this.globalCompositeOperation, 'copy'); copies.push({ frame: input.frame, coordinates }); surface.frame = input.frame; } };
  surface.getContext = () => ctx;
  const video = {
    videoWidth: 1280, videoHeight: 720, readyState: 4, seeking: false, paused: false, ended: false, loop: true,
    playbackRate: originalRate, petPlaybackGeneration: 7, petOutlineAssetName: name, petAnimationSource: base + name + '.webm', petPaintedMediaTime: 0, time: 0,
    get currentTime() { return this.time; }, set currentTime(value) { seeks.push(value); this.time = value; },
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); },
  };
  const sprite = {
    front: 0, videoA: video, videoB: {}, videoSurface: surface, assetBase: base, squashRef: null,
    isShuanglingProfile: () => true, stopVideoPaint() {}, startVideoPaint() {}, stopMove() {},
    frost: { beginTransition() {}, onTransition() {}, onAnimation() {}, onFrame() {} },
  };
  const handoff = handoffApi.create(sprite); handoff.onCommit(video, 7);
  return { video, sprite, handoff, seeks, copies, surface,
    paint(frame) { surface.frame = frame; video.petPaintedMediaTime = video.time = frame / 24; handoff.capture(video, frame / 24); },
    async run(ms) { for (let elapsed = 0; elapsed < ms; elapsed += 10) { now += 10; const callbacks = [...raf.values()]; raf.clear(); for (const callback of callbacks) callback(now); await settle(); } },
  };
}

test('sprite marks only controller-like local reading-to-task preparations', async () => {
  for (const next of targets) {
    const f = markerFixture({ next }); f.p.switchTo(next, true, 'owned-task'); await settle();
    assert.equal(f.p.pending.nativeTaskReturn, true, next);
    assert.equal(f.offers[0].transaction.nativeTaskReturn, true);
  }
});

test('manual, URL, other profiles/clips, drag and non-task targets cannot mint the marker', async () => {
  for (const config of [
    { manual: true }, { playbackId: null }, { url: 'https://example.invalid/video.webm' },
    { from: 'idle' }, { from: 'running' }, { profile: false }, { dragging: true }, { next: 'reading' }, { next: 'running-right' },
  ]) {
    const next = config.next || 'waiting', f = markerFixture({ ...config, next });
    f.p.videoB.readyState = 0;
    f.p.switchTo(next, true, config.playbackId === null ? null : 'owned-task', config.url, config.manual || false); await settle();
    assert.equal(f.p.pending.nativeTaskReturn, false, JSON.stringify(config));
  }
  const wrongSource = markerFixture(); wrongSource.p.videoA.petAnimationSource = 'https://example.invalid/reading.webm';
  wrongSource.p.switchTo('waiting', true, 'owned-task'); assert.equal(wrongSource.p.pending.nativeTaskReturn, false);
});

test('reusing a prepared target recomputes the internal marker for its latest owner', async () => {
  const f = markerFixture(); f.p.switchTo('waiting', true, 'first-task'); await settle();
  const pending = f.p.pending; assert.equal(pending.nativeTaskReturn, true);
  f.p.switchTo('waiting', true, null, undefined, true); await settle();
  assert.equal(f.p.pending, pending); assert.equal(pending.nativeTaskReturn, false);
  assert.equal(pending.manualAction, true);
  f.p.switchTo('waiting', true, 'latest-task'); await settle();
  assert.equal(f.p.pending, pending); assert.equal(pending.nativeTaskReturn, true);
  assert.equal(pending.playbackId, 'latest-task');
});

test('native forward reading return uses 1.25 only until the genuine authored terminal', async () => {
  const f = gateFixture(); f.paint(144); const committed = [];
  f.handoff.request(transaction(), () => { committed.push(f.surface.frame); return true; });
  assert.equal(f.video.playbackRate, 1.25); assert.equal(f.video.loop, false);
  f.paint(238); await settle(); assert.deepEqual(committed, []);
  f.paint(239); await settle(); assert.deepEqual(committed, [239]);
  assert.equal(f.video.playbackRate, 1); assert.equal(f.video.loop, true);
  assert.deepEqual(f.seeks, []); assert.deepEqual(f.copies, [], 'forward return uses the decoder, not copied or blended artwork');
});

test('native gate independently rejects malformed task markers and untrusted outgoing media', async () => {
  for (const extra of [
    { nativeTaskReturn: false }, { manualAction: true }, { manualAction: undefined }, { playbackId: null },
    { outlineAssetName: null }, { source: 'https://example.invalid/waiting.webm' },
  ]) {
    const f = gateFixture(); f.paint(144); f.handoff.request(transaction('waiting', extra), () => true);
    assert.equal(f.video.playbackRate, 1, JSON.stringify(extra)); f.handoff.cancel();
  }
  for (const name of ['reading', 'running-right', 'drag-lift']) {
    const f = gateFixture(); f.paint(144); f.handoff.request(transaction(name), () => true);
    assert.equal(f.video.playbackRate, 1, name); f.handoff.cancel();
  }
  const other = gateFixture('waiting'); other.paint(60); other.handoff.request(transaction(), () => true);
  assert.equal(other.video.playbackRate, 1); other.handoff.cancel();
  const wrongSource = gateFixture(); wrongSource.paint(144); wrongSource.video.petAnimationSource = 'https://example.invalid/reading.webm';
  wrongSource.handoff.request(transaction(), () => true); assert.equal(wrongSource.video.playbackRate, 1); await settle();
});

test('latest task retargets the existing forward return without an obsolete commit', async () => {
  const f = gateFixture(); f.paint(144); const commits = [];
  f.handoff.request(transaction('running'), () => commits.push('obsolete'));
  f.paint(170); f.handoff.request(transaction('waiting', { playbackId: 'latest-task' }), () => commits.push('latest'));
  assert.equal(f.video.playbackRate, 1.25); f.paint(239); await settle();
  assert.deepEqual(commits, ['latest']); assert.equal(f.video.playbackRate, 1); assert.deepEqual(f.seeks, []);
});

test('a manual retarget and cancellation restore the outgoing decoder original rate', async () => {
  for (const originalRate of [1, 1.1]) {
    const f = gateFixture('reading', originalRate); f.paint(144); const commits = [];
    f.handoff.request(transaction(), () => commits.push('obsolete'));
    f.handoff.request({ anim: 'waving', manualAction: true }, () => commits.push('manual'));
    assert.equal(f.video.playbackRate, originalRate, 'new manual intent cannot retain automatic speedup');
    f.paint(239); await settle(); assert.deepEqual(commits, ['manual']); assert.equal(f.video.playbackRate, originalRate);
    const canceled = gateFixture('reading', originalRate); canceled.paint(144);
    canceled.handoff.request(transaction(), () => assert.fail('cancelled task cannot commit'));
    canceled.handoff.cancel(); assert.equal(canceled.video.playbackRate, originalRate); assert.equal(canceled.video.loop, true);
    await canceled.run(50); assert.deepEqual(canceled.seeks, []);
  }
});

test('reverse reading keeps its existing genuine cached-frame timing and drag keeps its existing cap', async () => {
  const reverse = gateFixture(); for (let frame = 1; frame <= 24; frame++) reverse.paint(frame);
  const commits = []; reverse.handoff.request(transaction(), () => commits.push(reverse.surface.frame));
  assert.equal(reverse.video.playbackRate, 1); assert.equal(reverse.video.paused, true);
  await reverse.run(760); assert.deepEqual(commits, []); await reverse.run(60); assert.deepEqual(commits, [0]);
  assert.deepEqual(reverse.seeks, []);
  const drag = gateFixture(); drag.paint(144);
  drag.handoff.request({ anim: 'drag-lift', nativeDragReturn: true }, () => true);
  assert.equal(drag.video.playbackRate, 3); drag.handoff.cancel(); assert.equal(drag.video.playbackRate, 1);
});
