import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/shuangling-frost-cleanup.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const api = context.ShuanglingFrostCleanup;
const assets = JSON.parse(readFileSync(new URL('../../reports/windows-assets.json', import.meta.url), 'utf8')).animations;

function sample() {
  for (const [name, binding] of Object.entries(api.bindings)) {
    for (let frame = 0; frame < binding.frameCount; frame++) {
      const rects = api.rectsForFrame(name, frame / binding.fps, binding);
      if (rects.length && frame > 0) return { name, binding, frame, rects };
    }
  }
  assert.fail('expected measured matte debris in at least one source frame');
}

test('offline masks are bound to every current asset hash and native frame inventory', () => {
  assert.equal(api.schema, 'shuangling-gpt/frost-cleanup-v1');
  assert.deepEqual(Object.keys(api.bindings).sort(), assets.map(row => row.name).sort());
  for (const row of assets) {
    const binding = api.bindings[row.name];
    const bytes = readFileSync(new URL('../../windows/assets/shuangling/' + row.name + '.webm', import.meta.url));
    assert.equal(binding.sha256, createHash('sha256').update(bytes).digest('hex'), row.name);
    assert.equal(binding.sha256, row.webmSha256, row.name);
    assert.deepEqual([binding.width, binding.height, binding.fps, binding.frameCount], [1280, 720, row.fps, row.encodedFrames]);
    assert.ok(Object.isFrozen(binding));
  }
});

test('every offline rectangle is compact, integral and inside the native canvas', () => {
  let total = 0;
  for (const [name, binding] of Object.entries(api.bindings)) {
    for (let frame = 0; frame < binding.frameCount; frame++) {
      const rects = api.rectsForFrame(name, frame / binding.fps, binding);
      assert.ok(Object.isFrozen(rects));
      for (const rect of rects) {
        const [x, y, width, height] = rect;
        assert.ok(Object.isFrozen(rect));
        assert.ok(rect.every(Number.isInteger));
        assert.ok(width > 0 && height > 0 && width <= 130 && height <= 130);
        assert.ok(x >= 0 && y >= 0 && x + width <= binding.width && y + height <= binding.height);
        total++;
      }
    }
  }
  assert.ok(total > 0);
});

test('unknown assets, changed hashes, dimensions and timelines fail closed', () => {
  const { name, binding, frame } = sample();
  const time = frame / binding.fps;
  for (const badName of ['unknown', '__proto__', 'constructor', null]) {
    assert.equal(api.rectsForFrame(badName, time, binding).length, 0);
  }
  for (const [key, wrong] of [['sha256', '0'.repeat(64)], ['width', 720], ['height', 1280], ['fps', 30], ['frameCount', binding.frameCount + 1]]) {
    assert.equal(api.rectsForFrame(name, time, { ...binding, [key]: wrong }).length, 0, key);
  }
  for (const missing of [null, {}, { sha256: binding.sha256 }]) assert.equal(api.rectsForFrame(name, time, missing).length, 0);
  for (const badTime of [NaN, Infinity, undefined, -1, binding.frameCount / binding.fps]) {
    assert.equal(api.rectsForFrame(name, badTime, binding).length, 0);
  }
});

test('millisecond-rounded WebM paint timestamps select the native frame without a second clock', () => {
  const { name, binding, frame, rects } = sample();
  assert.deepEqual(api.rectsForFrame(name, Math.round(frame / binding.fps * 1000) / 1000, binding), rects);
  assert.doesNotMatch(source, /getImageData|requestAnimationFrame|setTimeout|setInterval|performance\.now/);
});

test('paint cleanup clears only the selected offline rectangles on a matching native surface', () => {
  const { name, binding, frame, rects } = sample();
  const calls = [];
  const drawing = { canvas: { width: binding.width, height: binding.height }, clearRect(...rect) { calls.push(rect); } };
  assert.equal(api.apply(drawing, name, frame / binding.fps, binding), rects.length);
  assert.equal(JSON.stringify(calls), JSON.stringify(rects));
  calls.length = 0;
  drawing.canvas.width++;
  assert.equal(api.apply(drawing, name, frame / binding.fps, binding), 0);
  assert.equal(api.apply({ clearRect() { assert.fail('no canvas'); } }, name, frame / binding.fps, binding), 0);
  assert.equal(api.apply(null, name, frame / binding.fps, binding), 0);
  assert.equal(calls.length, 0);
});

test('reviewed disconnected blue light marks are removed even beside the protected silhouette buffer', () => {
  // Coordinates were visually reviewed in the unchanged pickup/hold/lower clips.
  const samples = [
    ['drag-lift', 3, 783, 502],
    ['drag-hover', 1, 794, 427],
    ['drag-hover', 14, 730, 546],
    ['drag-lower', 29, 783, 502],
  ];
  for (const [name, frame, px, py] of samples) {
    const rects = api.rectsForFrame(name, frame / 24, api.bindings[name]);
    assert.ok(rects.some(([x,y,w,h]) => px >= x && px < x+w && py >= y && py < y+h), name + ' F' + frame + ' background point');
  }
});
