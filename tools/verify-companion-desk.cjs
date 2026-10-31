'use strict';
// Native production UI with an isolated fixture service. Never contacts the
// installed pet, Codex, accounts or a media-generation service.
const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '..');
const output = join(root, 'qa', 'companion-desk-v190');
const helper = join(root, 'vendor', 'dsh-pet', 'runtime', 'electron-helper');
const { createPanelController } = require(join(helper, 'panel-main.cjs'));
mkdirSync(output, { recursive: true });
app.setPath('userData', join(output, 'electron-fixture'));
app.setPath('sessionData', join(output, 'electron-fixture'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(done => setTimeout(done, ms));
class CaptureWindow extends BrowserWindow {
  constructor(options) { super({ ...options, show: false, skipTaskbar: true, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }); }
  show() {}
  focus() {}
}
let owner, panel, desk;
app.whenReady().then(async () => {
  const { createDeskService } = await import(pathToFileURL(join(root, 'src/desk/service.mjs')));
  desk = await createDeskService({ dataDir: join(output, 'private-fixture'), autoTick: false });
  if (!(await desk.snapshot()).notes.length) await desk.command({ type: 'note.create', text: '下次从这里继续：检查袖口与手腕的衔接。\nContinue here: check the sleeve and wrist transition.' });
  let language = 'zh-CN', scale = 1, area = { x: 0, y: 0, width: 1920, height: 1040 };
  const client = { async request(route, body) {
    if (route === '/api/desk') return body ? desk.command(body) : desk.snapshot();
    if (route === '/api/preferences') return { language, autoLaunch: false, ambientEnabled: true, ambientFrequency: 'normal', lifecycle: {} };
    if (body) throw Error('fixture-route-not-writable');
    if (route === '/api/state') return { status: { state: 'idle', scope: 'codex' }, control: { paused: false, preempted: false }, availableAnimations: ['looking-around', 'stretching-wings'] };
    if (route === '/api/appearance') return { size: 339, position: { corner: 'bottom-right', marginX: 20, marginY: 12 }, display: 'desktop', metrics: { visibleHeightRatio: .35390625, minWidth: 160, maxWidth: 1200, defaultWidth: 562, defaultVisibleHeight: 200 } };
    if (route === '/api/usage') return { selection: { status: 'unknown' } };
    if (route === '/api/account-usage') return {};
    throw Error('fixture-route-not-allowed');
  } };
  owner = new BrowserWindow({ width: 1, height: 1, show: false, skipTaskbar: true });
  await owner.loadURL('about:blank');
  panel = createPanelController({ BrowserWindow: CaptureWindow, ipcMain, screen: { getDisplayMatching: () => ({ workArea: area }) }, shell: { openExternal: async () => { throw Error('no-external-links'); } }, client, getScale: () => scale, isPetWindow: win => win === owner });
  const interactions = [];
  async function until(check, name) {
    const deadline = Date.now() + 6000;
    while (!await check()) { if (Date.now() > deadline) throw Error('interaction-timeout-' + name); await sleep(30); }
  }
  async function ready() {
    await until(() => panel.desk.window.webContents.executeJavaScript("!document.getElementById('focus-start').disabled"), 'window-ready');
  }
  await desk.command({ type: 'focus.stop' });
  await panel.desk.open(owner, { tab: 'focus' }); await ready();
  let current = panel.desk.window;
  await current.webContents.executeJavaScript("document.getElementById('focus-start').click()");
  await until(async () => (await desk.snapshot()).focus.status === 'running', 'focus-start');
  await until(() => current.webContents.executeJavaScript("!document.getElementById('focus-pause').disabled"), 'pause-enabled');
  await current.webContents.executeJavaScript("document.getElementById('focus-pause').click()");
  await until(async () => (await desk.snapshot()).focus.status === 'paused', 'focus-pause');
  await until(() => current.webContents.executeJavaScript("!document.getElementById('focus-resume').disabled"), 'resume-enabled');
  await current.webContents.executeJavaScript("document.getElementById('focus-resume').click()");
  await until(async () => (await desk.snapshot()).focus.status === 'running', 'focus-resume');
  panel.desk.close();
  if ((await desk.snapshot()).focus.status !== 'running') throw Error('closing-window-stopped-timer');
  interactions.push('native-start-pause-resume-and-close-keeps-timer');
  await desk.close(); desk = await createDeskService({ dataDir: join(output, 'private-fixture'), autoTick: false });
  if ((await desk.snapshot()).focus.status !== 'paused') throw Error('restart-did-not-pause-timer');
  interactions.push('full-service-restart-preserves-paused-timer');
  await desk.command({ type: 'focus.stop' });
  await panel.desk.open(owner, { tab: 'notes' }); await ready(); current = panel.desk.window;
  await current.webContents.executeJavaScript("document.getElementById('note-text').value='Unsaved fixture draft';document.getElementById('note-text').dispatchEvent(new Event('input'));document.getElementById('close').click()");
  if (!await current.webContents.executeJavaScript("!document.getElementById('close-guard').hidden")) throw Error('unsaved-draft-not-guarded');
  await current.webContents.executeJavaScript("document.getElementById('continue-edit').click();document.getElementById('note-text').value='';document.getElementById('note-text').dispatchEvent(new Event('input'))");
  interactions.push('native-draft-close-guard');
  await current.webContents.executeJavaScript("document.getElementById('tab-journal').click()");
  await until(() => current.webContents.executeJavaScript("document.querySelectorAll('[data-story-id]').length===6&&!document.getElementById('story-favorite').disabled"), 'journal-ready');
  const selectedStory = (await desk.snapshot()).journal.selectedId;
  const hadFavorite = (await desk.snapshot()).journal.entries.find(entry => entry.id === selectedStory).favorite;
  await current.webContents.executeJavaScript("document.getElementById('story-favorite').click()");
  await until(async () => (await desk.snapshot()).journal.entries.find(entry => entry.id === selectedStory).favorite !== hadFavorite, 'favorite-roundtrip');
  interactions.push('native-story-selection-and-favorite');
  panel.desk.close();
  const results = [], screenshots = [];
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const factor of [1, 1.5, 2]) {
    language = locale; scale = factor;
    await panel.desk.open(owner, { tab: 'focus' });
    const win = panel.desk.window;
    const errors = [];
    win.webContents.on('console-message', (_event, _level, message) => { if (/Uncaught|ReferenceError|TypeError/.test(message || '')) errors.push(message); });
    const end = Date.now() + 6000;
    while (!await win.webContents.executeJavaScript("!document.getElementById('focus-start').disabled && document.documentElement.lang === " + JSON.stringify(locale))) {
      if (Date.now() > end) throw Error('desk-not-ready-' + locale);
      await sleep(40);
    }
    await win.webContents.executeJavaScript('document.fonts.ready');
    for (const tab of ['focus', 'journal', 'notes']) {
      await win.webContents.executeJavaScript(`document.getElementById('tab-${tab}').click()`);
      await sleep(180);
      const metrics = await win.webContents.executeJavaScript(`(() => {
        const page = document.getElementById(${JSON.stringify(tab)});
        const controls = [...page.querySelectorAll('button,input,textarea')].filter(e => e.getClientRects().length);
        return { lang: document.documentElement.lang, width: innerWidth, height: innerHeight,
          overflowX: document.documentElement.scrollWidth > innerWidth + 1,
          clippedButtons: controls.filter(e => e.tagName === 'BUTTON' && e.scrollWidth > e.clientWidth + 2).map(e => e.textContent),
          missingGlyph: page.textContent.includes('�'), storyCount: document.querySelectorAll('[data-story-id]').length };
      })()`);
      results.push({ locale, scale: factor, tab, ...metrics, errors: [...errors] });
      if (metrics.overflowX || metrics.clippedButtons.length || metrics.missingGlyph || errors.length) throw Error('desk-layout-' + JSON.stringify(results.at(-1)));
      const capture = factor === 1 && ((locale === 'zh-CN' && tab === 'focus') || (locale === 'zh-TW' && tab === 'journal') || (locale === 'en' && tab === 'notes'));
      if (capture) { const file = `desk-${locale}-${tab}.png`; writeFileSync(join(output, file), (await win.webContents.capturePage()).toPNG()); screenshots.push(file); }
    }
    panel.desk.close();
  }
  language = 'zh-CN'; scale = 1;
  await panel.open(owner);
  await sleep(500);
  for (const tab of ['actions', 'settings']) {
    await panel.window.webContents.executeJavaScript(`document.getElementById('tab-${tab}').click()`);
    await sleep(120);
    const file = `panel-${tab}.png`; writeFileSync(join(output, file), (await panel.window.webContents.capturePage()).toPNG()); screenshots.push(file);
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify({ ok: true, productionUI: true, syntheticDataOnly: true, liveRequests: 0, interactions, results, screenshots }, null, 2));
  console.log(JSON.stringify({ ok: true, layouts: results.length, screenshots, output }));
  panel.destroy(); owner.destroy(); await desk.close(); app.quit();
}).catch(async error => {
  console.error(error.stack); panel?.destroy(); owner?.destroy(); await desk?.close().catch(() => {}); app.exit(1);
});
