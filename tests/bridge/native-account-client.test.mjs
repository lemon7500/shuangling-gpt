import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { findAccountCli, openNativeAccountClient } from '../../src/bridge/native-account-client.mjs';

function fake(reply = message => ({ id: message.id, result: {} })) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  const calls = [], starts = [];
  child.stdin.on('data', data => {
    for (const line of data.toString().trim().split('\n')) {
      const message = JSON.parse(line); calls.push(message);
      if (!Object.hasOwn(message, 'id')) continue;
      const response = reply(message); if (response) child.stdout.write(JSON.stringify(response) + '\n');
    }
  });
  return { child, calls, starts, options: { findCli: async () => 'codex.exe', spawnFn: (...args) => { starts.push(args); return child; } } };
}

test('native account reader permits only read-only quota RPC and hides native errors', async () => {
  const f = fake(message => message.method === 'account/rateLimits/read' ? { id: message.id, error: { message: 'PRIVATE CREDENTIAL' } } : { id: message.id, result: {} });
  const client = await openNativeAccountClient(f.options);
  await client.call('account/read', { refreshToken: false });
  await assert.rejects(client.call('account/rateLimits/read', {}), /account-rpc-rejected/);
  for (const [method, params] of [['thread/start', {}], ['turn/start', {}], ['account/logout', {}], ['account/read', { refreshToken: true }], ['account/rateLimits/read', { url: 'https://anything' }]]) {
    await assert.rejects(client.call(method, params), /account-method-not-allowed/);
  }
  assert.deepEqual(f.calls.map(call => call.method), ['initialize', 'initialized', 'account/read', 'account/rateLimits/read']);
  assert.deepEqual(f.starts[0][1], ['app-server', '--stdio']);
  assert.equal(f.starts[0][2].windowsHide, true);
  client.close(); assert.equal(f.child.killed, true);
});

test('abort stops native calls and late replies cannot re-open the reader', async () => {
  const control = new AbortController();
  const f = fake(message => message.method === 'initialize' ? { id: message.id, result: {} } : null);
  const client = await openNativeAccountClient({ ...f.options, signal: control.signal });
  const pending = client.call('account/read', { refreshToken: false });
  control.abort();
  await assert.rejects(pending, /account-query-cancelled/);
  f.child.stdout.write('{"id":2,"result":{"account":{"email":"PRIVATE"}}}\n');
  await assert.rejects(client.call('account/rateLimits/read', {}), /account-query-cancelled/);
  assert.equal(f.child.killed, true);
});

test('missing native transport and timed out calls fail without hanging', async () => {
  const f = fake(message => message.method === 'initialize' ? { id: message.id, result: {} } : null);
  const client = await openNativeAccountClient({ ...f.options, timeoutMs: 15 });
  await assert.rejects(client.call('account/rateLimits/read', {}), /account-query-timeout/);
  assert.equal(f.child.killed, true);
  const broken = fake(); broken.options.spawnFn = () => { queueMicrotask(() => broken.child.emit('error', Error('PRIVATE PATH'))); return broken.child; };
  await assert.rejects(openNativeAccountClient(broken.options), /account-cli-unavailable/);
});

test('native executable discovery follows installation updates without pinning a version directory', async () => {
  const fs = { readdir: async () => ['old', 'new', 'incomplete'].map(name => ({ name, isDirectory: () => true })), stat: async path => { if (path.includes('incomplete')) throw Error(); return { mtimeMs: path.includes('new') ? 20 : 10, isFile: () => true }; } };
  assert.match(await findAccountCli({ env: { LOCALAPPDATA: 'C:/local' }, fs }), /new[\\/]codex.exe$/);
  await assert.rejects(findAccountCli({ env: {}, fs }), /account-cli-unavailable/);
});
