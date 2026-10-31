/* The panel receives only the fixed, local IPC capability exposed by its preload. */
(function () {
  'use strict';
  const i18n = typeof module !== 'undefined' && module.exports ? require('./panel-i18n.js') : globalThis.shuanglingI18n;
  const { t, getLanguage, setLanguage, normalizeLanguage } = i18n;
  const ANIMATIONS = Object.freeze(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review', 'reading', 'looking-around', 'stretching-wings']);
  const OPTIONAL_ANIMATIONS = Object.freeze(['reading', 'looking-around', 'stretching-wings']);
  function animationAvailable(name, snapshot) { return ANIMATIONS.includes(name) && (!OPTIONAL_ANIMATIONS.includes(name) || snapshot?.availableAnimations?.includes(name) === true); }
  const CORNERS = Object.freeze(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
  const STATE_LABELS = { idle: '安静陪伴中', working: '正在认真思考', running: '正在认真思考', waiting: '等你回答', complete: '本轮已完成', completed: '本轮已完成', interrupted: '动作已收起', unknown: '任务状态未知' };
  const HINTS = {
    'log-not-found': '暂时找不到聊天日志，陪伴和拖动仍可使用。',
    'log-permission-denied': '日志暂时不可读，陪伴和拖动仍可使用。',
    'log-format-incompatible': '暂时无法识别任务状态，陪伴和拖动仍可使用。',
    'log-unavailable': '暂时无法读取任务状态，陪伴和拖动仍可使用。',
    'runtime-unavailable': '本机连接暂未就绪，可以稍后重试。',
    'runtime-unreachable': '本机连接暂时断开，可以稍后重试。',
    'pet-not-displayed': '霜铃已隐藏，联动不会自动打开她。',
    'lock-lost': '',
    preempted: '',
    'interaction-active': '你正在操作霜铃，操作结束后会继续联动。',
    'surface-not-ready': '大小与位置已保存，等待桌宠就绪。',
  };
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const clamp = (number, min, max) => Math.min(max, Math.max(min, number));
  const formatNumber = number => Math.round(number).toLocaleString(getLanguage());
  const percent = value => `${Math.round(value * 10) / 10}%`;
  const displayName = (value, max = 200) => typeof value === 'string' ? value.replace(/[\s\u0000-\u001f\u007f-\u009f]+/gu, ' ').trim().slice(0, max) : '';
  const shortId = id => `${id.slice(0, 8)}${id.length > 12 ? `…${id.slice(-4)}` : id.slice(8)}`;

  function clock(value, date = false) {
    const time = typeof value === 'string' || finite(value) ? new Date(value) : null;
    if (!time || !Number.isFinite(time.getTime())) return '';
    return time.toLocaleString(getLanguage(), date ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  /** Historical request context is labelled; expired account balances stay unknown. */
  function presentUsage(sample, { context = false, now = Date.now(), disconnected = false } = {}) {
    if (!context && sample?.status === 'not-applicable') return { available: false, hidden: true, state: 'not-applicable', value: '', suffix: '', percent: '—', time: '', bar: null };
    const observed = typeof sample?.observedAt === 'string' ? Date.parse(sample.observedAt) : NaN;
    const age = now - observed;
    const maxAge = context ? 15 * 60_000 : 5 * 60_000;
    const resetPassed = !context && finite(sample?.resetsAt) && now >= sample.resetsAt * 1000;
    const historical = context && (sample?.status === 'historical' && sample.sample === 'last-model-request' || sample?.status === 'available' && age > maxAge);
    const stale = sample?.status === 'stale' || !context && sample?.status === 'available' && (age > maxAge || resetPassed);
    const validNumber = finite(sample?.remainingPercent) && sample.remainingPercent >= 0 && sample.remainingPercent <= 100;
    const validContext = !context || Number.isSafeInteger(sample?.remainingTokens) && Number.isSafeInteger(sample?.windowTokens) && sample.windowTokens > 0 && sample.remainingTokens >= 0 && sample.remainingTokens <= sample.windowTokens;
    const available = !disconnected && !stale && (sample?.status === 'available' || historical) && Number.isFinite(observed) && age >= -60_000 && validNumber && validContext;
    if (!available) {
      const reason = disconnected ? t('本机连接已断开') : resetPassed || sample?.reason === 'reset-passed' ? t('重置已到，等待新采样') : stale ? t('采样已过期') : t('等待可靠采样');
      return { available: false, state: stale ? 'stale' : 'unknown', value: t('未知'), suffix: '', percent: '—', time: `${reason}${clock(sample?.observedAt) ? ` · ${clock(sample.observedAt)}` : ''}`, bar: null };
    }
    return {
      available: true, historical, state: historical ? 'historical' : 'available', value: context ? formatNumber(sample.remainingTokens) : percent(sample.remainingPercent),
      suffix: context ? `/ ${formatNumber(sample.windowTokens)} tokens` : t('剩余'),
      percent: percent(sample.remainingPercent), bar: sample.remainingPercent,
      time: historical ? t('历史采样 · {time}', { time: new Date(observed).toLocaleString(getLanguage(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) }) : t('采样 {time}', { time: clock(sample.observedAt) }) + (!context && finite(sample.resetsAt) ? t(' · {time} 重置', { time: clock(sample.resetsAt * 1000, true) }) : ''),
    };
  }

  function presentState(snapshot, disconnected = false) {
    const status = snapshot?.status || {}, control = snapshot?.control || {};
    const paused = control.paused === true, manual = control.preempted === true;
    const reason = control.issue || status.reason;
    const state = disconnected ? 'unknown' : status.state;
    const label = disconnected ? t('本机连接已断开') : t(STATE_LABELS[state] || STATE_LABELS.unknown);
    const threadId = typeof status.threadId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(status.threadId) ? status.threadId : '';
    const global = status.scope === 'codex';
    const count = key => Number.isSafeInteger(status[key]) && status[key] >= 0 && status[key] <= 10000 ? status[key] : null;
    const working = count('workingCount'), waiting = count('waitingCount'), unknown = count('unknownCount');
    const counts = global && !disconnected && working !== null && waiting !== null ? t('运行 {working} · 等待 {waiting}', { working, waiting }) + (unknown > 0 ? t(' · 未知 {unknown}', { unknown }) : '') : '';
    return {
      label, threadId, shortThread: global ? t('整个 Codex') : threadId ? `${threadId.slice(0, 8)}${threadId.length > 12 ? `…${threadId.slice(-4)}` : threadId.slice(8)}` : t('尚未绑定'),
      headerLabel: disconnected ? label : global ? `${t('整个 Codex')}${counts ? ` · ${counts}` : ''}` : label, counts,
      badge: disconnected ? t('连接断开') : paused ? t('联动已暂停') : manual ? t('你在控制') : t('正在联动'),
      badgeMuted: disconnected || paused || manual, resume: paused || manual,
      dot: disconnected || paused || state === 'unknown' ? 'unknown' : state === 'waiting' ? 'waiting' : 'active',
      hint: disconnected ? t('可以稍后重试。陪伴与拖动不受面板连接影响。') : paused ? t('恢复后继续跟随整个 Codex。') : manual ? HINTS.preempted : t(HINTS[reason] || '') || (state === 'unknown' ? t('暂时无法确认任务状态，陪伴和拖动仍可使用。') : ''),
    };
  }

  function presentSelection(selection, { disconnected = false } = {}) {
    const threadId = typeof selection?.threadId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(selection.threadId) ? selection.threadId : '';
    const available = !disconnected && selection?.status === 'available' && !!threadId;
    const threadName = displayName(selection?.threadName), projectName = displayName(selection?.projectName, 100) || t('未归入项目');
    const choice = available ? usageChoices(selection).find(choice => choice.threadId === threadId) : null;
    const name = choice?.label || `${threadName || t('未命名聊天')} · ${projectName}${threadName ? '' : ` · ${shortId(threadId)}`}`;
    const caption = selection?.source === 'bound-chat' ? t('默认聊天') : selection?.source === 'selected-chat' ? t('所选聊天') : selection?.source === 'active-page' ? t('当前页面') : t('用量来源');
    return { available, threadId: available ? threadId : '', caption, label: available ? name : t('用量来源未知'), title: available ? [threadName || t('未命名聊天'), projectName, selection.projectRoot, threadId].filter(value => typeof value === 'string' && value).join('\n') : '', status: available ? 'available' : 'unknown' };
  }

  function usageChoices(selection) {
    if (!Array.isArray(selection?.choices)) return [];
    const seen = new Set();
    const choices = selection.choices.filter(choice => {
      if (typeof choice?.threadId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(choice.threadId) || seen.has(choice.threadId)) return false;
      seen.add(choice.threadId); return true;
    }).slice(0, 200).map(choice => ({ threadId: choice.threadId, threadName: displayName(choice.threadName), projectName: displayName(choice.projectName, 100) || t('未归入项目') }));
    const occurrences = new Map();
    for (const choice of choices) { choice.base = `${choice.threadName || t('未命名聊天')} · ${choice.projectName}`; occurrences.set(choice.base, (occurrences.get(choice.base) || 0) + 1); }
    return choices.map(choice => ({ threadId: choice.threadId, label: choice.base + (!choice.threadName || occurrences.get(choice.base) > 1 ? ` · ${shortId(choice.threadId)}` : ''), title: [choice.threadName || t('未命名聊天'), choice.projectName, choice.threadId].join('\n') }));
  }

  /** An incomplete local archive is a lower bound, never a precise cumulative total. */
  function presentProjectUsage(sample, { selection, disconnected = false, now = Date.now() } = {}) {
    const selected = presentSelection(selection, { disconnected });
    const scope = sample?.scope === 'project' ? 'project' : 'thread';
    const label = scope === 'thread' ? t('本聊天已用') : t('本项目已用');
    const observed = typeof sample?.observedAt === 'string' ? Date.parse(sample.observedAt) : NaN;
    const countValid = Number.isSafeInteger(sample?.usedTokens) && sample.usedTokens >= 0;
    const available = selected.available && ['available', 'partial'].includes(sample?.status) && countValid && Number.isFinite(observed) && observed <= now + 60_000;
    const partial = available && sample.status === 'partial';
    const threads = Number.isSafeInteger(sample?.threadCount) && sample.threadCount > 0 ? sample.threadCount : null;
    return {
      label, available, state: available ? partial ? 'partial' : 'available' : 'unknown',
      value: available ? `${partial ? '≥ ' : ''}${formatNumber(sample.usedTokens)}` : t('未知'),
      suffix: available ? 'tokens' : '',
      time: available ? `${partial ? t('部分记录 · ') : ''}${threads && scope === 'project' ? t('{count} 段聊天 · ', { count: threads }) : ''}${t('采样 {time}', { time: clock(sample.observedAt) })}` : disconnected ? t('本机连接已断开') : selected.available ? t('等待可靠记录') : t('等待识别用量来源'),
    };
  }

  function appearanceModel(appearance) {
    const metrics = appearance?.metrics;
    if (!finite(appearance?.size) || !finite(metrics?.visibleHeightRatio) || metrics.visibleHeightRatio <= 0 || metrics.visibleHeightRatio > 1 || !finite(metrics.minWidth) || !finite(metrics.maxWidth) || metrics.minWidth <= 0 || metrics.maxWidth < metrics.minWidth) return null;
    const ratio = metrics.visibleHeightRatio;
    return { ratio, min: Math.round(metrics.minWidth * ratio), max: Math.round(metrics.maxWidth * ratio), height: Math.round(appearance.size * ratio), minWidth: metrics.minWidth, maxWidth: metrics.maxWidth };
  }

  /** Docking alone keeps the exact stored width; height changes convert from visible pixels. */
  function appearanceCommand(appearance, { height, corner } = {}) {
    const model = appearanceModel(appearance);
    if (!model || !CORNERS.includes(corner ?? appearance?.position?.corner)) throw new Error('appearance-unavailable');
    const rawHeight = height === undefined ? undefined : Number(height);
    if (rawHeight !== undefined && !Number.isFinite(rawHeight)) throw new Error('invalid-height');
    const size = rawHeight === undefined ? appearance.size : clamp(Math.round(clamp(rawHeight, model.min, model.max) / model.ratio), model.minWidth, model.maxWidth);
    return { type: 'appearance', size, corner: corner ?? appearance.position.corner, marginX: finite(appearance.position?.marginX) ? appearance.position.marginX : 20, marginY: finite(appearance.position?.marginY) ? appearance.position.marginY : 12 };
  }

  /** A single request lane prevents slow state reads and usage refreshes from overlapping. */
  function createPoller({ snapshot, receive, failure, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, readRevision = () => 0 }) {
    let active = false, timer = null, inFlight = false, nextUsage = 0, rerun = false, forceUsage = false, generation = 0;
    const schedule = delay => { if (active) timer = setTimer(tick, delay); };
    async function tick() {
      if (!active) return;
      if (inFlight) { rerun = true; return; }
      inFlight = true;
      const token = generation, revision = readRevision();
      const includeUsage = forceUsage || now() >= nextUsage;
      forceUsage = false;
      try {
        const value = await snapshot({ includeUsage });
        if (token !== generation || !active) return;
        if (!value || value.ok === false) throw new Error('snapshot-unavailable');
        if (includeUsage) nextUsage = now() + 5000;
        receive(value, { includeUsage, revision });
      } catch (error) { if (token === generation && active) { if (includeUsage) nextUsage = now() + 5000; failure(error, { includeUsage }); } }
      finally {
        inFlight = false;
        if (active) { const delay = rerun ? 0 : 1000; rerun = false; schedule(delay); }
      }
    }
    return {
      start() { if (active) return; active = true; generation++; nextUsage = 0; if (inFlight) rerun = true; else tick(); },
      stop() { active = false; generation++; if (timer !== null) clearTimer(timer); timer = null; rerun = false; },
      refresh({ usage = false } = {}) { if (!active) return; forceUsage ||= usage; if (timer !== null) clearTimer(timer); timer = null; if (inFlight) rerun = true; else tick(); },
    };
  }

  const model = { i18n, ANIMATIONS, animationAvailable, presentUsage, presentState, presentSelection, presentProjectUsage, usageChoices, appearanceModel, appearanceCommand, createPoller };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const buttonLabel = (element, text, icon) => { if (globalThis.shuanglingIcons) globalThis.shuanglingIcons.setLabel(element, text, icon); else element.textContent = text; };
  const api = globalThis.shuanglingPanel;
  let lastSnapshot = null, currentAppearance = null, currentPreferences = null, usage = null, disconnected = false;
  let editingHeight = false, heightDirty = false, appearancePending = false, preferencePending = false, usageTargetPending = false, usageChoicesKey = '', usagePickerOpen = false, usageActiveIndex = 0, renderedUsageChoices = [], renderedUsageId = null, busy = false, revision = 0;
  const messageFor = error => ({ 'invalid-height': t('请填写有效的显示高度。'), 'appearance-unavailable': t('大小信息暂未就绪，请稍后重试。'), 'invalid-appearance': t('大小或位置超出可用范围。'), 'config-conflict': t('设置刚被其他操作更新，请稍后重试。'), 'lifecycle-unavailable': t('自动联动暂未就绪，请稍后重试。'), 'watcher-unavailable': t('自动联动暂未就绪，请稍后重试。') }[error?.message] || t('操作暂未完成，请稍后重试。'));
  function notice(text = '', kind = 'error') { $('notice').textContent = text; $('notice').dataset.kind = kind; $('notice').hidden = !text; }
  function applyLanguage(value) {
    const next = normalizeLanguage(value);
    const changed = getLanguage() !== next;
    setLanguage(next);
    document.documentElement.lang = next;
    document.title = t('霜铃 GPT · 控制面板');
    for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
    for (const attribute of ['title', 'aria-label']) for (const element of document.querySelectorAll('[data-i18n-' + attribute + ']')) element.setAttribute(attribute, t(element.getAttribute('data-i18n-' + attribute)));
    if (changed) { notice(); usageChoicesKey = ''; }
  }
  function renderState() {
    const state = presentState(lastSnapshot, disconnected);
    $('header-state').textContent = state.headerLabel;
    $('status-dot').dataset.state = state.dot;
    $('task-state').textContent = state.label;
    $('control-badge').textContent = state.badge;
    $('control-badge').dataset.state = state.badgeMuted ? 'muted' : 'active';
    $('thread').textContent = state.shortThread;
    $('thread').title = state.threadId;
    $('codex-counts').textContent = state.counts;
    $('codex-counts').hidden = !state.counts;
    buttonLabel($('pause'), state.resume ? t('恢复联动') : t('暂停联动'), state.resume ? 'play' : 'pause');
    $('pause').disabled = busy || !api;
    $('usage-thread').disabled = busy || !api;
    $('state-hint').textContent = state.hint;
    $('state-hint').hidden = !state.hint;
  }
  function renderUsage() {
    const selected = presentSelection(usage?.selection, { disconnected });
    $('usage-source-caption').textContent = selected.caption;
    $('usage-source').textContent = selected.label;
    $('usage-source').title = selected.title;
    $('usage-source').dataset.state = selected.status;
    const choices = usageChoices(usage?.selection), choiceKey = JSON.stringify(choices);
    $('usage-source').hidden = choices.length > 0;
    $('usage-picker').hidden = !usagePickerOpen && choices.length === 0;
    $('usage-thread').title = selected.title;
    if (!usagePickerOpen && choiceKey !== usageChoicesKey) {
      usageChoicesKey = choiceKey;
      renderedUsageChoices = choices;
      const options = choices.map((choice, index) => { const option = document.createElement('button'); option.type = 'button'; option.id = `usage-option-${index}`; option.dataset.threadId = choice.threadId; option.setAttribute('role', 'option'); option.tabIndex = -1; option.textContent = choice.label; option.title = choice.title; option.addEventListener('click', () => chooseUsageThread(choice.threadId)); return option; });
      $('usage-options').replaceChildren(...options);
    }
    // Never rewrite an in-progress native/user selection on the one-second poll.
    if (!usagePickerOpen && !usageTargetPending) {
      if (renderedUsageId !== selected.threadId) { renderedUsageId = selected.threadId; $('usage-thread').value = selected.threadId; }
      $('usage-current').textContent = selected.available ? selected.label : t('选择用量聊天');
      for (const option of $('usage-options').children) option.setAttribute('aria-selected', String(option.dataset.threadId === selected.threadId));
    }
    for (const [key, sample, context] of [['context', usage?.context, true], ['fiveHour', usage?.account?.fiveHour, false], ['weekly', usage?.account?.weekly, false]]) {
      const value = presentUsage(context && !selected.available ? null : sample, { context, disconnected });
      if (!context) $(key + '-card').hidden = value.hidden === true;
      if (context) $('context-label').textContent = value.historical ? t('上次请求上下文剩余') : t('上下文剩余');
      $(key + '-value').replaceChildren(document.createTextNode(value.value));
      if (context && value.available) { const suffix = document.createElement('small'); suffix.textContent = value.suffix; $(key + '-value').append(suffix); }
      if (context) $('context-percent').textContent = value.percent;
      $(key + '-bar').hidden = !value.available;
      if (value.available) $(key + '-bar').value = value.bar;
      $(key + '-time').textContent = value.time;
      $(key + '-time').dataset.state = value.state;
    }
    $('quota-grid').classList.toggle('single-window', $('fiveHour-card').hidden || $('weekly-card').hidden);
    const project = presentProjectUsage(usage?.project, { selection: usage?.selection, disconnected });
    $('project-label').textContent = project.label;
    $('project-value').textContent = project.value;
    $('project-suffix').textContent = project.suffix;
    $('project-time').textContent = project.time;
    $('project-time').dataset.state = project.state;
  }
  function updateRange() {
    const input = $('height-range');
    const fill = (Number(input.value) - Number(input.min)) / Math.max(1, Number(input.max) - Number(input.min)) * 100;
    input.style.setProperty('--range-fill', `${clamp(fill, 0, 100)}%`);
  }
  function renderAppearance() {
    const appearance = appearanceModel(currentAppearance);
    const disabled = !appearance || appearancePending || busy;
    for (const id of ['height-range', 'height-number', 'corner']) $(id).disabled = disabled;
    if (!appearance || editingHeight || heightDirty || appearancePending) return;
    for (const id of ['height-range', 'height-number']) { $(id).min = appearance.min; $(id).max = appearance.max; $(id).value = appearance.height; }
    $('height-min').textContent = `${appearance.min} px`;
    $('height-max').textContent = `${appearance.max} px`;
    $('corner').value = currentAppearance.position?.corner || 'bottom-right';
    updateRange();
  }
  function renderPreferences() {
    $('auto-launch').disabled = !currentPreferences || preferencePending || busy;
    $('language').disabled = !currentPreferences || preferencePending || busy;
    $('ambient-enabled').disabled = !currentPreferences || preferencePending || busy;
    $('ambient-frequency').disabled = !currentPreferences || preferencePending || busy || currentPreferences.ambientEnabled === false;
    if (currentPreferences && !preferencePending) $('language').value = normalizeLanguage(currentPreferences.language);
    if (!currentPreferences) return;
    $('ambient-enabled').setAttribute('aria-checked', String(currentPreferences.ambientEnabled !== false));
    if (!preferencePending) $('ambient-frequency').value = ['quiet', 'normal', 'lively'].includes(currentPreferences.ambientFrequency) ? currentPreferences.ambientFrequency : 'normal';
    const enabled = currentPreferences.autoLaunch !== false;
    $('auto-launch').setAttribute('aria-checked', String(enabled));
    const lifecycle = currentPreferences.lifecycle;
    const ready = lifecycle?.available === true && lifecycle?.taskInstalled === true && lifecycle?.taskEnabled === true && lifecycle?.pluginEnabled === true;
    $('launch-hint').textContent = !enabled ? t('自动启动已关闭') : ready ? t('自动启动已开启') : t('自动联动未就绪，仍可手动启动霜铃。');
  }
  function renderActions() {
    let count = 0;
    for (const button of document.querySelectorAll('[data-animation]')) { const available = animationAvailable(button.dataset.animation, lastSnapshot); if (available) count++; button.disabled = busy || !api || !available; button.title = available ? '' : t('素材待完善'); }
    $('action-count').textContent = t('{count} / {total} 可用', { count, total: ANIMATIONS.length });
    for (const button of document.querySelectorAll('[data-desk]')) button.disabled = busy || !api;
  }
  const poller = createPoller({
    snapshot: options => api?.snapshot ? api.snapshot(options) : Promise.reject(new Error('bridge-unavailable')),
    readRevision: () => revision,
    receive(value, request) {
      lastSnapshot = value; disconnected = false;
      if (request.includeUsage) {
        if (request.revision === revision && !usageTargetPending) {
          // A slow/unreadable chat must not remove the escape route to another
          // chat. Keep only the already sanitized choices, never its identity
          // or previous context/token values. Account remains the new source.
          const previousChoices = usage?.selection?.choices;
          usage = value.usage || null;
          if (usage?.selection?.status !== 'available' && !usage?.selection?.choices?.length && previousChoices?.length) {
            usage = { ...usage, selection: { ...usage?.selection, status: 'unknown', choices: previousChoices } };
          }
        }
        else usage = { ...usage, account: value.usage?.account ?? null };
      }
      if (request.revision === revision) {
        if (value.appearance && !appearancePending) currentAppearance = value.appearance;
        if (value.preferences && !preferencePending) {
          currentPreferences = value.preferences;
          if (getLanguage() !== normalizeLanguage(currentPreferences.language)) applyLanguage(currentPreferences.language);
        }
      }
      renderState(); renderUsage(); renderAppearance(); renderPreferences(); renderActions();
    },
    failure() { disconnected = true; renderState(); renderUsage(); },
  });
  async function command(payload, { success = '', refresh = true } = {}) {
    if (!api?.command || busy) return false;
    busy = true; revision++; notice(); renderState(); renderAppearance(); renderPreferences();
    document.querySelectorAll('[data-animation],[data-desk],#home,#hide,#quit,#advanced').forEach(button => button.disabled = true);
    try {
      const result = await api.command(payload);
      if (result?.ok === false) throw new Error(typeof result.error === 'string' ? result.error : 'operation-unavailable');
      if (success) notice(success, 'success');
      if (refresh) poller.refresh();
      return true;
    } catch (error) { notice(messageFor(error)); return false; }
    finally {
      busy = false; renderState(); renderAppearance(); renderPreferences();
      document.querySelectorAll('#home,#hide,#quit,#advanced').forEach(button => button.disabled = false);
      renderActions();
    }
  }
  async function saveAppearance() {
    if (appearancePending || busy) return;
    let payload;
    try { payload = appearanceCommand(currentAppearance, { ...(heightDirty ? { height: $('height-number').value.trim() === '' ? NaN : Number($('height-number').value) } : {}), corner: $('corner').value }); }
    catch (error) { notice(messageFor(error)); return; }
    appearancePending = true;
    renderAppearance();
    const saved = await command(payload, { success: t('大小与位置已保存。'), refresh: false });
    if (saved) { currentAppearance = { ...currentAppearance, size: payload.size, position: { corner: payload.corner, marginX: payload.marginX, marginY: payload.marginY } }; heightDirty = false; }
    appearancePending = false; renderAppearance(); poller.refresh();
  }
  function selectTab(name, focus = false) {
    if (usagePickerOpen) closeUsagePicker();
    for (const button of document.querySelectorAll('[data-tab]')) {
      const active = button.dataset.tab === name;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      $(button.dataset.tab).hidden = !active;
      if (active && focus) button.focus();
    }
    document.querySelector('.scroll-area').scrollTop = 0;
  }
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.addEventListener('click', () => selectTab(button.dataset.tab));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = ['overview', 'actions', 'settings'], index = tabs.indexOf(button.dataset.tab);
      selectTab(tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3], true);
    });
  }
  function close() { poller.stop(); api?.close?.(); }
  $('close').addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
  $('pause').addEventListener('click', () => command({ type: presentState(lastSnapshot).resume ? 'resume' : 'pause' }));
  function markUsageOption() {
    const options = Array.from($('usage-options').children);
    for (let index = 0; index < options.length; index++) options[index].dataset.active = String(index === usageActiveIndex);
    const active = options[usageActiveIndex];
    if (active) { $('usage-thread').setAttribute('aria-activedescendant', active.id); active.scrollIntoView({ block: 'nearest' }); }
  }
  function closeUsagePicker({ focus = false, refresh = true } = {}) {
    usagePickerOpen = false; $('usage-options').hidden = true; $('usage-thread').setAttribute('aria-expanded', 'false'); $('usage-thread').removeAttribute('aria-activedescendant');
    if (refresh) renderUsage();
    if (focus) $('usage-thread').focus();
  }
  function openUsagePicker() {
    if (busy || usageTargetPending || !renderedUsageChoices.length) return;
    usagePickerOpen = true; $('usage-options').hidden = false; $('usage-thread').setAttribute('aria-expanded', 'true');
    usageActiveIndex = Math.max(0, renderedUsageChoices.findIndex(choice => choice.threadId === $('usage-thread').value));
    const button = $('usage-thread').getBoundingClientRect(), area = document.querySelector('.scroll-area').getBoundingClientRect();
    const below = area.bottom - button.bottom - 6, above = button.top - area.top - 6, upwards = below < 90 && above > below;
    $('usage-options').style.top = upwards ? 'auto' : 'calc(100% + 3px)'; $('usage-options').style.bottom = upwards ? 'calc(100% + 3px)' : 'auto';
    $('usage-options').style.maxHeight = `${Math.max(55, Math.min(180, upwards ? above : below))}px`;
    markUsageOption();
  }
  async function chooseUsageThread(threadId) {
    const choice = renderedUsageChoices.find(choice => choice.threadId === threadId);
    if (usageTargetPending || busy || !choice) return;
    usageTargetPending = true;
    $('usage-thread').value = threadId; $('usage-current').textContent = choice.label;
    closeUsagePicker({ focus: true, refresh: false });
    // Clear the previous project's values while the read-only view is being switched.
    usage = { ...usage, selection: { ...usage.selection, status: 'unknown', source: 'selected-chat', threadId }, context: null, project: null };
    renderUsage();
    await command({ type: 'usageThread', threadId }, { refresh: false });
    usageTargetPending = false; poller.refresh({ usage: true });
  }
  $('usage-thread').addEventListener('click', () => usagePickerOpen ? closeUsagePicker() : openUsagePicker());
  $('usage-thread').addEventListener('keydown', event => {
    if (event.key === 'Tab') { if (usagePickerOpen) closeUsagePicker(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
    if (event.key === 'Escape' && !usagePickerOpen) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { closeUsagePicker({ focus: true }); return; }
    if (!usagePickerOpen) { openUsagePicker(); return; }
    if (event.key === 'Enter' || event.key === ' ') { chooseUsageThread(renderedUsageChoices[usageActiveIndex]?.threadId); return; }
    usageActiveIndex = event.key === 'Home' ? 0 : event.key === 'End' ? renderedUsageChoices.length - 1 : clamp(usageActiveIndex + (event.key === 'ArrowDown' ? 1 : -1), 0, renderedUsageChoices.length - 1);
    markUsageOption();
  });
  document.addEventListener('pointerdown', event => { if (usagePickerOpen && !$('usage-picker').contains(event.target)) closeUsagePicker(); });
  for (const button of document.querySelectorAll('[data-animation]')) button.addEventListener('click', () => { if (animationAvailable(button.dataset.animation, lastSnapshot)) command({ type: 'animation', name: button.dataset.animation }, { refresh: false }); });
  for (const button of document.querySelectorAll('[data-desk]')) button.addEventListener('click', () => command({ type: 'desk', tab: button.dataset.desk }, { refresh: false }));
  for (const type of ['home', 'hide', 'quit', 'advanced']) $(type).addEventListener('click', () => command({ type }, { refresh: !['quit', 'hide'].includes(type) }));
  for (const id of ['height-range', 'height-number']) {
    $(id).addEventListener('focus', () => { editingHeight = true; });
    $(id).addEventListener('blur', () => { editingHeight = false; renderAppearance(); });
    $(id).addEventListener('input', () => {
      heightDirty = true;
      const other = id === 'height-range' ? 'height-number' : 'height-range';
      if ($(id).value.trim() !== '') $(other).value = $(id).value;
      updateRange();
    });
    $(id).addEventListener('change', saveAppearance);
    $(id).addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); saveAppearance(); } });
  }
  $('corner').addEventListener('change', saveAppearance);
  $('auto-launch').addEventListener('click', async () => {
    if (preferencePending || busy || !currentPreferences) return;
    const enabled = currentPreferences.autoLaunch === false;
    preferencePending = true; renderPreferences();
    const saved = await command({ type: 'autoLaunch', enabled }, { success: enabled ? t('已开启随 Codex 自动启动。') : t('已关闭自动启动。'), refresh: false });
    if (saved) currentPreferences = { ...currentPreferences, autoLaunch: enabled };
    preferencePending = false; renderPreferences(); poller.refresh();
  });
  $('language').addEventListener('change', async () => {
    if (preferencePending || busy || !currentPreferences) return;
    const language = normalizeLanguage($('language').value);
    preferencePending = true; renderPreferences();
    const saved = await command({ type: 'language', language }, { refresh: false });
    if (saved) {
      currentPreferences = { ...currentPreferences, language };
      applyLanguage(language); renderState(); renderUsage();
      notice(t('界面语言已保存。'), 'success');
    }
    preferencePending = false; renderPreferences(); poller.refresh();
  });
  async function saveAmbient(enabled, frequency) {
    if (preferencePending || busy || !currentPreferences) return;
    preferencePending = true; renderPreferences();
    const saved = await command({ type: 'ambient', enabled, frequency }, { success: t('自主陪伴设置已保存。'), refresh: false });
    if (saved) currentPreferences = { ...currentPreferences, ambientEnabled: enabled, ambientFrequency: frequency };
    preferencePending = false; renderPreferences(); poller.refresh();
  }
  $('ambient-enabled').addEventListener('click', () => saveAmbient(currentPreferences?.ambientEnabled === false, $('ambient-frequency').value));
  $('ambient-frequency').addEventListener('change', () => saveAmbient(currentPreferences?.ambientEnabled !== false, $('ambient-frequency').value));
  applyLanguage(getLanguage());
  renderActions();
  document.addEventListener('visibilitychange', () => { if (document.hidden) poller.stop(); else poller.start(); });
  globalThis.addEventListener('pagehide', () => poller.stop());
  globalThis.addEventListener('beforeunload', () => poller.stop());
  if (!document.hidden) poller.start();
})();
