'use strict';
// Synthetic, offscreen production UI audit. Never opens a pet or real account.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '..');
const output = join(root, 'reports', 'i18n-audit');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'isolated-layout-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.setName('shuangling-i18n-layout-audit');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
const { createPanelController } = require(join(root, 'vendor/dsh-pet/runtime/electron-helper/panel-main.cjs'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const at = new Date().toISOString();
const demo = { threadId: 'isolated-layout-chat', threadName: 'Long user chat · 用户聊天原名', projectName: '演示项目 Demo project' };
const state = { status: { state: 'working', scope: 'codex', workingCount: 1, waitingCount: 1, unknownCount: 0 }, control: { paused: true, preempted: false } };
const appearance = { size: 562, position: { corner: 'bottom-right', marginX: 20, marginY: 12 }, display: 'desktop', metrics: { minWidth: 160, maxWidth: 1200, visibleHeightRatio: .35390625 } };
const account = { fiveHour: { status: 'available', observedAt: at, remainingPercent: 64 }, weekly: { status: 'available', observedAt: at, remainingPercent: 81 } };
const usage = { selection: { status: 'available', source: 'selected-chat', ...demo, choices: [demo] }, context: { status: 'available', observedAt: at, remainingTokens: 128000, windowTokens: 256000, remainingPercent: 50 }, project: { status: 'available', scope: 'thread', usedTokens: 1234567, observedAt: at } };
let preferences = { language: 'zh-CN', autoLaunch: true, lifecycle: { available: true, taskInstalled: true, taskEnabled: true, pluginEnabled: true, observerRunning: true } };
const fixtures = { '/api/state': state, '/api/appearance': appearance, '/api/account-usage': account, '/api/usage': usage };
const client = { async request(route, body) {
  if (body !== undefined) { assert.equal(route, '/api/preferences'); assert.deepEqual(Object.keys(body), ['language']); preferences = { ...preferences, ...body }; return structuredClone(preferences); }
  if (route === '/api/preferences') return structuredClone(preferences);
  assert.ok(Object.hasOwn(fixtures, route), 'only fixture routes'); return structuredClone(fixtures[route]);
} };
class HiddenWindow extends BrowserWindow {
  constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }); }
  show() {} focus() {}
}
const report = { syntheticOnly: true, realSettingsWrites: 0, panel: [], advanced: [], captures: [], issues: [] };
let controller, owner, settings, advanced;
async function until(fn, timeout = 10000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(30); } throw Error('layout-ready-timeout'); }
const run = (win, code) => win.webContents.executeJavaScript(code);

function inspectText() {
  const issues = [], ellipses = [], strings = [], controls = [];
  const intentional = new Set(['usage-current', 'usage-source']);
  const excluded = new Set(['usage-current', 'usage-source', 'usageSource', 'usageThread', 'thread']);
  const visible = el => el?.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, element = node.parentElement, text = node.textContent.trim();
    if (!text || !visible(element) || element.closest('script,style,option,svg')) continue;
    const rect = element.getBoundingClientRect();
    const scrolling = element.closest('.scroll-area');
    const view = scrolling?.getBoundingClientRect();
    if (rect.bottom <= (view?.top ?? 0) || rect.top >= (view?.bottom ?? innerHeight)) continue;
    const id = element.id || element.closest('[id]')?.id || element.tagName;
    const range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()];
    let clipped = false;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (!['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)) continue;
      const area = ancestor.getBoundingClientRect();
      if (rects.some(line => line.left < area.left - 1 || line.right > area.right + 1)) clipped = true;
    }
    if (rects.some(line => line.left < -1 || line.right > innerWidth + 1)) clipped = true;
    if (clipped) {
      if (intentional.has(id)) ellipses.push({ id, text });
      else issues.push({ type: 'horizontal-text-clipping', id, text });
    }
    if (/\ufffd|Ã.|Â.|â€|ä¸|æœ|锟斤拷/.test(text)) issues.push({ type: 'possible-mojibake', id, text });
    if (document.documentElement.lang === 'en' && /[\u4e00-\u9fff]/.test(text) && !excluded.has(id)) issues.push({ type: 'untranslated-Chinese', id, text });
    strings.push({ id, text });
  }
  for (const element of document.querySelectorAll('button,input,select')) {
    if (!visible(element)) continue;
    const rect = element.getBoundingClientRect(), scrolling = element.closest('.scroll-area'), area = scrolling?.getBoundingClientRect();
    if (rect.bottom <= (area?.top ?? 0) || rect.top >= (area?.bottom ?? innerHeight)) continue;
    const id = element.id || element.textContent.trim();
    if (rect.left < -1 || rect.right > innerWidth + 1) issues.push({ type: 'control-outside-width', id });
    if (element.tagName === 'SELECT') {
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d'), style = getComputedStyle(element);
      context.font = style.font; const text = element.selectedOptions[0]?.textContent || '';
      const available = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 15;
      if (context.measureText(text).width > available + 2) {
        if (id === 'usageThread' && element.title) ellipses.push({ id, text, fullTextAvailableInTooltip: true });
        else issues.push({ type: 'selected-option-clipping', id, text, available, required: context.measureText(text).width });
      }
    }
    controls.push({ id, width: rect.width, height: rect.height });
  }
  return { language: document.documentElement.lang, cssWidth: innerWidth, cssHeight: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, issues, intentionalEllipses: ellipses, textCount: strings.length, controlCount: controls.length, strings };
}
async function inspectScrolling(win, selector, prefix) {
  const info = await run(win, `(()=>{const e=document.querySelector(${JSON.stringify(selector)}); return {height:e.clientHeight,total:e.scrollHeight};})()`);
  const collected = [];
  const last = Math.max(0, info.total - info.height), step = Math.max(1, Math.floor(info.height * .7));
  const positions = [0];
  for (let position = step; position < last; position += step) positions.push(position);
  positions.push(last);
  for (const position of [...new Set(positions)]) {
    await run(win, `document.querySelector(${JSON.stringify(selector)}).scrollTop=${position}`); await sleep(50);
    const page = await run(win, '(' + inspectText.toString() + ')()');
    collected.push({ position, ...page, strings: undefined });
    if (page.horizontalOverflow) report.issues.push({ scope: prefix, type: 'page-horizontal-overflow', position });
    for (const issue of page.issues) report.issues.push({ scope: prefix, position, ...issue });
  }
  return collected;
}
async function capture(win, file) { await sleep(100); writeFileSync(join(output, file), (await win.webContents.capturePage()).toPNG()); report.captures.push(file); }

app.whenReady().then(async () => {
  const baseline = JSON.stringify({ state, appearance, usage, account, autoLaunch: preferences.autoLaunch });
  owner = new HiddenWindow({ width: 20, height: 20, show: false }); await owner.loadURL('about:blank');
  for (const scale of [1, 1.5, 2]) {
    controller = createPanelController({ BrowserWindow: HiddenWindow, ipcMain, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 3840, height: 2160 } }) }, getScale: () => scale, shell: { openExternal() { throw Error('no-external-open'); } }, client, isPetWindow: win => win === owner });
    for (const language of ['zh-CN', 'zh-TW', 'en']) {
      preferences = { ...preferences, language };
      await controller.open(owner); const win = controller.window;
      await until(() => run(win, `document.documentElement.lang===${JSON.stringify(language)}&&!document.getElementById('language').disabled`)); await run(win, 'document.fonts.ready');
      for (const tab of ['overview', 'actions', 'settings']) {
        await run(win, `document.getElementById('tab-${tab}').click()`);
        const pages = await inspectScrolling(win, '.scroll-area', `panel/${scale}/${language}/${tab}`);
        report.panel.push({ scale, language, tab, pages });
        if (scale === 2 && language === 'en' && tab === 'actions') { await run(win, "document.querySelector('.scroll-area').scrollTop=0"); await capture(win, 'panel-en-actions-200.png'); }
        if (scale === 1.5 && language === 'zh-TW' && tab === 'settings') { await run(win, "document.querySelector('.scroll-area').scrollTop=0"); await capture(win, 'panel-zh-TW-settings-150.png'); }
      }
      controller.close();
    }
    controller.destroy(); controller = null;
  }
  const { startSettings } = await import(pathToFileURL(join(root, 'src/settings/server.mjs')));
  settings = await startSettings({ getState: () => structuredClone(state), getUsage: () => structuredClone(usage), getThreads: () => [], getAccountUsage: () => structuredClone(account), getAppearance: () => structuredClone(appearance), setAppearance() { throw Error('forbidden'); }, getPreferences: () => structuredClone(preferences), setPreferences() { throw Error('forbidden'); }, update() { throw Error('forbidden'); }, shutdown() { throw Error('forbidden'); } });
  for (const width of [800, 360]) for (const language of ['zh-CN', 'zh-TW', 'en']) {
    preferences = { ...preferences, language };
    advanced = new HiddenWindow({ width, height: 900, useContentSize: true, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    await advanced.loadURL(settings.settingsUrl); await until(() => run(advanced, `document.documentElement.lang===${JSON.stringify(language)}&&document.getElementById('projectValue').textContent==='1,234,567 tokens'`)); await run(advanced, 'document.fonts.ready');
    const pages = await inspectScrolling(advanced, 'html', `advanced/${width}/${language}`); report.advanced.push({ width, language, pages });
    if (width === 360 && language === 'en') { await run(advanced, 'document.documentElement.scrollTop=document.documentElement.scrollHeight'); await capture(advanced, 'advanced-en-bottom-360.png'); }
    if (width === 800 && language === 'zh-TW') { await run(advanced, 'document.documentElement.scrollTop=0'); await capture(advanced, 'advanced-zh-TW-top-800.png'); }
    advanced.destroy(); advanced = null;
  }
  assert.equal(JSON.stringify({ state, appearance, usage, account, autoLaunch: preferences.autoLaunch }), baseline);
  report.ok = report.issues.length === 0; report.checkedAt = new Date().toISOString();
  writeFileSync(join(output, 'layout-report.json'), JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify({ ok: report.ok, panelCases: report.panel.length, advancedCases: report.advanced.length, issues: report.issues, captures: report.captures }));
  owner.destroy(); await settings.close(); app.exit(report.ok ? 0 : 1);
}).catch(async error => { writeFileSync(join(output, 'layout-failure.json'), JSON.stringify({ message: error.message })); console.error(error.message); advanced?.destroy(); controller?.destroy(); owner?.destroy(); await settings?.close(); app.exit(1); });
