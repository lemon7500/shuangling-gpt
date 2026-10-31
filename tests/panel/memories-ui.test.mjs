import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { STORIES } from '../../src/desk/stories.mjs';
const require = createRequire(import.meta.url);
const helper = new URL('../../vendor/dsh-pet/runtime/electron-helper/', import.meta.url);
const i18n = require('../../vendor/dsh-pet/runtime/electron-helper/panel-i18n.js');
const { memoryEntries, memoryDate, factLabel, continuationText } = require('../../vendor/dsh-pet/runtime/electron-helper/desk.js');
const source = name => readFileSync(new URL(name, helper), 'utf8');
const id = '0d42c769-f65b-4819-9d53-d4ecc9aaa306';
const otherId = '18b58a0c-1fe4-4714-8e6d-f5023a72f227';
const strings = text => ({ 'zh-CN': text, 'zh-TW': text, en: text });
const clone = value => JSON.parse(JSON.stringify(value));
const entries = () => [
  { date: '2026-10-27', title: strings('A page together'), body: strings('<script>not executable</script>\nA quiet shared page.'), reply: '', read: false, updatedAt: 1000,
    facts: [{ id: 'bookmark:' + id, kind: 'bookmark', noteId: id, text: '<img src=x onerror=bad>' }, { id: 'focus:one', kind: 'focus', minutes: 25 }, { id: 'reply:2026-10-26', kind: 'reply', sourceDate: '2026-10-26', text: 'A word from the previous page.' }] },
  { date: '2026-10-26', title: strings('The previous page'), body: strings('We left room for another day.'), reply: 'My own reply', read: true, updatedAt: 900, facts: [] },
];

afterEach(() => i18n.setLanguage('zh-CN'));

function fixture({ language = 'zh-CN', memoryEntries: initialEntries = entries(), prompt = null, snapshotReply = null } = {}) {
  const elements = new Map(), events = new Map(), commands = [], intervals = [], timeouts = new Map();
  let closeCount = 0, onTab, onClose;
  const state = { ok: true, activeTab: 'journal', language,
    focus: { phase: 'focus', status: 'idle', focusMinutes: 25, breakMinutes: 5, remainingMs: 1500000, endsAt: null },
    journal: { selectedId: STORIES[0].id, entries: STORIES.map(story => ({ ...story, read: false, favorite: false })), positionById: {} },
    notes: [{ id, text: 'Continue the control panel', intent: 'continue', resolved: false, pinned: false, archived: false, createdAt: 1000, updatedAt: 1000 }, { id: otherId, text: 'A second bookmark', intent: 'remember', resolved: false, pinned: false, archived: false, createdAt: 900, updatedAt: 900 }],
    memories: { enabled: true, reminders: true, since: 1000, selectedDate: initialEntries[0]?.date || null, entries: clone(initialEntries), prompt },
  };
  const descendants = children => children.flatMap(child => [child, ...descendants(child.children || [])]);
  const all = () => [...elements.values(), ...descendants([...elements.values()].flatMap(el => el.children))];
  const document = { hidden: false, activeElement: null, documentElement: { lang: language }, title: '',
    getElementById: key => elements.get(key), addEventListener(name, handler) { events.set(name, handler); },
    querySelectorAll(selector) { if (selector === '[data-tab]') return [...elements.values()].filter(el => el.dataset.tab); return []; },
    createElement: tag => element(tag),
  };
  function match(el, selector) {
    const attr = selector.match(/^\[data-([\w-]+)="([^"]+)"\]$/);
    if (!attr) return false;
    const key = attr[1].replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    return el.dataset[key] === attr[2];
  }
  function element(tag = 'div') {
    return { tagName: tag, dataset: {}, attributes: {}, listeners: new Map(), children: [], value: '', hidden: false, checked: false, disabled: false, textContent: '', scrollHeight: 1000, clientHeight: 200, scrollTop: 0,
      setAttribute(key, value) { this.attributes[key] = value; }, getAttribute(key) { return this.attributes[key]; },
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; }, focus() { document.activeElement = this; },
      addEventListener(name, handler) { this.listeners.set(name, handler); }, scrollIntoView() {}, reportValidity() { return true; },
      querySelector(selector) { return descendants(this.children).find(el => match(el, selector)) || null; },
    };
  }
  for (const match of source('desk.html').matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = element(match[1]); el.id = match[2]; el.hidden = /\shidden\b/.test(match[0]); el.value = match[0].match(/\bvalue="([^"]*)"/)?.[1] || '';
    const tab = match[0].match(/data-tab="([^"]+)"/)?.[1]; if (tab) el.dataset.tab = tab;
    elements.set(el.id, el);
  }
  const api = { async snapshot() { return clone(snapshotReply || state); }, async command(input) {
    const value = clone(input); commands.push(value);
    const note = state.notes.find(note => note.id === value.id), entry = state.memories.entries.find(entry => entry.date === value.date);
    switch (value.type) {
      case 'story.select': state.journal.selectedId = value.id; break;
      case 'memory.select': state.memories.selectedDate = value.date; if (entry) entry.read = true; break;
      case 'memory.configure': state.memories.enabled = value.enabled; state.memories.reminders = value.reminders; break;
      case 'memory.reply': if (entry) entry.reply = value.text; break;
      case 'memory.edit': if (entry) entry.body[value.language] = value.text; break;
      case 'memory.exclude': if (entry) entry.facts = entry.facts.filter(fact => fact.id !== value.factId); break;
      case 'memory.delete': state.memories.entries = state.memories.entries.filter(entry => entry.date !== value.date); break;
      case 'memory.dismiss': state.memories.prompt = null; break;
      case 'memory.revisit': state.memories.prompt = null; if (note && value.choice === 'done') note.resolved = true; break;
      case 'note.create': state.notes.push({ id: '6eea0f1d-c023-48b7-88db-39beb5774a21', text: value.text, intent: value.intent || 'none', resolved: false, pinned: false, archived: false, createdAt: 2000, updatedAt: 2000 }); break;
      case 'note.update': if (note) { note.text = value.text; if (value.intent) note.intent = value.intent; } break;
      case 'note.delete': state.notes = state.notes.filter(note => note.id !== value.id); break;
    }
    return clone(state);
  }, close() { closeCount++; }, onTab(fn) { onTab = fn; return () => { onTab = null; }; }, onCloseRequest(fn) { onClose = fn; return () => { onClose = null; }; } };
  vm.runInNewContext(source('desk.js'), { document, shuanglingI18n: i18n, shuanglingDesk: api, requestAnimationFrame: fn => fn(),
    setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {},
    setTimeout(fn, delay) { const key = timeouts.size + 1; timeouts.set(key, { fn, delay }); return key; }, clearTimeout(key) { timeouts.delete(key); }, addEventListener() {}, console });
  return { state, commands, elements, events, api, get closeCount() { return closeCount; },
    async settle() { for (let count = 0; count < 10; count++) await new Promise(resolve => setImmediate(resolve)); },
    async event(el, name = 'click') { const target = typeof el === 'string' ? elements.get(el) : el; assert.ok(target, 'missing element'); await target.listeners.get(name)?.({ preventDefault() {} }); await this.settle(); },
    async clickControl(key, value) { const el = all().find(el => el.dataset[key] === value); assert.ok(el, `missing control ${key}=${value}`); await this.event(el); },
    findControl(key, value) { return all().find(el => el.dataset[key] === value); },
    async poll() { intervals.forEach(fn => fn()); await this.settle(); },
    notifyClose() { onClose?.(); }, notifyTab(value) { onTab?.(value); },
  };
}

test('daily entry presentation orders local dates, translates confirmed facts and never turns prose into a bookmark', () => {
  const initial = entries(); const copy = JSON.stringify(initial);
  assert.deepEqual(memoryEntries({ entries: [...initial].reverse() }).map(entry => entry.date), ['2026-10-27', '2026-10-26']);
  assert.equal(JSON.stringify(initial), copy); assert.equal(memoryDate('../file'), '');
  assert.doesNotMatch(memoryDate('2026-10-27', true), /2026/);
  assert.equal(continuationText(initial[0]), '<img src=x onerror=bad>');
  assert.equal(continuationText(initial[1]), 'My own reply'); assert.equal(continuationText({ body: strings('generated prose') }), '');
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    i18n.setLanguage(language);
    assert.ok(memoryDate('2026-10-27').length > 0);
    for (const fact of [{ kind: 'focus', minutes: 25 }, { kind: 'round', count: 2 }, { kind: 'reply' }, { kind: 'bookmark' }]) {
      const label = factLabel(fact); assert.ok(label); if (language === 'en') assert.doesNotMatch(label, /\p{Script=Han}/u);
    }
  }
});

test('journal retains six fixed stories beside honest empty daily shelves and separate persisted switches', async () => {
  const f = fixture({ memoryEntries: [] }); await f.settle();
  assert.equal(f.elements.get('story-list').children.length, 6);
  await f.event('shelf-memories'); assert.equal(f.elements.get('memories-empty').hidden, false);
  assert.equal(f.elements.get('memory-entry').hidden, true);
  assert.equal(f.elements.get('memories-empty-text').textContent, '从今天开始，慢慢留下我们的日常。');
  f.elements.get('memory-enabled').checked = false; await f.event('memory-enabled', 'change');
  assert.deepEqual(f.commands.at(-1), { type: 'memory.configure', enabled: false, reminders: true });
  assert.equal(f.elements.get('memories-empty-text').textContent, '日常记录已关闭，已有手记仍可阅读。');
  f.elements.get('memory-reminders').checked = false; await f.event('memory-reminders', 'change');
  assert.deepEqual(f.commands.at(-1), { type: 'memory.configure', enabled: false, reminders: false });
});

test('reply draft survives polling, shelf and tab changes, external close and IME Escape', async () => {
  const f = fixture(); await f.settle(); await f.event('shelf-memories'); await f.event('memory-add-reply');
  f.elements.get('memory-editor').value = '我的一句还没写完'; await f.event('memory-editor', 'input');
  f.state.memories.entries[0].reply = 'Another committed value'; await f.poll();
  assert.equal(f.elements.get('memory-editor').value, '我的一句还没写完');
  await f.event('shelf-stories'); await f.event('tab-focus'); f.notifyTab('notes'); await f.settle();
  f.events.get('keydown')({ key: 'Escape', isComposing: true, preventDefault() { assert.fail('IME Escape must not close'); } });
  assert.equal(f.closeCount, 0);
  f.notifyClose(); assert.equal(f.elements.get('close-guard').hidden, false); await f.event('continue-edit');
  assert.equal(f.elements.get('journal').hidden, false); assert.equal(f.elements.get('memories-shelf').hidden, false);
  assert.equal(f.elements.get('memory-editor').value, '我的一句还没写完');
  await f.clickControl('memoryControl', 'date-2026-10-26');
  assert.ok(!f.commands.some(command => command.type === 'memory.select' && command.date === '2026-10-26'));
  await f.event('memory-save');
  assert.deepEqual(f.commands.find(command => command.type === 'memory.reply'), { type: 'memory.reply', date: '2026-10-27', text: '我的一句还没写完' });
  assert.equal(f.elements.get('memory-reply').textContent, '我的一句还没写完');
  assert.equal(f.elements.get('memory-editor-card').hidden, true);
});

test('body edits retain their original language through a language change and can be cancelled safely', async () => {
  const f = fixture({ language: 'en' }); await f.settle(); await f.event('shelf-memories'); await f.event('memory-edit');
  f.elements.get('memory-editor').value = 'A revised page'; await f.event('memory-editor', 'input');
  f.state.language = 'zh-TW'; await f.poll();
  assert.equal(f.elements.get('memory-editor').value, 'A revised page'); assert.match(f.elements.get('memory-editor-label').textContent, /English/);
  await f.event('memory-save');
  assert.deepEqual(f.commands.find(command => command.type === 'memory.edit'), { type: 'memory.edit', date: '2026-10-27', language: 'en', text: 'A revised page' });
  await f.event('memory-add-reply'); f.elements.get('memory-editor').value = 'discard just this draft'; await f.event('memory-cancel');
  assert.equal(f.elements.get('memory-editor-card').hidden, true); assert.equal(f.state.memories.entries[0].reply, '');
});

test('literal facts and replies stay plain text, link to their source and exclude only the selected fact', async () => {
  const f = fixture(); await f.settle(); await f.event('shelf-memories');
  assert.equal(f.elements.get('memory-body').textContent, '<script>not executable</script>\nA quiet shared page.');
  assert.equal(f.elements.get('memory-facts').children[0].children[1].textContent, '<img src=x onerror=bad>');
  assert.equal(f.elements.get('memory-facts').children[2].children[0].textContent, '你补写的一句');
  await f.clickControl('memoryControl', 'reply:2026-10-26-source');
  assert.equal(f.state.memories.selectedDate, '2026-10-26');
  await f.clickControl('memoryControl', 'date-2026-10-27');
  await f.clickControl('memoryControl', 'focus:one-exclude');
  assert.deepEqual(f.commands.at(-1), { type: 'memory.exclude', date: '2026-10-27', factId: 'focus:one' });
});

test('keep for next time prefills only an active fact and protects existing bookmark drafts', async () => {
  const f = fixture(); await f.settle(); await f.event('shelf-memories');
  f.elements.get('note-text').value = 'my unfinished bookmark'; await f.event('memory-carry');
  assert.equal(f.elements.get('note-text').value, 'my unfinished bookmark');
  await f.event('note-cancel'); await f.event('memory-carry');
  assert.equal(f.elements.get('notes').hidden, false);
  assert.equal(f.elements.get('note-text').value, '<img src=x onerror=bad>');
  assert.equal(f.elements.get('note-intent').value, 'continue');
  assert.ok(!f.commands.some(command => command.type === 'note.create'));
  await f.event('note-form', 'submit');
  assert.deepEqual(f.commands.find(command => command.type === 'note.create'), { type: 'note.create', text: '<img src=x onerror=bad>', intent: 'continue' });
});

test('bookmark edits atomically include intent and opening a second note cannot overwrite a draft', async () => {
  const f = fixture(); await f.settle(); await f.clickControl('noteControl', id + '-edit');
  f.elements.get('note-text').value = 'An unfinished change'; f.elements.get('note-intent').value = 'remember';
  await f.clickControl('noteControl', otherId + '-edit');
  assert.equal(f.elements.get('note-text').value, 'An unfinished change');
  await f.event('note-form', 'submit');
  assert.deepEqual(f.commands.find(command => command.type === 'note.update'), { type: 'note.update', id, text: 'An unfinished change', intent: 'remember' });
});

test('daily and continuation prompt buttons use bounded commands and never automatically open a window', async () => {
  const f = fixture({ prompt: { id: 'daily:2026-10-28', kind: 'daily', date: '2026-10-27' } }); await f.settle();
  assert.equal(f.elements.get('memory-prompt').hidden, false); assert.equal(f.elements.get('stories-shelf').hidden, false);
  await f.event('memory-prompt-open');
  assert.equal(f.elements.get('memories-shelf').hidden, false);
  assert.ok(f.commands.some(command => command.type === 'memory.select' && command.date === '2026-10-27'));
  assert.deepEqual(f.commands.at(-1), { type: 'memory.dismiss', id: 'daily:2026-10-28' });
  const g = fixture({ prompt: { id: 'continue:2026-10-28', kind: 'continue', noteId: id } }); await g.settle();
  await g.event('memory-prompt-open'); assert.deepEqual(g.commands.at(-1), { type: 'memory.revisit', id, choice: 'open' });
  assert.equal(g.elements.get('notes').hidden, false); assert.equal(g.elements.get('note-text').value, '');
  const h = fixture({ prompt: { id: 'daily:2026-10-28', kind: 'daily', date: '2026-10-27' } }); await h.settle(); await h.event('memory-prompt-later');
  assert.deepEqual(h.commands.at(-1), { type: 'memory.dismiss', id: 'daily:2026-10-28' });
});

test('entry deletion requires a second click and bookmark deletion exposes quote removal explicitly', async () => {
  const f = fixture(); await f.settle(); await f.event('shelf-memories'); await f.event('memory-delete');
  assert.ok(!f.commands.some(command => command.type === 'memory.delete'));
  await f.event('memory-delete-cancel'); await f.event('memory-delete'); await f.event('memory-delete');
  assert.deepEqual(f.commands.find(command => command.type === 'memory.delete'), { type: 'memory.delete', date: '2026-10-27' });
  await f.clickControl('noteControl', id + '-delete');
  const card = f.elements.get('note-list').children.find(card => card.dataset.noteId === id), checkbox = card.children.at(-1).children[0];
  assert.equal(checkbox.checked, true); checkbox.checked = false; await f.event(checkbox, 'change');
  await f.clickControl('noteControl', id + '-delete');
  assert.deepEqual(f.commands.find(command => command.type === 'note.delete'), { type: 'note.delete', id, purgeMemories: false });
});

test('an unsaved-edit notice follows three-language changes without touching drafts or requesting extra snapshots', async () => {
  const f = fixture(); await f.settle(); await f.event('shelf-memories');
  f.elements.get('note-text').value = 'My unfinished bookmark';
  await f.event('memory-carry');
  let snapshots = 0; const snapshot = f.api.snapshot;
  f.api.snapshot = async () => { snapshots++; return snapshot(); };
  const commands = clone(f.commands), notes = clone(f.state.notes);
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    f.state.language = language; const before = snapshots; await f.poll();
    assert.equal(snapshots - before, 1, 'only the existing poll requests a snapshot');
    assert.equal(f.elements.get('notice').textContent, i18n.dictionaries[language]['请先保存或取消当前编辑。']);
    assert.equal(f.elements.get('notice').hidden, false);
    assert.equal(f.elements.get('notice').dataset.kind, 'error');
    assert.equal(f.elements.get('note-text').value, 'My unfinished bookmark');
    assert.deepEqual(f.commands, commands); assert.deepEqual(f.state.notes, notes);
  }
});

test('a committed bookmark success notice translates without replaying its save or changing visibility', async () => {
  const f = fixture(); await f.settle();
  f.elements.get('note-text').value = 'A deliberately saved moment';
  f.elements.get('note-intent').value = 'remember';
  await f.event('note-form', 'submit');
  const created = f.state.notes.find(note => note.text === 'A deliberately saved moment');
  assert.ok(created); assert.equal(f.elements.get('note-text').value, '');
  const savedCommands = clone(f.commands), savedNotes = clone(f.state.notes);
  let snapshots = 0; const snapshot = f.api.snapshot;
  f.api.snapshot = async () => { snapshots++; return snapshot(); };
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    f.state.language = language; const before = snapshots; await f.poll();
    assert.equal(snapshots - before, 1);
    assert.equal(f.elements.get('notice').textContent, i18n.dictionaries[language]['好，我给这一页留个位置。']);
    assert.equal(f.elements.get('notice').hidden, false);
    assert.equal(f.elements.get('notice').dataset.kind, 'success');
    assert.deepEqual(f.commands, savedCommands); assert.deepEqual(f.state.notes, savedNotes);
  }
});

test('a failed-save notice keeps the last sampled language offline and translates on recovery without losing its draft', async () => {
  const f = fixture(); await f.settle();
  const snapshot = f.api.snapshot, notes = clone(f.state.notes);
  let offline = true, snapshots = 0;
  f.api.snapshot = async () => { snapshots++; if (offline) throw new Error('fixture-disconnected'); return snapshot(); };
  f.api.command = async () => ({ ok: false, error: 'fixture-storage-unavailable' });
  f.elements.get('note-text').value = 'Keep this failed save intact';
  f.elements.get('note-intent').value = 'remember';
  await f.event('note-form', 'submit');
  assert.equal(f.elements.get('notice').textContent, i18n.dictionaries['zh-CN']['操作暂未完成，请稍后重试。']);
  assert.equal(f.elements.get('connection').dataset.disconnected, 'true');
  f.state.language = 'zh-TW'; let before = snapshots; await f.poll();
  assert.equal(snapshots - before, 1);
  assert.equal(f.elements.get('notice').textContent, i18n.dictionaries['zh-CN']['操作暂未完成，请稍后重试。'], 'an unavailable snapshot cannot supply a new language');
  offline = false;
  for (const language of ['zh-TW', 'en']) {
    f.state.language = language; before = snapshots; await f.poll();
    assert.equal(snapshots - before, 1);
    assert.equal(f.elements.get('notice').textContent, i18n.dictionaries[language]['操作暂未完成，请稍后重试。']);
    assert.equal(f.elements.get('notice').hidden, false);
    assert.equal(f.elements.get('notice').dataset.kind, 'error');
    assert.equal(f.elements.get('note-text').value, 'Keep this failed save intact');
    assert.deepEqual(f.state.notes, notes);
  }
});

test('a cold unavailable desk can use trusted interface language while keeping private data and controls unavailable', async () => {
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    const f = fixture({ snapshotReply: { ok: false, error: 'desk-unavailable', language } });
    await f.settle();
    assert.equal(i18n.getLanguage(), language);
    assert.equal(f.elements.get('connection').textContent, i18n.dictionaries[language]['本机连接已断开']);
    assert.equal(f.elements.get('note-text').disabled, true);
    assert.equal(f.elements.get('memory-enabled').disabled, true);
    assert.equal(f.elements.get('note-list').children.length, 0, 'a failed read cannot invent empty successful content');
    assert.deepEqual(f.commands, []);
  }
});

test('a failed-data language update preserves drafts and notices without treating that data as a successful read', async () => {
  const f = fixture(); await f.settle(); await f.event('shelf-memories');
  f.elements.get('note-text').value = 'An unfinished local draft 💜';
  await f.event('memory-carry');
  const notes = clone(f.state.notes), commands = clone(f.commands);
  for (const language of ['zh-TW', 'en']) {
    f.api.snapshot = async () => ({ ok: false, language, notes: [{ text: 'PRIVATE-NOTE' }] });
    await f.poll();
    assert.equal(f.elements.get('notice').textContent, i18n.dictionaries[language]['请先保存或取消当前编辑。']);
    assert.equal(f.elements.get('connection').textContent, i18n.dictionaries[language]['本机连接已断开']);
    assert.equal(f.elements.get('note-save').disabled, true);
    assert.equal(f.elements.get('note-text').value, 'An unfinished local draft 💜');
    assert.deepEqual(f.state.notes, notes); assert.deepEqual(f.commands, commands);
    assert.ok(!JSON.stringify(f.elements.get('note-list').children).includes('PRIVATE-NOTE'));
  }
  f.api.snapshot = async () => ({ ok: false, language: 'invalid-arbitrary-language' });
  await f.poll(); assert.equal(i18n.getLanguage(), 'en', 'an invalid failure locale cannot replace the last trusted one');
});

test('hidden notices stay hidden during language changes and all notice keys have three translations', async () => {
  const f = fixture(); await f.settle();
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    f.state.language = language; await f.poll();
    assert.equal(f.elements.get('notice').hidden, true);
    assert.equal(f.elements.get('notice').textContent, '');
  }
  const keys = [...source('desk.js').matchAll(/\bnotice\('([^']+)'/g)].map(match => match[1]);
  assert.ok(keys.length >= 6);
  for (const key of keys) for (const language of ['zh-CN', 'zh-TW', 'en'])
    assert.ok(i18n.dictionaries[language][key]?.trim(), `${language}: ${key}`);
});
