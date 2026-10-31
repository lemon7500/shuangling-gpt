import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assertAuditDiskHeadroom, installRendererProbe, selectPublicActions, summarizeIdleSoak } from '../../tools/verify-companion-native.mjs';

test('the native observer forwards commit generation and all later paint arguments unchanged', () => {
  let received, receiver;
  const video = () => ({ addEventListener() {}, currentTime: 0, playbackRate: 1 });
  const sprite = { front: 0, videoA: video(), videoB: video(), pos: { x: 0, y: 0 }, animations: { categories: [] },
    paintVideoFrame(...args) { received = args; receiver = this; return 'original-result'; },
    sendBounds() {}, reportPlayback() {} };
  const sandbox = vm.createContext({ sprites: [sprite], window: {}, document: { createElement() { return { getContext() { return {}; } }; } } });
  vm.runInContext('(' + installRendererProbe.toString() + ')()', sandbox);
  const extension = {};
  assert.equal(sprite.paintVideoFrame(sprite.videoA, 0, 37, extension), 'original-result');
  assert.equal(receiver, sprite);
  assert.deepEqual(received, [sprite.videoA, 0, 37, extension]);
});

test('native audit stops above the three-GiB floor with a small shutdown reserve', () => {
  const floor = 3 * 1024 ** 3, reserve = 16 * 1024 ** 2;
  for (const free of [0, floor - 1, floor, floor + reserve, NaN, Infinity, -1]) assert.throws(() => assertAuditDiskHeadroom(free), /disk-safety-stop/);
  assert.equal(assertAuditDiskHeadroom(floor + reserve + 1), floor + reserve + 1);
});

test('a thirty-minute audit cannot pass without actually observing every installed companion gesture', () => {
  const row = (name, startedAt) => ({ name, status: 'ended', startedAt, endedAt: startedAt + 1000,
    rateMin: 1, rateMax: 1, paints: 24, distinctPaintHashes: 12, mediaMin: 0, mediaMax: 1 });
  const records = { one: row('reading', 0), two: row('looking-around', 26000) };
  const options = { expectedMs: 1800000, elapsedMs: 1800000 };
  assert.equal(summarizeIdleSoak(records, options).checks.everyCompanionObserved, false);
  records.three = row('stretching-wings', 52000);
  assert.equal(summarizeIdleSoak(records, options).checks.everyCompanionObserved, true);
  assert.equal(summarizeIdleSoak(records, options).ok, true);
});

test('real manifest audits twelve public actions without submitting private clip names to the public API', () => {
  const assets = JSON.parse(readFileSync(new URL('../../reports/windows-assets.json', import.meta.url), 'utf8'));
  const { playable, internal } = selectPublicActions(assets.animations);
  assert.equal(playable.length, 12);
  assert.ok(playable.some(row => row.name === 'reading' && row.durationMs === 10000));
  assert.equal(playable.length + internal.length, assets.animations.length);
  assert.deepEqual(internal.map(row => row.name).sort(), ['drag-hover', 'drag-lift', 'drag-lower', 'review-classic', 'running-classic', 'waiting-classic']);
  assert.ok(internal.every(row => row.publicPlayback === false && row.reason.length > 0));
});

test('new or mislabeled media cannot be silently excluded from native audits', () => {
  assert.throws(() => selectPublicActions([{ name: 'unclassified' }]), /unclassified/);
  assert.throws(() => selectPublicActions([{ name: 'running-classic' }]), /manual-variant-must-be-explicit/);
  assert.throws(() => selectPublicActions([{ name: 'reading' }, { name: 'reading' }]), /duplicate/);
});
