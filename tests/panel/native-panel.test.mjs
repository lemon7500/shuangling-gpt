import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { panelBounds } = require('../../vendor/dsh-pet/runtime/electron-helper/panel-position.cjs');
const { createPanelController, sanitizeSnapshot, trustedFrame, validateCommand } = require('../../vendor/dsh-pet/runtime/electron-helper/panel-main.cjs');

test('panel geometry fits every corner of negative-origin displays at 100/150/200 percent', () => {
  for (const scale of [1, 1.5, 2]) for (const area of [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1600, y: -500, width: 1600, height: 900 }, { x: 0, y: 0, width: 320, height: 240 }]) for (const right of [false, true]) for (const bottom of [false, true]) {
    const anchor = { x: right ? area.x + area.width - 100 : area.x, y: bottom ? area.y + area.height - 200 : area.y, width: 100, height: 200 };
    const b = panelBounds(anchor, area, scale);
    assert.ok(b.x >= area.x && b.y >= area.y);
    assert.ok(b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height);
    assert.ok(b.width <= 352 * scale && b.height <= 520 * scale);
  }
});

test('panel rejects unknown commands, arbitrary destinations and invalid native sizes', () => {
  for (const bad of [null, [], { type: 'fetch', url: 'http://example.test' }, { type: 'advanced', url: 'http://evil.test' }, { type: 'autoLaunch', enabled: 1 }, { type: 'animation', name: '__proto__' }, { type: 'usageThread', threadId: '../other' }, { type: 'usageThread', threadId: 'chat', url: 'https://arbitrary.test' }, { type: 'appearance', size: 10, corner: 'top-left', marginX: 0, marginY: 0 }]) assert.equal(validateCommand(bad), null);
  assert.deepEqual(validateCommand({ type: 'animation', name: 'running-right' }), { type: 'animation', name: 'running-right' });
  assert.deepEqual(validateCommand({ type: 'usageThread', threadId: 'other-chat' }), { type: 'usageThread', threadId: 'other-chat' });
});

test('snapshot returns only public metadata and never capabilities or message fields', () => {
  const snapshot = sanitizeSnapshot({ state: { status: { state: 'working', threadId: 'chat', message: 'private conversation' }, control: { paused: true, preempted: true, lockId: 'secret-lock' }, token: 'secret-token' }, appearance: { size: 396, position: { corner: 'bottom-right', marginX: 20, marginY: 12 } }, preferences: { autoLaunch: true, lifecycle: { available: true, taskInstalled: true, taskEnabled: true, pluginEnabled: true, secret: 'private' } }, usage: { context: { status: 'stale', remainingTokens: 10000, observedAt: new Date().toISOString() }, account: { weekly: { status: 'available', remainingPercent: 90 } }, text: 'private' } });
  assert.equal(snapshot.usage.context.remainingTokens, undefined);
  assert.equal(snapshot.preferences.lifecycle.available, true);
  for (const privateValue of ['private', 'secret-token', 'secret-lock']) assert.ok(!JSON.stringify(snapshot).includes(privateValue));
});

test('snapshot forwards only safe current-page totals and clears previous project context when selection is unknown', () => {
  const usage = { selection: { status: 'available', threadId: 'other-chat', projectName: '新项目', projectRoot: 'D:/new', source: 'active-page', observedAt: new Date().toISOString(), message: 'PRIVATE BODY' }, project: { status: 'partial', scope: 'project', usedTokens: 123456, threadCount: 2, observedAt: new Date().toISOString(), messages: 'PRIVATE BODY' }, context: { status: 'available', remainingTokens: 321, windowTokens: 1000, remainingPercent: 32.1 }, account: { fiveHour: { status: 'available', remainingPercent: 12 } } };
  const available = sanitizeSnapshot({ usage }).usage;
  assert.equal(available.selection.threadId, 'other-chat');
  assert.equal(available.project.status, 'partial');
  assert.equal(available.project.usedTokens, 123456);
  assert.ok(!JSON.stringify(available).includes('PRIVATE BODY'));
  const unknown = sanitizeSnapshot({ usage: { ...usage, selection: { ...usage.selection, status: 'unknown' } } }).usage;
  assert.equal(unknown.selection.projectName, undefined);
  assert.equal(unknown.selection.threadId, undefined);
  assert.equal(unknown.project.usedTokens, undefined);
  assert.equal(unknown.context.remainingTokens, undefined);
  assert.equal(unknown.account.fiveHour.remainingPercent, 12);
});

test('snapshot forwards historical numbers only for verified selected-chat request context', () => {
  const historical = { status: 'historical', sample: 'last-model-request', observedAt: new Date().toISOString(), remainingTokens: 321, windowTokens: 1000, remainingPercent: 32.1 };
  const usage = { selection: { status: 'available', threadId: 'chat' }, context: historical, account: { weekly: historical } };
  const known = sanitizeSnapshot({ usage }).usage;
  assert.equal(known.context.status, 'historical');
  assert.equal(known.context.remainingTokens, 321);
  assert.equal(known.context.sample, 'last-model-request');
  assert.equal(known.account.weekly.status, 'unknown');
  assert.equal(known.account.weekly.remainingPercent, undefined);
  const unavailable = sanitizeSnapshot({ usage: { ...usage, selection: { status: 'unknown' } } }).usage;
  assert.equal(unavailable.context.remainingTokens, undefined);
  assert.equal(sanitizeSnapshot({ usage: { ...usage, context: { ...historical, sample: 'unverified' } } }).usage.context.remainingTokens, undefined);
});

test('independent account source wins over selected history and only quota fields allow inapplicability', () => {
  const usage = { context: { status: 'not-applicable' }, account: { weekly: { status: 'available', remainingPercent: 99 } } };
  const account = { fiveHour: { status: 'not-applicable', reason: 'window-not-applicable', observedAt: new Date().toISOString(), remainingPercent: 99 }, weekly: { status: 'available', remainingPercent: 93 } };
  const snapshot = sanitizeSnapshot({ usage, account }).usage;
  assert.equal(snapshot.account.weekly.remainingPercent, 93);
  assert.equal(snapshot.account.fiveHour.status, 'not-applicable');
  assert.equal(snapshot.account.fiveHour.remainingPercent, undefined);
  assert.equal(snapshot.context.status, 'unknown');
  assert.equal(sanitizeSnapshot({ usage, account: null }).usage.account.weekly.status, 'unknown');
  assert.equal(sanitizeSnapshot({ usage, account: null }).usage.account.weekly.remainingPercent, undefined);
});

test('snapshot keeps normalized bounded chat names for selection and choices', () => {
  const usage = { selection: { status: 'available', threadId: 'chat', threadName: '  具体\n聊天\t名称 ', choices: [{ threadId: 'chat', threadName: ' 长'.repeat(300), projectName: '桌宠', private: 'PRIVATE BODY' }] } };
  const result = sanitizeSnapshot({ usage }).usage.selection;
  assert.equal(result.threadName, '具体 聊天 名称');
  assert.equal(result.choices[0].threadName.length, 200);
  assert.ok(!JSON.stringify(result).includes('PRIVATE BODY'));
  assert.equal(sanitizeSnapshot({ usage: { selection: { status: 'available', threadId: 'chat', threadName: null } } }).usage.selection.threadName, null);
});

test('snapshot permits only finite bounded global Codex counters', () => {
  const result = sanitizeSnapshot({ state: { status: { state: 'working', scope: 'codex', activeCount: 4, workingCount: 2, waitingCount: 1, unknownCount: -1 } } }).status;
  assert.equal(result.scope, 'codex');
  assert.equal(result.activeCount, 4);
  assert.equal(result.workingCount, 2);
  assert.equal(result.waitingCount, 1);
  assert.equal(result.unknownCount, undefined);
});

test('only the panel main frame can use the panel IPC', () => {
  const mainFrame = { url: 'file:///panel.html' }, contents = { mainFrame };
  const win = { webContents: contents, isDestroyed: () => false };
  assert.equal(trustedFrame({ sender: contents, senderFrame: mainFrame }, win, mainFrame.url), true);
  assert.equal(trustedFrame({ sender: contents, senderFrame: { url: mainFrame.url } }, win, mainFrame.url), false);
  assert.equal(trustedFrame({ sender: { mainFrame }, senderFrame: mainFrame }, win, mainFrame.url), false);
  assert.equal(trustedFrame({ sender: contents, senderFrame: mainFrame }, win, 'file:///other.html'), false);
});

function fakeNative({ request } = {}) {
  const ipc = new EventEmitter(); ipc.handlers = new Map(); ipc.handle = (key, fn) => ipc.handlers.set(key, fn); ipc.removeHandler = key => ipc.handlers.delete(key);
  let sequence = 0;
  class Window extends EventEmitter {
    constructor(options = {}) { super(); this.id = ++sequence; this.options = options; this.destroyed = false; this.bounds = { x: 400, y: 400, width: 500, height: 400, ...options }; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'file:///pet.html' }; this.sent = []; this.webContents.send = (channel, value) => this.sent.push({ channel, value }); this.webContents.setWindowOpenHandler = fn => this.popups = fn; this.webContents.setZoomFactor = value => this.zoom = value; }
    static fromWebContents(contents) { return windows.find(win => win.webContents === contents); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    getBounds() { return this.bounds; }
    setBounds(value) { this.bounds = value; }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    async loadFile(file) { this.webContents.mainFrame.url = new URL(`file:///${file.replaceAll('\\', '/')}`).href; this.webContents.emit('did-finish-load'); }
  }
  const windows = [];
  const Original = Window;
  class TrackedWindow extends Original { constructor(options) { super(options); windows.push(this); } }
  const owner = new TrackedWindow();
  const requests = [];
  let paused = false;
  const client = { settingsUrl: () => 'http://127.0.0.1:9999/#secret-capability', async request(route, body) { requests.push({ route, body }); if (request) { const value = await request(route, body); if (value !== undefined) return value; } if (route === '/api/state') return { status: { state: 'idle', threadId: 'chat' }, control: { paused, preempted: false } }; if (route === '/api/settings') paused = body.paused; if (route === '/api/appearance') return body || { size: 396, position: { corner: 'bottom-right', marginX: 20, marginY: 12 } }; if (route === '/api/preferences') return { autoLaunch: true }; return {}; } };
  const controller = createPanelController({ BrowserWindow: TrackedWindow, ipcMain: ipc, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }, shell: { openExternal: async () => {} }, client, isPetWindow: win => win === owner });
  return { controller, owner, ipc, requests, windows };
}

test('failed manager controls preserve the existing local animation handoff', async () => {
  for (const type of ['pause', 'resume', 'quit']) {
    const f = fakeNative({ request(route, body) {
      if (body && ['/api/settings', '/api/shutdown'].includes(route)) throw Error('offline');
    } });
    await f.controller.open(f.owner);
    const panel = f.controller.window;
    const result = await f.ipc.handlers.get('shuangling-panel:command')({ sender: panel.webContents, senderFrame: panel.webContents.mainFrame }, { type });
    assert.equal(result.ok, false, type);
    assert.equal(f.owner.sent.filter(row => row.value.kind === 'command').length, 0, `${type} must not cancel a local animation handoff after a failed manager write`);
    assert.equal(f.controller.window, panel);
    f.controller.destroy();
  }
});

test('manager controls reach the pet only after their write succeeds', async () => {
  for (const type of ['pause', 'resume', 'quit']) {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const f = fakeNative({ request(route, body) {
      if (body && ['/api/settings', '/api/shutdown'].includes(route)) return pending;
    } });
    await f.controller.open(f.owner);
    const panel = f.controller.window;
    const task = f.ipc.handlers.get('shuangling-panel:command')({ sender: panel.webContents, senderFrame: panel.webContents.mainFrame }, { type });
    await Promise.resolve();
    assert.equal(f.owner.sent.filter(row => row.value.kind === 'command').length, 0, `${type} is still pending`);
    release({ ok: true });
    assert.equal((await task).ok, true);
    assert.equal(f.owner.sent.filter(row => row.value.kind === 'command').length, 1);
    f.controller.destroy();
  }
});

test('late controls, appearance and optional actions cannot affect a newer card', async () => {
  const cases = [
    { value: { type: 'pause' }, route: '/api/settings', reply: {} },
    { value: { type: 'resume' }, route: '/api/settings', reply: {} },
    { value: { type: 'quit' }, route: '/api/shutdown', reply: {} },
    { value: { type: 'appearance', size: 480, corner: 'bottom-left', marginX: 20, marginY: 12 }, route: '/api/appearance', reply: { size: 480, position: { corner: 'bottom-left', marginX: 20, marginY: 12 } } },
    { value: { type: 'animation', name: 'reading' }, route: '/api/state', reply: { availableAnimations: ['reading'] } },
  ];
  for (const row of cases) {
    let defer = false, release;
    const pending = new Promise(resolve => { release = resolve; });
    const f = fakeNative({ request(route) { if (defer && route === row.route) return pending; } });
    await f.controller.open(f.owner);
    const old = f.controller.window;
    defer = true;
    const task = f.ipc.handlers.get('shuangling-panel:command')({ sender: old.webContents, senderFrame: old.webContents.mainFrame }, row.value);
    await Promise.resolve();
    defer = false;
    f.controller.close();
    await f.controller.open(f.owner);
    const next = f.controller.window;
    const mark = f.owner.sent.length;
    release(row.reply);
    await task;
    assert.equal(f.controller.window, next, row.value.type);
    assert.equal(f.owner.sent.length, mark, `${row.value.type} sent an expired local event`);
    f.controller.destroy();
  }
});

test('failed selected-chat reads keep successful shared quotas and the rest of the panel connected', async () => {
  const f = fakeNative({ request(route) {
    if (route === '/api/usage') throw Error('selected-chat-timeout');
    if (route === '/api/account-usage') return { fiveHour: { status: 'not-applicable' }, weekly: { status: 'available', remainingPercent: 93 } };
  } });
  const snapshot = await f.controller.snapshot(true);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.usage.selection.status, 'unknown');
  assert.equal(snapshot.usage.account.fiveHour.status, 'not-applicable');
  assert.equal(snapshot.usage.account.weekly.remainingPercent, 93);
  assert.ok(f.requests.some(row => row.route === '/api/account-usage'));
  f.controller.destroy();
});

test('failed account reads show unknown and never reuse a selected chat historical balance', async () => {
  const f = fakeNative({ request(route) {
    if (route === '/api/usage') return { selection: { status: 'available', threadId: 'chat' }, account: { weekly: { status: 'available', remainingPercent: 99 } } };
    if (route === '/api/account-usage') throw Error('account-source-unavailable');
  } });
  const snapshot = await f.controller.snapshot(true);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.usage.selection.threadId, 'chat');
  assert.equal(snapshot.usage.account.weekly.status, 'unknown');
  assert.equal(snapshot.usage.account.weekly.remainingPercent, undefined);
  f.controller.destroy();
});

test('native panel owns no pet geometry, keeps toggles open, and rejects owner IPC from panel channels', async () => {
  const { controller, owner, ipc, requests } = fakeNative();
  const originalBounds = { ...owner.bounds };
  await controller.open(owner);
  const panel = controller.window;
  const event = { sender: panel.webContents, senderFrame: panel.webContents.mainFrame };
  const unauthorized = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  assert.deepEqual(await ipc.handlers.get('shuangling-panel:command')(unauthorized, { type: 'pause' }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(await ipc.handlers.get('shuangling-panel:command')(event, { type: 'pause' }), { ok: true });
  assert.equal(controller.window, panel);
  assert.deepEqual(owner.bounds, originalBounds);
  assert.equal(panel.options.frame, false);
  assert.equal(panel.options.webPreferences.sandbox, true);
  assert.deepEqual(panel.popups(), { action: 'deny' });
  await ipc.handlers.get('shuangling-panel:command')(event, { type: 'appearance', size: 480, corner: 'bottom-left', marginX: 20, marginY: 12 });
  assert.equal(controller.window, panel);
  assert.equal(requests.at(-1).body.live, true);
  assert.equal(owner.sent.at(-1).value.kind, 'appearance');
  controller.ownerDestroyed(owner);
  assert.equal(controller.window, null);
  assert.equal(panel.isDestroyed(), true);
  controller.destroy();
  assert.equal(ipc.handlers.size, 0);
});

test('native action IPC closes the panel and retains the exact authored animation name', async () => {
  const { controller, owner, ipc } = fakeNative();
  await controller.open(owner);
  const panel = controller.window;
  await ipc.handlers.get('shuangling-panel:command')({ sender: panel.webContents, senderFrame: panel.webContents.mainFrame }, { type: 'animation', name: 'running-right' });
  assert.equal(controller.window, null);
  assert.equal(owner.sent.at(-2).value.command.name, 'running-right');
  assert.equal(owner.sent.at(-1).value.reason, 'action');
  controller.destroy();
});

test('usage selection has one fixed route and never writes the task binding', async () => {
  const { controller, owner, ipc, requests } = fakeNative();
  await controller.open(owner);
  const panel = controller.window;
  const result = await ipc.handlers.get('shuangling-panel:command')({ sender: panel.webContents, senderFrame: panel.webContents.mainFrame }, { type: 'usageThread', threadId: 'other-chat' });
  assert.equal(result.ok, true);
  assert.deepEqual(requests.at(-1), { route: '/api/usage-target', body: { threadId: 'other-chat' } });
  assert.ok(!requests.some(request => request.route === '/api/settings'));
  assert.equal(controller.window, panel);
  controller.destroy();
});

test('quit routes through the manager shutdown contract rather than directly quitting Electron', async () => {
  const { controller, ipc, owner, requests } = fakeNative();
  await controller.open(owner);
  const panel = controller.window;
  await ipc.handlers.get('shuangling-panel:command')({ sender: panel.webContents, senderFrame: panel.webContents.mainFrame }, { type: 'quit' });
  assert.equal(requests.at(-1).route, '/api/shutdown');
  assert.equal(controller.window, null);
  controller.destroy();
});

const spriteSource = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
function spritePrototype() {
  const context = vm.createContext({ window: { __dshPetDebug: {}, petBridge: { closePanel() {} } }, SHUANGLING_PROFILE: true });
  vm.runInContext(spriteSource + '\nthis.P = PetSprite.prototype;', context);
  return context.P;
}
test('info-only close settles only its own interaction, never a pre-existing manual handoff', () => {
  const p = spritePrototype();
  for (const preexisting of [false, true]) {
    const sprite = { nativePanelSession: 1, nativePanelInteraction: preexisting ? null : 'panel-info', interaction: { id: preexisting ? 'old-manual' : 'panel-info', kind: preexisting ? 'click' : 'info', phase: 'blocked', resumable: preexisting ? undefined : true }, isFiniteClipPlaying: () => false, syncInputBusy() {}, inputBusy: () => false, setInteractive() {}, updateInteraction(phase, extra) { this.interaction = { ...this.interaction, phase, ...extra }; } };
    p.finishNativePanel.call(sprite);
    assert.equal(sprite.interaction.phase, preexisting ? 'blocked' : 'settled');
    assert.equal(sprite.interaction.resumable, preexisting ? undefined : true);
  }
  const replaced = { nativePanelSession: 1, nativePanelInteraction: 'stale', interaction: { id: 'new-drag', kind: 'drag', phase: 'dragging' }, syncInputBusy() {}, inputBusy: () => true, updateInteraction: () => assert.fail('new interaction overwritten') };
  p.finishNativePanel.call(replaced);
  assert.equal(replaced.interaction.id, 'new-drag');
});

test('browsing a panel keeps the local breathing clip instead of rolling a roaming action', () => {
  const context = vm.createContext({ window: {}, S: { pick: values => values[0] } });
  vm.runInContext(spriteSource + '\nthis.P = PetSprite.prototype;', context);
  const calls = [];
  const sprite = { frozen: false, nativePanelSession: 2, animations: { idle: ['idle'] }, playOnce: name => calls.push(name), stopMove: () => assert.fail('random roaming path must not run') };
  context.P.playIdle.call(sprite);
  assert.deepEqual(calls, ['idle']);
});
