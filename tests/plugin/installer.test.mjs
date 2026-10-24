import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPlugin } from '../../windows/install-plugin.mjs';

const marketName = 'shuangling-local';
const pluginName = 'shuangling-gpt';
const id = `${pluginName}@${marketName}`;
const clone = value => JSON.parse(JSON.stringify(value));
const own = (root, enabled = true) => ({ pluginId: id, installed: true, enabled, source: { type: 'local', path: join(root, 'plugins', pluginName) } });

async function fixture({ initial = 'installed', enabled = true, sameLocation = false, extraManifest = false, extraInstalled = false, fault, suppressOldAdd = false } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'shuangling-installer-'));
  const root = join(base, 'new package');
  const market = join(root, 'plugin-marketplace');
  const oldRoot = sameLocation ? market : join(base, 'old package', 'plugin-marketplace');
  for (const file of ['windows/runtime/node/node.exe', 'src/plugin/server.mjs', 'plugin-marketplace/plugins/shuangling-gpt/.mcp.json']) {
    const path = join(root, file);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, '');
  }
  for (const path of new Set([market, oldRoot])) {
    await mkdir(join(path, '.agents', 'plugins'), { recursive: true });
    await writeFile(join(path, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({ name: marketName, plugins: [{ name: pluginName }, ...(path === oldRoot && extraManifest ? [{ name: 'another-plugin' }] : [])] }));
  }
  const initialEntries = initial === 'installed' ? [own(oldRoot, enabled)] : [];
  if (extraInstalled) initialEntries.push({ pluginId: `another-plugin@${marketName}`, installed: true, enabled: true });
  const state = { market: initial === 'absent' ? null : { name: marketName, root: oldRoot }, entries: initialEntries };
  const before = clone(state);
  const commands = [];
  let faultUsed = false;
  const runCli = async (_cli, args) => {
    commands.push([...args]);
    const kind = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ');
    const mutation = !kind.endsWith(' list');
    const match = mutation && !faultUsed && fault?.({ kind, args, state, market, oldRoot });
    if (match === 'before') { faultUsed = true; throw new Error('mock-command-failed'); }
    let result = {};
    if (kind === 'plugin marketplace list') result = { marketplaces: state.market ? [clone(state.market)] : [] };
    else if (kind === 'plugin list') result = { installed: clone(state.entries) };
    else if (kind === 'plugin marketplace add') {
      if (state.market) throw new Error('mock-marketplace-conflict');
      state.market = { name: marketName, root: args[3] };
    } else if (kind === 'plugin marketplace remove') {
      assert.equal(args[3], marketName);
      assert.equal(state.entries.length, 0, 'remove no marketplace containing an installed plugin');
      state.market = null;
    } else if (kind === 'plugin add') {
      assert.equal(args[2], id, 'only our plugin may be changed');
      assert.ok(state.market);
      if (!(suppressOldAdd && state.market.root === oldRoot)) state.entries = [own(state.market.root)];
    } else if (kind === 'plugin remove') {
      assert.equal(args[2], id, 'only our plugin may be changed');
      state.entries = state.entries.filter(entry => entry.pluginId !== id);
    } else throw new Error('mock-unexpected-command');
    if (match === 'after') { faultUsed = true; throw new Error('native-cli-timeout'); }
    return result;
  };
  const run = () => installPlugin({ projectRoot: root, findCli: async () => 'mock-codex-only', runCli });
  const mutations = () => commands.filter(args => !args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ').endsWith(' list'));
  return { root, market, oldRoot, state, before, run, commands, mutations };
}

test('installer preserves enabled same-location idempotence and regenerates local paths', async () => {
  const f = await fixture({ sameLocation: true });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.alreadyInstalledAtThisLocation, true);
  assert.deepEqual(f.mutations(), []);
  assert.deepEqual(f.state, f.before);
  const manifest = JSON.parse(await readFile(join(f.market, 'plugins', pluginName, '.mcp.json'), 'utf8'));
  assert.equal(manifest.mcpServers.shuangling_gpt.cwd, f.root.replaceAll('\\', '/'));
  assert.equal(manifest.mcpServers.shuangling_gpt.command, join(f.root, 'windows/runtime/node/node.exe').replaceAll('\\', '/'));
});

test('installer rejects disabled installs without enabling or removing them', async () => {
  const f = await fixture({ enabled: false });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'existing-plugin-disabled');
  assert.deepEqual(f.mutations(), []);
  assert.deepEqual(f.state, f.before);
  assert.equal(result.rollbackAttempted, undefined);
});

test('installer refuses migration when marketplace has other installed or listed plugins', async t => {
  for (const option of ['extraInstalled', 'extraManifest']) await t.test(option, async () => {
    const f = await fixture({ [option]: true });
    const result = await f.run();
    assert.equal(result.ok, false);
    assert.equal(result.failure, 'marketplace-has-other-plugins');
    assert.deepEqual(f.mutations(), []);
    assert.deepEqual(f.state, f.before);
  });
});

test('installer migrates an exclusive enabled install and verifies actual new source', async () => {
  const f = await fixture();
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.correctSource, true);
  assert.equal(f.state.market.root, f.market);
  assert.deepEqual(f.state.entries, [own(f.market)]);
  assert.equal(f.mutations().length, 4);
});

test('failed plugin add restores old enabled install after removing the new marketplace', async () => {
  const f = await fixture({ fault: ({ kind, state, market }) => kind === 'plugin add' && state.market?.root === market ? 'before' : null });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.previousStateRestored, true);
  assert.equal(result.previousSourceRestored, true);
  assert.deepEqual(f.state, f.before);
});

test('timeout after plugin-add commit is discovered and rolled back using actual state', async () => {
  const f = await fixture({ fault: ({ kind, state, market }) => kind === 'plugin add' && state.market?.root === market ? 'after' : null });
  const result = await f.run();
  assert.equal(result.failure, 'native-cli-timeout');
  assert.equal(result.previousStateRestored, true);
  assert.deepEqual(f.state, f.before);
  assert.equal(f.mutations().filter(args => args[1] === 'remove').length, 2, 'remove both the previous entry and the timed-out committed new entry');
});

test('rollback preserves previously uninstalled state rather than installing the old plugin', async () => {
  const f = await fixture({ initial: 'uninstalled', fault: ({ kind, state, market }) => kind === 'plugin add' && state.market?.root === market ? 'after' : null });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.previousStateRestored, true);
  assert.deepEqual(f.state, f.before);
  assert.equal(f.mutations().filter(args => args[1] === 'add').length, 1, 'never add a previously uninstalled plugin during rollback');
});

test('failed first installation removes its new plugin and marketplace completely', async () => {
  const f = await fixture({ initial: 'absent', fault: ({ kind }) => kind === 'plugin add' ? 'after' : null });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.previousStateRestored, true);
  assert.deepEqual(f.state, f.before);
});

test('rollback never reports restoration from command success without final state verification', async () => {
  const f = await fixture({ suppressOldAdd: true, fault: ({ kind, state, market }) => kind === 'plugin add' && state.market?.root === market ? 'before' : null });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.previousStateRestored, false);
  assert.equal(result.previousSourceRestored, false);
  assert.equal(result.rollbackFailure, 'rollback-verification-failed');
});
