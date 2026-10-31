import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const profile = require('../../vendor/dsh-pet/runtime/electron-helper/shuangling-motion.js');
const source = file => readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/' + file, import.meta.url), 'utf8');
const cleanupSource = source('shuangling-frost-cleanup.js');
const spriteSource = source('sprite.js');

test('the real host flattening preserves Shuangling identity and captures the main route in constructor setup', () => {
  const defaults = JSON.parse(readFileSync(new URL('../../windows/default-config.json', import.meta.url), 'utf8'));
  const sandbox = vm.createContext({ SHUANGLING_PROFILE: true, ShuanglingMotion: profile,
    BASE: 'dsh-pet-bridge://dsh-pet/dsh-pet-7340', defaults });
  vm.runInContext(source('shared-core.js'), sandbox);
  const setup = spriteSource.slice(spriteSource.indexOf('    this.assetRoot = pet.assetRoot || pet.id;'), spriteSource.indexOf('    this.pending = null;'));
  assert.ok(setup.includes('this.videoOutlineAssetBase'));
  const sprite = vm.runInContext(`(() => {
    const pet = PetShared.flattenConfigPets({ main: defaults })[0];
    return new (class { constructor(pet) { this.pet = pet; ${setup} }
      isShuanglingProfile() { return SHUANGLING_PROFILE; }
    })(pet);
  })()`, sandbox);
  assert.equal(sprite.pet.id, 'shuangling');
  assert.equal(sprite.pet.extra, false);
  assert.equal(sprite.assetRoot, 'main');
  assert.equal(sprite.videoOutlineAssetBase, sprite.assetBase);
  assert.ok(sprite.videoOutlineAssetBase.endsWith('/thumb/main/'));
});

function fixture({ customUrl = false, wrongHash = false, duration = 124 / 24, name = 'running-left', assetRoot = 'shuangling', petId = 'shuangling', petExtra = false } = {}) {
  const calls = [];
  const makeCanvas = label => {
    const canvas = { width: 1280, height: 720, clientWidth: 339 };
    const ctx = { canvas,
      drawImage(...args) { calls.push([label + ':draw', ...args]); },
      clearRect(...args) { calls.push([label + ':clear', ...args]); },
      fillRect() { calls.push([label + ':fill']); },
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    };
    canvas.getContext = () => ctx;
    return canvas;
  };
  const motion = structuredClone(profile);
  if (wrongHash) motion.outlineMaskRoi.webmSha256ByAnimation[name] = '0'.repeat(64);
  const sandbox = vm.createContext({ SHUANGLING_PROFILE: true, ShuanglingMotion: motion,
    document: { createElement() { return makeCanvas('mask'); } } });
  vm.runInContext('globalThis.window=globalThis;', sandbox);
  vm.runInContext(cleanupSource, sandbox);
  vm.runInContext(spriteSource, sandbox);
  const proto = vm.runInContext('PetSprite.prototype', sandbox);
  const assetBase = 'dsh-pet-bridge://dsh-pet/dsh-pet-7340/thumb/' + assetRoot + '/';
  const video = { videoWidth: 1280, videoHeight: 720, duration, currentTime: 0,
    petOutlineAssetName: name,
    petAnimationSource: customUrl ? 'http://127.0.0.1/custom.webm' : assetBase + name + '.webm' };
  const sprite = Object.assign(Object.create(proto), {
    pet: { id: petId, extra: petExtra }, assetRoot, assetBase, videoOutlineAssetBase: assetBase,
    videoSurface: makeCanvas('frame'), videoOutlineCssPx: .45,
    videoA: {}, videoB: {}, front: 0, gen: 7, size: 339,
  });
  return { sprite, video, calls, cleanup: sandbox.ShuanglingFrostCleanup };
}

test('native specks clear after the single frame copy and before its outline snapshot', () => {
  const f = fixture();
  f.sprite.paintVideoFrame(f.video, 31 / 24);
  const expected = f.cleanup.rectsForFrame('running-left', 31 / 24, f.cleanup.bindings['running-left']);
  const clears = f.calls.filter(([name]) => name === 'frame:clear');
  assert.ok(expected.length > 0);
  assert.deepEqual(clears.map(call => call.slice(1)), Array.from(expected, rect => Array.from(rect)));
  assert.equal(f.calls[0][0], 'frame:draw');
  assert.equal(f.calls.filter(([, image]) => image === f.video).length, 1, 'never read a second decoder pose');
  assert.ok(f.calls.findIndex(([name]) => name === 'mask:draw') > f.calls.findLastIndex(([name]) => name === 'frame:clear'));
  assert.equal(f.video.petPaintedMediaTime, 31 / 24);
  assert.equal(f.video.petPaintedGeneration, 7);
});

test('the standalone main route cleans the same verified reading frame before outlining it', () => {
  const f = fixture({ assetRoot: 'main', name: 'reading', duration: 10 });
  assert.ok(f.sprite.outlineMaskSourceRect(f.video, 0));
  f.sprite.paintVideoFrame(f.video, 108 / 24);
  const expected = f.cleanup.rectsForFrame('reading', 108 / 24, f.cleanup.bindings.reading);
  assert.ok(expected.length > 0);
  assert.deepEqual(f.calls.filter(([name]) => name === 'frame:clear').map(call => call.slice(1)),
    Array.from(expected, rect => Array.from(rect)));
  assert.ok(f.calls.findIndex(([name]) => name === 'mask:draw') > f.calls.findLastIndex(([name]) => name === 'frame:clear'));
});

test('main-route cleanup rejects another pet, changed local base and explicit custom media', () => {
  for (const options of [{ assetRoot: 'main', petId: 'other' }, { assetRoot: 'main', petExtra: true }, { assetRoot: 'main', customUrl: true }, { assetRoot: 'other' }]) {
    const f = fixture(options);
    assert.equal(f.sprite.outlineMaskSourceRect(f.video, 0), null);
    f.sprite.paintVideoFrame(f.video, 31 / 24);
    assert.equal(f.calls.filter(([name]) => name === 'frame:clear').length, 0);
  }
  const f = fixture({ assetRoot: 'main' });
  f.sprite.assetBase += 'changed/';
  assert.equal(f.sprite.outlineMaskSourceRect(f.video, 0), null);
});

for (const [label, options] of [['custom media', { customUrl: true }], ['unreviewed bytes', { wrongHash: true }],
  ['incompatible duration', { duration: 5 }]]) {
  test('native cleanup leaves ' + label + ' untouched', () => {
    const f = fixture(options);
    f.sprite.paintVideoFrame(f.video, 31 / 24);
    assert.equal(f.calls.filter(([name]) => name === 'frame:clear').length, 0);
    assert.equal(f.calls.filter(([, image]) => image === f.video).length, 1);
  });
}

test('millisecond-rounded media time selects the painted native frame, not the decoder clock', () => {
  const f = fixture();
  f.video.currentTime = 0;
  f.sprite.paintVideoFrame(f.video, .083);
  const expected = f.cleanup.rectsForFrame('running-left', 2 / 24, f.cleanup.bindings['running-left']);
  assert.deepEqual(f.calls.filter(([name]) => name === 'frame:clear').map(call => call.slice(1)),
    Array.from(expected, rect => Array.from(rect)));
});

test('ended fallback cleans the final decoded frame without changing the recorded playback time', () => {
  const f = fixture({ name: 'waiting', duration: 116 / 24 });
  f.video.ended = true;
  f.video.currentTime = f.video.duration;
  f.sprite.paintVideoFrame(f.video);
  const binding = f.cleanup.bindings.waiting;
  const expected = f.cleanup.rectsForFrame('waiting', (binding.frameCount - 1) / binding.fps, binding);
  assert.ok(expected.length > 0, 'the final waiting frame has measured debris');
  assert.deepEqual(f.calls.filter(([name]) => name === 'frame:clear').map(call => call.slice(1)),
    Array.from(expected, rect => Array.from(rect)));
  assert.equal(f.calls.filter(([, image]) => image === f.video).length, 1);
  assert.ok(f.calls.findIndex(([name]) => name === 'mask:draw') > f.calls.findLastIndex(([name]) => name === 'frame:clear'));
  assert.equal(f.video.petPaintedMediaTime, f.video.duration, 'movement and receipts retain the real ended clock');
  assert.equal(f.video.petPaintedGeneration, 7);
});

test('an explicit invalid paint timestamp is not rewritten by the ended fallback rule', () => {
  const f = fixture({ name: 'waiting', duration: 116 / 24 });
  f.video.ended = true;
  f.video.currentTime = f.video.duration;
  f.sprite.paintVideoFrame(f.video, f.video.duration);
  assert.equal(f.calls.filter(([name]) => name === 'frame:clear').length, 0);
  assert.equal(f.video.petPaintedMediaTime, f.video.duration);
});
