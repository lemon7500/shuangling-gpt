import test from 'node:test';
import assert from 'node:assert/strict';
import { startSettings } from '../../src/settings/server.mjs';
import { STORY_IDS } from '../../src/desk/stories.mjs';

test('desk API requires capability, same origin and fixed typed commands', async t => {
  const mutations = [];
  const snapshot = { ok: true, focus: { status: 'idle' }, journal: { entries: [] }, notes: [] };
  const ui = await startSettings({ getState: () => ({}), getUsage: () => ({}), getThreads: () => [], update: () => ({}),
    getAppearance: () => ({}), setAppearance: () => ({}), shutdown: () => {}, getDesk: () => snapshot,
    deskCommand: value => { mutations.push(value); return snapshot; } });
  t.after(() => ui.close());
  const url = `http://127.0.0.1:${ui.port}/api/desk`;
  const headers = { 'x-shuangling-token': ui.token, 'content-type': 'application/json' };
  const post = (value, extraHeaders = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(value) });
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url, { headers: { ...headers, origin: 'https://example.invalid' } })).status, 403);
  assert.deepEqual(await (await fetch(url, { headers })).json(), snapshot);
  for (const value of [{ type: 'fetch', url: 'https://example.invalid' }, { type: 'note.create', text: 'x', source: 'chat' },
    { type: 'focus.start', phase: 'unknown' }, { type: 'focus.pause', action: 'run' }, { type: 'story.select', id: '../data' }]) assert.equal((await post(value)).status, 400);
  assert.equal((await post({ type: 'focus.pause' }, { origin: 'https://example.invalid' })).status, 403);
  assert.equal((await post({ type: 'focus.suspend', reason: 'sleep' })).status, 200);
  assert.equal((await post({ type: 'story.select', id: STORY_IDS[0] })).status, 200);
  assert.equal((await post({ type: 'note.create', text: '手动记录' })).status, 200);
  assert.deepEqual(mutations, [{ type: 'focus.suspend', reason: 'sleep' }, { type: 'story.select', id: STORY_IDS[0] }, { type: 'note.create', text: '手动记录' }]);
});
