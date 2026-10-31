import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDeskService } from '../../src/desk/service.mjs';

const languages = ['zh-CN', 'zh-TW', 'en'];
const local = (year, month, day, hour = 12, minute = 0, second = 0) => new Date(year, month - 1, day, hour, minute, second).getTime();
async function fixture(t, start = local(2026, 10, 28)) {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-memory-recheck-'));
  let at = start, service;
  const boot = async () => { service = await createDeskService({ dataDir, now: () => at, autoTick: false, detectSleep: false }); return service; };
  await boot(); t.after(() => service.close());
  return { get service() { return service; }, set(value) { at = value; }, now: () => at,
    async restart() { await service.close(); return boot(); },
    store: async () => JSON.parse(await readFile(join(dataDir, 'desk.json'), 'utf8')) };
}
const page = (view, date) => view.memories.entries.find(entry => entry.date === date);

test('a closed year boundary generates only recorded dates on restart and retains selection and replay proofs', async t => {
  const f = await fixture(t, local(2026, 12, 31, 23, 59, 59));
  const completed = { id: 'isolated-root-year-end', at: f.now() };
  assert.equal(await f.service.recordTask(completed), true);
  assert.deepEqual((await f.service.snapshot()).memories.entries, []);
  f.set(local(2027, 1, 1, 0, 0, 1)); await f.restart();
  let view = await f.service.snapshot();
  assert.deepEqual(view.memories.entries.map(entry => entry.date), ['2026-12-31']);
  for (const language of languages) assert.ok(page(view, '2026-12-31').body[language]);
  assert.equal(await f.service.recordTask(completed), false);
  const oldDaily = view.memories.prompt;
  await f.service.command({ type: 'memory.select', date: oldDaily.date });
  await f.service.command({ type: 'memory.dismiss', id: oldDaily.id });
  await f.restart(); view = await f.service.snapshot();
  assert.equal(view.memories.selectedDate, '2026-12-31');
  assert.equal(page(view, '2026-12-31').read, true);
  assert.equal(await f.service.claimMemoryPrompt(oldDaily.id), false);
  f.set(local(2027, 1, 4)); await f.restart(); view = await f.service.snapshot();
  assert.deepEqual(view.memories.entries.map(entry => entry.date), ['2026-12-31'], 'days spent closed or without facts must stay absent');
  assert.equal(page(view, '2026-12-31').facts[0].count, 1);
});

test('a reply follows its source through several pages and restart, then update and clear redact only its direct quotes in all languages', async t => {
  const f = await fixture(t);
  await f.service.recordTask({ id: 'isolated-source', at: f.now() });
  f.set(local(2026, 10, 29)); await f.service.snapshot();
  const original = '<literal>原回应</literal> & “first”', revised = '修改後的回应 / revised';
  await f.service.command({ type: 'memory.reply', date: '2026-10-28', text: original });
  f.set(local(2026, 10, 30)); await f.restart();
  for (const language of languages) {
    await f.service.command({ type: 'memory.edit', date: '2026-10-29', language,
      text: `Unrelated ${language} paragraph. Direct quote: ${original}. Keep the ending.` });
  }
  await f.service.command({ type: 'memory.reply', date: '2026-10-28', text: revised });
  f.set(local(2026, 10, 31)); await f.restart();
  let view = await f.service.snapshot();
  assert.equal(page(view, '2026-10-28').reply, revised);
  for (const date of ['2026-10-29', '2026-10-30']) {
    assert.equal(page(view, date).facts.find(fact => fact.kind === 'reply').text, revised);
    assert.equal(page(view, date).facts.find(fact => fact.kind === 'reply').sourceDate, '2026-10-28');
  }
  for (const language of languages) {
    assert.equal(page(view, '2026-10-29').body[language], `Unrelated ${language} paragraph. Direct quote: …. Keep the ending.`);
    assert.ok(page(view, '2026-10-30').body[language].includes(revised));
    assert.equal(page(view, '2026-10-30').body[language].includes('\ufffd'), false);
  }
  assert.equal(JSON.stringify(await f.store()).includes(original), false);
  await f.service.command({ type: 'memory.reply', date: '2026-10-28', text: '' });
  await f.restart(); view = await f.service.snapshot();
  assert.equal(page(view, '2026-10-28').reply, '');
  assert.equal(JSON.stringify(await f.store()).includes(revised), false, 'no stored derived or pending copy may retain a cleared reply');
  for (const date of ['2026-10-29', '2026-10-30']) assert.deepEqual(page(view, date).facts, []);
  for (const language of languages) assert.equal(page(view, '2026-10-29').body[language], `Unrelated ${language} paragraph. Direct quote: …. Keep the ending.`);
  assert.equal(view.notes.length, 0, 'adding a line does not implicitly create a bookmark');
});

test('continuing a bookmark crosses month boundaries with distinct saved, reopened and settled records that survive restart', async t => {
  const f = await fixture(t, local(2026, 10, 31));
  const created = await f.service.command({ type: 'note.create', text: '下一次继续整理 / next time', intent: 'continue' });
  const id = created.notes[0].id;
  await f.service.command({ type: 'note.pin', id, pinned: true });
  f.set(local(2026, 11, 1)); await f.restart();
  let view = await f.service.snapshot();
  assert.equal(page(view, '2026-10-31').facts[0].action, 'saved');
  await f.service.command({ type: 'memory.select', date: '2026-10-31' });
  view = await f.service.command({ type: 'memory.revisit', id, choice: 'open' });
  assert.equal(view.notes[0].resolved, false); assert.equal(view.notes[0].pinned, true);
  await f.restart();
  f.set(local(2026, 11, 3)); view = await f.service.snapshot();
  assert.notEqual(view.memories.prompt?.kind, 'continue', 'two calendar days must remain inside the cooldown');
  assert.equal(page(view, '2026-11-01').facts[0].action, 'revisited');
  await f.service.command({ type: 'memory.select', date: '2026-11-01' });
  f.set(local(2026, 11, 4)); view = await f.service.snapshot();
  assert.equal(view.memories.prompt.noteId, id);
  view = await f.service.command({ type: 'memory.revisit', id, choice: 'done' });
  assert.equal(view.notes[0].resolved, true);
  f.set(local(2026, 11, 5)); await f.restart(); view = await f.service.snapshot();
  assert.equal(view.notes[0].resolved, true); assert.equal(view.notes[0].intent, 'continue');
  const settled = page(view, '2026-11-04');
  assert.equal(settled.facts[0].action, 'resolved');
  assert.ok(settled.body['zh-CN'].includes('标为告一段落'));
  assert.ok(settled.body['zh-TW'].includes('標為告一段落'));
  assert.ok(settled.body.en.includes('settled for now'));
  await f.service.command({ type: 'memory.select', date: '2026-11-04' });
  f.set(local(2026, 12, 10)); await f.restart();
  assert.equal((await f.service.snapshot()).memories.prompt, null, 'a resolved bookmark cannot return as a continuation after a long absence');
});

test('recording and reminder switches remain independent over disabled days and restarts', async t => {
  const f = await fixture(t);
  await f.service.command({ type: 'note.create', text: 'before disabling', intent: 'remember' });
  await f.service.command({ type: 'memory.configure', enabled: false, reminders: false });
  f.set(local(2026, 10, 29)); await f.restart();
  assert.equal(await f.service.recordTask({ id: 'must-not-collect-off', at: f.now() }), false);
  await f.service.command({ type: 'note.create', text: 'explicit note while off', intent: 'remember' });
  let view = await f.service.snapshot();
  assert.equal(view.memories.enabled, false); assert.equal(view.memories.reminders, false);
  assert.deepEqual(view.memories.entries, []); assert.equal(view.memories.prompt, null);
  f.set(local(2026, 10, 30));
  await f.service.command({ type: 'memory.configure', enabled: true, reminders: false });
  await f.service.recordTask({ id: 'collect-after-resuming', at: f.now() });
  f.set(local(2026, 10, 31)); await f.restart(); view = await f.service.snapshot();
  assert.equal(view.memories.enabled, true); assert.equal(view.memories.reminders, false); assert.equal(view.memories.prompt, null);
  assert.deepEqual(view.memories.entries.map(entry => entry.date), ['2026-10-28', '2026-10-30']);
  assert.equal(JSON.stringify(view.memories.entries).includes('explicit note while off'), false);
  assert.equal(view.notes.length, 2, 'the switch must not erase deliberately saved notes');
  const contents = JSON.stringify(view.memories.entries);
  view = await f.service.command({ type: 'memory.configure', enabled: true, reminders: true });
  assert.equal(JSON.stringify(view.memories.entries), contents, 'enabling hints must not change recorded page contents');
  assert.equal(view.memories.prompt.date, '2026-10-30');
  assert.equal(await f.service.claimMemoryPrompt(view.memories.prompt.id), true);
  await f.restart(); view = await f.service.snapshot();
  assert.equal(view.memories.enabled, true); assert.equal(view.memories.reminders, true);
  assert.equal(await f.service.claimMemoryPrompt(view.memories.prompt.id), false);
});

test('saved page language edits, bookmarks and independent desk preferences survive reloading without overwriting other languages', async t => {
  const f = await fixture(t);
  await f.service.command({ type: 'focus.configure', focusMinutes: 45, breakMinutes: 8 });
  const stories = (await f.service.snapshot()).journal.entries;
  const storyId = stories[2].id;
  await f.service.command({ type: 'story.select', id: storyId });
  await f.service.command({ type: 'story.favorite', id: storyId, favorite: true });
  await f.service.command({ type: 'story.position', id: storyId, position: 0.625 });
  const saved = await f.service.command({ type: 'note.create', text: 'literal <b>text</b> 繁體 English', intent: 'continue' });
  const id = saved.notes[0].id;
  await f.service.command({ type: 'note.pin', id, pinned: true });
  f.set(local(2026, 10, 29)); const first = await f.service.snapshot();
  const original = { ...first.memories.entries[0].body };
  const handwritten = { 'zh-CN': '我的补充：保持原有设置。', 'zh-TW': '我的補充：保留原有設定。', en: 'My own line: keep my existing preferences.' };
  for (const language of languages) {
    await f.service.command({ type: 'memory.edit', date: '2026-10-28', language, text: handwritten[language] });
    const current = (await f.service.snapshot()).memories.entries[0];
    for (const untouched of languages.slice(languages.indexOf(language) + 1)) assert.equal(current.body[untouched], original[untouched]);
  }
  await f.service.command({ type: 'memory.select', date: '2026-10-28' });
  await f.restart(); const after = await f.service.snapshot();
  assert.deepEqual(after.memories.entries[0].body, handwritten);
  assert.equal(after.memories.entries[0].read, true); assert.equal(after.memories.selectedDate, '2026-10-28');
  assert.deepEqual(after.notes, first.notes);
  assert.equal(after.focus.focusMinutes, 45); assert.equal(after.focus.breakMinutes, 8);
  assert.equal(after.journal.selectedId, storyId); assert.equal(after.journal.positionById[storyId], 0.625);
  assert.equal(after.journal.entries.find(entry => entry.id === storyId).favorite, true);
  assert.equal(after.journal.entries.length, 6);
});
