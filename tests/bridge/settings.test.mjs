import test from 'node:test';
import assert from 'node:assert/strict';
import { startSettings } from '../../src/settings/server.mjs';

test('loopback settings require capability, reject foreign origin, limit routes and payloads', async t => {
  const mutations = [];
  let shutdown = false;
  const ui = await startSettings({ getState: () => ({ status: { state: 'working', threadId: 'root' } }), getUsage: () => ({ summaryText: '5 小时额度剩余：未知' }), getThreads: () => [{ id: 'root', timestamp: '2026-10-21', source: null }], update: async v => { mutations.push(v); return { ok: true }; }, getAppearance: () => ({ size: 400 }), setAppearance: async v => { mutations.push(v); return { ok: true }; }, shutdown: async () => { shutdown = true; } });
  t.after(() => ui.close());
  const base = `http://127.0.0.1:${ui.port}`;
  const headers = { 'x-shuangling-token': ui.token, 'content-type': 'application/json' };
  assert.ok(ui.settingsUrl.endsWith(`#${ui.token}`));
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/api/state')).status, 403);
  assert.equal((await fetch(base + '/api/usage')).status, 403);
  assert.equal((await fetch(base + '/api/usage', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/state', { headers: { 'x-shuangling-token': 'é'.repeat(43) } })).status, 403);
  assert.equal((await fetch(base + '/api/state', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/anything', { method: 'POST', headers, body: '{}' })).status, 404);
  assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ threadId: 'root', paused: true }) })).status, 200);
  assert.deepEqual(mutations, [{ threadId: 'root', paused: true }]);
  assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ padding: 'a'.repeat(5000) }) })).status, 400);
  await fetch(base + '/api/shutdown', { method: 'POST', headers, body: '{}' });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(shutdown, true);
});

test('preferences remain capability protected and accept only the automatic-launch boolean', async t => {
  const changes = [];
  const ui = await startSettings({
    getState: () => ({}), getUsage: () => ({}), getThreads: () => [], update: () => ({}),
    getAppearance: () => ({}), setAppearance: () => ({}), shutdown: () => {},
    getPreferences: () => ({ autoLaunch: true, lifecycle: { available: true } }),
    setPreferences: value => { changes.push(value); return value; },
  });
  t.after(() => ui.close());
  const url = `http://127.0.0.1:${ui.port}/api/preferences`;
  const headers = { 'x-shuangling-token': ui.token, 'content-type': 'application/json' };
  assert.equal((await fetch(url)).status, 403);
  assert.deepEqual(await (await fetch(url, { headers })).json(), { autoLaunch: true, lifecycle: { available: true } });
  for (const body of [null, [], {}, { autoLaunch: 1 }, { autoLaunch: true, command: 'anything' }]) {
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
  }
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'https://example.invalid' }, body: '{"autoLaunch":false}' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers, body: '{"autoLaunch":false}' })).status, 200);
  assert.deepEqual(changes, [{ autoLaunch: false }]);
});

test('usage target accepts only an authenticated thread choice without changing task settings', async t => {
  const targetChanges = [], settingsChanges = [];
  const ui = await startSettings({
    getState: () => ({}), getUsage: () => ({}), getThreads: () => [], update: value => settingsChanges.push(value),
    getAppearance: () => ({}), setAppearance: () => ({}), shutdown: () => {},
    setUsageTarget: value => { targetChanges.push(value); return { ok: true }; },
  });
  t.after(() => ui.close());
  const url = `http://127.0.0.1:${ui.port}/api/usage-target`;
  const headers = { 'x-shuangling-token': ui.token, 'content-type': 'application/json' };
  const request = (body, more = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...more }, body: JSON.stringify(body) });
  assert.equal((await fetch(url, { method: 'POST', body: '{"threadId":"root"}' })).status, 403);
  for (const value of [null, [], {}, { threadId: '../anything' }, { threadId: 'root', paused: false }]) assert.equal((await request(value)).status, 400);
  assert.equal((await request({ threadId: 'root' }, { origin: 'https://example.invalid' })).status, 403);
  assert.equal((await request({ threadId: 'root' })).status, 200);
  assert.deepEqual(targetChanges, [{ threadId: 'root' }]);
  assert.deepEqual(settingsChanges, []);
});
