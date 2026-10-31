'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const TABS = Object.freeze(['focus', 'journal', 'notes']);
const CHANNELS = Object.freeze(['shuangling-desk:snapshot', 'shuangling-desk:command']);
const LANGUAGES = ['zh-CN', 'zh-TW', 'en'];
const STORY_IDS = Object.freeze(['name-under-the-chimes', 'the-rose-keepsake', 'bookmark-within-reach', 'space-for-tomorrow', 'window-light', 'first-travel-entry']);
const storyId = value => STORY_IDS.includes(value);
const id = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const dateKey = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number(value.slice(0, 4)) < 1970) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const memoryId = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,120}$/.test(value);
const intent = value => ['none', 'remember', 'continue'].includes(value);
const userText = (value, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
function boundedText(value, max) {
  if (typeof value !== 'string') return '';
  let end = Math.min(value.length, max);
  // Keep the existing UTF-16 budget without cutting an emoji or CJK pair.
  if (end > 0 && end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff &&
      value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) end--;
  return value.slice(0, end);
}

/** The renderer never chooses a route, method, path, capability or destination. */
function validateDeskCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const only = (fields, optional = []) => fields.every(key => Object.hasOwn(value, key)) && keys.every(key => fields.includes(key) || optional.includes(key));
  const { type } = value;
  if (['focus.pause', 'focus.resume', 'focus.stop'].includes(type) && only(['type'])) return { type };
  if (type === 'focus.configure' && only(['type', 'focusMinutes', 'breakMinutes']) && Number.isInteger(value.focusMinutes) && value.focusMinutes >= 10 && value.focusMinutes <= 120 && Number.isInteger(value.breakMinutes) && value.breakMinutes >= 1 && value.breakMinutes <= 30) return { type, focusMinutes: value.focusMinutes, breakMinutes: value.breakMinutes };
  if (type === 'focus.start' && only(['type', 'phase']) && ['focus', 'break'].includes(value.phase)) return { type, phase: value.phase };
  if (type === 'story.select' && only(['type', 'id']) && storyId(value.id)) return { type, id: value.id };
  if (type === 'story.favorite' && only(['type', 'id', 'favorite']) && storyId(value.id) && typeof value.favorite === 'boolean') return { type, id: value.id, favorite: value.favorite };
  if (type === 'story.position' && only(['type', 'id', 'position']) && storyId(value.id) && finite(value.position) && value.position >= 0 && value.position <= 1) return { type, id: value.id, position: value.position };
  if (['note.create', 'note.update'].includes(type) && only(type === 'note.create' ? ['type', 'text'] : ['type', 'id', 'text'], ['intent']) && (type === 'note.create' || id(value.id)) && userText(value.text) && (!Object.hasOwn(value, 'intent') || intent(value.intent))) return { type, ...(type === 'note.update' ? { id: value.id } : {}), text: value.text, ...(Object.hasOwn(value, 'intent') ? { intent: value.intent } : {}) };
  for (const [command, key] of [['note.pin', 'pinned'], ['note.archive', 'archived']]) if (type === command && only(['type', 'id', key]) && id(value.id) && typeof value[key] === 'boolean') return { type, id: value.id, [key]: value[key] };
  if (type === 'note.delete' && only(['type', 'id'], ['purgeMemories']) && id(value.id) && (!Object.hasOwn(value, 'purgeMemories') || typeof value.purgeMemories === 'boolean')) return { type, id: value.id, ...(Object.hasOwn(value, 'purgeMemories') ? { purgeMemories: value.purgeMemories } : {}) };
  if (type === 'note.intent' && only(['type', 'id', 'intent']) && id(value.id) && intent(value.intent)) return { type, id: value.id, intent: value.intent };
  if (type === 'memory.configure' && only(['type', 'enabled', 'reminders']) && typeof value.enabled === 'boolean' && typeof value.reminders === 'boolean') return { type, enabled: value.enabled, reminders: value.reminders };
  if (['memory.select', 'memory.delete'].includes(type) && only(['type', 'date']) && dateKey(value.date)) return { type, date: value.date };
  if (type === 'memory.reply' && only(['type', 'date', 'text']) && dateKey(value.date) && userText(value.text, true)) return { type, date: value.date, text: value.text };
  if (type === 'memory.edit' && only(['type', 'date', 'language', 'text']) && dateKey(value.date) && LANGUAGES.includes(value.language) && userText(value.text)) return { type, date: value.date, language: value.language, text: value.text };
  if (type === 'memory.exclude' && only(['type', 'date', 'factId']) && dateKey(value.date) && memoryId(value.factId)) return { type, date: value.date, factId: value.factId };
  if (type === 'memory.dismiss' && only(['type', 'id']) && memoryId(value.id)) return { type, id: value.id };
  if (type === 'memory.revisit' && only(['type', 'id', 'choice']) && id(value.id) && ['open', 'later', 'done'].includes(value.choice)) return { type, id: value.id, choice: value.choice };
  return null;
}

function sanitizeDeskSnapshot(desk, preferences, activeTab = 'focus') {
  const language = LANGUAGES.includes(preferences?.language) ? preferences.language : 'zh-CN';
  // A failed private-store read is unavailable, never a new empty journal.
  // Language is independently trusted; backend details and paths stay private.
  if (desk?.ok === false) return { ok: false, error: 'desk-unavailable', language };
  const focus = desk?.focus || {}, journal = desk?.journal || {};
  const text = boundedText;
  const translations = (value, max) => Object.fromEntries(LANGUAGES.map(language => [language, text(value?.[language], max)]));
  const entries = Array.isArray(journal.entries) ? journal.entries.filter(entry => storyId(entry?.id)).slice(0, 6).map(entry => ({ id: entry.id, title: translations(entry.title, 160), body: translations(entry.body, 16000), read: entry.read === true, favorite: entry.favorite === true })) : [];
  const positions = Object.fromEntries(entries.map(entry => [entry.id, finite(journal.positionById?.[entry.id]) ? Math.max(0, Math.min(1, journal.positionById[entry.id])) : 0]));
  const stamp = value => finite(value) ? value : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value.slice(0, 40) : null;
  return {
    ok: true, activeTab: TABS.includes(activeTab) ? activeTab : 'focus', language,
    focus: { phase: focus.phase === 'break' ? 'break' : 'focus', status: ['idle', 'running', 'paused', 'completed'].includes(focus.status) ? focus.status : 'idle', focusMinutes: Number.isInteger(focus.focusMinutes) && focus.focusMinutes >= 10 && focus.focusMinutes <= 120 ? focus.focusMinutes : 25, breakMinutes: Number.isInteger(focus.breakMinutes) && focus.breakMinutes >= 1 && focus.breakMinutes <= 30 ? focus.breakMinutes : 5, remainingMs: finite(focus.remainingMs) && focus.remainingMs >= 0 ? Math.min(focus.remainingMs, 120 * 60000) : 25 * 60000, endsAt: stamp(focus.endsAt), pauseReason: ['sleep', 'app-exit', 'manual'].includes(focus.pauseReason) ? focus.pauseReason : null },
    journal: { selectedId: entries.some(entry => entry.id === journal.selectedId) ? journal.selectedId : entries[0]?.id ?? null, entries, positionById: positions },
    notes: Array.isArray(desk?.notes) ? desk.notes.filter(note => id(note?.id)).slice(0, 100).map(note => ({ id: note.id, text: text(note.text, 1000), pinned: note.pinned === true, archived: note.archived === true, createdAt: stamp(note.createdAt), updatedAt: stamp(note.updatedAt), intent: intent(note.intent) ? note.intent : 'none', resolved: note.resolved === true })) : [],
    ...(desk?.memories && typeof desk.memories === 'object' && !Array.isArray(desk.memories) ? { memories: sanitizeMemories(desk.memories, { text, translations }) } : {}),
  };
}

function sanitizeMemories(value, { text, translations }) {
  const count = n => Number.isSafeInteger(n) && n > 0 && n <= 1000000;
  const validFact = fact => memoryId(fact?.id) && (
    fact.kind === 'bookmark' && id(fact.noteId) && typeof fact.text === 'string' ||
    fact.kind === 'reply' && dateKey(fact.sourceDate) && typeof fact.text === 'string' ||
    fact.kind === 'focus' && count(fact.minutes) && count(fact.count) ||
    fact.kind === 'round' && count(fact.count));
  const entries = Array.isArray(value.entries) ? value.entries.filter(entry => dateKey(entry?.date)).slice(0, 365).map(entry => ({
    date: entry.date, title: translations(entry.title, 160), body: translations(entry.body, 4000), reply: text(entry.reply, 1000), read: entry.read === true,
    updatedAt: Number.isSafeInteger(entry.updatedAt) && entry.updatedAt >= 0 ? entry.updatedAt : null,
    facts: Array.isArray(entry.facts) ? entry.facts.filter(validFact).slice(0, 8).map(fact => ({
      id: fact.id, kind: fact.kind,
      ...(id(fact.noteId) ? { noteId: fact.noteId } : {}), ...(dateKey(fact.sourceDate) ? { sourceDate: fact.sourceDate } : {}),
      ...(typeof fact.text === 'string' ? { text: text(fact.text, 240) } : {}),
      ...(['saved', 'revisited', 'resolved'].includes(fact.action) ? { action: fact.action } : {}),
      ...(count(fact.minutes) ? { minutes: fact.minutes } : {}),
      ...(count(fact.count) ? { count: fact.count } : {}),
    })) : [],
  })) : [];
  const p = value.prompt;
  const prompt = p && memoryId(p.id) && ((p.kind === 'daily' && dateKey(p.date) && entries.some(entry => entry.date === p.date)) || (p.kind === 'continue' && id(p.noteId)))
    ? { id: p.id, kind: p.kind, ...(p.kind === 'daily' ? { date: p.date } : { noteId: p.noteId }) } : null;
  return { enabled: value.enabled === true, reminders: value.reminders === true, limitReached: value.limitReached === true, since: Number.isSafeInteger(value.since) && value.since >= 0 ? value.since : null,
    selectedDate: entries.some(entry => entry.date === value.selectedDate) ? value.selectedDate : entries[0]?.date ?? null, entries, prompt };
}

function deskBounds(anchor, area, scale = 1, previous) {
  const s = finite(scale) && scale > 0 ? scale : 1;
  const inset = Math.min(12, Math.max(0, Math.floor(Math.min(area.width, area.height) / 20)));
  const width = Math.min(Math.round(640 * s), Math.max(1, area.width - inset * 2));
  const height = Math.min(Math.round(600 * s), Math.max(1, area.height - inset * 2));
  const w = previous && finite(previous.width) ? Math.min(previous.width, area.width - inset * 2) : width;
  const h = previous && finite(previous.height) ? Math.min(previous.height, area.height - inset * 2) : height;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
  return { x: clamp(previous?.x ?? anchor.x + anchor.width / 2 - w / 2, area.x + inset, area.x + area.width - inset - w), y: clamp(previous?.y ?? anchor.y + anchor.height / 2 - h / 2, area.y + inset, area.y + area.height - inset - h), width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

function createDeskController({ BrowserWindow, ipcMain, screen, client, getScale = () => 1, onError = () => {}, directory = __dirname }) {
  const url = pathToFileURL(path.join(directory, 'desk.html')).href;
  let win = null, activeTab = 'focus', previous = null, closed = false, opening = null, ownerCleanup = null, currentOwner = null;
  let lastLanguage = 'zh-CN';
  const authorized = event => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame?.url === url;
  async function snapshot() {
    try {
      const [desk, preferences] = await Promise.allSettled([client.request('/api/desk'), client.request('/api/preferences')]);
      if (preferences.status === 'fulfilled' && LANGUAGES.includes(preferences.value?.language)) lastLanguage = preferences.value.language;
      if (desk.status === 'rejected') return { ok: false, error: 'connection-unavailable', language: lastLanguage };
      return sanitizeDeskSnapshot(desk.value, { language: lastLanguage }, activeTab);
    } catch { return { ok: false, error: 'connection-unavailable', language: lastLanguage }; }
  }
  function close() {
    const old = win; win = null; opening = null;
    ownerCleanup?.(); ownerCleanup = null; currentOwner = null;
    if (old && !old.isDestroyed()) { previous = old.getBounds(); old.destroy(); }
  }
  function watchOwner(owner, created) {
    if (owner === currentOwner) return;
    ownerCleanup?.(); currentOwner = owner;
    const onClosed = () => { if (win === created) close(); };
    owner.once('closed', onClosed);
    ownerCleanup = () => owner.removeListener('closed', onClosed);
  }
  async function reveal(created, allowed = () => true) {
    let interrupted = false;
    const onBlur = () => { interrupted = true; };
    const current = () => !closed && win === created && !created.isDestroyed() && currentOwner && !currentOwner.isDestroyed() && !interrupted && allowed();
    created.on('blur', onBlur);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!current()) return false;
        created.show();
        if (created.isVisible()) {
          if (!current()) return false;
          created.focus();
          return true;
        }
        // Windows hidden startup can suppress the first ShowWindow call even
        // though focus succeeds. Retry once from a fresh event turn, using the
        // visibility receipt rather than requiring a second user click.
        if (attempt === 0) await new Promise(resolve => setImmediate(resolve));
      }
      return false;
    } finally { created.removeListener('blur', onBlur); }
  }
  async function open(owner, options = {}) {
    if (closed || !owner || owner.isDestroyed()) return { ok: false, error: 'owner-unavailable' };
    activeTab = TABS.includes(options.tab) ? options.tab : 'focus';
    if (win && !win.isDestroyed()) {
      watchOwner(owner, win);
      // A cold renderer cannot receive tab events yet. Keep the latest intent
      // and reveal it once loadFile has completed instead of showing a blank.
      if (opening) { opening.canReveal = typeof options.canReveal === 'function' ? options.canReveal : () => true; return opening.promise; }
      const existing = win;
      existing.webContents.send('shuangling-desk:tab', activeTab);
      if (await reveal(existing, typeof options.canReveal === 'function' ? options.canReveal : undefined)) return { ok: true };
      if (win === existing) close();
      return { ok: false, error: 'desk-unavailable' };
    }
    const attempt = { promise: null, canReveal: typeof options.canReveal === 'function' ? options.canReveal : () => true }; opening = attempt;
    let created;
    attempt.promise = (async () => {
      try {
      const anchor = owner.getBounds(), display = screen.getDisplayMatching(previous ?? anchor), scale = getScale(display);
      const bounds = deskBounds(anchor, display.workArea, scale, previous);
      created = new BrowserWindow({ ...bounds, minWidth: Math.min(bounds.width, Math.round(380 * scale)), minHeight: Math.min(bounds.height, Math.round(390 * scale)), useContentSize: true, title: '霜铃 GPT', frame: false, backgroundColor: '#f9f7fc', resizable: true, minimizable: false, maximizable: false, fullscreenable: false, show: false, hasShadow: true, skipTaskbar: false, webPreferences: { preload: path.join(directory, 'desk-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: false } });
      win = created;
      watchOwner(owner, created);
      created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      created.webContents.on('will-navigate', event => event.preventDefault());
      created.webContents.on('will-attach-webview', event => event.preventDefault());
      created.webContents.on('did-finish-load', () => created.webContents.setZoomFactor(scale));
      created.webContents.on('render-process-gone', () => { if (win === created) close(); });
      // Alt+F4 follows the same draft guard as the in-page close button. Main
      // process teardown uses destroy(), which does not re-enter this handler.
      created.on('close', event => { if (win === created) { event.preventDefault(); created.webContents.send('shuangling-desk:request-close'); } });
      created.on('closed', () => { if (win === created) close(); });
        await created.loadFile(path.join(directory, 'desk.html'));
        if (closed || win !== created || created.isDestroyed() || currentOwner?.isDestroyed()) return { ok: false };
        // This also chooses the right offline page if the first data request
        // fails. Renderer navigation must not depend on a backend round trip.
        created.webContents.send('shuangling-desk:tab', activeTab);
        if (await reveal(created, () => attempt.canReveal())) return { ok: true };
        if (win === created) close();
        return { ok: false, error: 'desk-unavailable' };
      } catch {
        if (opening === attempt && (!created || win === created)) { close(); onError('desk-unavailable'); return { ok: false, error: 'desk-unavailable' }; }
        return { ok: false };
      }
    })().finally(() => { if (opening === attempt) opening = null; });
    return attempt.promise;
  }
  async function command(value) {
    const command = validateDeskCommand(value);
    if (!command) return { ok: false, error: 'invalid-command' };
    try {
      const desk = await client.request('/api/desk', command);
      // A saved edit stays successful even if the independent language read
      // disconnects afterwards. Retain the last known interface language.
      try { const preferences = await client.request('/api/preferences'); if (LANGUAGES.includes(preferences?.language)) lastLanguage = preferences.language; } catch { /* saved result is authoritative */ }
      return sanitizeDeskSnapshot(desk, { language: lastLanguage }, activeTab);
    } catch { return { ok: false, error: 'operation-unavailable' }; }
  }
  const closeHandler = event => { if (authorized(event)) close(); };
  ipcMain.handle(CHANNELS[0], event => authorized(event) ? snapshot() : { ok: false, error: 'unauthorized' });
  ipcMain.handle(CHANNELS[1], (event, value) => authorized(event) ? command(value) : { ok: false, error: 'unauthorized' });
  ipcMain.on('shuangling-desk:close', closeHandler);
  return { open, close, snapshot,
    reposition() { if (win && !win.isDestroyed()) { const b = win.getBounds(), display = screen.getDisplayMatching(b); win.setBounds(deskBounds(b, display.workArea, getScale(display), b)); } },
    destroy() { closed = true; close(); for (const channel of CHANNELS) ipcMain.removeHandler(channel); ipcMain.removeListener('shuangling-desk:close', closeHandler); },
    get window() { return win; },
  };
}
module.exports = { TABS, STORY_IDS, validateDeskCommand, sanitizeDeskSnapshot, deskBounds, createDeskController };
