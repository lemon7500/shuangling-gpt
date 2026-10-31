/* Local-only tool window. All user and story text is rendered as plain text. */
(function () {
  'use strict';
  const i18n = typeof module !== 'undefined' && module.exports ? require('./panel-i18n.js') : globalThis.shuanglingI18n;
  const { t, getLanguage, setLanguage, normalizeLanguage } = i18n;
  const TABS = Object.freeze(['focus', 'journal', 'notes']);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function presentFocus(focus = {}, now = Date.now()) {
    const status = ['idle', 'running', 'paused', 'completed'].includes(focus.status) ? focus.status : 'idle';
    const phase = focus.phase === 'break' ? 'break' : 'focus';
    const total = (phase === 'break' ? focus.breakMinutes || 5 : focus.focusMinutes || 25) * 60000;
    const end = typeof focus.endsAt === 'number' ? focus.endsAt : Date.parse(focus.endsAt);
    const remaining = status === 'running' && Number.isFinite(end) ? clamp(end - now, 0, total) : clamp(Number.isFinite(focus.remainingMs) ? focus.remainingMs : total, 0, total);
    const seconds = Math.ceil(remaining / 1000);
    const labels = { idle: '尚未开始', running: '计时中', paused: '已暂停', completed: '本段完成' };
    const hint = status === 'paused' ? ['sleep', 'app-exit'].includes(focus.pauseReason) ? '离开期间已暂停，准备好后再继续。' : '慢一点也没关系，准备好后继续。' : status === 'completed' ? '这一小段完成了。下一段由你决定。' : status === 'running' ? phase === 'break' ? '放松一下眼睛和肩膀吧。' : '我在这里，陪你把这一件事做好。' : '准备好了，就从这一小段开始。';
    return { status, phase, remaining, clock: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`, progress: total ? clamp(1 - remaining / total, 0, 1) : 0, label: t(labels[status]), phaseLabel: t(phase === 'break' ? '休息时光' : '专注时光'), hint: t(hint), canConfigure: ['idle', 'completed'].includes(status), canStart: ['idle', 'completed'].includes(status), canPause: status === 'running', canResume: status === 'paused', canStop: ['running', 'paused'].includes(status) };
  }
  function visibleNotes(notes, archived = false) {
    return (Array.isArray(notes) ? notes : []).filter(note => note.archived === archived).slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || (Date.parse(b.updatedAt) || Number(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || Number(a.updatedAt) || 0));
  }
  function memoryEntries(memories) {
    return (Array.isArray(memories?.entries) ? memories.entries : []).filter(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry?.date || '')).slice().sort((a, b) => b.date.localeCompare(a.date));
  }
  function memoryDate(value, compact = false) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return '';
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(getLanguage(), { ...(compact ? {} : { year: 'numeric' }), month: 'short', day: 'numeric' });
  }
  function factLabel(fact) {
    if (fact?.kind === 'focus') return t('一起完成了 {minutes} 分钟专注', { minutes: fact.minutes || 0 });
    if (fact?.kind === 'round') return t('一起经历了 {count} 轮任务', { count: fact.count || 1 });
    if (fact?.kind === 'reply') return t('你补写的一句');
    if (fact?.action === 'revisited') return t('又翻开了这一页');
    if (fact?.action === 'resolved') return t('这一页已告一段落');
    return t('你留下的书签');
  }
  function continuationText(entry) {
    const bookmarked = entry?.facts?.find(fact => fact.kind === 'bookmark' && typeof fact.text === 'string' && fact.text.trim());
    return String(bookmarked?.text || entry?.reply || '').slice(0, 1000);
  }
  const localized = value => typeof value?.[getLanguage()] === 'string' ? value[getLanguage()] : value?.['zh-CN'] || '';
  const model = { presentFocus, visibleNotes, localized, memoryEntries, memoryDate, factLabel, continuationText, TABS };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const buttonLabel = (element, text, icon) => { if (globalThis.shuanglingIcons) globalThis.shuanglingIcons.setLabel(element, text, icon); else element.textContent = text; };
  const api = globalThis.shuanglingDesk;
  let data = null, activeTab = 'focus', connected = false, pending = 0, revision = 0, alive = true;
  let lane = Promise.resolve(), refreshPending = false, timer = null, configuredDirty = false, favoritesOnly = false, archived = false, editingId = null, confirmDelete = null;
  let storyKey = '', positionTimer = null, positionDraft = null, suppressScroll = false, initialTab = false, restoreStory = false, closeGuard = false;
  let journalShelf = 'stories', selectedMemoryDate = null, memoryDraft = null, confirmMemoryDelete = null, linkedNoteId = null, closeTarget = 'notes', purgeMemories = true;
  let currentNotice = { key: '', kind: 'error', values: {} };
  const enqueue = fn => { const result = lane.then(fn, fn); lane = result.catch(() => {}); return result; };
  const isBusy = () => pending > 0;
  function renderNotice() { $('notice').textContent = currentNotice.key ? t(currentNotice.key, currentNotice.values) : ''; $('notice').dataset.kind = currentNotice.kind; $('notice').hidden = !currentNotice.key; }
  function notice(key = '', kind = 'error', values = {}) { currentNotice = { key, kind, values: { ...values } }; renderNotice(); }
  function language(value) {
    setLanguage(normalizeLanguage(value)); document.documentElement.lang = getLanguage(); document.title = t('霜铃 GPT · 霜白小工具');
    for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
    for (const attr of ['title', 'aria-label']) for (const element of document.querySelectorAll('[data-i18n-' + attr + ']')) element.setAttribute(attr, t(element.getAttribute('data-i18n-' + attr)));
    renderNotice();
  }
  function renderFocus() {
    const view = presentFocus(data?.focus);
    $('timer').textContent = view.clock; $('focus-progress').value = view.progress;
    $('focus-phase').textContent = view.phaseLabel; $('focus-state').textContent = view.label; $('focus-hint').textContent = view.hint;
    for (const [element, visible] of [['focus-start', view.canStart], ['break-start', view.canStart], ['focus-pause', view.canPause], ['focus-resume', view.canResume], ['focus-stop', view.canStop]]) { $(element).hidden = !visible; $(element).disabled = !connected || isBusy(); }
    const disabled = !connected || isBusy() || !view.canConfigure;
    for (const element of ['focus-minutes', 'break-minutes', 'focus-save']) $(element).disabled = disabled;
    if (data && !configuredDirty && !['focus-minutes', 'break-minutes'].includes(document.activeElement?.id)) { $('focus-minutes').value = data.focus.focusMinutes; $('break-minutes').value = data.focus.breakMinutes; }
  }
  function renderJournal() {
    const journal = data?.journal, entries = journal?.entries || [];
    const selected = entries.find(entry => entry.id === journal?.selectedId);
    const list = entries.filter(entry => !favoritesOnly || entry.favorite);
    const previousFocus = document.activeElement?.dataset?.storyId;
    $('favorites-only').setAttribute('aria-pressed', String(favoritesOnly));
    const buttons = list.map(entry => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.storyId = entry.id; button.setAttribute('aria-current', String(entry.id === selected?.id)); button.disabled = isBusy() || !connected;
      const title = document.createElement('strong'); title.textContent = localized(entry.title);
      if (entry.favorite && globalThis.shuanglingIcons) title.prepend(globalThis.shuanglingIcons.create('favorite', document));
      const status = document.createElement('small'); status.textContent = t(entry.read ? '已读' : '未读'); button.append(title, status);
      button.addEventListener('click', async () => { flushPosition(); await command({ type: 'story.select', id: entry.id }); });
      return button;
    });
    $('story-list').replaceChildren(...buttons);
    if (previousFocus) buttons.find(button => button.dataset.storyId === previousFocus)?.focus();
    $('story-list-empty').hidden = list.length !== 0;
    $('story-title').textContent = selected ? localized(selected.title) : t('选择一篇手记');
    $('story-favorite').disabled = !selected || !connected || isBusy();
    $('story-favorite').setAttribute('aria-pressed', String(selected?.favorite === true));
    buttonLabel($('story-favorite'), t(selected?.favorite ? '已收藏' : '收藏'), 'favorite');
    $('story-read').textContent = selected ? t(selected.read ? '已读' : '未读') : '';
    const nextKey = selected ? `${selected.id}\u0000${getLanguage()}\u0000${localized(selected.body)}` : '';
    if (nextKey !== storyKey) {
      storyKey = nextKey; restoreStory = true; suppressScroll = true;
      $('story-body').textContent = selected ? localized(selected.body) : '';
      requestAnimationFrame(restorePosition);
    }
    renderMemories();
  }
  function selectedMemory() {
    const entries = memoryEntries(data?.memories);
    return entries.find(entry => entry.date === (memoryDraft?.date || selectedMemoryDate || data?.memories?.selectedDate)) || entries[0] || null;
  }
  function renderMemories() {
    const memories = data?.memories, entries = memoryEntries(memories), selected = selectedMemory();
    const available = !!memories, disabled = !connected || isBusy() || !available;
    $('shelf-stories').setAttribute('aria-pressed', String(journalShelf === 'stories'));
    $('shelf-memories').setAttribute('aria-pressed', String(journalShelf === 'memories'));
    $('stories-shelf').hidden = journalShelf !== 'stories'; $('memories-shelf').hidden = journalShelf !== 'memories';
    const unread = entries.filter(entry => !entry.read).length;
    $('memory-unread').textContent = String(unread); $('memory-unread').hidden = unread === 0;
    $('memory-enabled').checked = memories?.enabled === true; $('memory-enabled').disabled = disabled;
    $('memory-reminders').checked = memories?.reminders === true; $('memory-reminders').disabled = disabled;
    $('memory-limit').hidden = memories?.limitReached !== true;
    const previousFocus = document.activeElement?.dataset?.memoryControl;
    const buttons = entries.map(entry => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.memoryControl = `date-${entry.date}`;
      button.setAttribute('aria-current', String(entry.date === selected?.date)); button.disabled = disabled;
      const title = document.createElement('strong'); title.textContent = memoryDate(entry.date, true); button.title = memoryDate(entry.date);
      const status = document.createElement('small'); status.textContent = `${entry.date.slice(0, 4)} · ${t(entry.read ? '已读' : '未读')}`; button.append(title, status);
      button.addEventListener('click', () => chooseMemory(entry.date)); return button;
    });
    $('memory-list').replaceChildren(...buttons);
    $('memories-empty').hidden = !!selected || !!memoryDraft;
    $('memories-empty-text').textContent = t(memories?.enabled === false ? '日常记录已关闭，已有手记仍可阅读。' : '从今天开始，慢慢留下我们的日常。');
    $('memory-entry').hidden = !selected && !memoryDraft;
    $('memory-date').textContent = memoryDate(memoryDraft?.date || selected?.date);
    $('memory-title').textContent = selected ? localized(selected.title) : t('这一页暂时不可用');
    $('memory-body').textContent = selected ? localized(selected.body) : '';
    $('memory-reply-card').hidden = !selected?.reply; $('memory-reply').textContent = selected?.reply || '';
    for (const element of ['memory-add-reply', 'memory-carry', 'memory-edit', 'memory-delete']) $(element).disabled = disabled || !selected || !!memoryDraft;
    buttonLabel($('memory-delete'), t(confirmMemoryDelete === selected?.date ? '确认删除这一页' : '删除这一页'), 'trash');
    $('memory-delete-cancel').hidden = confirmMemoryDelete !== selected?.date || !selected;
    $('memory-delete-cancel').disabled = disabled;
    $('memory-editor-card').hidden = !memoryDraft;
    if (memoryDraft) {
      const name = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English' }[memoryDraft.language];
      $('memory-editor-label').textContent = memoryDraft.mode === 'reply' ? t('你补写的一句') : t('编辑正文 · {language}', { language: name });
      // Polling never writes into the active editor or changes its language.
      $('memory-editor-count').textContent = `${$('memory-editor').value.length} / 1000`;
    }
    $('memory-editor').disabled = disabled; $('memory-save').disabled = disabled || !memoryDraft || (memoryDraft.mode === 'body' && !$('memory-editor').value.trim()); $('memory-cancel').disabled = isBusy();
    const facts = (selected?.facts || []).map(fact => {
      const card = document.createElement('div'); card.className = 'memory-fact';
      const label = document.createElement('p'); label.className = 'eyebrow'; label.textContent = factLabel(fact);
      const text = document.createElement('p'); text.textContent = fact.text || '';
      const actions = document.createElement('div'); actions.className = 'note-actions';
      const add = (key, caption, action) => { const button = document.createElement('button'); button.type = 'button'; button.dataset.memoryControl = `${fact.id}-${key}`; buttonLabel(button, t(caption), { open: 'notes', source: 'back', exclude: 'close' }[key]); button.disabled = disabled || !!memoryDraft; button.addEventListener('click', action); actions.append(button); };
      if (fact.noteId && data?.notes?.some(note => note.id === fact.noteId)) add('open', '打开书签', () => openNote(fact.noteId));
      if (fact.kind === 'reply' && entries.some(entry => entry.date === fact.sourceDate)) add('source', '回到那一页', () => chooseMemory(fact.sourceDate));
      add('exclude', '这段不记了', () => command({ type: 'memory.exclude', date: selected.date, factId: fact.id }));
      card.append(label, text, actions); return card;
    });
    $('memory-facts').replaceChildren(...facts);
    if (previousFocus) {
      const all = [...buttons, ...facts.flatMap(card => card.children?.[2]?.children ? Array.from(card.children[2].children) : [])];
      all.find(button => button.dataset.memoryControl === previousFocus)?.focus();
    }
    const prompt = memories?.prompt;
    $('memory-prompt').hidden = !prompt;
    $('memory-prompt-text').textContent = t(prompt?.kind === 'continue' ? '上次夹住的那一页，今天想接着写吗？' : '新的一页，我写好了。要一起看看吗？');
    buttonLabel($('memory-prompt-open'), t(prompt?.kind === 'continue' ? '打开书签' : '看看'), prompt?.kind === 'continue' ? 'notes' : 'reading');
    $('memory-prompt-open').disabled = disabled || !!memoryDraft; $('memory-prompt-later').disabled = disabled;
  }
  function chooseShelf(shelf) {
    journalShelf = shelf === 'memories' ? 'memories' : 'stories';
    if (journalShelf === 'stories') {
      requestAnimationFrame(restorePosition);
      if (data?.journal?.selectedId) command({ type: 'story.select', id: data.journal.selectedId }, { background: true });
    } else if (selectedMemory() && !memoryDraft) chooseMemory(selectedMemory().date);
    renderJournal();
  }
  async function chooseMemory(value) {
    if (memoryDraft && memoryDraft.date !== value) { notice('请先保存或取消当前编辑。'); return false; }
    selectedMemoryDate = value; confirmMemoryDelete = null; journalShelf = 'memories';
    renderMemories(); return command({ type: 'memory.select', date: value }, { background: true });
  }
  function startMemoryEditor(mode) {
    const selected = selectedMemory(); if (!selected || memoryDraft) return;
    memoryDraft = { date: selected.date, mode, language: getLanguage() };
    $('memory-editor').value = mode === 'reply' ? selected.reply || '' : localized(selected.body);
    confirmMemoryDelete = null; renderMemories(); $('memory-editor').focus(); $('memory-editor-card').scrollIntoView({ block: 'nearest' });
  }
  function openNote(id) {
    const note = data?.notes?.find(note => note.id === id); if (!note) return;
    linkedNoteId = id; archived = note.archived; selectTab('notes'); renderNotes();
    requestAnimationFrame(() => $('note-list').querySelector(`[data-note-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }));
  }
  function date(value) {
    const d = new Date(value); return value !== null && Number.isFinite(d.getTime()) ? d.toLocaleString(getLanguage(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function renderNotes() {
    buttonLabel($('notes-archive'), t(archived ? '返回书签' : '查看归档'), archived ? 'back' : 'archive'); $('notes-archive').setAttribute('aria-pressed', String(archived));
    $('note-text').disabled = !connected || isBusy(); $('note-intent').disabled = !connected || isBusy(); $('note-save').disabled = !connected || isBusy() || !$('note-text').value.trim() || (!editingId && (data?.notes?.length || 0) >= 100);
    buttonLabel($('note-save'), t(editingId ? '保存修改' : '保存书签'), 'save'); $('note-editor-label').textContent = t(editingId ? '编辑书签' : '新建书签'); $('note-cancel').hidden = !editingId && !$('note-text').value;
    $('note-count').textContent = `${$('note-text').value.length} / 1000`;
    const notes = visibleNotes(data?.notes, archived);
    const previousFocus = document.activeElement?.dataset?.noteControl;
    const cards = notes.map(note => {
      const article = document.createElement('article'); article.className = 'note-card'; article.dataset.pinned = String(note.pinned); article.dataset.noteId = note.id; article.dataset.linked = String(note.id === linkedNoteId);
      const text = document.createElement('p'); text.className = 'note-text'; text.textContent = note.text;
      const meta = document.createElement('p'); meta.className = 'note-meta'; meta.textContent = [note.pinned ? t('已置顶') : '', date(note.updatedAt)].filter(Boolean).join(' · ');
      const actions = document.createElement('div'); actions.className = 'note-actions';
      const add = (label, key, action) => { const button = document.createElement('button'); button.type = 'button'; buttonLabel(button, t(label), { edit: 'edit', pin: 'pin', archive: 'archive', delete: 'trash', 'cancel-delete': 'close', continue: 'continue', later: 'pause', done: 'review' }[key]); button.dataset.noteControl = `${note.id}-${key}`; button.disabled = !connected || isBusy(); button.addEventListener('click', action); actions.append(button); return button; };
      add('编辑', 'edit', () => { if (editingId === note.id) { $('note-text').focus(); return; } if (editingId || $('note-text').value.length) { notice('请先保存或取消当前编辑。'); return; } editingId = note.id; $('note-text').value = note.text; $('note-intent').value = ['remember', 'continue'].includes(note.intent) ? note.intent : 'none'; renderNotes(); $('note-text').focus(); $('note-form').scrollIntoView({ block: 'nearest' }); });
      add(note.pinned ? '取消置顶' : '置顶', 'pin', () => command({ type: 'note.pin', id: note.id, pinned: !note.pinned }));
      add(note.archived ? '移出归档' : '归档', 'archive', () => command({ type: 'note.archive', id: note.id, archived: !note.archived }));
      const remove = add(confirmDelete === note.id ? '确认删除' : '删除', 'delete', async () => {
        if (confirmDelete !== note.id) { confirmDelete = note.id; purgeMemories = true; renderNotes(); return; }
        if (await command({ type: 'note.delete', id: note.id, purgeMemories })) { if (editingId === note.id) resetEditor(); confirmDelete = null; renderNotes(); }
      }); remove.className = `${remove.className ? remove.className + ' ' : ''}danger`;
      if (confirmDelete === note.id) add('取消', 'cancel-delete', () => { confirmDelete = null; renderNotes(); });
      if (['remember', 'continue'].includes(note.intent)) {
        const tag = document.createElement('span'); tag.className = 'note-kind'; tag.textContent = t(note.resolved ? '已告一段落' : note.intent === 'continue' ? '下次继续' : '值得记住');
        article.append(tag);
      }
      if (note.intent === 'continue' && !note.resolved && !note.archived) {
        add('继续这一页', 'continue', async () => { if (await command({ type: 'memory.revisit', id: note.id, choice: 'open' })) openNote(note.id); });
        add('先放一放', 'later', async () => { if (await command({ type: 'memory.revisit', id: note.id, choice: 'later' })) notice('先放在这里，准备好再继续。', 'success'); });
        add('告一段落', 'done', () => command({ type: 'memory.revisit', id: note.id, choice: 'done' }));
      }
      article.append(text, meta, actions);
      if (confirmDelete === note.id) {
        const label = document.createElement('label'); label.className = 'note-delete-options';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = purgeMemories; checkbox.addEventListener('change', () => { purgeMemories = checkbox.checked; });
        const caption = document.createElement('span'); caption.textContent = t('同时移除手记中的书签引用'); label.append(checkbox, caption); article.append(label);
      }
      return article;
    });
    $('note-list').replaceChildren(...cards);
    if (previousFocus) $('note-list').querySelector(`[data-note-control="${previousFocus}"]`)?.focus();
    $('notes-empty').textContent = t(archived ? '还没有归档的书签。' : '还没有书签，先留下一条吧。'); $('notes-empty').hidden = notes.length > 0;
  }
  function render() {
    $('connection').textContent = t(connected ? '已连接' : '本机连接已断开'); $('connection').dataset.disconnected = String(!connected);
    renderFocus(); renderJournal(); renderNotes();
  }
  function receive(value) {
    // A failed store read can still carry the independently sampled UI locale.
    // Apply only its allowed language; keep unavailable content out of data.
    if (['zh-CN', 'zh-TW', 'en'].includes(value?.language) && getLanguage() !== value.language) language(value.language);
    if (!value || value.ok === false) throw new Error('connection-unavailable');
    data = value; connected = true;
    if (getLanguage() !== normalizeLanguage(value.language)) language(value.language);
    if (!initialTab) { initialTab = true; selectTab(TABS.includes(value.activeTab) ? value.activeTab : 'focus'); }
    render();
  }
  async function refresh() {
    if (!alive || refreshPending || document.hidden) return;
    refreshPending = true; const version = revision;
    try { const value = await enqueue(() => api?.snapshot ? api.snapshot() : Promise.reject(new Error('bridge-unavailable'))); if (alive && version === revision) receive(value); }
    catch { if (alive && version === revision) { connected = false; render(); } }
    finally { refreshPending = false; }
  }
  async function command(payload, { background = false } = {}) {
    if (!api?.command || !alive) return false;
    const version = ++revision;
    if (!background) { pending++; notice(); render(); }
    try {
      const result = await enqueue(() => api.command(payload));
      if (result?.ok === false) throw new Error(result.error || 'operation-unavailable');
      if (alive && version === revision) receive(result);
      return true;
    } catch { if (alive) { if (!background) notice('操作暂未完成，请稍后重试。'); connected = false; render(); } return false; }
    finally { if (!background) pending--; if (alive) { render(); refresh(); } }
  }
  function selectTab(tab, focus = false) {
    if (!TABS.includes(tab)) return;
    const enteringJournal = tab === 'journal' && activeTab !== 'journal';
    if (activeTab === 'journal' && tab !== 'journal') flushPosition();
    activeTab = tab;
    for (const button of document.querySelectorAll('[data-tab]')) { const selected = button.dataset.tab === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; $(button.dataset.tab).hidden = !selected; if (selected && focus) button.focus(); }
    if (tab === 'journal') requestAnimationFrame(() => { restorePosition(); updatePositionLabel(); });
    if (enteringJournal && journalShelf === 'stories' && data?.journal?.selectedId) command({ type: 'story.select', id: data.journal.selectedId }, { background: true });
  }
  function restorePosition() {
    if (!restoreStory || activeTab !== 'journal' || !data?.journal?.selectedId) return;
    const reader = $('story-reader'); suppressScroll = true;
    reader.scrollTop = Math.max(0, reader.scrollHeight - reader.clientHeight) * (data.journal.positionById?.[data.journal.selectedId] || 0);
    restoreStory = false; updatePositionLabel(); requestAnimationFrame(() => { suppressScroll = false; });
  }
  function updatePositionLabel() {
    const reader = $('story-reader'), max = reader.scrollHeight - reader.clientHeight;
    $('story-position').textContent = `${Math.round(max > 0 ? clamp(reader.scrollTop / max, 0, 1) * 100 : 100)}%`;
  }
  function flushPosition() {
    clearTimeout(positionTimer); positionTimer = null;
    if (positionDraft) { const draft = positionDraft; positionDraft = null; command({ type: 'story.position', ...draft }, { background: true }); }
  }
  function resetEditor() { editingId = null; $('note-text').value = ''; $('note-intent').value = 'none'; renderNotes(); }
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.addEventListener('click', () => { initialTab = true; selectTab(button.dataset.tab); });
    button.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); initialTab = true; const index = TABS.indexOf(button.dataset.tab); selectTab(TABS[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3], true); });
  }
  const stopTab = api?.onTab?.(tab => { if (TABS.includes(tab)) { initialTab = true; selectTab(tab, true); } });
  $('focus-start').addEventListener('click', () => command({ type: 'focus.start', phase: 'focus' }));
  $('break-start').addEventListener('click', () => command({ type: 'focus.start', phase: 'break' }));
  for (const [element, type] of [['focus-pause', 'focus.pause'], ['focus-resume', 'focus.resume'], ['focus-stop', 'focus.stop']]) $(element).addEventListener('click', () => command({ type }));
  for (const element of ['focus-minutes', 'break-minutes']) $(element).addEventListener('input', () => { configuredDirty = true; });
  $('focus-config').addEventListener('submit', async event => { event.preventDefault(); if (!$('focus-config').reportValidity()) return; const focusMinutes = Number($('focus-minutes').value), breakMinutes = Number($('break-minutes').value); if (!Number.isInteger(focusMinutes) || focusMinutes < 10 || focusMinutes > 120 || !Number.isInteger(breakMinutes) || breakMinutes < 1 || breakMinutes > 30) { notice('请填写有效的分钟数。'); return; } if (await command({ type: 'focus.configure', focusMinutes, breakMinutes })) { configuredDirty = false; notice('时长已保存。', 'success'); renderFocus(); } });
  $('favorites-only').addEventListener('click', () => { favoritesOnly = !favoritesOnly; renderJournal(); });
  $('shelf-stories').addEventListener('click', () => chooseShelf('stories'));
  $('shelf-memories').addEventListener('click', () => chooseShelf('memories'));
  for (const id of ['memory-enabled', 'memory-reminders']) $(id).addEventListener('change', () => command({ type: 'memory.configure', enabled: $('memory-enabled').checked, reminders: $('memory-reminders').checked }));
  $('memory-prompt-open').addEventListener('click', async () => { const prompt = data?.memories?.prompt; if (!prompt) return; if (prompt.kind === 'continue') { if (await command({ type: 'memory.revisit', id: prompt.noteId, choice: 'open' })) openNote(prompt.noteId); } else if (await chooseMemory(prompt.date)) await command({ type: 'memory.dismiss', id: prompt.id }, { background: true }); });
  $('memory-prompt-later').addEventListener('click', () => { const prompt = data?.memories?.prompt; if (prompt) command({ type: 'memory.dismiss', id: prompt.id }); });
  $('memory-add-reply').addEventListener('click', () => startMemoryEditor('reply'));
  $('memory-edit').addEventListener('click', () => startMemoryEditor('body'));
  $('memory-editor').addEventListener('input', renderMemories);
  $('memory-cancel').addEventListener('click', () => { memoryDraft = null; $('memory-editor').value = ''; renderMemories(); });
  $('memory-save').addEventListener('click', async () => { if (!memoryDraft || isBusy()) return; const draft = { ...memoryDraft }, text = $('memory-editor').value; if (text.length > 1000 || draft.mode === 'body' && !text.trim()) return; const payload = draft.mode === 'reply' ? { type: 'memory.reply', date: draft.date, text } : { type: 'memory.edit', date: draft.date, language: draft.language, text }; if (await command(payload)) { memoryDraft = null; $('memory-editor').value = ''; renderMemories(); } });
  $('memory-carry').addEventListener('click', () => { const entry = selectedMemory(); if (!entry) return; if (editingId || $('note-text').value.length) { notice('请先保存或取消当前编辑。'); return; } $('note-text').value = continuationText(entry); $('note-intent').value = 'continue'; archived = false; selectTab('notes'); renderNotes(); $('note-text').focus(); $('note-form').scrollIntoView({ block: 'nearest' }); });
  $('memory-delete').addEventListener('click', async () => { const entry = selectedMemory(); if (!entry || memoryDraft) return; if (confirmMemoryDelete !== entry.date) { confirmMemoryDelete = entry.date; renderMemories(); return; } if (await command({ type: 'memory.delete', date: entry.date })) { selectedMemoryDate = null; confirmMemoryDelete = null; renderMemories(); } });
  $('memory-delete-cancel').addEventListener('click', () => { confirmMemoryDelete = null; renderMemories(); });
  $('story-favorite').addEventListener('click', () => { const selected = data?.journal?.entries.find(entry => entry.id === data.journal.selectedId); if (selected) command({ type: 'story.favorite', id: selected.id, favorite: !selected.favorite }); });
  $('story-reader').addEventListener('scroll', () => { updatePositionLabel(); if (suppressScroll || activeTab !== 'journal' || !data?.journal?.selectedId) return; const reader = $('story-reader'), max = reader.scrollHeight - reader.clientHeight; positionDraft = { id: data.journal.selectedId, position: max > 0 ? clamp(reader.scrollTop / max, 0, 1) : 1 }; clearTimeout(positionTimer); positionTimer = setTimeout(flushPosition, 500); }, { passive: true });
  $('notes-archive').addEventListener('click', () => { archived = !archived; confirmDelete = null; renderNotes(); });
  $('note-text').addEventListener('input', renderNotes);
  $('note-cancel').addEventListener('click', resetEditor);
  $('note-form').addEventListener('submit', async event => { event.preventDefault(); const text = $('note-text').value, intent = ['remember', 'continue'].includes($('note-intent').value) ? $('note-intent').value : 'none'; if (!text.trim() || text.length > 1000 || isBusy()) return; const payload = editingId ? { type: 'note.update', id: editingId, text, intent } : { type: 'note.create', text, intent }; if (await command(payload)) { resetEditor(); if (intent !== 'none') notice('好，我给这一页留个位置。', 'success'); } });
  function commitClose() { flushPosition(); lane.finally(() => { api?.close?.(); }); }
  function close() {
    if (editingId || $('note-text').value.length > 0 || memoryDraft) { closeTarget = memoryDraft && (activeTab === 'journal' || !editingId && !$('note-text').value.length) ? 'memory' : 'notes'; closeGuard = true; $('close-guard').hidden = false; $('continue-edit').focus(); return; }
    commitClose();
  }
  function continueEditing() { closeGuard = false; $('close-guard').hidden = true; if (closeTarget === 'memory') { journalShelf = 'memories'; selectTab('journal'); renderMemories(); $('memory-editor').focus(); } else { selectTab('notes'); $('note-text').focus(); } }
  $('close').addEventListener('click', close);
  $('discard-close').addEventListener('click', commitClose);
  $('continue-edit').addEventListener('click', continueEditing);
  const stopCloseRequest = api?.onCloseRequest?.(close);
  document.addEventListener('keydown', event => { if (event.isComposing || event.keyCode === 229) return; if (event.key === 'Escape') { event.preventDefault(); if (closeGuard) continueEditing(); else if (confirmDelete) { confirmDelete = null; renderNotes(); } else if (confirmMemoryDelete) { confirmMemoryDelete = null; renderMemories(); } else close(); } });
  function dispose() { alive = false; clearInterval(timer); clearTimeout(positionTimer); stopTab?.(); stopCloseRequest?.(); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); else flushPosition(); });
  globalThis.addEventListener('pagehide', dispose); globalThis.addEventListener('beforeunload', dispose);
  language('zh-CN'); render(); refresh();
  timer = setInterval(() => { renderFocus(); refresh(); }, 1000);
})();
