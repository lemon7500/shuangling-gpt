import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const spriteSource = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
const assetBase = 'dsh-pet-bridge://dsh-pet/dsh-pet-7340/thumb/main/';
const source = assetBase + 'idle.webm';

class Decoder {
  constructor() {
    this.listeners = new Map(); this.style = {}; this.classList = { add() {}, remove() {} };
    this.readyState = 4; this.seeking = false; this.error = null; this._time = 0;
    this.petAnimationSource = source; this.seekWrites = 0; this.playCalls = 0; this.loadCalls = 0;
  }
  get currentTime() { return this._time; }
  set currentTime(value) { this.seekWrites++; this._time = value; this.seeking = true; }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name) { for (const callback of [...(this.listeners.get(name) || [])]) callback(); }
  pause() { this.paused = true; }
  play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
  load() { this.loadCalls++; }
  finishSeek() { this.seeking = false; this.emit('seeked'); }
}

function fixture(profile = true) {
  const timers = new Map(); let sequence = 0;
  const context = vm.createContext({
    window: { setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); } },
    SHUANGLING_PROFILE: profile, S: { ANIMATION_EXT: '.webm' }, console,
  });
  vm.runInContext(spriteSource + '\nthis.prototype = PetSprite.prototype;', context);
  const p = Object.create(context.prototype), paints = [], receipts = [];
  Object.assign(p, {
    assetRoot: 'main', assetBase, videoOutlineAssetBase: null, animations: { idle: ['idle'] },
    videoA: new Decoder(), videoB: new Decoder(), front: 0, idlePreload: null, pending: null, gen: 0,
    videoSurface: { style: {} }, displayedAnim: 'waving', displayedOnce: true, playback: null,
    videoFacingTransform: () => '', startVideoPaint() {},
    paintVideoFrame(video, time) { paints.push({ time, decoderTime: video.currentTime, seeking: video.seeking, readyState: video.readyState, playCalls: video.playCalls }); },
    reportPlayback(id, status, reason) { receipts.push({ id, status, reason }); },
  });
  return { p, hidden: p.videoB, paints, receipts, timers };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('main asset root predecodes its own neutral without an outline ROI or starting playback', () => {
  const { p, hidden, paints, receipts } = fixture();
  p.preloadIdleFrame();
  assert.equal(p.assetRoot, 'main'); assert.equal(p.videoOutlineAssetBase, null);
  assert.equal(hidden.petPreloadedSource, source);
  assert.equal(hidden.currentTime, 0); assert.equal(hidden.seekWrites, 0); assert.equal(hidden.playCalls, 0);
  assert.equal(hidden.paused, true); assert.deepEqual(paints, []); assert.deepEqual(receipts, []);
  const upstream = fixture(false); upstream.p.preloadIdleFrame();
  assert.equal(upstream.hidden.petPreloadedSource, undefined);
});

test('predecode only becomes usable after data is ready and a seek really finishes', () => {
  const { p, hidden } = fixture();
  hidden.readyState = 1; hidden._time = .25;
  p.preloadIdleFrame();
  assert.equal(hidden.petPreloadedSource, null);
  hidden.readyState = 4; hidden.emit('loadeddata');
  assert.equal(hidden.seekWrites, 1); assert.equal(hidden.seeking, true);
  assert.equal(hidden.petPreloadedSource, null, 'a zero timestamp during seek does not prove F0 is decoded');
  hidden.finishSeek();
  assert.equal(hidden.petPreloadedSource, source);
});

test('a completed matching predecode paints F0 while paused without a redundant seek or warmup play', () => {
  const { p, hidden, paints, receipts } = fixture();
  p.preloadIdleFrame();
  p.preloadIdleFrame = () => {};
  p.switchTo('idle', true, 'new-receipt');
  assert.equal(hidden.seekWrites, 0, 'even assigning currentTime=0 again would begin a new Chromium seek');
  assert.equal(paints.length, 1); assert.equal(paints[0].time, 0); assert.equal(paints[0].decoderTime, 0);
  assert.equal(paints[0].seeking, false); assert.equal(paints[0].playCalls, 0, 'the decoded first frame precedes play()');
  assert.equal(hidden.playCalls, 1); assert.equal(p.front, 1);
  assert.deepEqual(receipts.map(row => row.status), ['playing']);
});

test('a preloaded marker with insufficient data cannot bypass loading or commit a later frame', async () => {
  const { p, hidden, paints } = fixture();
  hidden.petPreloadedSource = source; hidden.readyState = 1; hidden._time = .292;
  p.preloadIdleFrame = () => {};
  p.switchTo('idle', true, 'cold');
  assert.equal(hidden.petPreloadedSource, null); assert.equal(hidden.loadCalls, 1); assert.equal(paints.length, 0);
  hidden.readyState = 4; hidden.emit('loadeddata'); await settle();
  assert.equal(hidden.seekWrites, 1); assert.equal(paints.length, 0);
  hidden.finishSeek();
  assert.equal(paints.length, 1); assert.equal(paints[0].decoderTime, 0);
});

test('a still-seeking predecode cannot commit until seeked confirms neutral', () => {
  const { p, hidden, paints } = fixture();
  hidden.petPreloadedSource = source; hidden.seeking = true;
  p.preloadIdleFrame = () => {};
  p.switchTo('idle', true, 'seeking');
  assert.equal(hidden.seekWrites, 1); assert.equal(paints.length, 0);
  hidden.finishSeek();
  assert.equal(paints.length, 1); assert.equal(paints[0].decoderTime, 0);
});

test('ordinary cached replay still seeks and waits rather than treating currentTime=0 as a predecode', async () => {
  for (const marker of [undefined, assetBase + 'waving.webm']) {
    const { p, hidden, paints } = fixture();
    hidden.petPreloadedSource = marker; p.preloadIdleFrame = () => {};
    p.switchTo('idle', true, 'ordinary');
    assert.equal(hidden.seekWrites, 1); assert.equal(paints.length, 0);
    hidden.finishSeek(); await settle();
    assert.equal(hidden.seekWrites, 2); assert.equal(paints.length, 0);
    hidden.finishSeek();
    assert.equal(paints.length, 1); assert.equal(paints[0].decoderTime, 0);
  }
});

test('a nonzero predecode must seek back before committing its first frame', () => {
  const { p, hidden, paints } = fixture();
  hidden.petPreloadedSource = source; hidden._time = .125; p.preloadIdleFrame = () => {};
  p.switchTo('idle', true, 'nonzero');
  assert.equal(hidden.seekWrites, 1); assert.equal(paints.length, 0);
  hidden.finishSeek();
  assert.equal(paints.length, 1); assert.equal(paints[0].decoderTime, 0);
});
