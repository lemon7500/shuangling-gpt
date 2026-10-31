import { mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { STORIES, STORY_IDS } from './stories.mjs';
import focusSleep from '../../vendor/dsh-pet/runtime/electron-helper/focus-sleep.cjs';
import { createMemories, restoreMemories, memoriesView, advanceMemories, validMemoryCommand, validNoteIntent,
  recordMemoryTask, recordMemoryFocus, recordMemoryBookmark, purgeMemoryBookmark, applyMemoryCommand,
  claimMemoryPrompt as claimPrompt } from './memories.mjs';

const MINUTE = 60_000;
const STATUSES = ['idle', 'running', 'paused', 'completed'];
const PHASES = ['focus', 'break'];
const PAUSE_REASONS = ['manual', 'sleep', 'app-exit'];
const MAX_NOTES = 100;
const MAX_NOTE_LENGTH = 1000;
const activePaths = new Set();
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const epoch = value => Number.isSafeInteger(value) && value >= 0;
const noteId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const storyId = value => STORY_IDS.includes(value);
const validText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_NOTE_LENGTH && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const error = (reason, status = 400) => Object.assign(new Error(reason), { reason, status });
const keysAre = (input, required, optional = []) => plain(input) && required.every(key => Object.hasOwn(input, key)) &&
  Object.keys(input).every(key => required.includes(key) || optional.includes(key));

/** Fixed local capabilities. No paths, URLs, conversation IDs or arbitrary actions. */
export function validDeskCommand(input) {
  if (!plain(input) || typeof input.type !== 'string') return false;
  if (input.type.startsWith('memory.') || input.type === 'note.intent') return validMemoryCommand(input);
  switch (input.type) {
    case 'focus.configure': return keysAre(input, ['type', 'focusMinutes', 'breakMinutes']) && inRange(input.focusMinutes, 10, 120) && inRange(input.breakMinutes, 1, 30);
    case 'focus.start': return keysAre(input, ['type'], ['phase']) && (!Object.hasOwn(input, 'phase') || PHASES.includes(input.phase));
    case 'focus.pause': case 'focus.resume': case 'focus.stop': return keysAre(input, ['type']);
    case 'focus.suspend': return keysAre(input, ['type'], ['reason', 'event']) &&
      (!Object.hasOwn(input, 'reason') || ['sleep', 'app-exit'].includes(input.reason)) &&
      (!Object.hasOwn(input, 'event') || ((input.reason ?? 'sleep') === 'sleep' && focusSleep.validSleepEvent(input.event)));
    case 'story.select': return keysAre(input, ['type', 'id']) && storyId(input.id);
    case 'story.favorite': return keysAre(input, ['type', 'id', 'favorite']) && storyId(input.id) && typeof input.favorite === 'boolean';
    case 'story.position': return keysAre(input, ['type', 'id', 'position']) && storyId(input.id) && typeof input.position === 'number' && Number.isFinite(input.position) && input.position >= 0 && input.position <= 1;
    case 'note.create': return keysAre(input, ['type', 'text'], ['intent']) && validText(input.text) && (!Object.hasOwn(input, 'intent') || validNoteIntent(input.intent));
    case 'note.update': return keysAre(input, ['type', 'id', 'text'], ['intent']) && noteId(input.id) && validText(input.text) && (!Object.hasOwn(input, 'intent') || validNoteIntent(input.intent));
    case 'note.pin': return keysAre(input, ['type', 'id', 'pinned']) && noteId(input.id) && typeof input.pinned === 'boolean';
    case 'note.archive': return keysAre(input, ['type', 'id', 'archived']) && noteId(input.id) && typeof input.archived === 'boolean';
    case 'note.delete': return keysAre(input, ['type', 'id'], ['purgeMemories']) && noteId(input.id) && (!Object.hasOwn(input, 'purgeMemories') || typeof input.purgeMemories === 'boolean');
    default: return false;
  }
}

function defaults(at) {
  return { schemaVersion: 1, revision: 0,
    focus: { phase: 'focus', status: 'idle', focusMinutes: 25, breakMinutes: 5, remainingMs: 25 * MINUTE,
      endsAt: null, pauseReason: null, completedAt: null, completionId: null, runId: null, checkpointAt: at },
    journal: { selectedId: STORY_IDS[0], readIds: [], favoriteIds: [], positionById: {} },
    notes: [], notices: [], memories: createMemories(at) };
}

function restore(value, at) {
  if (!plain(value) || value.schemaVersion !== 1) throw error('desk-storage-incompatible');
  const { focus: f, journal: j } = value;
  if (!inRange(value.revision, 0, Number.MAX_SAFE_INTEGER) || !plain(f) || !PHASES.includes(f.phase) || !STATUSES.includes(f.status) ||
      !inRange(f.focusMinutes, 10, 120) || !inRange(f.breakMinutes, 1, 30) || !epoch(f.remainingMs) ||
      f.remainingMs > (f.phase === 'break' ? f.breakMinutes : f.focusMinutes) * MINUTE ||
      !(f.endsAt === null || epoch(f.endsAt)) || (f.status === 'running' && f.endsAt === null) ||
      !(f.pauseReason === null || PAUSE_REASONS.includes(f.pauseReason)) ||
      !(f.completedAt === null || epoch(f.completedAt)) || !(f.completionId === null || noteId(f.completionId)) ||
      !(f.runId === null || noteId(f.runId)) || !epoch(f.checkpointAt)) throw error('desk-storage-invalid');
  if (!plain(j) || !storyId(j.selectedId) || !Array.isArray(j.readIds) || !j.readIds.every(storyId) ||
      !Array.isArray(j.favoriteIds) || !j.favoriteIds.every(storyId) || !plain(j.positionById) ||
      Object.entries(j.positionById).some(([id, position]) => !storyId(id) || typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 1)) throw error('desk-storage-invalid');
  if (!Array.isArray(value.notes) || value.notes.length > MAX_NOTES || value.notes.some(note => !plain(note) || !noteId(note.id) ||
      !validText(note.text) || typeof note.pinned !== 'boolean' || typeof note.archived !== 'boolean' || !epoch(note.createdAt) || !epoch(note.updatedAt) ||
      (Object.hasOwn(note, 'intent') && !validNoteIntent(note.intent)) || (Object.hasOwn(note, 'resolved') && typeof note.resolved !== 'boolean') ||
      (Object.hasOwn(note, 'memoryRevisitedAt') && !epoch(note.memoryRevisitedAt))) ||
      new Set(value.notes.map(note => note.id)).size !== value.notes.length) throw error('desk-storage-invalid');
  if (!Array.isArray(value.notices) || value.notices.length > 1000 || value.notices.some(notice => !plain(notice) || !noteId(notice.id) ||
      !PHASES.includes(notice.phase) || !epoch(notice.completedAt) || !inRange(notice.durationMinutes, 1, 120))) throw error('desk-storage-invalid');
  return { schemaVersion: 1, revision: value.revision, focus: {
    phase: f.phase, status: f.status, focusMinutes: f.focusMinutes, breakMinutes: f.breakMinutes, remainingMs: f.remainingMs,
    endsAt: f.endsAt, pauseReason: f.pauseReason, completedAt: f.completedAt, completionId: f.completionId, runId: f.runId, checkpointAt: f.checkpointAt,
  }, journal: { selectedId: j.selectedId, readIds: [...new Set(j.readIds)], favoriteIds: [...new Set(j.favoriteIds)], positionById: { ...j.positionById } },
  notes: value.notes.map(note => ({ id: note.id, text: note.text, pinned: note.pinned, archived: note.archived, createdAt: note.createdAt, updatedAt: note.updatedAt,
    ...(Object.hasOwn(note, 'intent') ? { intent: note.intent } : {}), ...(Object.hasOwn(note, 'resolved') ? { resolved: note.resolved } : {}),
    ...(Object.hasOwn(note, 'memoryRevisitedAt') ? { memoryRevisitedAt: note.memoryRevisitedAt } : {}) })),
  notices: value.notices.map(notice => ({ id: notice.id, phase: notice.phase, completedAt: notice.completedAt, durationMinutes: notice.durationMinutes })),
  memories: restoreMemories(value.memories, at) };
}

/** One writer per private data directory; callers never supply a filename. */
export async function createDeskService({ dataDir, now = Date.now, onNotice, autoTick = true,
  tickIntervalMs = 1000, checkpointIntervalMs = 15_000, sleepGapMs = 30_000, detectSleep = autoTick } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw error('desk-data-unavailable');
  const directory = resolve(dataDir), file = join(directory, 'desk.json'), sleepSessionId = randomUUID();
  if (activePaths.has(file)) throw error('desk-already-open', 409);
  activePaths.add(file);
  let state, interval, closed = false, closing = false;
  let tail = Promise.resolve(), lastTickAt = now();
  const delivered = new Set();
  const rejectedSleepEvents = new Set();
  const stamp = () => { const value = now(); if (!epoch(value)) throw error('desk-clock-unavailable'); return value; };
  async function persist(draft) {
    draft.revision = state.revision + 1;
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      focusSleep.prepareFocusActivationSync(directory, state, draft);
      await mkdir(directory, { recursive: true });
      const contents = JSON.stringify(draft) + '\n';
      if (Buffer.byteLength(contents) > 8_388_608) throw error('desk-storage-limit');
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(contents); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temp, file);
      state = draft;
    } catch (cause) { throw Object.assign(error('desk-storage-unavailable'), { cause }); }
  }
  try {
    const at = stamp();
    try {
      const info = await stat(file);
      if (info.size > 8_388_608) throw error('desk-storage-invalid');
      const contents = await readFile(file, 'utf8');
      if (Buffer.byteLength(contents) > 8_388_608) throw error('desk-storage-invalid');
      try { const saved = JSON.parse(contents); state = restore(saved, at); }
      catch (cause) { if (cause.reason) throw cause; throw error('desk-storage-invalid'); }
    } catch (cause) {
      if (cause.code === 'ENOENT') { state = defaults(at); }
      else throw cause.reason ? cause : Object.assign(error('desk-storage-unavailable'), { cause });
    }
    const draft = structuredClone(state);
    // Published atomically with timer state; old helpers/events cannot suspend a
    // newly created service or a resumed timer activation.
    draft.sleepSessionId = sleepSessionId; draft.sleepRunStartedAt = null;
    if (draft.focus.status === 'running') {
      // Do not count application downtime or sleep as completed focus time.
      draft.focus.status = 'paused'; draft.focus.endsAt = null; draft.focus.pauseReason = 'app-exit'; draft.focus.checkpointAt = at;
    }
    // Old completions remain visible in the panel but never replay on restart.
    draft.notices = [];
    advanceMemories(draft.memories, at);
    await persist(draft);
  } catch (cause) { activePaths.delete(file); throw cause; }

  function enqueue(operation, allowClosing = false) {
    if (closing && !allowClosing) return Promise.reject(error('desk-unavailable', 409));
    const result = tail.then(() => { if (closed) throw error('desk-unavailable', 409); return operation(); });
    tail = result.catch(() => {});
    return result;
  }
  function publicView(draft, at) {
    const f = draft.focus;
    return { ok: true, focus: { phase: f.phase, status: f.status, focusMinutes: f.focusMinutes, breakMinutes: f.breakMinutes,
      remainingMs: f.status === 'running' ? Math.max(0, f.endsAt - at) : f.remainingMs,
      endsAt: f.status === 'running' ? f.endsAt : null, pauseReason: f.pauseReason, completedAt: f.completedAt, completionId: f.completionId },
    journal: { fictional: true, selectedId: draft.journal.selectedId, positionById: { ...draft.journal.positionById },
      originalArtist: { name: '@ZipZipPipe', url: 'https://space.bilibili.com/4168597' }, permission: 'non-commercial',
      entries: STORIES.map(story => ({ id: story.id, title: { ...story.title }, body: { ...story.body },
        read: draft.journal.readIds.includes(story.id), favorite: draft.journal.favoriteIds.includes(story.id) })) },
    notes: draft.notes.map(note => ({ id: note.id, text: note.text, pinned: note.pinned, archived: note.archived, createdAt: note.createdAt,
      updatedAt: note.updatedAt, intent: note.intent ?? 'none', resolved: note.resolved === true })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
    memories: memoriesView(draft.memories, draft.notes, at) };
  }
  function progress(draft, at) {
    const f = draft.focus;
    let changed = false;
    if (f.status === 'running') {
      if (detectSleep && (at - lastTickAt > sleepGapMs || at < lastTickAt)) {
        f.remainingMs = Math.max(0, f.endsAt - lastTickAt);
        f.endsAt = null; f.status = 'paused'; f.pauseReason = 'sleep'; f.checkpointAt = at;
        changed = true;
      } else {
        f.remainingMs = Math.max(0, f.endsAt - at);
        if (f.remainingMs === 0) {
          f.status = 'completed'; f.endsAt = null; f.pauseReason = null; f.completedAt = at; f.completionId = randomUUID();
          draft.notices.push({ id: f.completionId, phase: f.phase, completedAt: at,
            durationMinutes: f.phase === 'focus' ? f.focusMinutes : f.breakMinutes });
          if (f.phase === 'focus') recordMemoryFocus(draft.memories, f.focusMinutes, at);
          f.checkpointAt = at; changed = true;
        } else if (at - f.checkpointAt >= checkpointIntervalMs) { f.checkpointAt = at; changed = true; }
      }
    }
    return changed;
  }
  function applySleepIntent(draft, at, forwarded) {
    let saved;
    try { saved = focusSleep.readFocusSleepSync(directory); }
    catch (cause) { throw Object.assign(error('desk-storage-unavailable'), { cause }); }
    const f = draft.focus, rejected = [];
    for (const event of [saved, forwarded]) {
      if (!event || event.sessionId !== sleepSessionId || event.runId !== f.runId || f.status !== 'running' ||
          rejectedSleepEvents.has(event.id) || !epoch(draft.sleepRunStartedAt)) continue;
      if (event.at < draft.sleepRunStartedAt || event.at > at) { rejected.push(event.id); continue; }
      if (event.at >= f.endsAt) continue;
      f.remainingMs = f.endsAt - event.at;
      f.endsAt = null; f.status = 'paused'; f.pauseReason = 'sleep'; f.checkpointAt = at;
      return { changed: true, rejected };
    }
    return { changed: false, rejected };
  }
  function emit(notices) {
    if (typeof onNotice !== 'function' || closing || closed) return;
    for (const notice of notices) {
      if (delivered.has(notice.id)) continue;
      delivered.add(notice.id);
      // A callback may call consumeNotice; never await it inside the write queue.
      void Promise.resolve().then(() => onNotice({ ...notice })).catch(() => {});
    }
  }
  async function transact(operation, sleepEvent) {
    const result = await enqueue(async () => {
      const at = stamp(), draft = structuredClone(state);
      const sleeping = applySleepIntent(draft, at, sleepEvent);
      const changed = progress(draft, at) || sleeping.changed;
      const beforeMemoryChange = advanceMemories(draft.memories, at);
      const mutated = operation ? operation(draft, at) : false;
      const memoriesChanged = advanceMemories(draft.memories, at);
      if (changed || mutated || memoriesChanged || beforeMemoryChange) await persist(draft);
      for (const id of sleeping.rejected) rejectedSleepEvents.add(id);
      // Observation time belongs to the same committed transaction as state.
      // An invalid operation or failed write must not turn a later wake read
      // into elapsed focus time by consuming the only evidence of a sleep gap.
      lastTickAt = at;
      return { snapshot: publicView(draft, at), notices: draft.notices.map(notice => ({ ...notice })) };
    });
    emit(result.notices);
    return result;
  }
  const pause = (draft, at, reason) => {
    if (draft.focus.status !== 'running') return false;
    draft.focus.remainingMs = Math.max(0, draft.focus.endsAt - at);
    draft.focus.status = 'paused'; draft.focus.endsAt = null; draft.focus.pauseReason = reason; draft.focus.checkpointAt = at;
    return true;
  };
  const service = {
    async snapshot() { return (await transact()).snapshot; },
    async tick() { return transact(); },
    async command(input) {
      if (!validDeskCommand(input)) throw error('invalid-desk-command');
      return (await transact((draft, at) => {
        if (input.type.startsWith('memory.') || input.type === 'note.intent') return applyMemoryCommand(draft.memories, draft.notes, input, at);
        const f = draft.focus;
        switch (input.type) {
          case 'focus.configure':
            if (!['idle', 'completed'].includes(f.status)) throw error('focus-busy', 409);
            f.focusMinutes = input.focusMinutes; f.breakMinutes = input.breakMinutes;
            if (f.status === 'idle') { f.phase = 'focus'; f.remainingMs = f.focusMinutes * MINUTE; }
            return true;
          case 'focus.start':
            if (!['idle', 'completed'].includes(f.status)) throw error('focus-busy', 409);
            f.phase = input.phase ?? 'focus'; f.status = 'running'; f.pauseReason = null; f.completedAt = null; f.completionId = null;
            f.remainingMs = (f.phase === 'break' ? f.breakMinutes : f.focusMinutes) * MINUTE;
            f.endsAt = at + f.remainingMs; f.checkpointAt = at; f.runId = randomUUID(); draft.notices = [];
            draft.sleepRunStartedAt = at;
            return true;
          case 'focus.pause':
            if (!pause(draft, at, 'manual')) throw error('focus-not-running', 409);
            return true;
          case 'focus.suspend': return input.event ? false : pause(draft, at, input.reason ?? 'sleep');
          case 'focus.resume':
            if (f.status !== 'paused') throw error('focus-not-paused', 409);
            f.status = 'running'; f.endsAt = at + f.remainingMs; f.pauseReason = null; f.checkpointAt = at;
            f.runId = randomUUID(); draft.sleepRunStartedAt = at;
            return true;
          case 'focus.stop':
            f.phase = 'focus'; f.status = 'idle'; f.remainingMs = f.focusMinutes * MINUTE; f.endsAt = null;
            f.pauseReason = null; f.completedAt = null; f.completionId = null; f.runId = null; f.checkpointAt = at; draft.notices = [];
            return true;
          case 'story.select': {
            const changed = draft.journal.selectedId !== input.id || !draft.journal.readIds.includes(input.id);
            draft.journal.selectedId = input.id;
            if (!draft.journal.readIds.includes(input.id)) draft.journal.readIds.push(input.id);
            return changed;
          }
          case 'story.favorite': {
            const had = draft.journal.favoriteIds.includes(input.id);
            draft.journal.favoriteIds = draft.journal.favoriteIds.filter(id => id !== input.id);
            if (input.favorite) draft.journal.favoriteIds.push(input.id);
            return had !== input.favorite;
          }
          case 'story.position': {
            const changed = draft.journal.positionById[input.id] !== input.position;
            draft.journal.positionById[input.id] = input.position;
            return changed;
          }
          case 'note.create': {
            if (draft.notes.length >= MAX_NOTES) throw error('desk-notes-limit', 409);
            const note = { id: randomUUID(), text: input.text.trim(), pinned: false, archived: false, createdAt: at, updatedAt: at,
              intent: input.intent ?? 'none', resolved: false };
            draft.notes.push(note); recordMemoryBookmark(draft.memories, note, at);
            return true;
          }
          default: {
            const index = draft.notes.findIndex(note => note.id === input.id);
            if (index < 0) throw error('desk-note-not-found');
            if (input.type === 'note.delete') {
              if (input.purgeMemories !== false) purgeMemoryBookmark(draft.memories, input.id, at, draft.notes[index].text);
              draft.notes.splice(index, 1); return true;
            }
            const note = draft.notes[index];
            const key = input.type === 'note.update' ? 'text' : input.type === 'note.pin' ? 'pinned' : 'archived';
            const value = key === 'text' ? input.text.trim() : input[key];
            const intentChanged = input.type === 'note.update' && Object.hasOwn(input, 'intent') && (note.intent ?? 'none') !== input.intent;
            if (note[key] === value && !intentChanged) return false;
            note[key] = value; note.updatedAt = Math.max(at, note.createdAt);
            if (intentChanged) { note.intent = input.intent; note.resolved = false; }
            if (input.type === 'note.update') recordMemoryBookmark(draft.memories, note, at);
            return true;
          }
        }
      }, input.type === 'focus.suspend' ? input.event : undefined)).snapshot;
    },
    /** Internal metadata only; no renderer can supply or replay task events. */
    async recordTask(event) {
      let recorded = false;
      await transact((draft, at) => { recorded = recordMemoryTask(draft.memories, event, at); return recorded; });
      return recorded;
    },
    async claimMemoryPrompt(id) {
      let claimed = false;
      await transact((draft, at) => { claimed = claimPrompt(draft.memories, draft.notes, id, at); return claimed; });
      return claimed;
    },
    async consumeNotice(id) {
      if (!noteId(id)) throw error('invalid-desk-notice');
      return enqueue(async () => {
        const draft = structuredClone(state), before = draft.notices.length;
        draft.notices = draft.notices.filter(notice => notice.id !== id);
        if (draft.notices.length === before) return { consumed: false };
        await persist(draft); return { consumed: true };
      });
    },
    async suspend(reason = 'sleep') { return service.command({ type: 'focus.suspend', reason }); },
    async close() {
      if (closed) return;
      if (closing) return tail;
      closing = true; if (interval) clearInterval(interval);
      try {
        await enqueue(async () => {
          const at = stamp(), draft = structuredClone(state);
          const sleeping = applySleepIntent(draft, at);
          const changed = progress(draft, at) || sleeping.changed;
          const paused = pause(draft, at, 'app-exit');
          const memoriesChanged = advanceMemories(draft.memories, at);
          if (changed || paused || memoriesChanged) await persist(draft);
          for (const id of sleeping.rejected) rejectedSleepEvents.add(id);
          lastTickAt = at;
        }, true);
      } finally { closed = true; activePaths.delete(file); }
    },
  };
  if (autoTick) { interval = setInterval(() => { void service.tick().catch(() => {}); }, Math.max(50, tickIntervalMs)); interval.unref?.(); }
  return service;
}
