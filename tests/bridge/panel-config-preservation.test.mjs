import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, rename, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';

const root = resolve(import.meta.dirname, '../..');
const sourceText = readFileSync(join(root, 'vendor/dsh-pet/src/host/shuangling-config.ts'), 'utf8');
const compiled = stripTypeScriptTypes(sourceText, { mode: 'strip' });
let moduleCount = 0;
const importCode = code => import('data:text/javascript,' + encodeURIComponent(code + '\n//# sourceURL=isolated-shuangling-config-' + (++moduleCount) + '.mjs'));
const removeFixture = dir => {
  assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
  assert.match(basename(dir), /^shuangling-(?:atomic|geometry-routes)/);
  return rm(dir, { recursive: true, force: true });
};
const source = await importCode(compiled);
const bundleText = readFileSync(join(root, 'vendor/dsh-pet/lib/standalone.js'), 'utf8');
const bundledUtility = bundleText.split('//#region src/host/shuangling-config.ts\n')[1]?.split('//#endregion')[0];
assert.ok(bundledUtility, 'packaged standalone must contain the profile utility');
const utilityImports = "import {mkdir,rename,unlink,writeFile} from 'node:fs/promises';import{dirname}from'node:path';import{randomUUID}from'node:crypto';";
const packaged = await importCode(utilityImports + bundledUtility + '\nexport {patchShuanglingGeometry,createShuanglingConfigQueue,writeShuanglingConfigAtomic};');
const ambientModule = 'data:text/javascript,' + encodeURIComponent(stripTypeScriptTypes(readFileSync(join(root, 'vendor/dsh-pet/src/host/ambient-animations.ts'), 'utf8'), { mode: 'strip' }));
const hostConfig = await importCode(stripTypeScriptTypes(readFileSync(join(root, 'vendor/dsh-pet/src/host/config.ts'), 'utf8'), { mode: 'strip' }).replace("'./ambient-animations.js'", JSON.stringify(ambientModule)));
const defaults = JSON.parse(readFileSync(join(root, 'windows/default-config.json'), 'utf8'));
const geometry = { petId: 'shuangling', size: 396, corner: 'top-left', marginX: 23, marginY: 17 };

for (const [label, implementation] of [['source', source], ['packaged', packaged]]) {
  test(`${label}: raw geometry patch retains unknown fields, unrelated pets, position extras and omitted defaults`, () => {
    const other = { id: 'other-pet', size: 300, future: { enabled: true } };
    const existing = { pets: [{ id: 'shuangling', size: 562, futurePetOption: { enabled: true }, position: { corner: 'bottom-right', marginX: 20, marginY: 12, pin: 'keep' } }, other], customAdvanced: { untouched: true }, physics: { gravity: 123 } };
    const before = structuredClone(existing);
    const patch = implementation.patchShuanglingGeometry(existing, defaults.pets, geometry);
    assert.ok(patch.changed);
    assert.deepEqual(existing, before, 'must not mutate the caller/raw config');
    const expected = structuredClone(before);
    Object.assign(expected.pets[0], { size: 396, position: { ...expected.pets[0].position, corner: 'top-left', marginX: 23, marginY: 17 } });
    assert.deepEqual(patch.config, expected);
    assert.equal(patch.config.pets[1], other, 'unrelated raw pet remains unchanged');
    assert.deepEqual(Object.keys(patch.config), Object.keys(existing), 'no merged top-level defaults may be added');
  });

  test(`${label}: equal effective geometry is a no-op and missing raw pets materialize only the inherited pet list`, () => {
    const input = { petId: 'shuangling', size: defaults.pets[0].size, ...defaults.pets[0].position };
    const noOp = implementation.patchShuanglingGeometry({ custom: 1 }, defaults.pets, input);
    assert.equal(noOp.changed, false);
    assert.deepEqual(noOp.config, { custom: 1 });
    const patch = implementation.patchShuanglingGeometry({ custom: 1 }, defaults.pets, geometry);
    assert.deepEqual(Object.keys(patch.config), ['custom', 'pets']);
    assert.equal(patch.config.pets[0].display, 'desktop');
    assert.throws(() => implementation.patchShuanglingGeometry({ pets: [{ id: 'damaged' }] }, defaults.pets, geometry), /config-conflict/);
  });

  test(`${label}: all four mutation methods share a queue; read-only calls and ordinary profiles do not wait`, async () => {
    const queue = implementation.createShuanglingConfigQueue(true);
    let release;
    const barrier = new Promise(resolve => release = resolve);
    const trace = [];
    const first = queue('/dsh-pet-7340/shuangling-appearance', 'PUT', async () => { trace.push('geometry-start'); await barrier; trace.push('geometry-end'); });
    const config = queue('/dsh-pet-7340/config', 'PUT', async () => trace.push('config-put'));
    const sync = queue('/dsh-pet-7340/config', 'POST', async () => { trace.push('config-post'); throw Error('expected-failure'); }).catch(() => trace.push('failure-observed'));
    const display = queue('/dsh-pet-7340/pet-display', 'POST', async () => trace.push('display'));
    await queue('/dsh-pet-7340/config', 'GET', async () => trace.push('read-not-blocked'));
    assert.deepEqual([...trace].sort(), ['geometry-start', 'read-not-blocked'].sort());
    release(); await Promise.all([first, config, sync, display]);
    assert.ok(trace.indexOf('geometry-end') < trace.indexOf('config-put'));
    assert.ok(trace.indexOf('config-put') < trace.indexOf('config-post'));
    assert.ok(trace.indexOf('config-post') < trace.indexOf('display'));
    const ordinary = implementation.createShuanglingConfigQueue(false);
    let releaseOrdinary;
    const pending = ordinary('/dsh-pet-7340/config', 'PUT', () => new Promise(resolve => releaseOrdinary = resolve));
    let secondRan = false;
    await ordinary('/dsh-pet-7340/config', 'PUT', async () => secondRan = true);
    assert.ok(secondRan); releaseOrdinary(); await pending;
  });

  test(`${label}: atomic replacement leaves complete parseable content and no temporary files`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shuangling-atomic-'));
    try {
      const file = join(dir, 'main-config.jsonc');
      await writeFile(file, '{"old":true}');
      await implementation.writeShuanglingConfigAtomic(file, JSON.stringify({ large: 'x'.repeat(64000) }));
      assert.equal(JSON.parse(await readFile(file, 'utf8')).large.length, 64000);
      assert.deepEqual(await readdir(dir), ['main-config.jsonc']);
    } finally { await removeFixture(dir); }
  });
}

test('failed atomic rename keeps the previous bytes and cleans its own temporary output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shuangling-atomic-failure-'));
  try {
    const factory = new Function('mkdir', 'dirname', 'process', 'randomUUID', 'writeFile', 'rename', 'unlink', bundledUtility + '\nreturn writeShuanglingConfigAtomic;');
    const writeAtomic = factory(mkdir, dirname, process, randomUUID, writeFile, async () => { throw Object.assign(Error('blocked-rename'), { code: 'EPERM' }); }, unlink);
    const file = join(dir, 'main-config.jsonc');
    await writeFile(file, '{"keep":"original"}');
    await assert.rejects(writeAtomic(file, '{"replace":true}'), /blocked-rename/);
    assert.equal(await readFile(file, 'utf8'), '{"keep":"original"}');
    assert.deepEqual(await readdir(dir), ['main-config.jsonc']);
  } finally { await removeFixture(dir); }
});

async function routesFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'shuangling-geometry-routes-'));
  const configPaths = { defaultFile: join(dir, 'default.jsonc'), userFile: join(dir, 'main-config.jsonc'), petDir: join(dir, 'pets') };
  const existing = { pets: [{ ...defaults.pets[0], futurePetOption: { preserve: true }, position: { ...defaults.pets[0].position, pin: 'preserve' } }], physics: { ...defaults.physics, gravity: 1523 }, customAdvanced: { preserve: true } };
  await mkdir(configPaths.petDir);
  await writeFile(configPaths.defaultFile, JSON.stringify(defaults));
  await writeFile(configPaths.userFile, JSON.stringify(existing));
  const start = bundleText.indexOf('\t\tif (rest === "shuangling-appearance")');
  const end = bundleText.indexOf('\t\tif (rest === "reload")', start);
  assert.ok(start > 0 && end > start, 'production mutation route boundaries must exist');
  const routeBody = "const url = new URL(rawUrl,'http://localhost');const rest=decodeURIComponent(url.pathname.slice('/dsh-pet-7340/'.length));" + bundleText.slice(start, end);
  let reloads = 0, writes = 0;
  let atomic = source.writeShuanglingConfigAtomic;
  const deps = { process: { env: { SHUANGLING_PROFILE: '1' } }, configPaths, userConfigPath: configPaths.userFile, userRoot: dir, petConfigDir: configPaths.petDir,
    ...hostConfig, patchShuanglingGeometry: source.patchShuanglingGeometry,
    writeShuanglingConfigAtomic: async (...args) => { writes++; return atomic(...args); },
    mkdir, writeFile, readFileSync,
    syncDesktop: () => reloads++, state: { writeSection() {} }, lock: { release() {} } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const route = new AsyncFunction(...Object.keys(deps), 'rawUrl', 'method', 'body', routeBody);
  const queue = source.createShuanglingConfigQueue(true);
  const request = (path, method, body) => queue('/dsh-pet-7340/' + path, method, () => route(...Object.values(deps), '/dsh-pet-7340/' + path, method, body === undefined ? undefined : JSON.stringify(body)));
  return { dir, configPaths, existing, request, counts: () => ({ reloads, writes }), useAtomic: value => atomic = value, close: () => removeFixture(dir) };
}

test('production geometry route preserves raw settings, makes no helper reload and skips no-op writes', async () => {
  const fixture = await routesFixture();
  try {
    const result = await fixture.request('shuangling-appearance', 'PUT', geometry);
    assert.equal(result.status, 200);
    const saved = JSON.parse(await readFile(fixture.configPaths.userFile, 'utf8'));
    const expected = structuredClone(fixture.existing);
    expected.pets[0].size = geometry.size;
    Object.assign(expected.pets[0].position, { corner: geometry.corner, marginX: geometry.marginX, marginY: geometry.marginY });
    assert.deepEqual(saved, expected);
    assert.deepEqual(fixture.counts(), { reloads: 0, writes: 1 });
    const bytes = await readFile(fixture.configPaths.userFile, 'utf8');
    await fixture.request('shuangling-appearance', 'PUT', geometry);
    assert.deepEqual(fixture.counts(), { reloads: 0, writes: 1 });
    assert.equal(await readFile(fixture.configPaths.userFile, 'utf8'), bytes);
    for (const invalid of [{ ...geometry, display: 'none' }, { ...geometry, petId: 'other' }, { ...geometry, size: 0 }]) assert.equal((await fixture.request('shuangling-appearance', 'PUT', invalid)).status, 400);
    assert.equal(await readFile(fixture.configPaths.userFile, 'utf8'), bytes);
    assert.equal((await fixture.request('shuangling-appearance', 'POST', geometry)).status, 405);
    await writeFile(fixture.configPaths.userFile, '{broken');
    assert.equal((await fixture.request('shuangling-appearance', 'PUT', geometry)).status, 409);
    assert.equal(await readFile(fixture.configPaths.userFile, 'utf8'), '{broken');
  } finally { await fixture.close(); }
});

test('production geometry/config/display routes serialize entire read-modify-write operations', async () => {
  const fixture = await routesFixture();
  try {
    let release, entered;
    const barrier = new Promise(resolve => release = resolve), reached = new Promise(resolve => entered = resolve);
    fixture.useAtomic(async (...args) => { entered(); await barrier; return source.writeShuanglingConfigAtomic(...args); });
    const first = fixture.request('shuangling-appearance', 'PUT', geometry);
    await reached;
    const next = { pets: [{ ...defaults.pets[0], size: geometry.size, position: { corner: geometry.corner, marginX: geometry.marginX, marginY: geometry.marginY } }], physics: { ...defaults.physics, gravity: 1751 } };
    const config = fixture.request('config', 'PUT', next);
    const display = fixture.request('pet-display', 'POST', { id: 'shuangling', display: 'none' });
    const during = await fixture.request('config', 'GET');
    assert.equal(during.obj.main.pets[0].size, defaults.pets[0].size, 'reads see the complete old config before atomic commit');
    assert.equal(fixture.counts().writes, 1, 'queued routes cannot enter their write stage yet');
    fixture.useAtomic(source.writeShuanglingConfigAtomic); release();
    assert.equal((await first).status, 200);
    assert.equal((await config).status, 200);
    assert.equal((await display).status, 200);
    const final = JSON.parse(await readFile(fixture.configPaths.userFile, 'utf8'));
    assert.equal(final.pets[0].size, geometry.size);
    assert.equal(final.pets[0].display, 'none');
    assert.equal(final.physics.gravity, 1751);
    assert.deepEqual(fixture.counts(), { reloads: 2, writes: 3 });
  } finally { await fixture.close(); }
});
