import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { STORIES } from '../../src/desk/stories.mjs';
const require = createRequire(import.meta.url);
const helper = new URL('../../vendor/dsh-pet/runtime/electron-helper/', import.meta.url);
const { TABS, STORY_IDS, validateDeskCommand, sanitizeDeskSnapshot, deskBounds, createDeskController } = require('../../vendor/dsh-pet/runtime/electron-helper/desk-main.cjs');
const { createPanelController, validateCommand, sanitizeSnapshot } = require('../../vendor/dsh-pet/runtime/electron-helper/panel-main.cjs');
const { presentFocus, visibleNotes } = require('../../vendor/dsh-pet/runtime/electron-helper/desk.js');
const { ANIMATIONS, animationAvailable } = require('../../vendor/dsh-pet/runtime/electron-helper/panel-ui.js');
const i18n = require('../../vendor/dsh-pet/runtime/electron-helper/panel-i18n.js');
const noteId = '0d42c769-f65b-4819-9d53-d4ecc9aaa306';
const source = name => readFileSync(new URL(name, helper), 'utf8');
afterEach(() => i18n.setLanguage('zh-CN'));

test('desk IPC accepts a closed set of commands and matches the six canonical stories', () => {
  assert.deepEqual(STORY_IDS, STORIES.map(story => story.id));
  const commands = [{ type: 'focus.configure', focusMinutes: 25, breakMinutes: 5 }, { type: 'focus.start', phase: 'focus' }, { type: 'focus.start', phase: 'break' }, ...['pause', 'resume', 'stop'].map(type => ({ type: `focus.${type}` })), { type: 'story.select', id: STORY_IDS[0] }, { type: 'story.favorite', id: STORY_IDS[0], favorite: true }, { type: 'story.position', id: STORY_IDS[0], position: 0.75 }, { type: 'note.create', text: '<b>user text</b>\nhttps://example.test' }, { type: 'note.update', id: noteId, text: 'changed' }, { type: 'note.pin', id: noteId, pinned: true }, { type: 'note.archive', id: noteId, archived: false }, { type: 'note.delete', id: noteId }];
  for (const command of commands) {
    assert.deepEqual(validateDeskCommand(command), command);
    for (const extra of [{ url: 'https://evil.test' }, { route: '/api/shutdown' }, { token: 'private' }, { reason: 'sleep' }]) assert.equal(validateDeskCommand({ ...command, ...extra }), null);
  }
  for (const value of [null, [], { type: 'focus.suspend', reason: 'sleep' }, { type: 'focus.configure', focusMinutes: 9, breakMinutes: 5 }, { type: 'focus.configure', focusMinutes: 120.5, breakMinutes: 5 }, { type: 'focus.configure', focusMinutes: 25, breakMinutes: 31 }, { type: 'focus.start', phase: 'automatic' }, { type: 'story.select', id: 'arbitrary-story' }, { type: 'story.position', id: STORY_IDS[0], position: NaN }, { type: 'story.position', id: STORY_IDS[0], position: 1.001 }, { type: 'note.create', text: ' ' }, { type: 'note.create', text: 'x'.repeat(1001) }, { type: 'note.create', text: 'nul\0text' }, { type: 'note.update', id: '../file', text: 'x' }, { type: 'note.pin', id: noteId, pinned: 1 }, { type: 'fetch', url: 'https://evil.test' }]) assert.equal(validateDeskCommand(value), null);
  assert.deepEqual(validateDeskCommand({ type: 'focus.configure', focusMinutes: 10, breakMinutes: 1 }), { type: 'focus.configure', focusMinutes: 10, breakMinutes: 1 });
  assert.deepEqual(validateDeskCommand({ type: 'focus.configure', focusMinutes: 120, breakMinutes: 30 }), { type: 'focus.configure', focusMinutes: 120, breakMinutes: 30 });
});

function deskSnapshot() { return { focus: { phase: 'focus', status: 'idle', focusMinutes: 25, breakMinutes: 5, remainingMs: 1500000, endsAt: null }, journal: { selectedId: STORY_IDS[0], positionById: { [STORY_IDS[0]]: 0.4 }, entries: STORIES.map(story => ({ ...story, favorite: false, read: false })) }, notes: [{ id: noteId, text: '<script>plain text</script>', pinned: true, archived: false, createdAt: 1000, updatedAt: 2000 }] }; }

test('desk snapshot drops credentials, paths, URLs and arbitrary objects while retaining bounded local content', () => {
  const original = deskSnapshot(); original.token = 'PRIVATE-TOKEN'; original.path = 'PRIVATE-PATH'; original.focus.lockId = 'PRIVATE-LOCK'; original.journal.originalArtist = { url: 'PRIVATE-URL' }; original.notes[0].private = 'PRIVATE-FIELD';
  const result = sanitizeDeskSnapshot(original, { language: 'en', token: 'PRIVATE-PREFERENCE' }, 'journal');
  assert.equal(result.ok, true); assert.equal(result.language, 'en'); assert.equal(result.activeTab, 'journal'); assert.equal(result.journal.positionById[STORY_IDS[0]], 0.4);
  assert.equal(result.notes[0].text, '<script>plain text</script>'); assert.equal(result.journal.entries.length, 6);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-'));
  original.journal.entries.push({ id: 'evil', title: { en: 'evil' }, body: { en: 'evil' } });
  assert.equal(sanitizeDeskSnapshot(original).journal.entries.length, 6);
  assert.equal(sanitizeDeskSnapshot({ focus: { endsAt: Infinity, remainingMs: NaN }, notes: [{ id: 'bad', text: 'bad' }] }).notes.length, 0);
});

test('desk failed storage replies remain unavailable instead of inventing empty local data', () => {
  for (const failed of [{ ok: false, error: 'desk-storage-unavailable' }, { ok: false, reason: 'PRIVATE-PATH', notes: [{ text: 'PRIVATE-NOTE' }] }]) {
    assert.deepEqual(sanitizeDeskSnapshot(failed, { language: 'en' }), { ok: false, error: 'desk-unavailable', language: 'en' });
  }
});

test('desk geometry clamps tiny and negative-origin displays without changing the pet bounds', () => {
  for (const scale of [1, 1.5, 2]) for (const area of [{ x: -1920, y: -100, width: 1920, height: 1040 }, { x: 0, y: 0, width: 320, height: 240 }]) {
    const anchor = { x: area.x + area.width - 80, y: area.y, width: 80, height: 200 }; const before = { ...anchor };
    for (const previous of [undefined, { x: 10000, y: -10000, width: 900, height: 900 }]) { const b = deskBounds(anchor, area, scale, previous); assert.ok(b.x >= area.x && b.y >= area.y); assert.ok(b.x + b.width <= area.x + area.width); assert.ok(b.y + b.height <= area.y + area.height); }
    assert.deepEqual(anchor, before);
  }
});

function nativeFixture({ loadFile } = {}) {
  const windows = [], requests = [], ipcMain = new EventEmitter(); ipcMain.handlers = new Map(); ipcMain.handle = (name, fn) => ipcMain.handlers.set(name, fn); ipcMain.removeHandler = name => ipcMain.handlers.delete(name);
  class Window extends EventEmitter {
    constructor(options = {}) { super(); this.options = options; this.bounds = { x: 600, y: 500, width: 180, height: 250, ...options }; this.dead = false; this.sent = []; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'file:///pet.html' }; this.webContents.send = (...args) => this.sent.push(args); this.webContents.setWindowOpenHandler = handler => { this.popup = handler; }; this.webContents.setZoomFactor = value => { this.zoom = value; }; windows.push(this); }
    static fromWebContents(contents) { return windows.find(win => win.webContents === contents); }
    isDestroyed() { return this.dead; } getBounds() { return this.bounds; } setBounds(value) { this.bounds = value; }
    destroy() { this.dead = true; this.emit('closed'); } show() { this.shown = true; } focus() { this.focused = true; }
    async loadFile(file) { this.webContents.mainFrame.url = pathToFileURL(file).href; if (loadFile) await loadFile(this, file); this.webContents.emit('did-finish-load'); }
  }
  const owner = new Window(); let available = [];
  const client = { settingsUrl() { return 'http://127.0.0.1:9999/#SECRET'; }, async request(route, body) { requests.push({ route, body }); if (route === '/api/desk') return deskSnapshot(); if (route === '/api/preferences') return { language: 'en', ambientEnabled: true, ambientFrequency: 'normal' }; if (route === '/api/state') return { status: { state: 'working' }, control: {}, availableAnimations: available }; return {}; } };
  const options = { BrowserWindow: Window, ipcMain, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) }, client, isPetWindow: win => win === owner, shell: { openExternal: async () => {} } };
  return { ...options, owner, windows, requests, setAvailable: value => { available = value; } };
}
const eventFor = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('a committed desk mutation remains successful when its later language request disconnects', async () => {
  const f = nativeFixture(), original = f.client.request;
  let preferencesOffline = false, writes = 0;
  f.client.request = async (route, body) => {
    if (route === '/api/preferences' && preferencesOffline) throw Error('offline');
    if (route === '/api/desk' && body) writes++;
    return original(route, body);
  };
  const controller = createDeskController(f);
  await controller.open(f.owner, { tab: 'notes' });
  assert.equal((await controller.snapshot()).language, 'en');
  preferencesOffline = true;
  const result = await f.ipcMain.handlers.get('shuangling-desk:command')(eventFor(controller.window), { type: 'note.create', text: 'A saved note' });
  assert.equal(result.ok, true); assert.equal(result.language, 'en'); assert.equal(writes, 1);
  controller.destroy();
});

test('a cold failed desk read retains independently available language without exposing storage content', async () => {
  for (const language of ['zh-CN', 'zh-TW', 'en']) for (const failedBy of ['reply', 'rejection']) {
    const f = nativeFixture();
    f.client.request = async route => {
      if (route === '/api/preferences') return { language, path: 'PRIVATE-PREFERENCE' };
      if (failedBy === 'rejection') throw Error('PRIVATE-PATH');
      return { ok: false, error: 'PRIVATE-PATH', notes: [{ text: 'PRIVATE-NOTE' }] };
    };
    const controller = createDeskController(f);
    const result = await controller.snapshot();
    assert.deepEqual(result, { ok: false, error: failedBy === 'reply' ? 'desk-unavailable' : 'connection-unavailable', language });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-/);
    controller.destroy();
  }
});

test('desk snapshots retain last trusted language when preferences disconnect without discarding readable content', async () => {
  const f = nativeFixture(), original = f.client.request;
  const controller = createDeskController(f);
  assert.equal((await controller.snapshot()).language, 'en');
  f.client.request = async (route, body) => {
    if (route === '/api/preferences') throw Error('PRIVATE-PREFERENCE');
    return original(route, body);
  };
  const readable = await controller.snapshot();
  assert.equal(readable.ok, true); assert.equal(readable.language, 'en');
  assert.equal(readable.notes[0].id, noteId);
  f.client.request = async () => { throw Error('PRIVATE-PATH'); };
  assert.deepEqual(await controller.snapshot(), { ok: false, error: 'connection-unavailable', language: 'en' });
  controller.destroy();
});

test('a cold desk open delivers its requested page before showing without waiting for backend data', async () => {
  for (const tab of TABS) {
    const f = nativeFixture(), controller = createDeskController(f);
    await controller.open(f.owner, { tab });
    assert.deepEqual(controller.window.sent.at(-1), ['shuangling-desk:tab', tab]);
    assert.equal(controller.window.shown, true);
    assert.equal(f.requests.length, 0);
    controller.destroy();
  }
});

test('rapid opens during cold load share one pending window and reveal only the latest page after load', async () => {
  const gate = deferred(), f = nativeFixture({ loadFile: () => gate.promise }), controller = createDeskController(f);
  const first = controller.open(f.owner, { tab: 'focus' }), win = controller.window;
  const next = controller.open(f.owner, { tab: 'journal' });
  const last = controller.open(f.owner, { tab: 'notes' });
  assert.equal(f.windows.length, 2);
  assert.equal(win.shown, undefined);
  assert.deepEqual(win.sent, []);
  let settled = false; next.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, next, last]), [{ ok: true }, { ok: true }, { ok: true }]);
  assert.deepEqual(win.sent, [['shuangling-desk:tab', 'notes']]);
  assert.equal(win.shown, true);
  controller.destroy();
});

test('an owner closing during load prevents an orphan and does not block a new owner opening', async () => {
  const oldGate = deferred(), newGate = deferred(); let loads = 0;
  const f = nativeFixture({ loadFile: () => (++loads === 1 ? oldGate.promise : newGate.promise) }), controller = createDeskController(f);
  const first = controller.open(f.owner, { tab: 'journal' }), old = controller.window;
  f.owner.destroy();
  assert.equal(old.isDestroyed(), true); assert.equal(controller.window, null);
  const replacementOwner = new f.BrowserWindow();
  const replacement = controller.open(replacementOwner, { tab: 'notes' }), next = controller.window;
  oldGate.resolve(); assert.equal((await first).ok, false);
  assert.equal(controller.window, next); assert.equal(next.shown, undefined);
  newGate.resolve(); assert.equal((await replacement).ok, true);
  assert.deepEqual(next.sent.at(-1), ['shuangling-desk:tab', 'notes']);
  assert.equal(f.owner.listenerCount('closed'), 0);
  controller.destroy(); assert.equal(replacementOwner.listenerCount('closed'), 0);
});

test('closing or failing a cold load allows one clean retry and stale failure cannot destroy its replacement', async () => {
  const stale = deferred(); let loads = 0, errors = 0;
  const f = nativeFixture({ loadFile: () => ++loads === 1 ? stale.promise : loads === 2 ? Promise.reject(Error('load-failed')) : undefined });
  const controller = createDeskController({ ...f, onError() { errors++; } });
  const first = controller.open(f.owner, { tab: 'focus' }); controller.close();
  const failedAttempt = controller.open(f.owner, { tab: 'journal' });
  assert.notEqual(controller.window, null, 'a canceled open must not keep the next open waiting on its old load');
  assert.equal((await failedAttempt).ok, false);
  assert.equal(errors, 1); assert.equal(controller.window, null);
  const result = await controller.open(f.owner, { tab: 'notes' }), replacement = controller.window;
  assert.equal(result.ok, true); assert.equal(replacement.shown, true);
  stale.reject(Error('stale-load-failed')); assert.equal((await first).ok, false);
  assert.equal(controller.window, replacement); assert.equal(errors, 1);
  controller.destroy();
});

test('desk is a singleton independent window with fixed IPC, isolated preload, and no focus or pet side effects', async () => {
  const f = nativeFixture(), controller = createDeskController(f), before = { ...f.owner.bounds };
  await controller.open(f.owner, { tab: 'journal' }); const win = controller.window;
  assert.equal(win.options.webPreferences.sandbox, true); assert.equal(win.options.webPreferences.nodeIntegration, false); assert.equal(win.options.webPreferences.contextIsolation, true); assert.equal(win.options.skipTaskbar, false); assert.equal(win.options.parent, undefined);
  assert.deepEqual(win.popup(), { action: 'deny' }); let blocked = 0; win.webContents.emit('will-navigate', { preventDefault: () => blocked++ }); win.webContents.emit('will-attach-webview', { preventDefault: () => blocked++ }); assert.equal(blocked, 2);
  win.emit('blur'); assert.equal(controller.window, win);
  let preventedClose = false; win.emit('close', { preventDefault() { preventedClose = true; } }); assert.equal(preventedClose, true); assert.deepEqual(win.sent.at(-1), ['shuangling-desk:request-close']);
  await controller.open(f.owner, { tab: 'notes' }); assert.equal(controller.window, win); assert.equal(f.windows.length, 2); assert.deepEqual(win.sent.at(-1), ['shuangling-desk:tab', 'notes']);
  const snapshot = await f.ipcMain.handlers.get('shuangling-desk:snapshot')(eventFor(win)); assert.equal(snapshot.activeTab, 'notes'); assert.equal(snapshot.language, 'en');
  const unauthorized = await f.ipcMain.handlers.get('shuangling-desk:command')(eventFor(f.owner), { type: 'note.delete', id: noteId }); assert.equal(unauthorized.error, 'unauthorized');
  const subframe = { sender: win.webContents, senderFrame: { url: win.webContents.mainFrame.url } }; assert.equal((await f.ipcMain.handlers.get('shuangling-desk:snapshot')(subframe)).error, 'unauthorized');
  const beforeRequests = f.requests.length;
  assert.equal((await f.ipcMain.handlers.get('shuangling-desk:command')(eventFor(win), { type: 'note.delete', id: noteId, url: 'https://evil.test' })).error, 'invalid-command'); assert.equal(f.requests.length, beforeRequests);
  await f.ipcMain.handlers.get('shuangling-desk:command')(eventFor(win), { type: 'note.create', text: 'local note' }); assert.deepEqual(f.requests.at(-2), { route: '/api/desk', body: { type: 'note.create', text: 'local note' } });
  f.ipcMain.emit('shuangling-desk:close', eventFor(f.owner)); assert.equal(controller.window, win);
  f.ipcMain.emit('shuangling-desk:close', eventFor(win)); assert.equal(controller.window, null); assert.deepEqual(f.owner.bounds, before); assert.deepEqual(f.owner.sent, []);
  assert.ok(!f.requests.some(request => ['/api/settings', '/api/shutdown'].includes(request.route)));
  controller.destroy(); assert.equal(f.ipcMain.handlers.size, 0); assert.equal(f.ipcMain.listenerCount('shuangling-desk:close'), 0);
});

test('desk snapshot and command report backend storage failure and recover on a later valid reply', async () => {
  const f = nativeFixture(), originalRequest = f.client.request;
  let failed = true;
  f.client.request = async (route, body) => route === '/api/desk' && failed
    ? { ok: false, error: 'desk-storage-unavailable', path: 'PRIVATE-PATH' }
    : originalRequest(route, body);
  const controller = createDeskController(f);
  await controller.open(f.owner);
  const event = eventFor(controller.window);
  const snapshot = () => f.ipcMain.handlers.get('shuangling-desk:snapshot')(event);
  const command = () => f.ipcMain.handlers.get('shuangling-desk:command')(event, { type: 'note.create', text: 'manual note' });
  assert.deepEqual(await snapshot(), { ok: false, error: 'desk-unavailable', language: 'en' });
  assert.deepEqual(await command(), { ok: false, error: 'desk-unavailable', language: 'en' });
  failed = false;
  const restored = await snapshot();
  assert.equal(restored.ok, true); assert.equal(restored.notes[0].id, noteId); assert.equal(restored.journal.entries.length, 6);
  assert.equal((await command()).ok, true);
  assert.deepEqual(f.owner.sent, []);
  controller.destroy();
});

test('panel tool shortcut releases its info interaction before opening desk and does not pause task following', async () => {
  const f = nativeFixture(), controller = createPanelController(f); await controller.open(f.owner); const panel = controller.window;
  const result = await f.ipcMain.handlers.get('shuangling-panel:command')(eventFor(panel), { type: 'desk', tab: 'focus' });
  assert.equal(result.ok, true); assert.equal(controller.window, null); assert.ok(controller.desk.window); assert.equal(f.owner.sent.at(-1)[1].kind, 'closed'); assert.equal(f.owner.sent.at(-1)[1].reason, 'desk');
  assert.ok(!f.requests.some(request => request.route === '/api/settings'));
  const sent = f.owner.sent.length; controller.desk.close(); assert.equal(f.owner.sent.length, sent);
  controller.destroy(); assert.equal(f.ipcMain.handlers.size, 0);
});

test('panel optional animations are disabled and rejected until the runtime advertises their files', async () => {
  const f = nativeFixture(), controller = createPanelController(f);
  for (const name of ['reading', 'looking-around', 'stretching-wings']) {
    assert.equal(animationAvailable(name, {}), false); assert.equal(animationAvailable(name, { availableAnimations: [name] }), true);
    await controller.open(f.owner); const panel = controller.window;
    const denied = await f.ipcMain.handlers.get('shuangling-panel:command')(eventFor(panel), { type: 'animation', name }); assert.equal(denied.error, 'animation-unavailable'); assert.equal(controller.window, panel);
    f.setAvailable([name]); await f.ipcMain.handlers.get('shuangling-panel:command')(eventFor(panel), { type: 'animation', name }); assert.equal(controller.window, null); assert.equal(f.owner.sent.at(-2)[1].command.name, name); f.setAvailable([]);
  }
  assert.equal(animationAvailable('idle', {}), true); assert.equal(animationAvailable('arbitrary', { availableAnimations: ['arbitrary'] }), false);
  assert.deepEqual(sanitizeSnapshot({ state: { availableAnimations: ['reading', 'reading', 'evil'] } }).availableAnimations, ['reading']); controller.destroy();
});

test('new action labels match the approved names without changing animation identifiers', () => {
  const html = source('panel.html');
  for (const [name, key, traditional, english] of [['reading', '翻看见闻', '翻看見聞', 'Read journal'], ['looking-around', '侧望微光', '側望微光', 'Glance at light'], ['stretching-wings', '轻舒双翼', '輕舒雙翼', 'Stretch wings']]) {
    assert.match(html, new RegExp(`data-animation="${name}"[^>]*>[\\s\\S]*?data-i18n="${key}"`));
    assert.equal(i18n.dictionaries['zh-CN'][key], key); assert.equal(i18n.dictionaries['zh-TW'][key], traditional); assert.equal(i18n.dictionaries.en[key], english);
  }
});

test('an eleven-asset release keeps the reading slot disabled and labels available versus total in three languages', async () => {
  const availableAnimations = ANIMATIONS.filter(name => name !== 'reading');
  const snapshot = { availableAnimations };
  assert.equal(ANIMATIONS.length, 12);
  assert.equal(ANIMATIONS.filter(name => animationAvailable(name, snapshot)).length, 11);
  assert.equal(animationAvailable('reading', snapshot), false);
  for (const [language, expected, pending] of [['zh-CN', '11 / 12 可用', '素材待完善'], ['zh-TW', '11 / 12 可用', '素材待完善'], ['en', '11 / 12 available', 'Animation needs refinement']]) {
    i18n.setLanguage(language);
    assert.equal(i18n.t('{count} / {total} 可用', { count: 11, total: ANIMATIONS.length }), expected);
    assert.equal(i18n.t('素材待完善'), pending);
  }
  const f = nativeFixture(), controller = createPanelController(f); f.setAvailable(availableAnimations);
  await controller.open(f.owner); const win = controller.window;
  assert.equal((await f.ipcMain.handlers.get('shuangling-panel:command')(eventFor(win), { type: 'animation', name: 'reading' })).error, 'animation-unavailable');
  assert.equal(controller.window, win); assert.ok(!f.owner.sent.some(([, value]) => value.command?.name === 'reading'));
  controller.destroy();
});

test('ambient controls keep the three enum values on the fixed preferences route', async () => {
  const f = nativeFixture(), controller = createPanelController(f); await controller.open(f.owner); const win = controller.window;
  for (const frequency of ['quiet', 'normal', 'lively']) { const value = { type: 'ambient', enabled: true, frequency }; assert.deepEqual(validateCommand(value), value); await f.ipcMain.handlers.get('shuangling-panel:command')(eventFor(win), value); assert.deepEqual(f.requests.at(-1), { route: '/api/preferences', body: { ambientEnabled: true, ambientFrequency: frequency } }); }
  for (const value of [{ type: 'ambient', enabled: 1, frequency: 'quiet' }, { type: 'ambient', enabled: true, frequency: 'high' }, { type: 'ambient', enabled: true, frequency: 'normal', url: 'https://evil.test' }, { type: 'desk', tab: 'remote' }]) assert.equal(validateCommand(value), null);
  controller.destroy();
});

test('focus presentation uses a real deadline, preserves pause time, and never starts the next phase', () => {
  const now = 1800000000000;
  const running = { status: 'running', phase: 'focus', focusMinutes: 25, breakMinutes: 5, endsAt: now + 90_001, remainingMs: 1500000 };
  assert.equal(presentFocus(running, now).clock, '01:31'); assert.equal(presentFocus(running, now).canConfigure, false);
  assert.equal(presentFocus(running, now + 100_000).clock, '00:00'); assert.equal(presentFocus(running, now + 100_000).canStart, false);
  const paused = presentFocus({ ...running, status: 'paused', remainingMs: 90_001, endsAt: null, pauseReason: 'sleep' }, now + 500_000); assert.equal(paused.clock, '01:31'); assert.equal(paused.canResume, true); assert.equal(paused.canStart, false);
  const completed = presentFocus({ ...running, status: 'completed', remainingMs: 0, endsAt: null }, now); assert.equal(completed.canStart, true); assert.equal(completed.phase, 'focus'); assert.equal(completed.canPause, false);
});

test('bookmarks filter archives and sort pinned first without altering their plain text or source order', () => {
  const notes = [{ id: 'a', text: '<img onerror=bad>', pinned: false, archived: false, updatedAt: 2000 }, { id: 'b', text: 'https://example.test', pinned: true, archived: false, updatedAt: 1000 }, { id: 'c', text: 'archived', pinned: true, archived: true, updatedAt: 3000 }]; const before = JSON.stringify(notes);
  assert.deepEqual(visibleNotes(notes).map(note => note.id), ['b', 'a']); assert.deepEqual(visibleNotes(notes, true).map(note => note.id), ['c']); assert.equal(JSON.stringify(notes), before);
});

test('desk has complete three-language static strings and permits no HTML or network rendering', () => {
  const html = source('desk.html'), script = source('desk.js');
  const keys = new Set([...html.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)].map(match => match[1]));
  for (const match of script.matchAll(/\bt\('([^']*)'/g)) keys.add(match[1]);
  for (const key of keys) for (const language of i18n.languages) assert.equal(typeof i18n.dictionaries[language][key], 'string', `${language}: ${key}`);
  assert.match(html, /connect-src 'none'/); assert.match(html, /form-action 'none'/); assert.doesNotMatch(html, /https?:\/\/|<webview|<iframe|\son\w+=/); assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|\bfetch\(|XMLHttpRequest|window\.open|location\s*=/);
  assert.match(script, /story\.position/); assert.match(script, /setTimeout\(flushPosition, 500\)/); assert.match(script, /text\.textContent = note\.text/); assert.match(script, /\$\('story-body'\)\.textContent/);
});

test('desk preload exposes only fixed calls and validates enum-only tab notifications with cleanup', () => {
  let api; const listeners = new Map(), invocations = [], sends = [];
  vm.runInNewContext(source('desk-preload.cjs'), { require(name) { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'shuanglingDesk'); api = value; } }, ipcRenderer: { invoke(...args) { invocations.push(args); }, send(...args) { sends.push(args); }, on(name, handler) { listeners.set(name, handler); }, removeListener(name, handler) { assert.equal(listeners.get(name), handler); listeners.delete(name); } } }; } });
  assert.deepEqual(Object.keys(api).sort(), ['close', 'command', 'onCloseRequest', 'onTab', 'snapshot']); api.snapshot(); api.command({ type: 'focus.pause' }); api.close(); assert.equal(invocations[0][0], 'shuangling-desk:snapshot'); assert.equal(invocations[1][0], 'shuangling-desk:command'); assert.equal(sends[0][0], 'shuangling-desk:close');
  const received = [], stop = api.onTab(value => received.push(value)); const callback = listeners.get('shuangling-desk:tab'); for (const value of [...TABS, 'http://evil.test', {}, null]) callback({}, value); assert.deepEqual(received, TABS); stop(); assert.equal(listeners.size, 0);
  let closeRequests = 0; const stopClose = api.onCloseRequest(() => closeRequests++); listeners.get('shuangling-desk:request-close')({}, { url: 'https://ignored.test' }); assert.equal(closeRequests, 1); stopClose(); assert.equal(listeners.size, 0);
});

function rendererFixture({ tab = 'focus', snapshotGate, failed = false } = {}) {
  const elements = new Map(), events = new Map(), timeouts = new Map(), commands = []; let closeCount = 0, tabListener, closeListener;
  let snapshot = { ...deskSnapshot(), ok: true, language: 'zh-CN', activeTab: tab };
  const document = { hidden: false, activeElement: null, documentElement: { lang: 'zh-CN' }, getElementById: id => elements.get(id), addEventListener(name, handler) { events.set(name, handler); }, querySelectorAll(selector) { return selector === '[data-tab]' ? [...elements.values()].filter(element => element.dataset.tab) : []; }, createElement(tag) { return element(tag); } };
  function element(tag = 'div') {
    return { tagName: tag, dataset: {}, attributes: {}, listeners: new Map(), children: [], value: '', hidden: false, textContent: '', scrollHeight: 1000, clientHeight: 200, scrollTop: 0,
      setAttribute(name, value) { this.attributes[name] = value; }, getAttribute(name) { return this.attributes[name]; }, append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; }, focus() { document.activeElement = this; }, addEventListener(name, handler) { this.listeners.set(name, handler); }, scrollIntoView() {}, reportValidity() { return true; },
      querySelector(selector) { const key = selector.match(/data-note-control="([^"]+)"/)?.[1]; const all = children => children.flatMap(child => [child, ...all(child.children || [])]); return all(this.children).find(child => child.dataset.noteControl === key) || null; },
    };
  }
  for (const match of source('desk.html').matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) { const el = element(match[1]); el.id = match[2]; el.hidden = /\shidden\b/.test(match[0]); el.value = match[0].match(/\bvalue="([^"]*)"/)?.[1] || ''; const dataTab = match[0].match(/data-tab="([^"]+)"/)?.[1]; if (dataTab) el.dataset.tab = dataTab; elements.set(el.id, el); }
  const api = { async snapshot() { const captured = structuredClone(snapshot); if (snapshotGate) await snapshotGate.promise; return failed ? { ok: false } : captured; }, async command(value) { commands.push(value); if (value.type === 'story.select') { snapshot.journal.selectedId = value.id; snapshot.journal.entries.find(entry => entry.id === value.id).read = true; } if (value.type === 'story.position') snapshot.journal.positionById[value.id] = value.position; return structuredClone(snapshot); }, close() { closeCount++; }, onTab(fn) { tabListener = fn; return () => { tabListener = null; }; }, onCloseRequest(fn) { closeListener = fn; return () => { closeListener = null; }; } };
  const context = vm.createContext({ document, shuanglingI18n: i18n, shuanglingDesk: api, requestAnimationFrame: fn => fn(), setInterval() { return 1; }, clearInterval() {}, setTimeout(fn, delay) { const id = timeouts.size + 1; timeouts.set(id, { fn, delay }); return id; }, clearTimeout(id) { timeouts.delete(id); }, addEventListener() {}, console });
  vm.runInContext(source('desk.js'), context);
  return { elements, events, commands, timeouts, api, get closeCount() { return closeCount; }, notifyClose: () => closeListener?.(), notifyTab: tab => tabListener?.(tab), async settle() { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); }, async click(id) { await elements.get(id).listeners.get('click')?.({ preventDefault() {} }); await this.settle(); } };
}

test('an explicit cold-open page survives an earlier snapshot and a temporary backend failure', async () => {
  for (const tab of ['journal', 'notes']) {
    const gate = deferred(), f = rendererFixture({ snapshotGate: gate });
    await new Promise(resolve => setImmediate(resolve));
    f.notifyTab(tab); assert.equal(f.elements.get(tab).hidden, false);
    gate.resolve(); await f.settle();
    assert.equal(f.elements.get(tab).hidden, false);
    assert.equal(f.elements.get('focus').hidden, true);
    const offline = rendererFixture({ failed: true }); offline.notifyTab(tab); await offline.settle();
    assert.equal(offline.elements.get(tab).hidden, false);
    assert.equal(offline.elements.get('connection').dataset.disconnected, 'true');
  }
});

test('a local tab click before the first snapshot is not overwritten by its older initial page', async () => {
  const gate = deferred(), f = rendererFixture({ snapshotGate: gate });
  await f.click('tab-notes'); gate.resolve(); await f.settle();
  assert.equal(f.elements.get('notes').hidden, false); assert.equal(f.elements.get('focus').hidden, true);
});

test('desk protects unfinished bookmarks on close and ignores Escape during Chinese input', async () => {
  const f = rendererFixture(); await f.settle(); f.elements.get('note-text').value = '我还没写完';
  let prevented = false; f.events.get('keydown')({ key: 'Escape', isComposing: true, preventDefault() { prevented = true; } }); await f.settle(); assert.equal(prevented, false); assert.equal(f.closeCount, 0); assert.equal(f.elements.get('close-guard').hidden, true);
  f.events.get('keydown')({ key: 'Escape', isComposing: false, preventDefault() {} }); assert.equal(f.elements.get('close-guard').hidden, false); assert.equal(f.closeCount, 0);
  await f.click('continue-edit'); assert.equal(f.elements.get('close-guard').hidden, true); assert.equal(f.elements.get('note-text').value, '我还没写完'); assert.equal(f.elements.get('notes').hidden, false);
  f.notifyClose(); assert.equal(f.elements.get('close-guard').hidden, false); await f.click('discard-close'); assert.equal(f.closeCount, 1);
});

test('journal restores saved scroll position after a hidden-tab load and debounces reading writes', async () => {
  const f = rendererFixture(); await f.settle(); const reader = f.elements.get('story-reader');
  assert.equal(reader.scrollTop, 0); await f.click('tab-journal'); assert.equal(reader.scrollTop, 320); assert.ok(f.commands.some(command => command.type === 'story.select' && command.id === STORY_IDS[0]));
  reader.scrollTop = 600; reader.listeners.get('scroll')(); reader.scrollTop = 640; reader.listeners.get('scroll')(); assert.equal(f.timeouts.size, 1); assert.equal([...f.timeouts.values()][0].delay, 500);
  [...f.timeouts.values()][0].fn(); await f.settle(); const positions = f.commands.filter(command => command.type === 'story.position'); assert.equal(positions.length, 1); assert.equal(positions[0].position, 0.8);
  assert.equal(f.elements.get('story-body').textContent, STORIES[0].body['zh-CN']);
});
