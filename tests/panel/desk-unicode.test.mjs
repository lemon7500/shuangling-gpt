import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sanitizeDeskSnapshot } = require('../../vendor/dsh-pet/runtime/electron-helper/desk-main.cjs');
const languages = ['zh-CN', 'zh-TW', 'en'];
const noteId = '0d42c769-f65b-4819-9d53-d4ecc9aaa306';
const date = '2026-10-28';
const translations = value => Object.fromEntries(languages.map(key => [key, value]));

function snapshot(character, fits = false) {
  const make = limit => 'a'.repeat(limit - (fits ? 2 : 1)) + character;
  return {
    notes: [{ id: noteId, text: make(1000) }],
    memories: { entries: [{ date, title: translations(make(160)), body: translations(make(4000)), reply: make(1000),
      facts: [{ id: 'bookmark:fixture', kind: 'bookmark', noteId, text: make(240) }] }] },
  };
}

for (const character of ['💜', '𠮷']) {
  test(`desk IPC does not split ${character} at any bounded user-visible field`, () => {
    const result = sanitizeDeskSnapshot(snapshot(character));
    const entry = result.memories.entries[0];
    const fields = [[result.notes[0].text, 1000], [entry.reply, 1000], [entry.facts[0].text, 240],
      ...languages.flatMap(key => [[entry.title[key], 160], [entry.body[key], 4000]])];
    for (const [text, limit] of fields) {
      assert.equal(text.length, limit - 1); assert.equal(text.isWellFormed(), true);
      assert.equal(text.includes('\uFFFD'), false); assert.equal(text, 'a'.repeat(limit - 1));
    }
  });
  test(`desk IPC retains ${character} when both UTF-16 units fit exactly`, () => {
    const original = snapshot(character, true), result = sanitizeDeskSnapshot(original), entry = result.memories.entries[0];
    assert.equal(result.notes[0].text, original.notes[0].text);
    assert.equal(entry.reply, original.memories.entries[0].reply);
    assert.deepEqual(entry.title, original.memories.entries[0].title);
    assert.deepEqual(entry.body, original.memories.entries[0].body);
    assert.equal(entry.facts[0].text, original.memories.entries[0].facts[0].text);
  });
}

test('desk IPC keeps ordinary short text and non-string field defaults unchanged', () => {
  const original = snapshot('x');
  original.notes[0].text = '普通书签 / Traditional 繁體 / English 💜';
  original.memories.entries[0].reply = undefined;
  const result = sanitizeDeskSnapshot(original);
  assert.equal(result.notes[0].text, original.notes[0].text);
  assert.equal(result.memories.entries[0].reply, '');
});
