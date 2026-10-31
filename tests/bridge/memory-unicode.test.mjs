import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDeskService} from '../../src/desk/service.mjs';

const languages = ['zh-CN', 'zh-TW', 'en'];
const local = day => new Date(2026, 9, day, 12).getTime();

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-memory-unicode-'));
  let at = local(28), service;
  const boot = async () => { service = await createDeskService({dataDir, now: () => at, autoTick: false, detectSleep: false}); };
  await boot(); t.after(() => service.close());
  return {get service() {return service;}, nextDay(day) {at = local(day);},
    async restart() {await service.close(); await boot();},
    store: async () => JSON.parse(await readFile(join(dataDir, 'desk.json'), 'utf8'))};
}

function assertWellFormedPage(entry) {
  for (const language of languages) {
    assert.ok(entry.body[language].isWellFormed(), language + ' body');
    assert.ok(entry.body[language].length <= 1000, language + ' budget');
    assert.equal(entry.body[language].includes('\ufffd'), false);
  }
  for (const fact of entry.facts.filter(fact => typeof fact.text === 'string')) {
    assert.ok(fact.text.isWellFormed()); assert.ok(fact.text.length <= 240);
  }
}

for (const [label, character] of [['emoji', '💜'], ['supplementary CJK', '𠮷']]) {
  test(label + ' bookmark and reply excerpts preserve whole pairs at and across the 240-unit boundary', async t => {
    const f = await fixture(t);
    const exact = 'a'.repeat(238) + character, cut = 'b'.repeat(239) + character;
    const short = '雪' + character + ' 白', ordinary = 'c'.repeat(241);
    for (const text of [exact, cut, short, ordinary]) await f.service.command({type: 'note.create', text, intent: 'remember'});
    f.nextDay(29);
    let view = await f.service.snapshot(), first = view.memories.entries[0];
    const bookmarks = first.facts.filter(fact => fact.kind === 'bookmark');
    assert.deepEqual(bookmarks.map(fact => fact.text), [exact, 'b'.repeat(239), short, 'c'.repeat(240)]);
    assertWellFormedPage(first);
    await f.service.command({type: 'memory.reply', date: first.date, text: cut});
    await f.restart();
    assert.equal((await f.service.snapshot()).memories.entries[0].reply, cut, 'the deliberate full reply is not truncated');
    f.nextDay(30); view = await f.service.snapshot();
    const replyPage = view.memories.entries.find(entry => entry.date === '2026-10-29');
    assert.equal(replyPage.facts[0].text, 'b'.repeat(239));
    assertWellFormedPage(replyPage);
    for (const language of languages) assert.ok(replyPage.body[language].includes('b'.repeat(239)));
    const saved = await f.store();
    assert.deepEqual(saved.notes.map(note => note.text), [exact, cut, short, ordinary], 'source bookmarks retain their complete original text');
    const expected = view.memories.entries;
    await f.restart(); view = await f.service.snapshot();
    assert.deepEqual(view.memories.entries, expected);
    for (const entry of view.memories.entries) assertWellFormedPage(entry);
    // A replacement remains whole when a previously truncated reply is revised.
    view = await f.service.command({type: 'memory.reply', date: first.date, text: exact});
    assert.equal(view.memories.entries.find(entry => entry.date === '2026-10-29').facts[0].text, exact);
    for (const entry of view.memories.entries) assertWellFormedPage(entry);
  });

  test(label + ' handwritten pages retain exact 1000-unit text and reject an oversized pair without corrupting any language', async t => {
    const f = await fixture(t);
    await f.service.recordTask({id: 'isolated-unicode-body', at: local(28)});
    f.nextDay(29); const date = (await f.service.snapshot()).memories.entries[0].date;
    const exact = 'd'.repeat(998) + character, over = 'e'.repeat(999) + character;
    for (const language of languages) await f.service.command({type: 'memory.edit', date, language, text: exact});
    for (const language of languages) await assert.rejects(f.service.command({type: 'memory.edit', date, language, text: over}), error => error.reason === 'invalid-desk-command');
    await f.restart();
    const entry = (await f.service.snapshot()).memories.entries[0];
    for (const language of languages) assert.equal(entry.body[language], exact);
    assertWellFormedPage(entry);
  });
}
