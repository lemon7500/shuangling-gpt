'use strict';
// Offscreen production panel/desk renderers with closed, in-memory fixtures.
// This helper never reads the installed manager, user preferences or desk store.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '..');
const helper = join(root, 'vendor/dsh-pet/runtime/electron-helper');
const output = resolve(process.env.SHUANGLING_FONT_QA || join(root, 'reports/font-icons-native'));
function guard() { const disk = fs.statfsSync(root); assert.ok(disk.bavail * disk.bsize > 3 * 1024 ** 3 + 32 * 1024 ** 2, 'disk-safety-stop'); }
guard(); fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(join(output, 'isolated-profile-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.setName('shuangling-font-icons-fixture');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
const { createPanelController } = require(join(helper, 'panel-main.cjs'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const report = { ok: false, syntheticDataOnly: true, actualPetOrManagerStarted: false, realSettingsReads: 0, realSettingsWrites: 0, networkRequestsAllowed: 0,
  generationCredits: 0, githubWrites: false, layouts: [], captures: [], consoleErrors: [], blockedNetworkRequests: 0 };
const at = new Date().toISOString();
const fixtureThread = { threadId: 'fixture-current-chat', threadName: '霜鈴・书签 / Bookmark sample', projectName: 'Independent UI sample' };
const state = { status: { state: 'complete', scope: 'codex', activeCount: 0, workingCount: 0, waitingCount: 0, unknownCount: 0, updatedAt: at }, control: { paused: false, preempted: false }, availableAnimations: ['idle', 'running', 'review', 'waiting', 'waving', 'jumping', 'failed', 'running-left', 'running-right', 'reading', 'looking-around', 'stretching-wings'] };
const appearance = { size: 367, position: { corner: 'bottom-right', marginX: 20, marginY: 12 }, display: 'desktop', metrics: { minWidth: 160, maxWidth: 1200, visibleHeightRatio: .35390625, defaultWidth: 562, defaultVisibleHeight: 200 } };
let preferences = { language: 'zh-CN', autoLaunch: true, ambientEnabled: true, ambientFrequency: 'normal', lifecycle: { available: true, taskInstalled: true, taskEnabled: true, pluginEnabled: true, observerRunning: true, windowCount: 1 } };
const usage = { selection: { status: 'available', source: 'selected-chat', ...fixtureThread, choices: [fixtureThread] }, context: { status: 'available', observedAt: at, remainingTokens: 128000, windowTokens: 256000, remainingPercent: 50 }, project: { status: 'available', scope: 'thread', usedTokens: 1234567, observedAt: at } };
const account = { fiveHour: { status: 'available', remainingPercent: 64, observedAt: at }, weekly: { status: 'available', remainingPercent: 81, observedAt: at } };
let desk, controller, owner, currentScale = 1;
const noteId = '0d42c769-f65b-4819-9d53-d4ecc9aaa306';
const client = { async request(route, body) {
  if (body !== undefined) {
    if (route === '/api/preferences') { assert.deepEqual(Object.keys(body), ['language']); assert.ok(['zh-CN', 'zh-TW', 'en'].includes(body.language)); preferences = { ...preferences, language: body.language }; return structuredClone(preferences); }
    if (route === '/api/desk') {
      assert.ok(['story.read', 'story.position', 'memory.read'].includes(body.type), 'fixture-mutation-forbidden:' + body.type);
      return structuredClone(desk);
    }
    throw Error('fixture-mutation-forbidden');
  }
  if (route === '/api/state') return structuredClone(state);
  if (route === '/api/preferences') return structuredClone(preferences);
  if (route === '/api/appearance') return structuredClone(appearance);
  if (route === '/api/usage') return structuredClone(usage);
  if (route === '/api/account-usage') return structuredClone(account);
  if (route === '/api/desk') return structuredClone(desk);
  throw Error('fixture-route-forbidden');
} };
class CaptureWindow extends BrowserWindow {
  constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }); }
  show() {}
  focus() {}
  // This fixture models only a revealed layout in an offscreen renderer. Its
  // no-op show cannot provide an OS visibility receipt. Cold-start input QA
  // uses real BrowserWindows and their actual visibility/focus instead.
  isVisible() { return !this.isDestroyed(); }
  isFocused() { return false; }
}
async function until(operation, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await operation(); if (value) return value; await sleep(50); }
  throw Error('fixture-timeout:' + label);
}
async function ready(win, language, type) {
  await until(() => win.webContents.executeJavaScript(`document.documentElement.lang===${JSON.stringify(language)}&&!!document.querySelector('.shuangling-icon')&&${type === 'panel' ? "!document.getElementById('language').disabled" : "!document.getElementById('note-save').disabled||document.getElementById('connection').dataset.disconnected==='false'"}`), type + '-ready-' + language);
  const font = await win.webContents.executeJavaScript(`document.fonts.load('16px "Shuangling WenKai"','霜铃・霜鈴・專注・書籤・Remaining 64%').then(()=>document.fonts.ready).then(()=>({loaded:[...document.fonts].filter(face=>face.family.includes('Shuangling WenKai')).some(face=>face.status==='loaded'),check:document.fonts.check('16px "Shuangling WenKai"'),family:getComputedStyle(document.querySelector('button[data-icon]')).fontFamily}))`);
  assert.equal(font.loaded, true, 'bundled-font-not-loaded'); assert.equal(font.check, true, 'bundled-font-not-ready'); assert.match(font.family, /Shuangling WenKai/);
}
async function inspect(win, type, language, tab) {
  await win.webContents.executeJavaScript(`document.getElementById('tab-${tab}').click()`);
  await sleep(80);
  const value = await win.webContents.executeJavaScript(`(${function () {
    const visible = element => element.getClientRects().length > 0;
    const buttons = [...document.querySelectorAll('button')].filter(visible);
    const clipped = buttons.filter(button => button.scrollWidth > button.clientWidth + 2).map(button => button.id || button.textContent.trim());
    const labelsOutside = [];
    for (const button of buttons) for (const label of button.querySelectorAll('[data-icon-label]')) {
      const bounds = button.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(label);
      for (const rect of range.getClientRects()) if (rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2) { labelsOutside.push(button.id || button.textContent.trim()); break; }
    }
    const missingIcons = [...document.querySelectorAll('[data-icon]')].filter(button => button.querySelectorAll(':scope > .shuangling-icon').length !== 1).map(button => button.id || button.dataset.animation || button.dataset.icon);
    const panels = [...document.querySelectorAll('.scroll-area,.page:not([hidden]),.header,.tabs')].filter(visible);
    return { width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 || panels.some(element => element.scrollWidth > element.clientWidth + 2), clipped, labelsOutside, missingIcons, language: document.documentElement.lang, icons: document.querySelectorAll('.shuangling-icon').length,
      pausedIcon: document.getElementById('pause')?.dataset.icon, project: document.getElementById('project-value')?.textContent, weekly: document.getElementById('weekly-value')?.textContent, glyphReplacement: document.body.textContent.includes('\uFFFD') };
  }.toString()})()`);
  const row = { type, scale: currentScale, language, tab, ...value };
  report.layouts.push(row);
  assert.equal(value.language, language); assert.equal(value.horizontalOverflow, false, `${type}/${language}/${tab}/${currentScale}:horizontal`);
  assert.deepEqual(value.clipped, [], `${type}/${language}/${tab}/${currentScale}:button-overflow`);
  assert.deepEqual(value.labelsOutside, [], `${type}/${language}/${tab}/${currentScale}:label-outside-button`);
  assert.deepEqual(value.missingIcons, [], `${type}/${language}/${tab}/${currentScale}:missing-icons`);
  assert.equal(value.glyphReplacement, false, 'replacement-character-in-ui');
  if (type === 'panel') { assert.equal(value.width, 352); assert.equal(value.height, 520); assert.equal(value.project, '1,234,567'); assert.equal(value.weekly, '81%'); }
  const capture = currentScale === 1 && (type === 'panel' && tab === 'actions' || type === 'desk' && tab === 'notes' || language === 'en' && (type === 'panel' && tab === 'overview' || type === 'desk' && tab === 'focus'));
  if (capture) { guard(); const name = `${type}-${language}-${tab}.png`; fs.writeFileSync(join(output, name), (await win.webContents.capturePage()).toPNG()); report.captures.push(name); }
}
async function changePanelLanguage(language) {
  const win = controller.window;
  await win.webContents.executeJavaScript(`document.getElementById('tab-settings').click();document.getElementById('language').value=${JSON.stringify(language)};document.getElementById('language').dispatchEvent(new Event('change',{bubbles:true}));`);
  await until(() => win.webContents.executeJavaScript(`document.documentElement.lang===${JSON.stringify(language)}&&!document.getElementById('language').disabled`), 'panel-language');
  assert.equal(preferences.language, language);
  // Do not let this fixture's language-save toast cover the action samples.
  await win.webContents.executeJavaScript("document.getElementById('notice').hidden=true");
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event, details) => { if (typeof details === 'object' && details.level >= 2) report.consoleErrors.push(String(details.message).slice(0, 250)); });
});
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const safe = details.url.startsWith('file:') || details.url === 'about:blank'; if (!safe) report.blockedNetworkRequests++; callback({ cancel: !safe }); });
  const { STORIES } = await import(pathToFileURL(join(root, 'src/desk/stories.mjs')));
  desk = { focus: { phase: 'focus', status: 'idle', focusMinutes: 25, breakMinutes: 5, remainingMs: 1500000 }, journal: { entries: STORIES.map((entry, i) => ({ ...structuredClone(entry), favorite: i === 0, read: i !== 0 })), selectedId: STORIES[0].id, positionById: {} }, notes: [{ id: noteId, text: '独立测试书签・獨立測試書籤・A bookmark for tomorrow.\n这不是你的真实数据。', intent: 'continue', pinned: true, archived: false, createdAt: at, updatedAt: at, resolved: false }], memories: { enabled: true, remindersEnabled: true, entries: [], prompt: null } };
  owner = new BrowserWindow({ width: 1, height: 1, x: 30, y: 30, show: false, skipTaskbar: true }); await owner.loadURL('about:blank');
  const preserved = JSON.stringify({ state, appearance, usage, account, desk });
  for (const scale of [1, 1.5, 2]) {
    currentScale = scale; controller?.destroy();
    // Each DPI is a fresh native session. Carrying a previous physical window
    // size between virtual monitors would test cross-monitor size migration.
    controller = createPanelController({ BrowserWindow: CaptureWindow, ipcMain, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 3840, height: 2160 } }) }, getScale: () => currentScale,
      shell: { openExternal: () => { throw Error('external-open-forbidden'); } }, client, isPetWindow: win => win === owner, onError: error => report.consoleErrors.push(error) });
    await controller.open(owner);
    for (const language of ['zh-CN', 'zh-TW', 'en']) {
      await changePanelLanguage(language); const panel = controller.window; await ready(panel, language, 'panel');
      for (const tab of ['overview', 'actions', 'settings']) await inspect(panel, 'panel', language, tab);
      controller.desk.close(); await controller.desk.open(owner, 'notes'); const tool = controller.desk.window;
      await ready(tool, language, 'desk');
      for (const tab of ['focus', 'journal', 'notes']) await inspect(tool, 'desk', language, tab);
    }
  }
  const panel = controller.window; await panel.webContents.executeJavaScript("document.getElementById('tab-overview').click()");
  state.control.paused = true;
  await until(() => panel.webContents.executeJavaScript("document.getElementById('pause').dataset.icon==='play'&&document.getElementById('pause').querySelectorAll('.shuangling-icon').length===1"), 'paused-icon-survives-poll');
  state.control.paused = false;
  await until(() => panel.webContents.executeJavaScript("document.getElementById('pause').dataset.icon==='pause'&&document.getElementById('pause').querySelectorAll('.shuangling-icon').length===1"), 'resumed-icon-survives-poll');
  assert.equal(JSON.stringify({ state, appearance, usage, account, desk }), preserved, 'fixture-settings-or-content-changed');
  assert.deepEqual(report.consoleErrors, [], 'native-renderer-console-errors');
  report.ok = true; report.pollingPreservesIcons = true; report.fixtureStatePreserved = true; report.scaleMethod = 'production getScale + native BrowserWindow zoomFactor at 100/150/200%; offscreen capture only';
  guard(); fs.writeFileSync(join(output, 'native-font-icons-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, layouts: report.layouts.length, captures: report.captures, output }));
  controller.destroy(); owner.destroy(); app.quit();
}).catch(error => {
  report.failure = String(error.message || error).slice(0, 500); guard(); fs.writeFileSync(join(output, 'native-font-icons-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(report.failure); controller?.destroy(); owner?.destroy(); app.exit(1);
});
