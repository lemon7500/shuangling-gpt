'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFileSync } = require('node:fs');
const { panelBounds } = require('./panel-position.cjs');
const ACTIONS = new Set(['idle', 'running-left', 'running-right', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']);
const CHANNELS = ['shuangling-panel:snapshot', 'shuangling-panel:command'];
const safeText = value => typeof value === 'string' ? value.slice(0, 160) : null;
const safeName = value => typeof value === 'string' ? value.replace(/[\s\u0000-\u001f\u007f-\u009f]+/gu, ' ').trim().slice(0, 200) || null : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

function trustedFrame(event, win, expectedUrl) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false;
  return event.senderFrame?.url === expectedUrl;
}
function validateCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const only = allowed => keys.every(key => allowed.includes(key));
  if (['pause', 'resume', 'home', 'hide', 'advanced', 'quit'].includes(value.type) && only(['type'])) return { type: value.type };
  if (value.type === 'autoLaunch' && only(['type', 'enabled']) && typeof value.enabled === 'boolean') return { type: value.type, enabled: value.enabled };
  if (value.type === 'language' && only(['type', 'language']) && ['zh-CN', 'zh-TW', 'en'].includes(value.language)) return { type: value.type, language: value.language };
  if (value.type === 'animation' && only(['type', 'name']) && ACTIONS.has(value.name)) return { type: value.type, name: value.name };
  if (value.type === 'usageThread' && only(['type', 'threadId']) && typeof value.threadId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value.threadId)) return { type: value.type, threadId: value.threadId };
  if (value.type === 'appearance' && only(['type', 'size', 'corner', 'marginX', 'marginY']) && Number.isFinite(value.size) && value.size >= 160 && value.size <= 1200 && ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(value.corner) && [value.marginX, value.marginY].every(n => Number.isFinite(n) && n >= 0 && n <= 3000)) {
    return { type: value.type, size: value.size, corner: value.corner, marginX: value.marginX, marginY: value.marginY };
  }
  return null;
}

function sanitizeSnapshot({ state, usage, account, appearance, preferences, error }) {
  const status = state?.status || {};
  const control = state?.control || {};
  const quota = (sample, context = false) => {
    const historical = context && sample?.status === 'historical' && sample.sample === 'last-model-request';
    const result = { status: historical ? 'historical' : [...(!context ? ['not-applicable'] : []), 'available', 'stale', 'unknown'].includes(sample?.status) ? sample.status : 'unknown', reason: safeText(sample?.reason), observedAt: safeText(sample?.observedAt) };
    if (result.status === 'available' || historical) for (const key of ['remainingTokens', 'windowTokens', 'remainingPercent', 'usedPercent', 'usedTokens', 'resetsAt', 'windowMinutes', 'ageSeconds']) if (number(sample?.[key]) !== null) result[key] = sample[key];
    if (historical) result.sample = 'last-model-request';
    return result;
  };
  const result = {
    ok: !error,
    status: { state: ['unknown', 'idle', 'working', 'waiting', 'complete', 'interrupted'].includes(status.state) ? status.state : 'unknown', threadId: safeText(status.threadId), updatedAt: safeText(status.updatedAt), reason: safeText(status.reason) },
    control: { paused: control.paused === true, preempted: control.preempted === true, issue: safeText(control.issue) },
    appearance: { size: number(appearance?.size), position: { corner: safeText(appearance?.position?.corner), marginX: number(appearance?.position?.marginX), marginY: number(appearance?.position?.marginY) }, display: safeText(appearance?.display), metrics: {} },
    preferences: { autoLaunch: typeof preferences?.autoLaunch === 'boolean' ? preferences.autoLaunch : null, language: ['zh-CN', 'zh-TW', 'en'].includes(preferences?.language) ? preferences.language : 'zh-CN', lifecycle: {} },
  };
  if (status.scope === 'codex') {
    result.status.scope = 'codex';
    for (const key of ['activeCount', 'workingCount', 'waitingCount', 'unknownCount']) if (Number.isSafeInteger(status[key]) && status[key] >= 0 && status[key] <= 10000) result.status[key] = status[key];
  }
  for (const key of ['visibleHeightRatio', 'minWidth', 'maxWidth', 'defaultWidth', 'defaultVisibleHeight']) result.appearance.metrics[key] = number(appearance?.metrics?.[key]);
  for (const key of ['ready', 'enabled', 'observerRunning', 'taskEnabled', 'installed', 'available', 'taskInstalled', 'pluginEnabled', 'sessionActive', 'suppressed']) if (typeof preferences?.lifecycle?.[key] === 'boolean') result.preferences.lifecycle[key] = preferences.lifecycle[key];
  if (number(preferences?.lifecycle?.windowCount) !== null) result.preferences.lifecycle.windowCount = preferences.lifecycle.windowCount;
  for (const key of ['state', 'reason', 'issue']) if (safeText(preferences?.lifecycle?.[key])) result.preferences.lifecycle[key] = safeText(preferences.lifecycle[key]);
  if (usage !== undefined) {
    const selected = usage?.selection;
    const available = selected?.status === 'available' && typeof selected.threadId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(selected.threadId);
    const selection = { status: available ? 'available' : 'unknown', reason: safeText(selected?.reason), source: safeText(selected?.source), observedAt: safeText(selected?.observedAt) };
    if (available) for (const key of ['threadId', 'projectName', 'projectRoot']) selection[key] = safeText(selected[key]);
    if (available) selection.threadName = safeName(selected.threadName);
    if (Array.isArray(selected?.choices)) selection.choices = selected.choices.filter(choice => typeof choice?.threadId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(choice.threadId)).slice(0, 200).map(choice => ({ threadId: choice.threadId, threadName: safeName(choice.threadName), projectName: safeText(choice.projectName) }));
    const project = { status: available && ['available', 'partial'].includes(usage?.project?.status) ? usage.project.status : 'unknown', scope: usage?.project?.scope === 'project' ? 'project' : 'thread', reason: safeText(usage?.project?.reason), observedAt: safeText(usage?.project?.observedAt) };
    if (project.status !== 'unknown') {
      for (const key of ['usedTokens', 'threadCount']) if (Number.isSafeInteger(usage.project[key]) && usage.project[key] >= 0) project[key] = usage.project[key];
    }
    // Production always supplies the independent account read, including null
    // on failure. Never fall back to the selected chat's historical limits.
    const sharedAccount = account !== undefined ? account : usage?.account;
    result.usage = { source: 'local-codex-rollout', selection, project, context: quota(available ? usage?.context : null, true), account: { fiveHour: quota(sharedAccount?.fiveHour), weekly: quota(sharedAccount?.weekly) } };
  }
  if (error) result.error = 'connection-unavailable';
  return result;
}

/** Only the main process reads the private capability. Destination and routes are fixed. */
function managerClient(statePath, fetchImpl = fetch) {
  const capability = () => {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const url = new URL(state.settingsUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || !url.hash || url.username || url.password) throw new Error('settings-unavailable');
    return url;
  };
  const routes = new Set(['/api/state', '/api/usage', '/api/account-usage', '/api/usage-target', '/api/appearance', '/api/preferences', '/api/settings', '/api/shutdown']);
  return {
    settingsUrl: () => capability().href,
    async request(route, body) {
      if (!routes.has(route)) throw new Error('route-not-allowed');
      const base = capability();
      const response = await fetchImpl(new URL(route, base), { method: body === undefined ? 'GET' : 'POST', headers: { 'x-shuangling-token': base.hash.slice(1), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error('request-unavailable');
      return response.json();
    },
  };
}

function createPanelController({ BrowserWindow, ipcMain, screen, shell, statePath, getScale = () => 1, isPetWindow, client = managerClient(statePath), onError = () => {}, directory = __dirname }) {
  const panelUrl = pathToFileURL(path.join(directory, 'panel.html')).href;
  let panel = null;
  let owner = null;
  let session = 0;
  let anchor = null;
  let opening = null;
  let closed = false;
  const send = payload => { if (owner && !owner.isDestroyed()) owner.webContents.send('pet:panel-event', { ...payload, session }); };
  const canPet = event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && !win.isDestroyed() && isPetWindow(win) && event.senderFrame === win.webContents.mainFrame ? win : null;
  };
  const authorized = event => trustedFrame(event, panel, panelUrl);
  async function snapshot(includeUsage) {
    const values = await Promise.allSettled([client.request('/api/state'), client.request('/api/appearance'), client.request('/api/preferences'), ...(includeUsage ? [client.request('/api/usage'), client.request('/api/account-usage')] : [])]);
    const pick = i => values[i]?.status === 'fulfilled' ? values[i].value : undefined;
    return sanitizeSnapshot({ state: pick(0), appearance: pick(1), preferences: pick(2), usage: includeUsage ? pick(3) ?? null : undefined, account: includeUsage ? pick(4) ?? null : undefined, error: values.slice(0, 3).some(v => v.status === 'rejected') });
  }
  function close(reason = 'dismiss') {
    if (!panel && !owner) return;
    const old = panel;
    panel = null;
    send({ kind: 'closed', reason });
    owner = null;
    if (old && !old.isDestroyed()) old.destroy();
  }
  async function open(win, payload = {}) {
    if (closed || win.isDestroyed() || !isPetWindow(win)) return { ok: false };
    if (panel && owner === win && !panel.isDestroyed()) { panel.focus(); return { ok: true }; }
    close();
    owner = win;
    const id = ++session;
    const state = await snapshot(false);
    if (closed || owner !== win || session !== id || win.isDestroyed()) return { ok: false };
    const b = win.getBounds();
    const raw = payload.anchor;
    const validAnchor = raw && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(raw[k])) && raw.width > 0 && raw.height > 0;
    anchor = validAnchor ? { x: Math.max(b.x, Math.min(b.x + b.width, raw.x)), y: Math.max(b.y, Math.min(b.y + b.height, raw.y)), width: Math.min(b.width, raw.width), height: Math.min(b.height, raw.height) } : b;
    const display = screen.getDisplayMatching(anchor);
    const scale = getScale(display);
    const bounds = panelBounds(anchor, display.workArea, scale);
    panel = new BrowserWindow({ ...bounds, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: true, show: false, webPreferences: { preload: path.join(directory, 'panel-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: false } });
    const created = panel;
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('will-navigate', event => event.preventDefault());
    created.webContents.on('will-attach-webview', event => event.preventDefault());
    created.webContents.on('did-finish-load', () => created.webContents.setZoomFactor(scale));
    created.webContents.on('render-process-gone', () => close('renderer-gone'));
    // The renderer gives an open, local listbox first refusal on Escape.
    // Its document handler closes the panel once no nested control owns it.
    created.on('blur', () => { if (panel === created) close(); });
    created.on('closed', () => { if (panel === created) close(); });
    send({ kind: 'opened', allowResume: state.ok && !state.control.paused && !state.control.preempted });
    try {
      await created.loadFile(path.join(directory, 'panel.html'));
      if (panel !== created || created.isDestroyed()) return { ok: false };
      created.show(); created.focus();
      return { ok: true };
    } catch { close('unavailable'); onError('panel-unavailable'); return { ok: false, error: 'panel-unavailable' }; }
  }
  async function command(value) {
    const v = validateCommand(value);
    if (!v) return { ok: false, error: 'invalid-command' };
    try {
      if (v.type === 'pause' || v.type === 'resume') await client.request('/api/settings', { paused: v.type === 'pause' });
      else if (v.type === 'appearance') {
        const { type, ...body } = v;
        const appearance = await client.request('/api/appearance', { ...body, live: true });
        send({ kind: 'appearance', appearance: { size: appearance.size, position: appearance.position, display: appearance.display } });
        return { ok: true, appearance: sanitizeSnapshot({ appearance }).appearance };
      }
      else if (v.type === 'autoLaunch') await client.request('/api/preferences', { autoLaunch: v.enabled });
      else if (v.type === 'language') await client.request('/api/preferences', { language: v.language });
      // The usage selection is intentionally separate from task-following settings.
      else if (v.type === 'usageThread') await client.request('/api/usage-target', { threadId: v.threadId });
      else if (v.type === 'advanced') await shell.openExternal(client.settingsUrl());
      else if (v.type === 'quit') { await client.request('/api/shutdown', {}); close('quit'); }
      else if (v.type === 'animation' || v.type === 'home' || v.type === 'hide') {
        send({ kind: 'command', command: v });
        close(v.type === 'animation' ? 'action' : 'dismiss');
      }
      return { ok: true };
    } catch { return { ok: false, error: 'operation-unavailable' }; }
  }
  const openHandler = (event, payload) => {
    const win = canPet(event);
    if (!win) return Promise.resolve({ ok: false, error: 'unauthorized' });
    if (opening) return opening;
    opening = open(win, payload).finally(() => { opening = null; });
    return opening;
  };
  const closeHandler = event => { if (authorized(event)) close(); };
  const petCloseHandler = event => { if (canPet(event) === owner) close(); };
  ipcMain.handle('pet:open-panel', openHandler);
  ipcMain.on('pet:close-panel', petCloseHandler);
  ipcMain.handle(CHANNELS[0], (event, options) => authorized(event) ? snapshot(options?.includeUsage === true) : { ok: false, error: 'unauthorized' });
  ipcMain.handle(CHANNELS[1], (event, value) => authorized(event) ? command(value) : { ok: false, error: 'unauthorized' });
  ipcMain.on('shuangling-panel:close', closeHandler);
  return {
    open, close, snapshot,
    ownerDestroyed(win) { if (owner === win) close('owner-gone'); },
    reposition() { if (panel && !panel.isDestroyed() && anchor) { const display = screen.getDisplayMatching(anchor); panel.setBounds(panelBounds(anchor, display.workArea, getScale(display))); } },
    destroy() { closed = true; close('shutdown'); for (const channel of [...CHANNELS, 'pet:open-panel']) ipcMain.removeHandler(channel); ipcMain.removeListener('pet:close-panel', petCloseHandler); ipcMain.removeListener('shuangling-panel:close', closeHandler); },
    get window() { return panel; },
  };
}
module.exports = { ACTIONS, validateCommand, trustedFrame, sanitizeSnapshot, managerClient, createPanelController };
