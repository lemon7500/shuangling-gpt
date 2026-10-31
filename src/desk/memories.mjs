import { createHash } from 'node:crypto';

const LANGUAGES = ['zh-CN', 'zh-TW', 'en'];
const INTENTS = ['none', 'remember', 'continue'];
const MAX_ENTRIES = 365;
const MAX_DAYS = 90;
const MAX_FACTS = 6;
const MAX_TEXT = 1000;
const MAX_EXCERPT = 240;
const MAX_ROUNDS_PER_DAY = 128;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const epoch = value => Number.isSafeInteger(value) && value >= 0;
const count = (value, max = 1_000_000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const id = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const factId = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(value);
const text = (value, max = MAX_TEXT, empty = false) => typeof value === 'string' && value.length <= max &&
  (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const keysAre = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = (reason = 'desk-storage-invalid') => Object.assign(new Error(reason), { reason });
function boundedText(value, max) {
  let end = Math.min(value.length, max);
  // Keep the existing UTF-16 budget without cutting an emoji or extended CJK pair.
  if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff &&
      value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) end--;
  return value.slice(0, end);
}
const excerpt = value => boundedText(value.trim(), MAX_EXCERPT);

export const validNoteIntent = value => INTENTS.includes(value);
export function localMemoryDate(at) {
  const date = new Date(at);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validMemoryDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1970 || year > 9999) return false;
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
function dateDistance(a, b) {
  const day = value => { const [y, m, d] = value.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  return day(a) - day(b);
}
const translations = values => Object.fromEntries(LANGUAGES.map((language, index) => [language, values[index]]));
const validTranslations = value => plain(value) && LANGUAGES.every(language => text(value[language], MAX_TEXT));
const copyTranslations = value => Object.fromEntries(LANGUAGES.map(language => [language, value[language]]));

export function validMemoryCommand(input) {
  if (!plain(input)) return false;
  switch (input.type) {
    case 'memory.configure': return keysAre(input, ['type', 'enabled', 'reminders']) && typeof input.enabled === 'boolean' && typeof input.reminders === 'boolean';
    case 'memory.select': case 'memory.delete': return keysAre(input, ['type', 'date']) && validMemoryDate(input.date);
    case 'memory.reply': return keysAre(input, ['type', 'date', 'text']) && validMemoryDate(input.date) && text(input.text, MAX_TEXT, true);
    case 'memory.edit': return keysAre(input, ['type', 'date', 'language', 'text']) && validMemoryDate(input.date) && LANGUAGES.includes(input.language) && text(input.text);
    case 'memory.exclude': return keysAre(input, ['type', 'date', 'factId']) && validMemoryDate(input.date) && factId(input.factId);
    case 'memory.dismiss': return keysAre(input, ['type', 'id']) && factId(input.id);
    case 'memory.revisit': return keysAre(input, ['type', 'id', 'choice']) && id(input.id) && ['open', 'later', 'done'].includes(input.choice);
    case 'note.intent': return keysAre(input, ['type', 'id', 'intent']) && id(input.id) && validNoteIntent(input.intent);
    default: return false;
  }
}

export function createMemories(at) {
  return { version: 1, enabled: true, reminders: true, since: at, enabledSince: at, selectedDate: null,
    entries: [], days: [], generatedDates: [], claimedDates: [], dismissed: [] };
}

function validateFact(value) {
  if (!plain(value) || !factId(value.id) || !['bookmark', 'focus', 'round', 'reply'].includes(value.kind)) return false;
  if (value.kind === 'bookmark') return id(value.noteId) && text(value.text, MAX_EXCERPT) &&
    (value.action === undefined || ['saved', 'revisited', 'resolved'].includes(value.action));
  if (value.kind === 'reply') return validMemoryDate(value.sourceDate) && text(value.text, MAX_EXCERPT);
  if (value.kind === 'focus') return count(value.minutes, 1_000_000) && value.minutes > 0 && count(value.count) && value.count > 0;
  return count(value.count, MAX_ROUNDS_PER_DAY) && value.count > 0;
}
function copyFact(value) {
  if (value.kind === 'bookmark') return { id: value.id, kind: value.kind, noteId: value.noteId, text: value.text,
    ...(value.action === undefined ? {} : { action: value.action }) };
  if (value.kind === 'reply') return { id: value.id, kind: value.kind, sourceDate: value.sourceDate, text: value.text };
  return { id: value.id, kind: value.kind, count: value.count, ...(value.kind === 'focus' ? { minutes: value.minutes } : {}) };
}

/** Corrupt new data cannot silently reset or overwrite the original desk store. */
export function restoreMemories(value, at) {
  if (value === undefined) return createMemories(at);
  const validDates = (values, max) => Array.isArray(values) && values.length <= max && values.every(validMemoryDate) && new Set(values).size === values.length;
  if (!plain(value) || value.version !== 1 || typeof value.enabled !== 'boolean' || typeof value.reminders !== 'boolean' || !epoch(value.since) ||
      !epoch(value.enabledSince) || value.enabledSince < value.since || !(value.selectedDate === null || validMemoryDate(value.selectedDate)) ||
      !validDates(value.generatedDates, 730) || !validDates(value.claimedDates, 180) || !Array.isArray(value.dismissed) || value.dismissed.length > 360 ||
      !value.dismissed.every(factId) || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES || !Array.isArray(value.days) || value.days.length > MAX_DAYS) throw fail();
  for (const entry of value.entries) {
    if (!plain(entry) || !validMemoryDate(entry.date) || !validTranslations(entry.title) || !validTranslations(entry.body) ||
        !text(entry.reply, MAX_TEXT, true) || typeof entry.read !== 'boolean' || !epoch(entry.updatedAt) || !Array.isArray(entry.facts) || entry.facts.length > MAX_FACTS ||
        !entry.facts.every(validateFact) || new Set(entry.facts.map(f => f.id)).size !== entry.facts.length ||
        !plain(entry.edited) || Object.entries(entry.edited).some(([language, edited]) => !LANGUAGES.includes(language) || edited !== true)) throw fail();
  }
  if (new Set(value.entries.map(entry => entry.date)).size !== value.entries.length) throw fail();
  if (value.entries.some(entry => !value.generatedDates.includes(entry.date)) ||
      value.selectedDate !== null && !value.entries.some(entry => entry.date === value.selectedDate)) throw fail();
  for (const day of value.days) {
    if (!plain(day) || !validMemoryDate(day.date) || !count(day.focusMinutes) || !count(day.focusCount) || !Array.isArray(day.roundHashes) ||
        day.roundHashes.length > MAX_ROUNDS_PER_DAY || !day.roundHashes.every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)) ||
        new Set(day.roundHashes).size !== day.roundHashes.length || !Array.isArray(day.bookmarks) || day.bookmarks.length > 12 ||
        day.bookmarks.some(note => !plain(note) || !id(note.noteId) || !text(note.text, MAX_EXCERPT) ||
          (note.action !== undefined && !['saved', 'revisited', 'resolved'].includes(note.action))) ||
        new Set(day.bookmarks.map(n => n.noteId)).size !== day.bookmarks.length || !Array.isArray(day.replies) || day.replies.length > 4 ||
        day.replies.some(reply => !plain(reply) || !validMemoryDate(reply.sourceDate) || !text(reply.text, MAX_EXCERPT))) throw fail();
  }
  if (new Set(value.days.map(day => day.date)).size !== value.days.length) throw fail();
  return { version: 1, enabled: value.enabled, reminders: value.reminders, since: value.since, enabledSince: value.enabledSince,
    selectedDate: value.selectedDate, entries: value.entries.map(entry => ({ date: entry.date, title: copyTranslations(entry.title), body: copyTranslations(entry.body),
      reply: entry.reply, read: entry.read, facts: entry.facts.map(copyFact), updatedAt: entry.updatedAt, edited: { ...entry.edited } })),
    days: value.days.map(day => ({ date: day.date, focusMinutes: day.focusMinutes, focusCount: day.focusCount,
      roundHashes: [...day.roundHashes], bookmarks: day.bookmarks.map(note => ({ noteId: note.noteId, text: note.text,
        ...(note.action === undefined ? {} : { action: note.action }) })),
      replies: day.replies.map(reply => ({ sourceDate: reply.sourceDate, text: reply.text })) })),
    generatedDates: [...value.generatedDates], claimedDates: [...value.claimedDates], dismissed: [...value.dismissed] };
}

function dayFor(memories, at, observedAt = at) {
  if (!memories.enabled || memories.entries.length >= MAX_ENTRIES || at < memories.enabledSince || at > observedAt + 60000) return null;
  const date = localMemoryDate(at), today = localMemoryDate(observedAt);
  if (dateDistance(today, date) > 89 || memories.generatedDates.includes(date)) return null;
  let day = memories.days.find(value => value.date === date);
  if (!day) {
    day = { date, focusMinutes: 0, focusCount: 0, roundHashes: [], bookmarks: [], replies: [] };
    memories.days.push(day);
    memories.days.sort((a, b) => a.date.localeCompare(b.date));
    if (memories.days.length > MAX_DAYS) memories.days.splice(0, memories.days.length - MAX_DAYS);
  }
  return day;
}

export function recordMemoryTask(memories, event, observedAt) {
  if (!plain(event) || typeof event.id !== 'string' || !event.id.length || event.id.length > 500 || /[\u0000-\u001f]/.test(event.id) || !epoch(event.at)) throw fail('invalid-memory-event');
  const day = dayFor(memories, event.at, observedAt);
  if (!day) return false;
  const hash = createHash('sha256').update(event.id).digest('hex');
  if (day.roundHashes.includes(hash) || day.roundHashes.length >= MAX_ROUNDS_PER_DAY) return false;
  day.roundHashes.push(hash);
  return true;
}
export function recordMemoryFocus(memories, minutes, at) {
  const day = dayFor(memories, at);
  if (!day || !Number.isInteger(minutes) || minutes < 1 || minutes > 120) return false;
  day.focusMinutes = Math.min(1_000_000, day.focusMinutes + minutes); day.focusCount = Math.min(1_000_000, day.focusCount + 1);
  return true;
}
export function recordMemoryBookmark(memories, note, at, action = 'saved') {
  if (!['remember', 'continue'].includes(note.intent) || note.archived) return false;
  const day = dayFor(memories, at);
  if (!day) return false;
  const value = { noteId: note.id, text: excerpt(note.text), action }, existing = day.bookmarks.findIndex(item => item.noteId === note.id);
  if (existing >= 0) {
    if (day.bookmarks[existing].text === value.text && day.bookmarks[existing].action === value.action) return false;
    day.bookmarks[existing] = value;
  } else {
    if (day.bookmarks.length >= 12) day.bookmarks.shift();
    day.bookmarks.push(value);
  }
  return true;
}

function storyFor(date, facts) {
  const variant = Number(date.replaceAll('-', '')) % 3;
  if (!facts.length) return {
    title: translations(['留给你的一页', '留給你的一頁', 'A page left for you']),
    body: translations(['这一页的片段已经收起，空白仍可以留着。你想补一句，或让它安静地夹在书里，都很好。',
      '這一頁的片段已經收起，空白仍可以留著。你想補一句，或讓它安靜地夾在書裡，都很好。',
      'The recorded fragments have been put away. There is still room on this page. You can add a line, or simply leave it resting between the covers.']),
  };
  const focus = facts.find(f => f.kind === 'focus'), round = facts.find(f => f.kind === 'round');
  const bookmarks = facts.filter(f => f.kind === 'bookmark'), reply = facts.find(f => f.kind === 'reply');
  const starts = [
    ['我把这一天翻回来看，先给那些有来处的小事留了位置。', '我把這一天翻回來看，先給那些有來處的小事留了位置。', 'I turned back to this day and made room for the little things we had actually recorded.'],
    ['这一页，我没有急着写满。先收好几段确实留下的片段，再看看它们怎样连在一起。', '這一頁，我沒有急著寫滿。先收好幾段確實留下的片段，再看看它們怎樣連在一起。', 'I did not hurry to fill this page. I gathered the moments we had recorded and let them sit beside one another.'],
    ['整理这一页时，我想起书库里夹在纸间的细书签：不必记住每一阵风，有几处能回来的折角就好。', '整理這一頁時，我想起書庫裡夾在紙間的細書籤：不必記住每一陣風，有幾處能回來的折角就好。', 'This page reminded me of the slender bookmarks in the library. We need not keep every passing breeze, only a few places we can return to.'],
  ];
  const ends = [
    ['我习惯把书页理齐，这回却愿意留几行空白给你。若有想添的一句，就写在下面；下一次翻开时，我们还能从这里接着走。', '我習慣把書頁理齊，這回卻願意留幾行空白給你。若有想添的一句，就寫在下面；下一次翻開時，我們還能從這裡接著走。', 'I usually straighten every page, but I have left a few lines for you. Add a thought below if you wish. Next time, we can return to this corner together.'],
    ['在书库时，我总想把每个空隙填妥。现在觉得，给明天留一点位置也很好。你若愿意补一句，这一页就会多一种声音。', '在書庫時，我總想把每個空隙填妥。現在覺得，給明天留一點位置也很好。你若願意補一句，這一頁就會多一種聲音。', 'At the library, I wanted every gap neatly filled. Now I like leaving a little room for tomorrow. If you add a line, this page will hold another voice beside mine.'],
    ['我把这一页轻轻压平，没有替空白作答。你留下的文字会有自己的位置；今天想继续，或先放一放，都可以从这里开始。', '我把這一頁輕輕壓平，沒有替空白作答。你留下的文字會有自己的位置；今天想繼續，或先放一放，都可以從這裡開始。', 'I smoothed the page and left its blank lines unanswered. Your words have a place of their own here. We can continue from this point, or let it rest a little longer.'],
  ];
  const bodies = LANGUAGES.map((language, index) => {
    const parts = [starts[variant][index]];
    if (focus) parts.push([
      `记录里留着${focus.count}段结束的专注，共${focus.minutes}分钟。`, `記錄裡留著${focus.count}段結束的專注，共${focus.minutes}分鐘。`,
      `The record holds ${focus.count} completed focus session${focus.count === 1 ? '' : 's'}, ${focus.minutes} minutes in all.`,
    ][index]);
    if (round) parts.push([
      `还有${round.count}轮对话在这里告一段落。`, `還有${round.count}輪對話在這裡告一段落。`,
      `${round.count} recorded conversation turn${round.count === 1 ? '' : 's'} also came to a close.`,
    ][index]);
    if (bookmarks.length) {
      const note = bookmarks[0];
      parts.push((note.action === 'revisited' ? [
        `你选择再次打开“${note.text}”那张书签。`, `你選擇再次打開「${note.text}」那張書籤。`, `You chose to reopen the bookmark for “${note.text}”.`,
      ] : note.action === 'resolved' ? [
        `你把“${note.text}”标为告一段落，我便收好这张书签，留着回看的位置。`, `你把「${note.text}」標為告一段落，我便收好這張書籤，留著回看的位置。`,
        `You marked the bookmark for “${note.text}” as settled for now. I put it away with a place for us to return to.`,
      ] : [
        `你给“${note.text}”夹上了书签。`, `你給「${note.text}」夾上了書籤。`, `You left a bookmark for “${note.text}”.`,
      ])[index]);
    }
    if (reply) parts.push([
      `你还给${reply.sourceDate}那一页添了一句：“${reply.text}”。`, `你還給${reply.sourceDate}那一頁添了一句：「${reply.text}」。`,
      `You added a line to the page for ${reply.sourceDate}: “${reply.text}”.`,
    ][index]);
    parts.push(ends[variant][index]);
    return boundedText(parts.join(index === 2 ? ' ' : ''), MAX_TEXT);
  });
  const titles = [
    ['留了位置的一页', '留了位置的一頁', 'A place to return to'],
    ['先收好这些片段', '先收好這些片段', 'A few moments to keep'],
    ['书页间的折角', '書頁間的折角', 'The corner of a page'],
  ];
  return { title: translations(titles[variant]), body: translations(bodies) };
}
function factsFor(day) {
  const facts = [];
  if (day.focusCount) facts.push({ id: `focus:${day.date}`, kind: 'focus', minutes: day.focusMinutes, count: day.focusCount });
  if (day.roundHashes.length) facts.push({ id: `round:${day.date}`, kind: 'round', count: day.roundHashes.length });
  if (day.replies.length) {
    const reply = day.replies.at(-1); facts.push({ id: `reply:${reply.sourceDate}`, kind: 'reply', ...reply });
  }
  for (const note of day.bookmarks.slice(-(MAX_FACTS - facts.length))) facts.push({ id: `note:${note.noteId}`, kind: 'bookmark', ...note });
  return facts;
}

export function advanceMemories(memories, at) {
  if (!memories.enabled) return false;
  const today = localMemoryDate(at);
  let changed = false;
  for (const day of memories.days) {
    if (day.date >= today || memories.generatedDates.includes(day.date)) continue;
    if (memories.entries.length >= MAX_ENTRIES) break;
    const facts = factsFor(day);
    if (facts.length) {
      const story = storyFor(day.date, facts);
      memories.entries.push({ date: day.date, ...story, facts, reply: '', read: false, updatedAt: at, edited: {} });
      memories.generatedDates.push(day.date);
      changed = true;
    }
  }
  if (changed) {
    memories.entries.sort((a, b) => a.date.localeCompare(b.date));
    memories.generatedDates = memories.generatedDates.slice(-730);
    if (!memories.entries.some(entry => entry.date === memories.selectedDate)) memories.selectedDate = memories.entries.at(-1)?.date ?? null;
  }
  // Already materialized ledgers retain only bounded opaque deduplication
  // proof; quoted text lives in one dated page, not a second hidden copy.
  for (const day of memories.days) if (memories.generatedDates.includes(day.date) && (day.bookmarks.length || day.replies.length)) {
    day.bookmarks = []; day.replies = []; changed = true;
  }
  return changed;
}

function promptFor(memories, notes, at) {
  if (!memories.enabled || !memories.reminders) return null;
  const today = localMemoryDate(at), latest = memories.entries.at(-1);
  if (latest && latest.date < today && !latest.read) {
    const prompt = { id: `daily:${latest.date}`, kind: 'daily', date: latest.date };
    if (!memories.dismissed.includes(prompt.id)) return prompt;
  }
  const note = notes.filter(note => note.intent === 'continue' && !note.resolved && !note.archived &&
    localMemoryDate(note.updatedAt) < today && (!note.memoryRevisitedAt || dateDistance(today, localMemoryDate(note.memoryRevisitedAt)) >= 3))
    .sort((a, b) => (a.memoryRevisitedAt ?? a.updatedAt) - (b.memoryRevisitedAt ?? b.updatedAt) || a.id.localeCompare(b.id))
    .find(note => !memories.dismissed.includes(`continue:${today}:${note.id}`));
  return note ? { id: `continue:${today}:${note.id}`, kind: 'continue', noteId: note.id } : null;
}
export function memoriesView(memories, notes, at) {
  return { enabled: memories.enabled, reminders: memories.reminders, since: memories.since, selectedDate: memories.selectedDate,
    limitReached: memories.entries.length >= MAX_ENTRIES,
    entries: memories.entries.map(entry => ({ date: entry.date, title: { ...entry.title }, body: { ...entry.body }, reply: entry.reply, read: entry.read,
      facts: entry.facts.map(copyFact), updatedAt: entry.updatedAt })), prompt: promptFor(memories, notes, at) };
}
export function claimMemoryPrompt(memories, notes, promptId, at) {
  const prompt = promptFor(memories, notes, at), today = localMemoryDate(at);
  if (!prompt || prompt.id !== promptId || memories.claimedDates.includes(today)) return false;
  memories.claimedDates.push(today); memories.claimedDates = memories.claimedDates.slice(-180);
  return true;
}
function rememberDismissed(memories, promptId, at) {
  if (!memories.dismissed.includes(promptId)) memories.dismissed.push(promptId);
  memories.dismissed = memories.dismissed.slice(-360);
  const today = localMemoryDate(at);
  if (!memories.claimedDates.includes(today)) memories.claimedDates.push(today);
  memories.claimedDates = memories.claimedDates.slice(-180);
}
function rebuildEntry(entry, at, removedQuotes = []) {
  const story = storyFor(entry.date, entry.facts);
  entry.title = story.title;
  for (const language of LANGUAGES) {
    if (!entry.edited[language]) entry.body[language] = story.body[language];
    else for (const quote of [...new Set(removedQuotes)].filter(Boolean).sort((a, b) => b.length - a.length)) {
      // A source edit never erases unrelated user prose. Direct quotes are
      // redacted literally; interpreting a user's own paraphrase is out of scope.
      entry.body[language] = entry.body[language].replaceAll(quote, '…');
    }
  }
  entry.updatedAt = at;
}
export function purgeMemoryBookmark(memories, noteId, at, fullText = '') {
  let changed = false;
  for (const day of memories.days) {
    const before = day.bookmarks.length; day.bookmarks = day.bookmarks.filter(note => note.noteId !== noteId);
    if (before !== day.bookmarks.length) changed = true;
  }
  for (const entry of memories.entries) {
    const removed = entry.facts.filter(fact => fact.noteId === noteId);
    entry.facts = entry.facts.filter(fact => fact.noteId !== noteId);
    if (removed.length) { rebuildEntry(entry, at, [fullText, ...removed.map(fact => fact.text)]); changed = true; }
  }
  return changed;
}

export function applyMemoryCommand(memories, notes, input, at) {
  if (input.type === 'memory.configure') {
    const changed = memories.enabled !== input.enabled || memories.reminders !== input.reminders;
    if (!memories.enabled && input.enabled) memories.enabledSince = at;
    memories.enabled = input.enabled; memories.reminders = input.reminders;
    return changed;
  }
  if (input.type === 'memory.dismiss') {
    const prompt = promptFor(memories, notes, at);
    if (!prompt || prompt.id !== input.id) return false;
    rememberDismissed(memories, input.id, at); return true;
  }
  if (input.type === 'note.intent' || input.type === 'memory.revisit') {
    const note = notes.find(note => note.id === input.id);
    if (!note) throw fail('desk-note-not-found');
    if (input.type === 'note.intent') {
      if ((note.intent ?? 'none') === input.intent && !note.resolved) return false;
      note.intent = input.intent; note.resolved = false; note.updatedAt = Math.max(at, note.createdAt);
      recordMemoryBookmark(memories, note, at); return true;
    }
    if (note.intent !== 'continue') throw fail('memory-bookmark-unavailable');
    note.memoryRevisitedAt = at;
    if (input.choice === 'done') { note.resolved = true; note.updatedAt = Math.max(at, note.createdAt); }
    rememberDismissed(memories, `continue:${localMemoryDate(at)}:${note.id}`, at);
    if (input.choice !== 'later') recordMemoryBookmark(memories, note, at, input.choice === 'done' ? 'resolved' : 'revisited');
    return true;
  }
  const entry = memories.entries.find(entry => entry.date === input.date);
  if (!entry) throw fail('memory-entry-not-found');
  switch (input.type) {
    case 'memory.select': {
      const changed = memories.selectedDate !== input.date || !entry.read;
      const prompt = promptFor(memories, notes, at);
      // Reading the offered daily page is already today's interaction. Record it
      // before read=true can expose a continuation card to the reminder pump.
      if (prompt?.kind === 'daily' && prompt.date === input.date) rememberDismissed(memories, prompt.id, at);
      memories.selectedDate = input.date; entry.read = true;
      return changed;
    }
    case 'memory.reply': {
      const value = input.text.trim();
      if (entry.reply === value) return false;
      const previousReply = entry.reply;
      entry.reply = value; entry.updatedAt = at;
      for (const day of memories.days) for (let index = day.replies.length - 1; index >= 0; index--) {
        if (day.replies[index].sourceDate !== input.date) continue;
        if (value) day.replies[index].text = excerpt(value);
        else day.replies.splice(index, 1);
      }
      for (const other of memories.entries) {
        const linked = other.facts.filter(fact => fact.kind === 'reply' && fact.sourceDate === input.date);
        if (!linked.length) continue;
        other.facts = other.facts.filter(fact => fact.kind !== 'reply' || fact.sourceDate !== input.date);
        if (value) for (const fact of linked) other.facts.push({ ...fact, text: excerpt(value) });
        rebuildEntry(other, at, [previousReply, ...linked.map(fact => fact.text)]);
      }
      const day = value ? dayFor(memories, at) : memories.days.find(day => day.date === localMemoryDate(at));
      if (day) {
        day.replies = day.replies.filter(reply => reply.sourceDate !== input.date);
        if (value) { if (day.replies.length >= 4) day.replies.shift(); day.replies.push({ sourceDate: input.date, text: excerpt(value) }); }
      }
      return true;
    }
    case 'memory.edit':
      if (entry.body[input.language] === input.text.trim()) return false;
      entry.body[input.language] = input.text.trim(); entry.edited[input.language] = true; entry.updatedAt = at; return true;
    case 'memory.exclude': {
      const removed = entry.facts.filter(fact => fact.id === input.factId);
      entry.facts = entry.facts.filter(fact => fact.id !== input.factId);
      if (!removed.length) return false;
      rebuildEntry(entry, at, removed.map(fact => fact.text)); return true;
    }
    case 'memory.delete':
      memories.entries = memories.entries.filter(entry => entry.date !== input.date);
      if (memories.selectedDate === input.date) memories.selectedDate = memories.entries.at(-1)?.date ?? null;
      // Delete any automatically copied response that came from this page.
      for (const day of memories.days) day.replies = day.replies.filter(reply => reply.sourceDate !== input.date);
      for (const other of memories.entries) {
        const removed = other.facts.filter(fact => fact.sourceDate === input.date);
        other.facts = other.facts.filter(fact => fact.sourceDate !== input.date);
        if (removed.length) rebuildEntry(other, at, [entry.reply, ...removed.map(fact => fact.text)]);
      }
      return true;
    default: throw fail('invalid-desk-command');
  }
}
