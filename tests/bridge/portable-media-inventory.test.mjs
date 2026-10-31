import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CORE_ANIMATIONS, AMBIENT_ANIMATIONS, MANUAL_VARIANTS, DRAG_ANIMATIONS } from '../../windows/outline-contract.mjs';
import { validatePackagedAnimationInventory } from '../../tools/portable-media-inventory.mjs';

const metadata = names => ({ animations: names.map(name => ({ name })) });
const oldContract = { verifyOutlineAssetContract() {} };
const newContract = { ...oldContract, CORE_ANIMATIONS, AMBIENT_ANIMATIONS };
const variantContract = { ...newContract, MANUAL_VARIANTS };
const dragContract = { ...variantContract, DRAG_ANIMATIONS };
const run = promisify(execFile);

test('portable plan includes all current media and rejects an incomplete drag capability without building a package', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shuangling-package-plan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['tools/licenses', 'windows', 'reports', 'vendor/dsh-pet']) await mkdir(join(root, dir), { recursive: true });
  for (const file of ['tools/package-windows.mjs', 'tools/portable-media-inventory.mjs', 'windows/outline-contract.mjs']) {
    await copyFile(new URL('../../' + file, import.meta.url), join(root, file));
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.9.0', type: 'module' }));
  await writeFile(join(root, 'vendor/dsh-pet/package.json'), JSON.stringify({ name: 'isolated-fixture', version: '1.0.0', dependencies: {} }));
  await writeFile(join(root, 'tools/licenses/sources.json'), JSON.stringify({ schema: 'shuangling-license-supplements-v1', sources: [] }));
  const assets = JSON.parse(await readFile(new URL('../../reports/windows-assets.json', import.meta.url), 'utf8'));
  const manifest = join(root, 'reports/windows-assets.json');
  await writeFile(manifest, JSON.stringify(assets));
  const result = JSON.parse((await run(process.execPath, [join(root, 'tools/package-windows.mjs'), '--plan'], { windowsHide: true })).stdout);
  const expected = [...CORE_ANIMATIONS, ...AMBIENT_ANIMATIONS, ...MANUAL_VARIANTS, ...DRAG_ANIMATIONS];
  assert.equal(assets.animations.length, expected.length);
  assert.deepEqual(result.sourceFiles.filter(file => file.endsWith('.webm')).sort(), expected.map(name => `windows/assets/shuangling/${name}.webm`).sort());
  await assert.rejects(stat(join(root, 'release')), { code: 'ENOENT' });
  assets.animations = assets.animations.filter(row => row.name !== 'drag-lower');
  await writeFile(manifest, JSON.stringify(assets));
  await assert.rejects(run(process.execPath, [join(root, 'tools/package-windows.mjs'), '--plan'], { windowsHide: true }), error => /inventory/.test(error.stderr));
  await assert.rejects(stat(join(root, 'release')), { code: 'ENOENT' });
});

test('legacy nine-clip packages remain supported without new exported constants', () => {
  const result = validatePackagedAnimationInventory(metadata(CORE_ANIMATIONS), oldContract);
  assert.equal(result.names.length, 9);
  assert.equal(result.legacyContract, true);
  assert.throws(() => validatePackagedAnimationInventory(metadata([...CORE_ANIMATIONS, 'looking-around']), oldContract), /inventory/);
});

test('new packages validate their own accepted subset rather than the source current count', () => {
  for (const names of [CORE_ANIMATIONS, [...CORE_ANIMATIONS, 'looking-around', 'stretching-wings'], [...CORE_ANIMATIONS, ...AMBIENT_ANIMATIONS]]) {
    const result = validatePackagedAnimationInventory(metadata(names), newContract);
    assert.deepEqual(result.names, names);
    assert.equal(result.legacyContract, false);
  }
});

test('duplicate, unknown or missing required clips cannot pass by matching a count', () => {
  for (const names of [
    CORE_ANIMATIONS.slice(1),
    [...CORE_ANIMATIONS, 'idle'],
    [...CORE_ANIMATIONS, 'unreviewed'],
    [...CORE_ANIMATIONS.slice(1), 'looking-around'],
  ]) assert.throws(() => validatePackagedAnimationInventory(metadata(names), newContract), /inventory/);
});

test('classic manual alternatives are supported only by packages that declare them', () => {
  const names = [...CORE_ANIMATIONS, 'looking-around', 'stretching-wings', ...MANUAL_VARIANTS];
  assert.deepEqual(validatePackagedAnimationInventory(metadata(names), variantContract).names, names);
  assert.throws(() => validatePackagedAnimationInventory(metadata(names), newContract), /inventory/);
  assert.throws(() => validatePackagedAnimationInventory(metadata([...names, 'running-classic']), variantContract), /inventory/);
  for (const manual of [['../running-classic'], ['unreviewed'], ['review-classic', 'review-classic'], null]) {
    assert.throws(() => validatePackagedAnimationInventory(metadata(CORE_ANIMATIONS), { ...newContract, MANUAL_VARIANTS: manual }), /manual/);
  }
});

test('internal drag clips require a declared complete triplet while older inventories remain valid', () => {
  const baseline = [...CORE_ANIMATIONS, ...AMBIENT_ANIMATIONS, ...MANUAL_VARIANTS];
  const full = [...baseline, ...DRAG_ANIMATIONS];
  assert.deepEqual(validatePackagedAnimationInventory(metadata(full), dragContract).names, full);
  assert.deepEqual(validatePackagedAnimationInventory(metadata(baseline), dragContract).names, baseline);
  assert.deepEqual(validatePackagedAnimationInventory(metadata(CORE_ANIMATIONS), { ...newContract, DRAG_ANIMATIONS: [] }).names, CORE_ANIMATIONS);
  assert.throws(() => validatePackagedAnimationInventory(metadata(full), variantContract), /inventory/);
  for (const extras of [DRAG_ANIMATIONS.slice(0, 1), DRAG_ANIMATIONS.slice(1), [...DRAG_ANIMATIONS, 'drag-drop'], [...DRAG_ANIMATIONS, 'drag-hover']]) {
    assert.throws(() => validatePackagedAnimationInventory(metadata([...baseline, ...extras]), dragContract), /inventory/);
  }
  for (const drag of [DRAG_ANIMATIONS.slice(0, 2), [...DRAG_ANIMATIONS, 'drag-drop'], ['drag-lift', 'drag-hover', 'drag-hover'], ['../drag-lift', 'drag-hover', 'drag-lower'], null]) {
    assert.throws(() => validatePackagedAnimationInventory(metadata(baseline), { ...variantContract, DRAG_ANIMATIONS: drag }), /drag animation contract/);
  }
});

test('malformed package capability exports fail instead of expanding the whitelist', () => {
  for (const contract of [
    {}, { ...oldContract, CORE_ANIMATIONS },
    { ...newContract, CORE_ANIMATIONS: [...CORE_ANIMATIONS, 'other'] },
    { ...newContract, AMBIENT_ANIMATIONS: ['unreviewed'] },
    { ...newContract, AMBIENT_ANIMATIONS: ['reading', 'reading'] },
  ]) assert.throws(() => validatePackagedAnimationInventory(metadata(CORE_ANIMATIONS), contract));
});
