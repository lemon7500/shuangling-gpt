import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createDeskService, validDeskCommand } from '../../src/desk/service.mjs';
import { createMemories, localMemoryDate, validMemoryDate, restoreMemories, recordMemoryTask, recordMemoryBookmark,
  advanceMemories, memoriesView } from '../../src/desk/memories.mjs';

const MINUTE = 60000;
const local = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).getTime();
async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-memories-'));
  let at = extra.at ?? local(2026, 10, 28);
  const service = await createDeskService({ dataDir, now: () => at, autoTick: false, detectSleep: false });
  t.after(() => service.close());
  return { service, dataDir, now: () => at, advance: ms => { at += ms; }, set: value => { at = value; } };
}
const readStore = f => readFile(join(f.dataDir, 'desk.json'), 'utf8').then(JSON.parse);

test('first enable starts empty and records no invented history or inferred work details', async t => {
  const f = await fixture(t), view = await f.service.snapshot();
  assert.equal(view.memories.enabled, true); assert.equal(view.memories.reminders, true);
  assert.equal(view.memories.since, f.now()); assert.equal(view.memories.selectedDate, null);
  assert.deepEqual(view.memories.entries, []); assert.equal(view.memories.prompt, null);
  assert.equal(await f.service.recordTask({ id: 'historical-round', at: f.now() - 1 }), false);
  f.set(local(2026, 10, 29));
  assert.deepEqual((await f.service.snapshot()).memories.entries, []);
  assert.equal((await f.service.snapshot()).journal.entries.length, 6);
});

test('old desk state migrates without changing old note fields, reading preferences or independent settings', async t => {
  const f = await fixture(t);
  await f.service.command({ type: 'note.create', text: 'what I deliberately saved' });
  await f.service.command({ type: 'story.select', id: 'the-rose-keepsake' });
  await f.service.close();
  const store = await readStore(f); delete store.memories;
  delete store.notes[0].intent; delete store.notes[0].resolved;
  await writeFile(join(f.dataDir, 'desk.json'), JSON.stringify(store));
  await writeFile(join(f.dataDir, 'plugin-config.json'), '{"language":"en","autoLaunch":true}\n');
  const again = await createDeskService({ dataDir: f.dataDir, now: f.now, autoTick: false });
  t.after(() => again.close());
  const snapshot = await again.snapshot(), migrated = await readStore(f);
  assert.deepEqual(migrated.notes, store.notes); assert.deepEqual(migrated.focus, store.focus); assert.deepEqual(migrated.journal, store.journal);
  assert.equal(snapshot.notes[0].intent, 'none'); assert.equal(snapshot.notes[0].resolved, false);
  assert.deepEqual(snapshot.memories.entries, []); assert.equal(snapshot.memories.since, f.now());
  assert.equal(await readFile(join(f.dataDir, 'plugin-config.json'), 'utf8'), '{"language":"en","autoLaunch":true}\n');
});

test('one dated page combines confirmed focus, deduplicated round metadata and deliberate bookmarks in all three languages', async t => {
  const f = await fixture(t);
  await f.service.command({ type: 'note.create', text: '继续整理控制面板', intent: 'continue' });
  const event = { id: 'root:private-thread:private-turn', at: f.now() };
  assert.equal(await f.service.recordTask(event), true); assert.equal(await f.service.recordTask(event), false);
  await f.service.command({ type: 'focus.configure', focusMinutes: 10, breakMinutes: 1 });
  await f.service.command({ type: 'focus.start', phase: 'focus' });
  f.advance(10 * MINUTE); await f.service.tick();
  await f.service.command({ type: 'focus.start', phase: 'break' });
  f.advance(MINUTE); await f.service.tick();
  assert.equal((await f.service.snapshot()).memories.entries.length, 0);
  f.set(local(2026, 10, 29));
  const snapshot = await f.service.snapshot(), page = snapshot.memories.entries[0];
  assert.equal(page.date, '2026-10-28'); assert.equal(page.facts.length, 3);
  assert.deepEqual(page.facts.find(fact => fact.kind === 'round'), { id: 'round:2026-10-28', kind: 'round', count: 1 });
  assert.deepEqual(page.facts.find(fact => fact.kind === 'focus'), { id: 'focus:2026-10-28', kind: 'focus', minutes: 10, count: 1 });
  assert.equal(page.facts.find(fact => fact.kind === 'bookmark').text, '继续整理控制面板');
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    assert.ok(page.body[language].length > 80); assert.ok(page.body[language].length <= 1000);
    assert.ok(page.title[language]); assert.equal(page.body[language].includes('\ufffd'), false);
  }
  assert.ok(!page.body['zh-CN'].includes('项目完成'));
  assert.ok(!JSON.stringify(await readStore(f)).includes('private-thread'));
  assert.ok(!JSON.stringify(snapshot.memories).includes('roundHashes'));
  assert.equal(await f.service.recordTask(event), false);
  await f.service.tick(); assert.equal((await f.service.snapshot()).memories.entries.length, 1);
});

test('plain bookmarks stay private to the bookmark list until marked for shared memories, and updates are atomic', async t => {
  const f = await fixture(t);
  let view = await f.service.command({ type: 'note.create', text: 'not a diary source' });
  const id = view.notes[0].id;
  await f.service.command({ type: 'note.update', id, text: 'now explicitly remembered', intent: 'remember' });
  view = await f.service.command({ type: 'note.update', id, text: 'latest same-day text' });
  assert.equal(view.notes[0].intent, 'remember');
  f.set(local(2026, 10, 29)); view = await f.service.snapshot();
  assert.equal(view.memories.entries[0].facts[0].text, 'latest same-day text');
  assert.equal(view.memories.entries[0].facts.length, 1);
  await f.service.command({ type: 'note.update', id, text: 'a later revision' });
  assert.equal((await f.service.snapshot()).memories.entries[0].facts[0].text, 'latest same-day text', 'past pages keep their actual historical snapshot');
});

test('disabling collection stops new events, generation and prompts while old pages remain editable', async t => {
  const f = await fixture(t);
  await f.service.command({ type: 'note.create', text: 'before switching off', intent: 'remember' });
  f.set(local(2026, 10, 29)); await f.service.snapshot();
  await f.service.command({ type: 'memory.configure', enabled: false, reminders: true });
  const disabledAt = f.now();
  assert.equal(await f.service.recordTask({ id: 'off-round', at: f.now() }), false);
  await f.service.command({ type: 'note.create', text: 'saved while off', intent: 'remember' });
  f.set(local(2026, 10, 30));
  let view = await f.service.snapshot();
  assert.equal(view.memories.entries.length, 1); assert.equal(view.memories.prompt, null);
  await f.service.command({ type: 'memory.reply', date: '2026-10-28', text: 'My own response is still editable' });
  await f.service.command({ type: 'memory.configure', enabled: true, reminders: false });
  assert.equal(await f.service.recordTask({ id: 'late-event-from-disabled-time', at: disabledAt }), false);
  assert.equal(await f.service.recordTask({ id: 'new-confirmed-round', at: f.now() }), true);
  f.set(local(2026, 10, 31)); view = await f.service.snapshot();
  assert.equal(view.memories.entries.length, 2); assert.equal(view.memories.prompt, null);
  assert.equal(view.memories.entries[1].facts[0].kind, 'round');
  assert.ok(!JSON.stringify(view.memories.entries).includes('saved while off'));
});

test('a daily prompt can be claimed once per local date across restarts while its actionable card remains visible', async t => {
  const f = await fixture(t);
  await f.service.recordTask({ id: 'one-round', at: f.now() });
  f.set(local(2026, 10, 29));
  let view = await f.service.snapshot(); const prompt = view.memories.prompt;
  assert.equal(prompt.kind, 'daily');
  const claims = await Promise.all(Array.from({ length: 8 }, () => f.service.claimMemoryPrompt(prompt.id)));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await f.service.snapshot()).memories.prompt.id, prompt.id);
  await f.service.close();
  const again = await createDeskService({ dataDir: f.dataDir, now: f.now, autoTick: false }); t.after(() => again.close());
  assert.equal(await again.claimMemoryPrompt(prompt.id), false);
  view = await again.command({ type: 'memory.dismiss', id: prompt.id });
  assert.equal(view.memories.prompt, null); assert.equal(view.memories.entries[0].read, false);
  await again.tick(); assert.equal((await again.snapshot()).memories.prompt, null);
});

test('reading the prompted daily page handles today before a stale dismissal can race with a continuation prompt', async t => {
  const f = await fixture(t);
  const created = await f.service.command({ type: 'note.create', text: 'continue together', intent: 'continue' });
  const noteId = created.notes[0].id;
  f.set(local(2026, 10, 29));
  const daily = (await f.service.snapshot()).memories.prompt;
  assert.equal(daily.kind, 'daily');
  const continuationId = `continue:2026-10-29:${noteId}`;
  const [selected, claimed] = await Promise.all([
    f.service.command({ type: 'memory.select', date: daily.date }),
    f.service.claimMemoryPrompt(continuationId)
  ]);
  assert.equal(selected.memories.prompt.id, continuationId, 'the continuation remains available as a manual card');
  assert.equal(claimed, false, 'reading the daily page must prevent a second automatic hint');
  const dismissed = await f.service.command({ type: 'memory.dismiss', id: daily.id });
  assert.equal(dismissed.memories.prompt.id, continuationId, 'a delayed daily dismissal must not dismiss another prompt');
  assert.equal(await f.service.claimMemoryPrompt(continuationId), false);
  await f.service.close();
  const again = await createDeskService({ dataDir: f.dataDir, now: f.now, autoTick: false }); t.after(() => again.close());
  assert.equal(await again.claimMemoryPrompt(continuationId), false, 'handled day must remain durable after restart');
  const store = await readStore(f);
  assert.deepEqual(store.memories.claimedDates, ['2026-10-29']);
  assert.ok(store.memories.dismissed.includes(daily.id));
});

test('reading a historical page does not consume the current latest daily reminder', async t => {
  const f = await fixture(t);
  await f.service.recordTask({ id: 'first-day', at: f.now() });
  f.set(local(2026, 10, 29)); await f.service.snapshot();
  await f.service.recordTask({ id: 'second-day', at: f.now() });
  f.set(local(2026, 10, 30));
  const current = (await f.service.snapshot()).memories.prompt;
  assert.equal(current.date, '2026-10-29');
  const view = await f.service.command({ type: 'memory.select', date: '2026-10-28' });
  assert.equal(view.memories.prompt.id, current.id);
  assert.deepEqual((await readStore(f)).memories.claimedDates, []);
  assert.equal(await f.service.claimMemoryPrompt(current.id), true);
});

test('reading while collection or reminders are disabled does not consume a later enabled reminder', async t => {
  for (const disabled of [{ enabled: false, reminders: true }, { enabled: true, reminders: false }]) {
    const f = await fixture(t);
    const created = await f.service.command({ type: 'note.create', text: 'saved continuation', intent: 'continue' });
    f.set(local(2026, 10, 29)); await f.service.snapshot();
    await f.service.command({ type: 'memory.configure', ...disabled });
    await f.service.command({ type: 'memory.select', date: '2026-10-28' });
    const store = await readStore(f);
    assert.deepEqual(store.memories.claimedDates, []); assert.deepEqual(store.memories.dismissed, []);
    const enabled = await f.service.command({ type: 'memory.configure', enabled: true, reminders: true });
    assert.equal(enabled.memories.prompt.noteId, created.notes[0].id);
    assert.equal(await f.service.claimMemoryPrompt(enabled.memories.prompt.id), true);
  }
});

test('continue bookmarks respect later, done, archived and a three-day revisit interval', async t => {
  const f = await fixture(t);
  let view = await f.service.command({ type: 'note.create', text: 'next step', intent: 'continue' });
  const id = view.notes[0].id;
  f.set(local(2026, 10, 29));
  await f.service.command({ type: 'memory.select', date: '2026-10-28' });
  view = await f.service.snapshot(); assert.equal(view.memories.prompt.noteId, id);
  view = await f.service.command({ type: 'memory.revisit', id, choice: 'later' }); assert.equal(view.memories.prompt, null);
  assert.equal(await f.service.claimMemoryPrompt(`continue:2026-10-29:${id}`), false);
  f.set(local(2026, 10, 31)); assert.equal((await f.service.snapshot()).memories.prompt, null);
  f.set(local(2026, 11, 1)); assert.equal((await f.service.snapshot()).memories.prompt.noteId, id);
  view = await f.service.command({ type: 'memory.revisit', id, choice: 'done' });
  assert.equal(view.notes[0].resolved, true); assert.equal(view.memories.prompt, null);
  f.set(local(2026, 11, 5)); await f.service.snapshot();
  // A new diary can be shown, but a resolved continuation is never offered.
  view = await f.service.snapshot(); assert.notEqual(view.memories.prompt?.kind, 'continue');
  await f.service.command({ type: 'note.intent', id, intent: 'continue' });
  await f.service.command({ type: 'note.archive', id, archived: true });
  f.set(local(2026, 11, 8)); view = await f.service.snapshot(); assert.notEqual(view.memories.prompt?.kind, 'continue');
});

test('user replies are their own text and can become a grounded continuation on the next dated page', async t => {
  const f = await fixture(t);
  await f.service.recordTask({ id: 'first', at: f.now() });
  f.set(local(2026, 10, 29)); await f.service.snapshot();
  let view = await f.service.command({ type: 'memory.reply', date: '2026-10-28', text: '最满意的是终于想清楚布局。' });
  assert.equal(view.memories.entries[0].reply, '最满意的是终于想清楚布局。');
  assert.equal(view.notes.length, 0, 'a reply does not silently create or rewrite a bookmark');
  await f.service.command({ type: 'memory.edit', date: '2026-10-28', language: 'en', text: 'My hand-edited version.' });
  f.set(local(2026, 10, 30)); view = await f.service.snapshot();
  const later = view.memories.entries.find(page => page.date === '2026-10-29');
  assert.equal(later.facts[0].kind, 'reply'); assert.equal(later.facts[0].sourceDate, '2026-10-28');
  assert.ok(later.body['zh-CN'].includes('最满意的是终于想清楚布局。'));
  assert.equal(view.memories.entries[0].body.en, 'My hand-edited version.');
  assert.notEqual(view.memories.entries[0].body['zh-CN'], 'My hand-edited version.');
});

test('editing or clearing the source reply updates derived pages and preserves unrelated handwritten paragraphs', async t => {
  const f = await fixture(t);
  await f.service.recordTask({ id: 'original', at: f.now() });
  f.set(local(2026, 10, 29)); await f.service.snapshot();
  await f.service.command({ type: 'memory.reply', date: '2026-10-28', text: 'old direct quotation' });
  f.set(local(2026, 10, 30)); await f.service.snapshot();
  await f.service.command({ type: 'memory.edit', date: '2026-10-29', language: 'en', text: 'My independent observation. Quoted: old direct quotation. Keep this ending.' });
  let view = await f.service.command({ type: 'memory.reply', date: '2026-10-28', text: 'a corrected contribution' });
  const next = view.memories.entries.find(page => page.date === '2026-10-29');
  assert.equal(next.facts[0].text, 'a corrected contribution');
  assert.ok(next.body['zh-CN'].includes('a corrected contribution')); assert.ok(!JSON.stringify(view.memories.entries).includes('old direct quotation'));
  assert.equal(next.body.en, 'My independent observation. Quoted: …. Keep this ending.');
  view = await f.service.command({ type: 'memory.reply', date: '2026-10-28', text: '' });
  assert.ok(!JSON.stringify(view.memories.entries).includes('a corrected contribution'));
  assert.deepEqual(view.memories.entries.find(page => page.date === '2026-10-29').facts, []);
  assert.equal(view.memories.entries.find(page => page.date === '2026-10-29').body.en, next.body.en);
});

test('a fact exclusion or deleted quote keeps unrelated user edits while removing the literal quote', async t => {
  const f = await fixture(t);
  let view = await f.service.command({ type: 'note.create', text: 'quoted source', intent: 'remember' });
  const id = view.notes[0].id;
  await f.service.recordTask({ id: 'round', at: f.now() });
  f.set(local(2026, 10, 29)); view = await f.service.snapshot();
  await f.service.command({ type: 'memory.edit', date: '2026-10-28', language: 'en', text: 'A handwritten paragraph with quoted source, and my independent conclusion.' });
  view = await f.service.command({ type: 'memory.exclude', date: '2026-10-28', factId: 'round:2026-10-28' });
  assert.equal(view.memories.entries[0].body.en, 'A handwritten paragraph with quoted source, and my independent conclusion.');
  view = await f.service.command({ type: 'note.delete', id });
  assert.equal(view.memories.entries[0].body.en, 'A handwritten paragraph with …, and my independent conclusion.');
});

test('reopening and resolving a continuation produce distinct factual narration without claiming a whole project finished', async t => {
  const f = await fixture(t);
  const view = await f.service.command({ type: 'note.create', text: 'layout work', intent: 'continue' }), id = view.notes[0].id;
  f.set(local(2026, 10, 29)); await f.service.snapshot();
  await f.service.command({ type: 'memory.revisit', id, choice: 'open' });
  f.set(local(2026, 10, 30));
  let page = (await f.service.snapshot()).memories.entries.find(page => page.date === '2026-10-29');
  assert.equal(page.facts[0].action, 'revisited'); assert.ok(page.body.en.includes('chose to reopen'));
  await f.service.command({ type: 'memory.revisit', id, choice: 'done' });
  f.set(local(2026, 10, 31));
  page = (await f.service.snapshot()).memories.entries.find(page => page.date === '2026-10-30');
  assert.equal(page.facts[0].action, 'resolved'); assert.ok(page.body.en.includes('marked the bookmark'));
  assert.ok(!page.body.en.includes('project finished'));
});

test('excluding facts and deleting a daily page do not regenerate deleted content or erase user replies', async t => {
  const f = await fixture(t);
  await f.service.recordTask({ id: 'first', at: f.now() });
  f.set(local(2026, 10, 29)); let view = await f.service.snapshot();
  await f.service.command({ type: 'memory.reply', date: '2026-10-28', text: 'Keep this response.' });
  view = await f.service.command({ type: 'memory.exclude', date: '2026-10-28', factId: view.memories.entries[0].facts[0].id });
  assert.deepEqual(view.memories.entries[0].facts, []); assert.equal(view.memories.entries[0].reply, 'Keep this response.');
  assert.ok(!view.memories.entries[0].body.en.includes('conversation turn'));
  await f.service.command({ type: 'memory.delete', date: '2026-10-28' });
  await f.service.tick(); assert.deepEqual((await f.service.snapshot()).memories.entries, []);
  f.set(local(2026, 10, 30)); assert.deepEqual((await f.service.snapshot()).memories.entries, [], 'deleted source response is not copied forward');
});

test('deleting a bookmark purges derived quotes by default, preserves user replies and offers explicit quote retention', async t => {
  const f = await fixture(t);
  let view = await f.service.command({ type: 'note.create', text: 'private quoted bookmark', intent: 'remember' });
  const firstId = view.notes[0].id;
  view = await f.service.command({ type: 'note.create', text: 'a second retained quote', intent: 'remember' });
  const secondId = view.notes.find(note => note.id !== firstId).id;
  f.set(local(2026, 10, 29)); await f.service.snapshot();
  await f.service.command({ type: 'memory.reply', date: '2026-10-28', text: 'My separate contribution.' });
  await f.service.command({ type: 'memory.edit', date: '2026-10-28', language: 'en', text: 'Adapted private quoted bookmark.' });
  await f.service.command({ type: 'note.delete', id: firstId });
  const store = await readStore(f);
  assert.ok(!JSON.stringify(store).includes('private quoted bookmark'));
  view = await f.service.command({ type: 'note.delete', id: secondId, purgeMemories: false });
  assert.ok(JSON.stringify(view.memories.entries).includes('a second retained quote'));
  assert.equal(view.memories.entries[0].reply, 'My separate contribution.');
  assert.deepEqual(view.notes, []);
});

test('memory command capabilities reject bad dates, unbounded text, task injection and extra destinations', () => {
  const date = '2026-10-28', id = '0d42c769-f65b-4819-9d53-d4ecc9aaa306';
  const commands = [{ type: 'memory.configure', enabled: false, reminders: true }, { type: 'memory.select', date },
    { type: 'memory.delete', date }, { type: 'memory.reply', date, text: '' }, { type: 'memory.edit', date, language: 'zh-TW', text: '手寫' },
    { type: 'memory.exclude', date, factId: `note:${id}` }, { type: 'memory.dismiss', id: `daily:${date}` },
    { type: 'memory.revisit', id, choice: 'later' }, { type: 'note.intent', id, intent: 'remember' },
    { type: 'note.create', text: '记住', intent: 'remember' }, { type: 'note.update', id, text: '下一步', intent: 'continue' },
    { type: 'note.delete', id, purgeMemories: true }];
  for (const input of commands) {
    assert.equal(validDeskCommand(input), true, JSON.stringify(input));
    assert.equal(validDeskCommand({ ...input, path: 'arbitrary destination' }), false);
    assert.equal(validDeskCommand({ ...input, token: 'private' }), false);
  }
  for (const input of [{ type: 'memory.select', date: '2026-02-30' }, { type: 'memory.reply', date, text: 'x'.repeat(1001) },
    { type: 'memory.reply', date, text: '\0' }, { type: 'memory.edit', date, language: 'ja', text: 'x' },
    { type: 'memory.record', id: 'fake', at: 0 }, { type: 'note.intent', id, intent: 'read-chat' },
    { type: 'note.create', text: 'x', intent: null }, { type: 'note.delete', id, purgeMemories: 'yes' },
    { type: 'memory.revisit', id, choice: 'start-task' }]) assert.equal(validDeskCommand(input), false, JSON.stringify(input));
});

test('literal user text remains data and corrupted memory fields are preserved instead of silently replaced', async t => {
  const f = await fixture(t);
  await f.service.command({ type: 'note.create', text: '<script>alert("x")</script>\nhttps://example.invalid', intent: 'remember' });
  f.set(local(2026, 10, 29)); const view = await f.service.snapshot();
  assert.ok(view.memories.entries[0].body.en.includes('<script>'));
  await f.service.close();
  const store = await readStore(f); store.memories.enabled = 'false';
  const corrupted = JSON.stringify(store); await writeFile(join(f.dataDir, 'desk.json'), corrupted);
  await assert.rejects(createDeskService({ dataDir: f.dataDir, now: f.now, autoTick: false }), { reason: 'desk-storage-invalid' });
  assert.equal(await readFile(join(f.dataDir, 'desk.json'), 'utf8'), corrupted);
});

test('failed atomic writes commit neither task proofs nor prompt claims, so a safe retry is possible', async t => {
  const f = await fixture(t), file = join(f.dataDir, 'desk.json'), retained = join(f.dataDir, 'retained-desk.json');
  async function block(operation) {
    await rename(file, retained); await mkdir(file);
    try { await operation(); }
    finally { await rename(file, join(f.dataDir, `retained-blocker-${Date.now()}`)); await rename(retained, file); }
  }
  const event = { id: 'not-committed-until-written', at: f.now() };
  await block(() => assert.rejects(f.service.recordTask(event), { reason: 'desk-storage-unavailable' }));
  assert.equal(await f.service.recordTask(event), true);
  f.set(local(2026, 10, 29)); const prompt = (await f.service.snapshot()).memories.prompt;
  await block(() => assert.rejects(f.service.claimMemoryPrompt(prompt.id), { reason: 'desk-storage-unavailable' }));
  assert.equal(await f.service.claimMemoryPrompt(prompt.id), true);
  assert.equal(await f.service.claimMemoryPrompt(prompt.id), false);
});

test('calendar handling uses local dates across leap days, month changes and daylight-saving transitions', () => {
  assert.equal(validMemoryDate('2024-02-29'), true); assert.equal(validMemoryDate('2025-02-29'), false);
  assert.equal(validMemoryDate('2026-04-31'), false); assert.equal(validMemoryDate('2026-13-01'), false);
  for (const [year, month, day, nextYear, nextMonth, nextDay] of [[2024, 2, 29, 2024, 3, 1], [2026, 12, 31, 2027, 1, 1]]) {
    const at = local(year, month, day), memories = createMemories(at);
    recordMemoryTask(memories, { id: 'a', at }, at); advanceMemories(memories, local(nextYear, nextMonth, nextDay));
    assert.equal(memories.entries[0].date, localMemoryDate(at));
  }
  const moduleUrl = new URL('../../src/desk/memories.mjs', import.meta.url).href;
  const source = `import {createMemories,recordMemoryTask,advanceMemories} from ${JSON.stringify(moduleUrl)};
    const a=new Date(2026,2,8,0,30).getTime(), b=new Date(2026,2,9,0,30).getTime(),m=createMemories(a);
    recordMemoryTask(m,{id:'dst',at:a},a);advanceMemories(m,b);console.log(JSON.stringify({hours:(b-a)/3600000,date:m.entries[0].date}));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(result.stdout); assert.equal(evidence.hours, 23); assert.equal(evidence.date, '2026-03-08');
});

test('history never silently evicts pages, and collection pauses at the bounded one-year capacity', () => {
  const start = local(2026, 1, 1), memories = createMemories(start);
  for (let day = 0; day < 400; day++) {
    const at = new Date(2026, 0, 1 + day, 12).getTime();
    recordMemoryTask(memories, { id: `turn-${day}`, at }, at);
    recordMemoryBookmark(memories, { id: '0d42c769-f65b-4819-9d53-d4ecc9aaa306', text: 'x'.repeat(1000), intent: 'remember', archived: false }, at);
    advanceMemories(memories, new Date(2026, 0, 2 + day, 12).getTime());
  }
  assert.equal(memories.entries.length, 365); assert.equal(memories.entries[0].date, '2026-01-01');
  assert.equal(memories.days.length, 90); assert.ok(memories.generatedDates.length <= 730);
  assert.ok(Buffer.byteLength(JSON.stringify(memories)) < 8_388_608);
  assert.equal(restoreMemories(memories, start).entries.length, 365);
  assert.ok(memories.days.every(day => !day.bookmarks.length), 'materialized quotes are not duplicated in hidden ledgers');
  const at = new Date(2026, 0, 402, 12).getTime(), view = memoriesView(memories, [], at);
  assert.equal(view.entries.length, 365); assert.equal(view.limitReached, true); assert.ok(!JSON.stringify(view).includes('roundHashes'));
  assert.equal(recordMemoryTask(memories, { id: 'over-capacity', at }, at), false);
});

test('concurrent source operations retain each independent bookmark and one proof per completed root turn', async t => {
  const f = await fixture(t), tasks = Array.from({ length: 20 }, (_, i) => ({ id: `private-root-${i}`, at: f.now() }));
  await Promise.all([
    ...Array.from({ length: 8 }, (_, i) => f.service.command({ type: 'note.create', text: `explicit note ${i}`, intent: 'remember' })),
    ...tasks.flatMap(event => [f.service.recordTask(event), f.service.recordTask(event)]),
  ]);
  const before = await f.service.snapshot(); assert.equal(before.notes.length, 8);
  f.set(local(2026, 10, 29)); const view = await f.service.snapshot(), page = view.memories.entries[0];
  assert.equal(page.facts.find(fact => fact.kind === 'round').count, 20); assert.equal(page.facts.length, 6);
  assert.ok(!JSON.stringify(await readStore(f)).includes('private-root-'));
  assert.ok(page.facts.filter(fact => fact.kind === 'bookmark').every(fact => before.notes.some(note => note.id === fact.noteId)));
});

test('malformed internal events cannot introduce conversation text or arbitrary stored objects', async t => {
  const f = await fixture(t);
  for (const event of [null, { id: '', at: f.now() }, { id: 'x', at: -1 }, { id: '\0', at: f.now() }]) {
    await assert.rejects(f.service.recordTask(event), { reason: 'invalid-memory-event' });
  }
  const event = { id: 'opaque-end', at: f.now(), conversation: 'PRIVATE-CONTENT', path: 'PRIVATE-PATH' };
  await f.service.recordTask(event);
  const stored = JSON.stringify(await readStore(f));
  assert.ok(!stored.includes('PRIVATE-')); assert.ok(!stored.includes('opaque-end'));
  const invalid = await readStore(f); invalid.memories.selectedDate = '2026-10-28';
  assert.throws(() => restoreMemories(invalid.memories, f.now()), { reason: 'desk-storage-invalid' });
});
