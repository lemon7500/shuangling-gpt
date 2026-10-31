'use strict';
// Production Electron UI and production storage, synthetic records only.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '..');
const at = process.argv.indexOf('--runtime-root');
if (at < 0 || !process.argv[at + 1]) throw Error('explicit-runtime-root-required');
const runtime = resolve(process.argv[at + 1]);
const output = join(runtime, 'qa', 'desk-workflows-20261029', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
function headroom() {
  const disk = fs.statfsSync(runtime.slice(0, 3));
  assert.ok(disk.bavail * disk.bsize > 3 * 1024 ** 3 + 16 * 1024 ** 2, 'disk-safety-stop');
}
headroom(); fs.mkdirSync(output, { recursive: true });
app.setPath('userData', join(output, 'electron-fixture'));
app.setPath('sessionData', join(output, 'electron-fixture'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const helper = join(root, 'vendor/dsh-pet/runtime/electron-helper');
const { createPanelController } = require(join(helper, 'panel-main.cjs'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const saved = ['windows/data/plugin-config.json', 'windows/data/usage-selection.json', 'windows/data/bridge-config.json',
  'windows/data/dsh-home/dsh-pet/main-config.jsonc', 'windows/runtime-config.json', 'windows/animation-timing.json'];
const assets = JSON.parse(fs.readFileSync(join(runtime, 'reports/windows-assets.json'), 'utf8')).animations.map(row => 'windows/assets/shuangling/' + row.name + '.webm');
const fingerprints = () => Object.fromEntries([...saved, ...assets].map(p => [p, hash(join(runtime, p))]));
const before = fingerprints();
const report = { startedAt: new Date().toISOString(), productionUI: true, syntheticDataOnly: true, realRequests: 0,
  realSettingsWrites: 0, generationCredits: 0, githubPublish: false, firstClicks: [], interactions: [], layouts: [], screenshots: [], errors: [], checks: {}, ok: false };
const sourceFiles = ['src/desk/service.mjs', 'src/desk/memories.mjs', ...['desk-main.cjs', 'desk-preload.cjs', 'desk.js', 'desk.html', 'desk.css', 'panel-main.cjs', 'panel-ui.js', 'panel-i18n.js'].map(p => 'vendor/dsh-pet/runtime/electron-helper/' + p)];
report.sourceHashes = Object.fromEntries(sourceFiles.map(p => [p, hash(join(root, p))]));
class AuditWindow extends BrowserWindow {
  constructor(options) {
    super({ ...options, show: false, skipTaskbar: true, opacity: 0,
      webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } });
    this.revealCount = 0;
    this.mainFileLoaded = false;
    this.webContents.on('did-finish-load', () => { this.mainFileLoaded = true; });
    this.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) report.errors.push(String(event.message).slice(0, 180)); });
    this.webContents.on('render-process-gone', (_event, details) => report.errors.push('renderer-gone:' + details.reason));
  }
  show() { this.revealCount++; this.revealedAfterLoad = this.mainFileLoaded; super.showInactive(); }
  focus() {}
}
let owner, panel, desk;
let language = 'zh-CN', scale = 1, clock = new Date(2026, 9, 27, 10).getTime();
async function until(check, name, timeout = 7000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { headroom(); const value = await check(); if (value) return value; await sleep(40); }
  throw Error('desk-check-timeout:' + name);
}
const evalIn = (win, js) => win.webContents.executeJavaScript(js);
const click = (win, id) => evalIn(win, `document.getElementById(${JSON.stringify(id)}).click()`);
async function ready(tab) {
  await until(() => panel.desk.window && !panel.desk.window.isDestroyed(), 'window-created');
  const win = panel.desk.window;
  await until(() => evalIn(win, `!document.getElementById(${JSON.stringify(tab)}).hidden && !document.getElementById('note-text').disabled && document.documentElement.lang===${JSON.stringify(language)}`), 'ready-' + tab);
  return win;
}
async function open(tab) { await panel.desk.open(owner, { tab }); return ready(tab); }
async function closeDesk() { const win = panel.desk.window; panel.desk.close(); if (win) assert.equal(win.isDestroyed(), true); }
app.whenReady().then(async () => {
  app.defaultSession?.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
  const { createDeskService } = await import(pathToFileURL(join(root, 'src/desk/service.mjs')));
  const dataDir = join(output, 'synthetic-data');
  const service = () => createDeskService({ dataDir, now: () => clock, autoTick: false });
  desk = await service();
  await desk.command({ type: 'note.create', text: 'QA: 把未写满的一页留给明天。 A page for tomorrow. 💜', intent: 'remember' });
  await desk.command({ type: 'note.create', text: 'QA_ORDINARY_BOOKMARK_MUST_STAY_PRIVATE', intent: 'none' });
  await desk.recordTask({ id: 'synthetic-confirmed-round', at: clock });
  clock = new Date(2026, 9, 28, 10).getTime();
  await desk.tick();
  assert.equal((await desk.snapshot()).memories.entries.length, 1);
  report.interactions.push('day-rollover-creates-one-page-from-explicit-records');
  const client = { async request(route, body) {
    if (route === '/api/desk') { if (!body) await sleep(90); return body ? desk.command(body) : desk.snapshot(); }
    if (route === '/api/preferences') return { language, autoLaunch: false, ambientEnabled: true, ambientFrequency: 'normal', lifecycle: {} };
    if (body) throw Error('fixture-route-not-writable');
    if (route === '/api/state') return { status: { state: 'idle', scope: 'codex' }, control: { paused: false, preempted: false }, availableAnimations: ['idle'] };
    if (route === '/api/appearance') return { size: 339, position: { corner: 'bottom-right', marginX: 20, marginY: 12 }, display: 'desktop', metrics: { visibleHeightRatio: .35390625, minWidth: 160, maxWidth: 1200, defaultWidth: 562, defaultVisibleHeight: 200 } };
    if (route === '/api/usage') return { selection: { status: 'unknown' } };
    if (route === '/api/account-usage') return {};
    throw Error('fixture-route-not-allowed');
  } };
  owner = new BrowserWindow({ width: 1, height: 1, show: false, skipTaskbar: true });
  await owner.loadURL('about:blank');
  panel = createPanelController({ BrowserWindow: AuditWindow, ipcMain, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
    shell: { openExternal: async () => { throw Error('no-external-links'); } }, client, getScale: () => scale, isPetWindow: win => win === owner });
  for (const tab of ['focus', 'journal', 'notes']) {
    await panel.open(owner);
    const card = panel.window;
    await until(() => evalIn(card, `!!document.querySelector('[data-desk="${tab}"]')&&!document.querySelector('[data-desk="${tab}"]').disabled`), 'shortcut-ready-' + tab);
    const sentAt = Date.now();
    await evalIn(card, `document.querySelector('[data-desk="${tab}"]').click()`);
    const win = await ready(tab);
    assert.equal(win.revealCount, 1, 'exactly-one-reveal-per-single-shortcut');
    assert.equal(win.revealedAfterLoad, true, 'reveal-after-native-finish-load'); assert.equal(win.isVisible(), true, 'native-window-visible');
    assert.equal(panel.window, null, 'card-closed-after-tool-open');
    report.firstClicks.push({ tab, clicks: 1, nativeVisible: win.isVisible(), revealAfterLoad: win.revealedAfterLoad, readyMs: Date.now() - sentAt });
    await closeDesk();
  }
  let win = await open('focus');
  await click(win, 'focus-start'); await until(async () => (await desk.snapshot()).focus.status === 'running', 'focus-start');
  clock += 65000;
  await closeDesk(); assert.equal((await desk.snapshot()).focus.status, 'running');
  await desk.close(); desk = await service();
  const paused = (await desk.snapshot()).focus;
  assert.equal(paused.status, 'paused'); assert.equal(paused.remainingMs, 25 * 60000 - 65000);
  report.interactions.push('window-close-keeps-timer-and-service-restart-pauses-exact-remainder');
  await desk.command({ type: 'focus.stop' });
  win = await open('journal'); await click(win, 'shelf-memories');
  await until(() => evalIn(win, "!document.getElementById('memory-entry').hidden&&!document.getElementById('memory-add-reply').disabled"), 'memory-entry-ready');
  assert.equal(await evalIn(win, "document.getElementById('memory-body').textContent.includes('QA_ORDINARY_BOOKMARK_MUST_STAY_PRIVATE')"), false);
  await click(win, 'memory-add-reply');
  const reply = 'QA: 今天把这一小步认真完成了。 Tomorrow, one more step. 💜';
  await evalIn(win, `document.getElementById('memory-editor').value=${JSON.stringify(reply)};document.getElementById('memory-editor').dispatchEvent(new Event('input'))`);
  await click(win, 'memory-save');
  await until(async () => (await desk.snapshot()).memories.entries[0].reply === reply, 'reply-persisted');
  await until(() => evalIn(win, "!document.getElementById('memory-carry').disabled"), 'carry-ready');
  const count = (await desk.snapshot()).notes.length;
  await click(win, 'memory-carry');
  await until(() => evalIn(win, "!document.getElementById('notes').hidden&&document.getElementById('note-text').value.length>0"), 'carry-editor');
  assert.equal((await desk.snapshot()).notes.length, count, 'carry-prefill-not-autosaved');
  assert.equal(await evalIn(win, "document.getElementById('note-intent').value"), 'continue');
  await click(win, 'note-save');
  await until(async () => (await desk.snapshot()).notes.length === count + 1, 'carry-explicit-save');
  const continuing = (await desk.snapshot()).notes.find(note => note.intent === 'continue');
  await closeDesk(); await desk.close(); desk = await service();
  const restarted = await desk.snapshot();
  assert.equal(restarted.memories.entries[0].reply, reply);
  assert.equal(restarted.notes.find(note => note.id === continuing.id).intent, 'continue');
  report.interactions.push('native-add-line-carry-prefill-explicit-save-and-restart-persistence');
  win = await open('notes');
  const unsaved = 'QA unsaved draft 💜';
  await evalIn(win, `document.getElementById('note-text').value=${JSON.stringify(unsaved)};document.getElementById('note-text').dispatchEvent(new Event('input'))`);
  await click(win, 'tab-journal'); await click(win, 'shelf-memories');
  await until(() => evalIn(win, "!document.getElementById('memory-carry').disabled"), 'unsaved-carry-ready');
  await click(win, 'memory-carry');
  const { dictionaries } = require(join(helper, 'panel-i18n.js'));
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    language = locale;
    const expected = dictionaries[locale]['请先保存或取消当前编辑。'];
    await until(() => evalIn(win, `document.documentElement.lang===${JSON.stringify(locale)}&&!document.getElementById('notice').hidden&&document.getElementById('notice').textContent===${JSON.stringify(expected)}`), 'live-notice-language-' + locale);
    assert.equal(await evalIn(win, "document.getElementById('note-text').value"), unsaved);
    assert.equal(await evalIn(win, "document.getElementById('notice').dataset.kind"), 'error');
    assert.equal((await desk.snapshot()).notes.length, restarted.notes.length);
  }
  await closeDesk();
  report.interactions.push('visible-notice-retranslates-in-three-languages-without-losing-or-saving-draft');
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const factor of [1, 1.5, 2]) {
    language = locale; scale = factor;
    win = await open('journal');
    await evalIn(win, 'document.fonts.ready');
    for (const tab of ['focus', 'journal', 'notes', 'memories']) {
      await click(win, 'tab-' + (tab === 'memories' ? 'journal' : tab));
      if (tab === 'journal' || tab === 'memories') await click(win, tab === 'journal' ? 'shelf-stories' : 'shelf-memories');
      await sleep(100);
      const metrics = await evalIn(win, `(() => { const page=document.getElementById(${JSON.stringify(tab === 'memories' ? 'journal' : tab)}); const buttons=[...page.querySelectorAll('button,summary,select')].filter(e=>e.getClientRects().length); const fields=[...page.querySelectorAll('input,textarea,select')].filter(e=>e.getClientRects().length); return {lang:document.documentElement.lang,width:innerWidth,height:innerHeight,overflowX:document.documentElement.scrollWidth>innerWidth+1,clipped:buttons.filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.textContent.trim()),badUnicode:!page.textContent.isWellFormed()||page.textContent.includes('\uFFFD'),enabledFields:fields.filter(e=>!e.disabled).length,body: ${tab === 'memories' ? "document.getElementById('memory-body').textContent" : "''"} }; })()`);
      assert.equal(metrics.lang, locale); assert.equal(metrics.overflowX, false, 'horizontal-overflow'); assert.deepEqual(metrics.clipped, [], 'clipped-controls'); assert.equal(metrics.badUnicode, false, 'unicode-error');
      if (tab === 'memories') { assert.ok(metrics.body.trim()); assert.equal(metrics.body, restarted.memories.entries[0].body[locale]); }
      delete metrics.body; report.layouts.push({ locale, scale: factor, tab, ...metrics });
      if (factor === 1 && tab === 'memories') { headroom(); const file = 'our-days-' + locale + '.png'; fs.writeFileSync(join(output, file), (await win.webContents.capturePage()).toPNG()); report.screenshots.push(file); }
    }
    await closeDesk();
  }
  assert.deepEqual(report.errors, []);
  report.checks.settingsAndMediaUnchanged = JSON.stringify(fingerprints()) === JSON.stringify(before);
  report.checks.sourceUnchanged = sourceFiles.every(p => hash(join(root, p)) === report.sourceHashes[p]);
  report.checks.allLayouts = report.layouts.length === 36;
  report.checks.allFirstClicks = report.firstClicks.length === 3;
  report.ok = Object.values(report.checks).every(Boolean);
}).catch(error => { report.failure = { name: error.name, message: String(error.message).slice(0, 600), stack: String(error.stack).slice(0, 1800) }; }).finally(async () => {
  try { panel?.destroy(); if (owner && !owner.isDestroyed()) owner.destroy(); await desk?.close(); }
  catch (error) { report.cleanupError = error.name; report.ok = false; }
  report.finishedAt = new Date().toISOString();
  report.limitations = ['Clock changes and clicks are explicit fixture inputs; no OS sleep, real data or live pet is manipulated.', 'Native windows render offscreen with opacity zero and use showInactive, preventing focus theft. Visibility and layout checks are not manual screen inspection.', 'Layout scale uses production zoom and bounds; it is not a physical monitor DPI change.'];
  try { headroom(); fs.writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  catch { report.reportWriteSkipped = true; report.ok = false; }
  console.log(JSON.stringify({ ok: report.ok, output, firstClicks: report.firstClicks, layouts: report.layouts.length, failure: report.failure }));
  app.exit(report.ok ? 0 : 1);
});
