import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyOutlineAssetContract } from '../../windows/outline-contract.mjs';
const require = createRequire(import.meta.url);
const { groups, select, logicalName, createSelector } = require('../../vendor/dsh-pet/runtime/electron-helper/shuangling-manual-variants.js');

test('each manual group independently selects current and classic with an equal threshold', () => {
  for (const [logical, choices] of Object.entries(groups)) {
    const samples = Array.from({ length: 100 }, (_, index) => select({ anim: logical }, () => (index + .5) / 100).anim);
    assert.equal(samples.filter(name => name === choices[0]).length, 50);
    assert.equal(samples.filter(name => name === choices[1]).length, 50);
    assert.equal(select({ anim: logical }, () => .499999).anim, choices[0]);
    assert.equal(select({ anim: logical }, () => .5).anim, choices[1]);
    assert.equal(logicalName(choices[1]), logical);
  }
});

test('a queued click keeps its chosen take and consumes entropy exactly once', () => {
  for (const sample of [.2, .8]) {
    let calls = 0;
    const source = { anim: 'review' };
    const selected = select(source, () => { calls++; return sample; });
    assert.deepEqual(source, { anim: 'review' });
    const queued = { anim: selected.anim, manualVariantSelected: selected.manualVariantSelected };
    const dispatched = select(queued, () => { calls++; return 1 - sample; });
    assert.equal(dispatched.anim, selected.anim);
    assert.equal(dispatched, queued);
    assert.equal(calls, 1);
  }
});

test('task receipts, unknown names and non-variant actions never randomize', () => {
  const unexpected = () => { throw Error('entropy must not be consumed'); };
  for (const leaf of [null, { anim: 'review', playbackId: 'task-1' }, { anim: 'idle' }, { anim: 'running-right' }, { anim: '../waiting' }, { anim: 'constructor' }, { anim: 'review-classic' }]) {
    assert.equal(select(leaf, unexpected), leaf);
  }
  assert.equal(logicalName('idle'), 'idle');
  for (const entropy of [NaN, Infinity, -1, 1, '0.8']) assert.equal(select({ anim: 'running' }, () => entropy).anim, 'running');
});

test('each group permits two real consecutive plays and forces the third to the other take', () => {
  for (const [logical, choices] of Object.entries(groups)) {
    for (const entropy of [.1, .9]) {
      const selector = createSelector(), preferred = entropy < .5 ? choices[0] : choices[1];
      const plays = []; let calls = 0;
      for (let generation = 1; generation <= 12; generation++) {
        const chosen = selector.select({ anim: logical }, () => { calls++; return entropy; });
        plays.push(chosen.anim); assert.equal(selector.record(chosen.anim, generation), true);
      }
      assert.equal(plays[0], preferred); assert.equal(plays[1], preferred);
      assert.equal(plays[2], choices.find(name => name !== preferred));
      for (let i = 2; i < plays.length; i++) assert.ok(!(plays[i] === plays[i - 1] && plays[i] === plays[i - 2]));
      assert.equal(calls, 12, 'a forced choice still consumes only its one original draw');
    }
  }
});

test('preparations and canceled choices do not consume the two-play allowance', () => {
  const selector = createSelector();
  for (let i = 0; i < 8; i++) assert.equal(selector.select({ anim: 'review' }, () => .1).anim, 'review');
  assert.equal(selector.record('review', 3), true);
  assert.equal(selector.select({ anim: 'review' }, () => .1).anim, 'review');
  assert.equal(selector.record('review', 7), true);
  for (let i = 0; i < 8; i++) assert.equal(selector.select({ anim: 'review' }, () => .1).anim, 'review-classic');
  // Merely preparing the alternate take does not erase the committed streak.
  assert.equal(selector.select({ anim: 'review' }, () => .9).anim, 'review-classic');
});

test('duplicate and obsolete playback generations cannot count a take twice', () => {
  const selector = createSelector();
  for (const name of ['constructor', '__proto__', 'toString', 'idle', '../waiting', null, 123])
    assert.equal(selector.record(name, 100), false, 'non-variant names cannot poison the generation or history');
  assert.equal(selector.record('waiting', 12), true);
  for (const generation of [12, 11, 0, -1, NaN, Infinity, '13', undefined])
    assert.equal(selector.record('waiting', generation), false);
  assert.equal(selector.select({ anim: 'waiting' }, () => .1).anim, 'waiting');
  assert.equal(selector.record('waiting', 13), true);
  assert.equal(selector.select({ anim: 'waiting' }, () => .1).anim, 'waiting-classic');
  assert.equal(selector.record('waiting-classic', 13), false, 'one real generation cannot become two takes');
  assert.equal(selector.select({ anim: 'waiting' }, () => .1).anim, 'waiting-classic');
});

test('groups retain independent streaks across other actions and pet instances', () => {
  const selector = createSelector(), anotherPet = createSelector();
  selector.record('running', 1); selector.record('running', 2);
  selector.record('review-classic', 3); selector.record('review-classic', 4);
  selector.record('waiting', 5);
  assert.equal(selector.record('idle', 6), false);
  assert.equal(selector.select({ anim: 'running' }, () => .1).anim, 'running-classic');
  assert.equal(selector.select({ anim: 'review' }, () => .9).anim, 'review');
  assert.equal(selector.select({ anim: 'waiting' }, () => .1).anim, 'waiting');
  assert.equal(anotherPet.select({ anim: 'running' }, () => .1).anim, 'running');
  assert.equal(anotherPet.select({ anim: 'review' }, () => .9).anim, 'review-classic');
});

test('bounded selectors keep queued intentions and exact task names without new random draws', () => {
  const selector = createSelector(); let calls = 0;
  selector.record('review', 1); selector.record('review', 2);
  const chosen = selector.select({ anim: 'review' }, () => { calls++; return .1; });
  assert.equal(chosen.anim, 'review-classic');
  assert.equal(selector.select(chosen, () => { calls++; return .9; }), chosen);
  const task = { anim: 'review', playbackId: 'exact-task' };
  assert.equal(selector.select(task, () => { throw Error('task must not draw'); }), task);
  assert.equal(calls, 1);
  for (const name of ['constructor', '../review', 'review-classic', 'idle', 'running-right']) {
    const leaf = { anim: name }; assert.equal(selector.select(leaf, () => { throw Error('explicit take must stay exact'); }), leaf);
  }
});

test('classic takes are real hash-bound media and fit the existing outline ROI', () => {
  const assets = JSON.parse(readFileSync(new URL('../../reports/windows-assets.json', import.meta.url), 'utf8'));
  const profile = require('../../vendor/dsh-pet/runtime/electron-helper/shuangling-motion.js');
  const rows = verifyOutlineAssetContract({ profile,
    manifestPath: new URL('../../' + assets.motionManifest, import.meta.url),
    assetDirectory: fileURLToPath(new URL('../../windows/assets/shuangling/', import.meta.url)),
    animations: assets.animations,
  });
  for (const choices of Object.values(groups)) {
    assert.ok(rows.some(row => row.name === choices[1]));
    const row = assets.animations.find(row => row.name === choices[1]);
    assert.equal(row.manualOnly, true); assert.equal(row.firstLastPixelEqual, true);
    assert.equal(row.encodedFrames, 124); assert.equal(row.fps, 24);
    const [x, y, width, height] = profile.outlineMaskRoi.sourceRect;
    const [left, top, right, bottom] = row.alphaBounds;
    assert.ok(left >= x + 16 && top >= y + 16 && right <= x + width - 16 && bottom <= y + height - 16);
  }
});
