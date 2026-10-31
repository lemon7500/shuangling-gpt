import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { validDeskCommand } from '../../src/desk/service.mjs';
import { startSettings } from '../../src/settings/server.mjs';
const require = createRequire(import.meta.url);
const { validateDeskCommand, sanitizeDeskSnapshot } = require('../../vendor/dsh-pet/runtime/electron-helper/desk-main.cjs');
const id = '0d42c769-f65b-4819-9d53-d4ecc9aaa306';
const valid = [
  { type: 'note.create', text: '主动保存', intent: 'remember' }, { type: 'note.update', id, text: 'Changed', intent: 'continue' },
  { type: 'note.intent', id, intent: 'none' }, { type: 'note.delete', id, purgeMemories: true }, { type: 'note.delete', id, purgeMemories: false },
  { type: 'memory.configure', enabled: true, reminders: false }, { type: 'memory.select', date: '2026-10-27' },
  { type: 'memory.reply', date: '2026-10-27', text: '' }, { type: 'memory.reply', date: '2026-10-27', text: '<script>literal</script>' },
  { type: 'memory.edit', date: '2026-10-27', language: 'zh-TW', text: '自己的文字' },
  { type: 'memory.exclude', date: '2026-10-27', factId: `note:${id}` }, { type: 'memory.dismiss', id: 'daily:2026-10-27' },
  ...['open', 'later', 'done'].map(choice => ({ type: 'memory.revisit', id, choice })), { type: 'memory.delete', date: '2024-02-29' },
];

test('memory commands have matching renderer and backend boundaries with no request capability', () => {
  for (const command of valid) {
    assert.equal(validDeskCommand(command), true, JSON.stringify(command));
    assert.deepEqual(validateDeskCommand(command), command);
    for (const extra of [{ url: 'https://evil.test' }, { path: '../private' }, { token: 'secret' }, { source: 'chat' }]) {
      assert.equal(validDeskCommand({ ...command, ...extra }), false);
      assert.equal(validateDeskCommand({ ...command, ...extra }), null);
    }
  }
  const invalid = [
    ...['0001-01-01', '1969-12-31', '2026-02-29', '2026-13-01', '2026-01-32', '../private'].map(date => ({ type: 'memory.delete', date })),
    ...['x.y', 'x'.repeat(121), '../private', ''].map(id => ({ type: 'memory.dismiss', id })),
    { type: 'memory.reply', date: '2026-10-27', text: 'x'.repeat(1001) }, { type: 'memory.edit', date: '2026-10-27', language: 'ja', text: 'text' },
    { type: 'memory.configure', enabled: 1, reminders: true }, { type: 'note.intent', id, intent: 'automatic' },
    { type: 'memory.revisit', id, choice: 'run-task' }, { type: 'note.delete', id, purgeMemories: 'yes' },
    { type: 'memory.recordTask', id: 'body', at: 1000 }, { type: 'memory.claim', id: 'daily:2026-10-27' },
  ];
  for (const command of invalid) {
    assert.equal(validDeskCommand(command), false, JSON.stringify(command));
    assert.equal(validateDeskCommand(command), null, JSON.stringify(command));
  }
});

test('only bounded translated pages and source facts reach the desk renderer', () => {
  const tr = value => ({ 'zh-CN': value, 'zh-TW': value, en: value });
  const snapshot = { memories: { enabled: true, reminders: true, limitReached: true, since: 1000, selectedDate: '2026-10-27',
    token: 'PRIVATE-TOKEN', days: [{ body: 'PRIVATE-LEDGER' }], entries: [{ date: '2026-10-27', title: tr('Title'), body: tr('Body'), reply: '<img>plain user words</img>', read: false, updatedAt: 2000,
      path: 'PRIVATE-PATH', facts: [{ id: 'focus:2026-10-27', kind: 'focus', minutes: 2000, count: 20, secret: 'PRIVATE-SECRET' },
        { id: `note:${id}`, kind: 'bookmark', noteId: id, text: 'user text', action: 'resolved' },
        { id: 'bad', kind: 'round', count: Infinity }, { id: 'reply:2026-10-26', kind: 'reply', sourceDate: '2026-10-26', text: 'my line' }] }],
    prompt: { id: 'daily:2026-10-27', kind: 'daily', date: '2026-10-27', url: 'PRIVATE-URL' } }, notes: [{ id, text: 'book', intent: 'continue', resolved: true }] };
  const result = sanitizeDeskSnapshot(snapshot, { language: 'en' });
  assert.equal(result.memories.entries[0].facts.length, 3);
  assert.equal(result.memories.entries[0].facts[0].minutes, 2000);
  assert.equal(result.memories.entries[0].facts[1].action, 'resolved');
  assert.equal(result.memories.entries[0].reply, '<img>plain user words</img>');
  assert.equal(result.memories.limitReached, true); assert.equal(result.notes[0].intent, 'continue');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-/);
  snapshot.memories.prompt.date = '2026-10-26';
  assert.equal(sanitizeDeskSnapshot(snapshot).memories.prompt, null);
  snapshot.memories.entries[0].date = 'not-a-date';
  assert.deepEqual(sanitizeDeskSnapshot(snapshot).memories.entries, []);
});

test('memory HTTP commands require the local capability and never expose internal event recording', async t => {
  const seen = [], server = await startSettings({ getState: () => ({}), getUsage: () => ({}), getThreads: () => [], update: () => ({}),
    getAppearance: () => ({}), setAppearance: () => ({}), shutdown: () => {},
    deskCommand: command => { seen.push(command); return { ok: true }; } });
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.port}/api/desk`;
  const headers = { 'x-shuangling-token': server.token, 'content-type': 'application/json' };
  for (const command of valid) assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(command) })).status, 200);
  for (const command of [{ type: 'memory.recordTask', id: 'x', at: 1000 }, { type: 'memory.claim', id: 'x' }])
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(command) })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(valid[0]) })).status, 403);
  assert.deepEqual(seen, valid);
});
