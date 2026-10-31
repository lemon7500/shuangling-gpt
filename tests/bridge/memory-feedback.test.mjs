import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeDeskCommand } from '../../src/desk/feedback.mjs';

test('saved bookmark and reply feedback is local, translated and optional on failure', async () => {
  const seen = [], controller = { companionNotice: async text => { seen.push(text); return true; } };
  assert.equal(await acknowledgeDeskCommand({ type: 'note.create', intent: 'continue' }, { controller, getLanguage: async () => 'en' }), true);
  assert.match(seen[0], /keep a place/);
  assert.equal(await acknowledgeDeskCommand({ type: 'memory.reply', text: '自己的话' }, { controller, getLanguage: async () => 'zh-TW' }), true);
  assert.match(seen[1], /這一句/);
  assert.equal(await acknowledgeDeskCommand({ type: 'note.update', intent: 'remember' }, { controller, getLanguage: async () => { throw Error('settings-offline'); } }), false);
  assert.equal(await acknowledgeDeskCommand({ type: 'memory.reply', text: 'reply' }, { controller: { companionNotice: async () => { throw Error('pet-hidden'); } }, getLanguage: async () => 'en' }), false);
  assert.equal(seen.length, 2);
});

test('ordinary saves, empty replies and timer controls do not create character chatter', async () => {
  for (const input of [{ type: 'note.create' }, { type: 'note.intent', intent: 'none' }, { type: 'memory.reply', text: '' }, { type: 'focus.pause' }]) {
    assert.equal(await acknowledgeDeskCommand(input, { controller: { companionNotice: async () => assert.fail('unexpected hint') }, getLanguage: async () => assert.fail('unneeded preference read') }), false);
  }
});
