import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CompanionPlugin } from '../../src/plugin/companion.mjs';

test('MCP initialization delegates automatic launch to observer, manual commands stay explicit', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-plugin-'));
  let starts = 0, observations = 0;
  const make = () => {
    const plugin = new CompanionPlugin({ projectRoot: 'unused', dataDir, lifecycle: { pluginEnabledImpl: () => true, ensureObserverImpl: async () => { observations++; }, taskController: async () => {} }, startImpl: async () => { starts++; return { running: true }; } });
    plugin.current = async () => null;
    return plugin;
  };
  await make().automaticStart(); await make().automaticStart();
  assert.equal(starts, 0); assert.equal(observations, 2);
  await make().stop(); await make().automaticStart();
  assert.equal(starts, 0);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'lifecycle-session.json'))).manualSuppressed, true);
  await make().start(); assert.equal(starts, 1);
  await make().setAutoLaunch(false); await make().automaticStart();
  assert.equal(observations, 3); assert.equal(starts, 1);
});

test('MCP handshake, inventory, read-only offline status and rejected mutation arguments', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-mcp-'));
  const entry = fileURLToPath(new URL('../../src/plugin/server.mjs', import.meta.url));
  const child = spawn(process.execPath, [entry], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, SHUANGLING_PLUGIN_NO_AUTO: '1', SHUANGLING_DATA_DIR: dataDir } });
  t.after(() => { child.stdin.end(); child.kill(); });
  const pending = new Map();
  let nextId = 0;
  createInterface({ input: child.stdout }).on('line', line => {
    const result = JSON.parse(line);
    const item = pending.get(result.id);
    if (item) { clearTimeout(item.timer); pending.delete(result.id); item.resolve(result); }
  });
  function request(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('mcp-test-timeout')), 5000);
      pending.set(id, { resolve, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params })+'\n');
    });
  }
  const hello = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(hello.result.serverInfo.name, 'shuangling-gpt');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })+'\n');
  const list = await request('tools/list');
  assert.equal(list.result.tools.length, 5);
  assert.equal(list.result.tools.find(x => x.name === 'companion_usage').annotations.readOnlyHint, true);
  const status = await request('tools/call', { name: 'companion_status', arguments: {} });
  const statusValue = JSON.parse(status.result.content[0].text);
  assert.equal(statusValue.running, false); assert.equal(statusValue.autoLaunch, true);
  assert.equal(typeof statusValue.lifecycle.available, 'boolean');
  const bad = await request('tools/call', { name: 'companion_auto_launch', arguments: { enabled: 'yes' } });
  assert.equal(bad.result.isError, true);
  assert.equal(JSON.parse(bad.result.content[0].text).error, 'invalid-auto-launch');
  const unknown = await request('not/a/method');
  assert.equal(unknown.error.code, -32601);
});
