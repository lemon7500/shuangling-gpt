'use strict';
// Real renderers and fixed IPC, synthetic local data only. No pet or account.
// Run with Electron; screenshots and the disposable profile stay in ignored reports.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '..');
const helper = join(root, 'vendor/dsh-pet/runtime/electron-helper');
const output = join(root, 'reports', 'ui-i18n');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'isolated-profile-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.setName('shuangling-localized-ui-validation');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
const { createPanelController, managerClient } = require(join(helper, 'panel-main.cjs'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const prefsPath = join(profile, 'fixture-preferences.json');
const at = new Date().toISOString();
const thread = { threadId: 'fixture-selected', threadName: '动画优化（示例）', projectName: '演示项目' };
let preferences = { language: 'zh-CN', autoLaunch: true, lifecycle: { available: true, taskInstalled: true, taskEnabled: true, pluginEnabled: true, observerRunning: true, sessionActive: true, windowCount: 1 } };
writeFileSync(prefsPath, JSON.stringify(preferences));
const state = { status: { state: 'working', scope: 'codex', activeCount: 2, workingCount: 1, waitingCount: 1, unknownCount: 0, updatedAt: at }, control: { paused: true, preempted: false } };
const appearance = { size: 562, position: { corner: 'bottom-right', marginX: 20, marginY: 12 }, display: 'desktop', metrics: { minWidth: 160, maxWidth: 1200, visibleHeightRatio: .35390625, defaultWidth: 562, defaultVisibleHeight: 200 } };
const account = {
  fiveHour: { status: 'available', remainingPercent: 64, observedAt: at },
  weekly: { status: 'available', remainingPercent: 81, observedAt: at },
};
const usage = {
  selection: { status: 'available', source: 'selected-chat', ...thread, choices: [thread, { threadId: 'fixture-unnamed', threadName: null, projectName: null }] },
  context: { status: 'available', observedAt: at, remainingTokens: 128000, windowTokens: 256000, remainingPercent: 50 },
  project: { status: 'available', scope: 'thread', usedTokens: 1234567, observedAt: at },
};
const writes = [], results = [];
const baseline = JSON.stringify({ state, appearance, account, usage, autoLaunch: preferences.autoLaunch });
let controller, owner, settings, advanced;
async function until(operation, ms = 10000) {
  const untilAt = Date.now() + ms;
  while (Date.now() < untilAt) { const value = await operation(); if (value) return value; await sleep(40); }
  throw Error('localized-ui-timeout');
}
class CaptureWindow extends BrowserWindow {
  constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }); }
  show() {}
  focus() {}
}
async function panelReady() {
  const panel = controller.window;
  await until(() => panel.webContents.executeJavaScript("!document.getElementById('language').disabled && document.getElementById('project-value').textContent==='1,234,567'"));
  await panel.webContents.executeJavaScript('document.fonts.ready'); return panel;
}
async function savePanelLanguage(language) {
  const panel = controller.window;
  await panel.webContents.executeJavaScript("document.getElementById('tab-settings').click(); document.getElementById('language').value=" + JSON.stringify(language) + "; document.getElementById('language').dispatchEvent(new Event('change',{bubbles:true}));");
  await until(() => panel.webContents.executeJavaScript("document.documentElement.lang===" + JSON.stringify(language) + " && !document.getElementById('language').disabled"));
  assert.equal(preferences.language, language);
}
async function inspectPanel(panel, language, tab) {
  await panel.webContents.executeJavaScript("document.getElementById('tab-" + tab + "').click()");
  await sleep(80);
  const measured = await panel.webContents.executeJavaScript("(" + (() => {
    const scroll = document.querySelector('.scroll-area'), header = document.querySelector('.header');
    const buttons = [...document.querySelectorAll('button')].filter(button => button.getClientRects().length && button.id !== 'usage-thread');
    const clippedButtons = buttons.filter(button => button.scrollWidth > button.clientWidth + 1).map(button => button.id || button.textContent.trim());
    return { width: innerWidth, height: innerHeight, horizontalOverflow: scroll.scrollWidth > scroll.clientWidth + 1 || header.scrollWidth > header.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth, clippedButtons,
      language: document.documentElement.lang, selectedChat: document.getElementById('usage-thread').value, project: document.getElementById('project-value').textContent,
      fiveHour: document.getElementById('fiveHour-value').textContent, weekly: document.getElementById('weekly-value').textContent, corner: document.getElementById('corner').value,
      heightValue: document.getElementById('height-number').value, autoLaunch: document.getElementById('auto-launch').getAttribute('aria-checked'), badge: document.getElementById('control-badge').textContent };
  }).toString() + ")()");
  assert.equal(measured.width, 352); assert.equal(measured.height, 520); assert.equal(measured.language, language);
  assert.equal(measured.horizontalOverflow, false, language + '/' + tab + ': horizontal overflow');
  assert.deepEqual(measured.clippedButtons, [], language + '/' + tab + ': clipped buttons');
  assert.equal(measured.selectedChat, thread.threadId); assert.equal(measured.project, '1,234,567');
  assert.equal(measured.fiveHour, '64%'); assert.equal(measured.weekly, '81%'); assert.equal(measured.corner, 'bottom-right'); assert.equal(measured.heightValue, '199'); assert.equal(measured.autoLaunch, 'true');
  results.push({ language, tab, width: measured.width, height: measured.height, horizontalOverflow: false, clippedButtons: [], valuesPreserved: true });
  if (language === 'en' || tab === 'overview') {
    const image = await panel.webContents.capturePage(); writeFileSync(join(output, 'panel-' + language + '-' + tab + '.png'), image.toPNG());
  }
}
app.whenReady().then(async () => {
  const { startSettings } = await import(pathToFileURL(join(root, 'src/settings/server.mjs')));
  settings = await startSettings({
    getState: () => structuredClone(state), getUsage: () => structuredClone(usage), getThreads: () => [], getAccountUsage: () => structuredClone(account),
    getAppearance: () => structuredClone(appearance), setAppearance: () => { throw Error('fixture-appearance-mutation-forbidden'); },
    getPreferences: () => structuredClone(preferences),
    setPreferences: input => {
      assert.deepEqual(Object.keys(input), ['language']); assert.ok(['zh-CN', 'zh-TW', 'en'].includes(input.language));
      writes.push({ ...input }); preferences = { ...preferences, language: input.language };
      writeFileSync(prefsPath, JSON.stringify(preferences)); return structuredClone(preferences);
    },
    update: () => { throw Error('fixture-task-mutation-forbidden'); }, shutdown: () => { throw Error('fixture-shutdown-forbidden'); },
  });
  const managerState = join(profile, 'fixture-manager.json'); writeFileSync(managerState, JSON.stringify({ settingsUrl: settings.settingsUrl }));
  owner = new BrowserWindow({ width: 1, height: 1, show: false, skipTaskbar: true }); await owner.loadURL('about:blank');
  controller = createPanelController({ BrowserWindow: CaptureWindow, ipcMain,
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }, getScale: () => 1,
    shell: { openExternal: () => { throw Error('fixture-external-open-forbidden'); } }, client: managerClient(managerState), isPetWindow: win => win === owner,
  });
  await controller.open(owner); let panel = await panelReady();
  for (const language of ['zh-CN', 'en', 'zh-TW']) {
    await savePanelLanguage(language);
    for (const tab of ['overview', 'actions', 'settings']) await inspectPanel(panel, language, tab);
  }
  controller.close(); preferences = JSON.parse(readFileSync(prefsPath, 'utf8'));
  await controller.open(owner); panel = await panelReady();
  assert.equal(await panel.webContents.executeJavaScript('document.documentElement.lang'), 'zh-TW');
  advanced = new BrowserWindow({ width: 800, height: 1250, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await advanced.loadURL(settings.settingsUrl);
  await until(() => advanced.webContents.executeJavaScript("document.documentElement.lang==='zh-TW' && document.getElementById('projectValue').textContent==='1,234,567 tokens'"));
  await advanced.webContents.executeJavaScript("document.getElementById('height').value='213'; document.getElementById('language').value='en'; document.getElementById('language').dispatchEvent(new Event('change',{bubbles:true}));");
  await until(() => advanced.webContents.executeJavaScript("document.documentElement.lang==='en' && !document.getElementById('language').disabled"));
  await until(() => panel.webContents.executeJavaScript("document.documentElement.lang==='en'"));
  const advancedValues = await advanced.webContents.executeJavaScript("({height:document.getElementById('height').value,chat:document.getElementById('usageThread').value,project:document.getElementById('projectValue').textContent,weekly:document.getElementById('weeklyValue').textContent,paused:document.getElementById('control').textContent,overflow:document.documentElement.scrollWidth>innerWidth})");
  assert.equal(advancedValues.height, '213'); assert.equal(advancedValues.chat, thread.threadId); assert.equal(advancedValues.project, '1,234,567 tokens');
  assert.equal(advancedValues.weekly, '81% remaining');
  assert.equal(advancedValues.paused, 'Linking paused'); assert.equal(advancedValues.overflow, false);
  writeFileSync(join(output, 'advanced-en.png'), (await advanced.webContents.capturePage()).toPNG());
  await savePanelLanguage('zh-CN');
  await until(() => advanced.webContents.executeJavaScript("document.documentElement.lang==='zh-CN'"), 7000);
  assert.equal(await advanced.webContents.executeJavaScript("document.getElementById('height').value"), '213');
  assert.equal(JSON.stringify({ state, appearance, account, usage, autoLaunch: preferences.autoLaunch }), baseline);
  assert.ok(writes.length >= 5 && writes.every(input => Object.keys(input).join(',') === 'language'));
  const report = { ok: true, syntheticDataOnly: true, petProcessesStarted: 0, nativePluginOrTaskRegistrations: 0, panel: results,
    reopenRetainsLanguage: true, advancedSavedLanguageFollowsToPanel: true, panelSavedLanguageFollowsToAdvanced: true, unrelatedSettingsAndNumbersPreserved: true, writes: writes.map(write => write.language), captures: ['panel-zh-CN-overview.png', 'panel-en-overview.png', 'panel-en-actions.png', 'panel-en-settings.png', 'panel-zh-TW-overview.png', 'advanced-en.png'] };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  advanced.destroy(); controller.destroy(); owner.destroy(); await settings.close(); app.quit();
}).catch(async error => {
  const failure = String(error.message || 'ui-validation-failed').replace(/http:\/\/127\.0\.0\.1:[0-9]+\/[^\s'"]*/g, '[fixture-url]').slice(0, 300);
  console.error(failure);
  writeFileSync(join(output, 'failure.json'), JSON.stringify({ ok: false, failure }, null, 2));
  advanced?.destroy(); controller?.destroy(); owner?.destroy(); await settings?.close(); app.exit(1);
});
