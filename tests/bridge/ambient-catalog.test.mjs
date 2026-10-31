import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../../vendor/dsh-pet/src/host/ambient-animations.ts', import.meta.url), 'utf8');
const { withAmbientAnimations } = await import('data:text/javascript,' + encodeURIComponent(stripTypeScriptTypes(source, { mode: 'strip' })));

test('accepted ambient media is projected without changing persisted animations or physics', () => {
  const raw = { pets: [{ id: 'shuangling', size: 339 }], physics: { gravity: .7 }, animations: { categories: [{ id: 'work', weight: 5, actions: ['running'] }], future: true } };
  const frozen = structuredClone(raw);
  assert.equal(withAmbientAnimations(raw, []), raw);
  assert.equal(withAmbientAnimations(raw, ['unknown', '../reading']), raw);
  const view = withAmbientAnimations(raw, ['reading', 'stretching-wings', 'reading', 'unknown']);
  assert.deepEqual(raw, frozen);
  assert.equal(view.pets, raw.pets); assert.equal(view.physics, raw.physics);
  assert.deepEqual(view.animations.categories[0], frozen.animations.categories[0]);
  assert.deepEqual(view.animations.categories[1], { id: 'shuangling-companion', weight: 0, noMirror: true, actions: ['reading', 'stretching-wings'] });
  assert.equal(view.animations.future, true);
});
