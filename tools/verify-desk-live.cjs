'use strict';
// Visible production Electron UI with synthetic storage and a root-owned manual checkpoint.
// Test tool only; never connects to the installed pet, accounts or live desk data.
// Launch focused/physical modes with windowsHide:false. Windows hidden startup
// can suppress the first ordinary show(); it must not masquerade as a UI bug.
const assert = require('node:assert/strict');
function mouseReplayEvents(point) {
  assert.ok(point && Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y) && point.x >= 0 && point.y >= 0, 'invalid-replay-point');
  return [
    { type: 'mouseMove', x: point.x, y: point.y },
    { type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 },
  ];
}
// These main-process traces are independent of the renderer console pointer probe.
// Keep only fixed role/command metadata, never URLs, payload text or credentials.
function windowRole(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return 'other';
    return /\/panel\.html$/.test(parsed.pathname) ? 'panel' : /\/desk\.html$/.test(parsed.pathname) ? 'desk' : 'other';
  } catch { return 'other'; }
}
function createAuditIpc(ipc, { record, senderWindowId, deskWindowId }) {
  let sequence = 0;
  const proxy = {
    handle(channel, handler) {
      return ipc.handle(channel, function (...args) {
        const value = args[1];
        if (channel !== 'shuangling-panel:command' || !value || typeof value !== 'object' || Array.isArray(value) ||
            value.type !== 'desk' || !['focus', 'journal', 'notes'].includes(value.tab) ||
            !Object.keys(value).every(key => ['type', 'tab'].includes(key))) return handler.apply(this, args);
        const metadata = { requestId: ++sequence, senderWindowId: senderWindowId(args[0]), tab: value.tab };
        record({ phase: 'received', at: Date.now(), ...metadata });
        const completed = ok => record({ phase: 'completed', at: Date.now(), ...metadata, ok, deskWindowId: deskWindowId() });
        let result;
        try { result = handler.apply(this, args); }
        catch (error) { completed(false); throw error; }
        // Observe a promise without replacing it or changing its result/rejection.
        if (result && typeof result.then === 'function') result.then(value => completed(value?.ok === true), () => completed(false));
        else completed(result?.ok === true);
        return result;
      });
    },
    on(...args) { ipc.on(...args); return proxy; },
    removeListener(...args) { ipc.removeListener(...args); return proxy; },
    removeHandler(...args) { return ipc.removeHandler(...args); },
  };
  return proxy;
}
if (process.argv.includes('--self-check')) {
  assert.deepEqual(mouseReplayEvents({ x: 24, y: 35 }).map(event => event.type), ['mouseMove', 'mouseDown', 'mouseUp']);
  assert.ok(mouseReplayEvents({ x: 0, y: 0 }).every(event => event.x === 0 && event.y === 0));
  for (const point of [null, { x: -1, y: 3 }, { x: 1.5, y: 3 }, { x: 2, y: NaN }]) assert.throws(() => mouseReplayEvents(point));
  assert.equal(windowRole('file:///fixture/panel.html'), 'panel');
  assert.equal(windowRole('file:///fixture/desk.html'), 'desk');
  for (const url of ['file:///private/notes.html', 'https://example.test/desk.html', 'bad-url']) assert.equal(windowRole(url), 'other');
  const handlers = new Map(), traces = [], forwards = [];
  const fakeIpc = { handle(channel, handler) { handlers.set(channel, handler); }, on(...args) { forwards.push(['on', ...args]); }, removeListener(...args) { forwards.push(['removeListener', ...args]); }, removeHandler(channel) { handlers.delete(channel); } };
  const audit = createAuditIpc(fakeIpc, { record: row => traces.push(row), senderWindowId: event => event.windowId, deskWindowId: () => 9 });
  const event = { windowId: 4 }, value = { type: 'desk', tab: 'focus' }, result = { ok: true };
  audit.handle('shuangling-panel:command', (...args) => { assert.deepEqual(args, [event, value, 'extra']); return result; });
  assert.equal(handlers.get('shuangling-panel:command')(event, value, 'extra'), result);
  assert.deepEqual(traces.map(({ phase, senderWindowId, tab, ok, deskWindowId }) => ({ phase, senderWindowId, tab, ok, deskWindowId })), [
    { phase: 'received', senderWindowId: 4, tab: 'focus', ok: undefined, deskWindowId: undefined },
    { phase: 'completed', senderWindowId: 4, tab: 'focus', ok: true, deskWindowId: 9 },
  ]);
  let resolveResult, rejectResult;
  const pending = { then(resolve, reject) { resolveResult = resolve; rejectResult = reject; } };
  audit.handle('shuangling-panel:command', () => pending);
  assert.equal(handlers.get('shuangling-panel:command')(event, value), pending);
  resolveResult({ ok: true }); assert.equal(traces.at(-1).ok, true);
  handlers.get('shuangling-panel:command')(event, value); rejectResult(Error('private-error')); assert.equal(traces.at(-1).ok, false);
  const failure = Error('private-error');
  audit.handle('shuangling-panel:command', () => { throw failure; });
  assert.throws(() => handlers.get('shuangling-panel:command')(event, value), error => error === failure);
  const previous = traces.length;
  audit.handle('shuangling-panel:command', () => result);
  for (const ignored of [null, { type: 'pause' }, { type: 'desk', tab: 'other' }, { type: 'desk', tab: 'focus', text: 'PRIVATE' }]) assert.equal(handlers.get('shuangling-panel:command')(event, ignored), result);
  audit.handle('other-channel', () => result); assert.equal(handlers.get('other-channel')(event, value), result);
  assert.equal(traces.length, previous);
  const listener = () => {};
  assert.equal(audit.on('close', listener), audit); assert.equal(audit.removeListener('close', listener), audit);
  assert.deepEqual(forwards, [['on', 'close', listener], ['removeListener', 'close', listener]]);
  audit.removeHandler('other-channel'); assert.equal(handlers.has('other-channel'), false);
  assert.ok(traces.every(row => Object.keys(row).every(key => ['phase', 'at', 'requestId', 'senderWindowId', 'tab', 'ok', 'deskWindowId'].includes(key))));
  console.log(JSON.stringify({ ok: true, selfCheck: 'mouseReplayEvents+independentMainTrace', inputOrigin: 'electron-sendInputEvent', osMouseEvidence: false }));
  process.exit(0);
}
const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '..');
const at = process.argv.indexOf('--runtime-root');
if (at < 0 || !process.argv[at + 1]) throw Error('explicit-runtime-root-required');
const runtime = resolve(process.argv[at + 1]);
const physicalInput = process.argv.includes('--physical-input');
const inputReplay = process.argv.includes('--input-replay');
assert.ok(!(physicalInput && inputReplay), 'input-modes-are-exclusive');
const focusReplay = process.argv.includes('--focus-replay');
assert.ok(!focusReplay || inputReplay, 'focus-replay-requires-input-replay');
const nativeFocus = physicalInput || focusReplay;
const holdCard = physicalInput && process.argv.includes('--hold-card');
const tabsArgument = process.argv.find(value=>value.startsWith('--physical-tabs='));
const physicalTabs = tabsArgument ? tabsArgument.split('=')[1].split(',') : ['focus','journal','notes'];
assert.ok(physicalTabs.length>0&&new Set(physicalTabs).size===physicalTabs.length&&physicalTabs.every(tab=>['focus','journal','notes'].includes(tab)),'invalid-physical-tabs');
const output = join(runtime, 'qa', 'desk-live-20261029', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
function headroom() {
  const disk = fs.statfsSync(runtime.slice(0, 3));
  assert.ok(disk.bavail * disk.bsize > 3 * 1024 ** 3 + 16 * 1024 ** 2, 'disk-safety-stop');
}
headroom(); fs.mkdirSync(output, { recursive: true });
app.setPath('userData', join(output, 'electron-fixture'));
app.setPath('sessionData', join(output, 'electron-fixture'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
// Follow the monitor's actual DPI for the visible QA window.
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
  realSettingsWrites: 0, generationCredits: 0, githubPublish: false, physicalInput, inputReplay, inputOrigin: inputReplay ? 'electron-sendInputEvent' : physicalInput ? 'root-computer-use' : 'dom-click', osMouseEvidence: false,
  holdCard, focusReplay, physicalTabs, nativePointerEvents: [], nativeToolOpens: [], mainWindowEvents: [], mainDeskRequests: [], inputReplays: [], windowEvents: [], windowLiveness: [], blockedNetworkRequests: [], firstClicks: [], interactions: [], layouts: [], screenshots: [], errors: [], checks: {}, ok: false };
app.on('browser-window-created', (_event, win) => {
  const windowId = win.id, webContentsId = win.webContents.id;
  let role = 'other';
  const record = phase => {
    if (!win.isDestroyed()) role = windowRole(win.webContents.getURL());
    if (report.mainWindowEvents.length < 200) report.mainWindowEvents.push({ phase, at: Date.now(), windowId, webContentsId, role });
  };
  record('created');
  for (const [event, phase] of [['ready-to-show', 'ready'], ['show', 'show'], ['hide', 'hide'], ['closed', 'closed']]) win.on(event, () => record(phase));
});
const sourceFiles = ['src/desk/service.mjs', 'src/desk/memories.mjs', ...['desk-main.cjs', 'desk-preload.cjs', 'desk.js', 'desk.html', 'desk.css', 'panel-main.cjs', 'panel-ui.js', 'panel-i18n.js'].map(p => 'vendor/dsh-pet/runtime/electron-helper/' + p)];
report.sourceHashes = Object.fromEntries(sourceFiles.map(p => [p, hash(join(root, p))]));
class AuditWindow extends BrowserWindow {
  constructor(options) {
    super({ ...options, show: false, skipTaskbar: false, opacity: 1, focusable: true,
      webPreferences: { ...options.webPreferences, backgroundThrottling: false } });
    this.qaTitle = options.transparent ? (physicalInput ? '霜铃 QA 原生点击 · 控制卡片' : '霜铃 QA · 控制卡片') : (physicalInput ? '霜铃 QA 原生点击 · 独立工具窗口' : '霜铃 QA · 独立工具窗口');
    this.setIgnoreMouseEvents(false);
    this.webContents.on('did-finish-load', () => this.webContents.executeJavaScript(`document.addEventListener('pointerdown', e => { const shortcut=e.target.closest('[data-desk]'); console.log('__QA_NATIVE_POINTER__'+JSON.stringify({trusted:e.isTrusted,at:Date.now(),target:shortcut?.dataset.desk||e.target.id||e.target.tagName,shortcut:!!shortcut,button:e.button})); },true)`).catch(error=>report.errors.push('pointer-probe:'+error.name)));
    this.webContents.on('console-message', event => { if(String(event.message||'').startsWith('__QA_NATIVE_POINTER__')){try{report.nativePointerEvents.push({...JSON.parse(event.message.slice('__QA_NATIVE_POINTER__'.length)),windowId:this.id,windowTitle:this.qaTitle,inputOrigin:report.inputOrigin})}catch{report.errors.push('bad-pointer-probe')}} });
    this.on('page-title-updated', event => event.preventDefault());
    this.webContents.on('did-finish-load', () => this.setTitle(this.qaTitle));
    if(physicalInput)this.webContents.on('did-finish-load', () => this.webContents.executeJavaScript(`(() => { const title=document.querySelector('.identity h1'); if(title)title.textContent='独立验收测试'; })()`).catch(error=>report.errors.push('test-label:'+error.name)));
    this.revealCount = 0;
    this.mainFileLoaded = false;
    this.webContents.on('did-finish-load', () => { this.mainFileLoaded = true; });
    this.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) report.errors.push(String(event.message).slice(0, 180)); });
    this.webContents.on('render-process-gone', (_event, details) => report.errors.push('renderer-gone:' + details.reason));
    for (const name of ['show','hide','focus','blur','minimize','restore','closed']) super.on(name, () => {
      if (report.windowEvents.length < 200) report.windowEvents.push({at:Date.now(),event:name,windowId:this.id,title:this.qaTitle,...windowState(this)});
    });
  }
  on(event,listener) { if(holdCard&&event==='blur'&&this.qaTitle?.endsWith('控制卡片'))return this;return super.on(event,listener); }
  show() { this.revealCount++; this.revealedAfterLoad = this.mainFileLoaded; if(nativeFocus)super.show();else super.showInactive(); if(physicalInput&&!this.qaTitle.endsWith('控制卡片'))report.nativeToolOpens.push({at:Date.now(),windowId:this.id,tab:report.nativePointerEvents.filter(row=>row.shortcut).at(-1)?.target??null,title:this.qaTitle,reveals:this.revealCount,afterLoad:this.mainFileLoaded}); }
  focus() { if(nativeFocus)super.focus(); }
  hide() { if(report.windowEvents.length < 200)report.windowEvents.push({at:Date.now(),event:'hide-method',windowId:this.id,stack:new Error().stack.split('\n').slice(1,5).join('\n')});return super.hide(); }
}
function windowState(win) {
  if(win.isDestroyed())return{destroyed:true};
  return{destroyed:false,visible:win.isVisible(),focused:win.isFocused(),minimized:win.isMinimized(),opacity:win.getOpacity(),bounds:win.getBounds()};
}
let owner, panel, desk;
const auditIpc = createAuditIpc(ipcMain, {
  record: row => { if (report.mainDeskRequests.length < 200) report.mainDeskRequests.push(row); },
  senderWindowId: event => BrowserWindow.fromWebContents(event.sender)?.id ?? null,
  deskWindowId: () => panel?.desk.window && !panel.desk.window.isDestroyed() ? panel.desk.window.id : null,
});
let language = 'zh-CN', scale = 1, clock = Date.now() - 86400000;
let fixtureControl = { state:'working', paused:false, preempted:false };
const requests = [];
const stateFile = join(output, 'control-state.json');
const commandFile = join(output, 'control.json');
function publishManual(phase, extra={}) {
  headroom();
  fs.writeFileSync(stateFile, JSON.stringify({phase,pid:process.pid,output,commandFile,control:{...fixtureControl},
    physicalInput,holdCard,nativePointerEvents:report.nativePointerEvents.slice(-15),nativeToolOpens:report.nativeToolOpens.slice(-10),
    card:panel?.window&&!panel.window.isDestroyed()?{focusable:panel.window.isFocusable(),enabled:panel.window.isEnabled(),focused:panel.window.isFocused(),nativeParent:panel.window.getParentWindow()?.getTitle()||null,acceptsMouse:true,title:panel.window.getTitle(),visible:panel.window.isVisible(),opacity:panel.window.getOpacity(),loaded:panel.window.mainFileLoaded,bounds:panel.window.getBounds(),url:panel.window.webContents.getURL(),offscreen:panel.window.webContents.isOffscreen()}:null,
    desk:panel?.desk.window&&!panel.desk.window.isDestroyed()?{windowId:panel.desk.window.id,focusable:panel.desk.window.isFocusable(),enabled:panel.desk.window.isEnabled(),focused:panel.desk.window.isFocused(),nativeParent:panel.desk.window.getParentWindow()?.getTitle()||null,acceptsMouse:true,title:panel.desk.window.getTitle(),visible:panel.desk.window.isVisible(),opacity:panel.desk.window.getOpacity(),loaded:panel.desk.window.mainFileLoaded,bounds:panel.desk.window.getBounds(),url:panel.desk.window.webContents.getURL(),offscreen:panel.desk.window.webContents.isOffscreen(),reveals:panel.desk.window.revealCount}:null,
    requests:requests.slice(-20),at:new Date().toISOString(),...extra},null,2)+'\n');
}
async function manualCheckpoint() {
  await panel.open(owner);
  await until(()=>evalIn(panel.window, "!!document.querySelector('[data-desk=\"focus\"]')&&!document.querySelector('[data-desk=\"focus\"]').disabled"),'manual-card-ready');
  headroom();fs.writeFileSync(join(output,'manual-control-card.png'),(await panel.window.webContents.capturePage()).toPNG());report.screenshots.push('manual-control-card.png');
  console.log(JSON.stringify({checkpoint:'ready',pid:process.pid,output,stateFile,commandFile,cardTitle:panel.window.getTitle()}));
  let lastId=null;const deadline=Date.now()+20*60000;
  while(Date.now()<deadline){
    let command;try{command=JSON.parse(fs.readFileSync(commandFile,'utf8'))}catch{}
    if(command?.id&&command.id!==lastId){
      lastId=command.id;
      if(command.operation==='continue'){report.manualEvidence=command.evidence||null;panel.close();panel.desk.close();publishManual('automated');return;}
      if(command.operation==='card'){panel.desk.close();await panel.open(owner);}
      else if(['focus','journal','notes'].includes(command.operation)){panel.close();await open(command.operation);}
      else if(command.operation==='control'&&['working','idle','waiting','paused','manual'].includes(command.state)){fixtureControl={state:command.state==='waiting'?'waiting':command.state==='working'?'working':'idle',paused:command.state==='paused',preempted:command.state==='manual'};}
      else if(command.operation==='close'){panel.close();panel.desk.close();}
      else if(command.operation==='quit'){report.manualEvidence=command.evidence||null;throw Error('qa-only-user-stop');}
      else if(command.operation==='diagnose'){const win=panel.window||panel.desk.window;report.manualDOM=win?await evalIn(win,`({text:document.body.innerText.slice(0,2000),rect:document.body.getBoundingClientRect().toJSON(),background:getComputedStyle(document.body).backgroundColor,ready:document.readyState,html:document.documentElement.outerHTML.length})`):null;publishManual('manual',{dom:report.manualDOM,lastCommandId:lastId});await sleep(2000);}
    }
    publishManual('manual',{lastCommandId:lastId});await sleep(500);
  }
  throw Error('manual-checkpoint-timed-out');
}
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
async function replayShortcuts() {
  const controlBefore = JSON.stringify(fixtureControl);
  let previousDesk = null;
  for (const tab of ['focus', 'journal', 'notes']) {
    await closeDesk(); panel.close();
    assert.equal(panel.desk.window, null, 'cold-tool-window-required');
    await panel.open(owner);
    const card = panel.window;
    const cardId = card.id;
    await until(() => evalIn(card, `!!document.querySelector('[data-desk="${tab}"]')&&!document.querySelector('[data-desk="${tab}"]').disabled`), 'input-replay-card-ready-' + tab);
    const point = await evalIn(card, `(() => { const element=document.querySelector('[data-desk="${tab}"]'); const rect=element.getBoundingClientRect(); const x=Math.floor(rect.x+rect.width/2),y=Math.floor(rect.y+rect.height/2); return {x,y,rect:rect.toJSON(),viewport:{width:innerWidth,height:innerHeight},hit:document.elementFromPoint(x,y)?.closest('[data-desk]')?.dataset.desk||null,disabled:element.disabled}; })()`);
    assert.equal(point.disabled, false, 'shortcut-enabled');
    assert.equal(point.hit, tab, 'replay-point-hits-shortcut:' + JSON.stringify(point));
    assert.ok(point.rect.width > 0 && point.rect.height > 0 && point.x < point.viewport.width && point.y < point.viewport.height, 'shortcut-within-viewport');
    const events = mouseReplayEvents(point), pointerOffset = report.nativePointerEvents.length, requestOffset = requests.length;
    const ipcOffset = report.mainDeskRequests.length, lifecycleOffset = report.mainWindowEvents.length;
    const sentAt = Date.now();
    for (const event of events) { card.webContents.sendInputEvent(event); await sleep(20); }
    const win = await ready(tab);
    await until(() => report.mainDeskRequests.slice(ipcOffset).some(row => row.phase === 'completed'), 'input-replay-main-completed-' + tab);
    await sleep(250);
    if(focusReplay){
      for(let index=0;index<=5;index++){
        if(index)await sleep(1000);
        const state={tab,at:Date.now(),windowId:win.id,...windowState(win)};
        if(!state.destroyed)state.document=await evalIn(win,'({hidden:document.hidden,visibility:document.visibilityState,focused:document.hasFocus()})');
        report.windowLiveness.push(state);
      }
    }
    assert.notEqual(win, previousDesk, 'each-entry-creates-new-tool-window');
    const pointers = report.nativePointerEvents.slice(pointerOffset).filter(row => row.shortcut && row.target === tab);
    assert.equal(pointers.length, 1, 'one-pointerdown-per-replayed-click');
    assert.equal(win.revealCount, 1, 'one-reveal-per-replayed-click');
    assert.equal(win.revealedAfterLoad, true, 'replayed-reveal-after-finish-load');
    assert.equal(win.isVisible(), true, 'replayed-window-visible');
    assert.equal(panel.window, null, 'replayed-card-closed');
    assert.equal(JSON.stringify(fixtureControl), controlBefore, 'replay-retains-control');
    assert.ok(requests.slice(requestOffset).every(row => !row.write), 'replay-requests-read-only');
    const mainRequests = report.mainDeskRequests.slice(ipcOffset), received = mainRequests.filter(row => row.phase === 'received'), completed = mainRequests.filter(row => row.phase === 'completed');
    assert.equal(received.length, 1, 'one-main-desk-request-per-replayed-click');
    assert.equal(completed.length, 1, 'one-main-desk-completion-per-replayed-click');
    assert.equal(received[0].tab, tab, 'main-request-matches-shortcut');
    assert.equal(received[0].senderWindowId, cardId, 'main-request-from-current-card');
    assert.equal(completed[0].requestId, received[0].requestId, 'main-completion-matches-request');
    assert.equal(completed[0].senderWindowId, cardId, 'main-completion-retains-sender-card');
    assert.equal(completed[0].tab, tab, 'main-completion-matches-shortcut');
    assert.equal(completed[0].ok, true, 'main-desk-command-succeeded');
    assert.equal(completed[0].deskWindowId, win.id, 'main-completion-matches-desk');
    const lifecycle = report.mainWindowEvents.slice(lifecycleOffset).filter(row => row.windowId === win.id);
    assert.equal(lifecycle.filter(row => row.phase === 'created').length, 1, 'one-independent-desk-created');
    const shows = lifecycle.filter(row => row.phase === 'show');
    assert.equal(shows.length, 1, 'one-independent-desk-show');
    assert.equal(shows[0].role, 'desk', 'main-show-is-desk-page');
    assert.equal(shows[0].webContentsId, win.webContents.id, 'main-show-matches-desk-contents');
    report.inputReplays.push({tab,inputOrigin:'electron-sendInputEvent',osMouseEvidence:false,point,events,pointerdownCount:pointers.length,isTrustedObserved:pointers[0].trusted,senderCardId:cardId,windowId:win.id,mainRequests,mainShows:shows,reveals:win.revealCount,revealAfterLoad:win.revealedAfterLoad,nativeVisible:win.isVisible(),readyMs:Date.now()-sentAt,controlUnchanged:true,requests:requests.slice(requestOffset)});
    previousDesk=win; await closeDesk();
    assert.equal(win.isDestroyed(), true, 'replayed-tool-destroyed');
  }
  report.checks.threeColdShortcutInputReplays=report.inputReplays.length===3;
  report.checks.independentMainProcessRequests=report.inputReplays.length===3&&report.mainDeskRequests.filter(row=>row.phase==='received').length===3&&report.inputReplays.every(row=>row.mainRequests.length===2);
  report.checks.independentDeskShows=report.inputReplays.length===3&&report.inputReplays.every(row=>row.mainShows.length===1&&row.mainShows[0].windowId===row.windowId);
  report.checks.oneRevealAfterLoad=report.inputReplays.every(row=>row.reveals===1&&row.revealAfterLoad&&row.nativeVisible);
  report.checks.retainedWorkingState=fixtureControl.state==='working'&&!fixtureControl.paused&&!fixtureControl.preempted;
  report.checks.noControlWrites=requests.every(row=>!row.write);
  report.checks.noRealRequests=report.realRequests===0&&report.blockedNetworkRequests.length===0;
  report.checks.noScreenshots=report.screenshots.length===0;
  report.checks.noRendererErrors=report.errors.length===0;
  if(focusReplay)report.checks.sustainedNativeVisibility=report.windowLiveness.length===18&&report.windowLiveness.every(row=>!row.destroyed&&row.visible&&!row.minimized&&row.document.visibility==='visible');
  report.checks.settingsAndMediaUnchanged=JSON.stringify(fingerprints())===JSON.stringify(before);
  report.checks.sourceUnchanged=sourceFiles.every(p=>hash(join(root,p))===report.sourceHashes[p]);
  report.ok=Object.values(report.checks).every(Boolean);
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed=/^(file:|about:|data:|devtools:)/.test(details.url);
    if(!allowed)report.blockedNetworkRequests.push({scheme:details.url.split(':')[0],resourceType:details.resourceType});
    callback({cancel:!allowed});
  });
  const { createDeskService } = await import(pathToFileURL(join(root, 'src/desk/service.mjs')));
  const dataDir = join(output, 'synthetic-data');
  const service = () => createDeskService({ dataDir, now: () => clock, autoTick: false });
  desk = await service();
  await desk.command({ type: 'note.create', text: 'QA: 把未写满的一页留给明天。 A page for tomorrow. 💜', intent: 'remember' });
  await desk.command({ type: 'note.create', text: 'QA_ORDINARY_BOOKMARK_MUST_STAY_PRIVATE', intent: 'none' });
  await desk.recordTask({ id: 'synthetic-confirmed-round', at: clock });
  clock += 86400000;
  await desk.tick();
  assert.equal((await desk.snapshot()).memories.entries.length, 1);
  report.interactions.push('day-rollover-creates-one-page-from-explicit-records');
  const client = { async request(route, body) {
    requests.push({route,write:body!==undefined,type:body?.type||null,at:Date.now()});
    if (route === '/api/desk') { if (!body) await sleep(90); return body ? desk.command(body) : desk.snapshot(); }
    if (route === '/api/preferences') return { language, autoLaunch: false, ambientEnabled: true, ambientFrequency: 'normal', lifecycle: {} };
    if (body) throw Error('fixture-route-not-writable');
    if (route === '/api/state') return { status: { state: fixtureControl.state, scope: 'codex' }, control: { paused: fixtureControl.paused, preempted: fixtureControl.preempted }, availableAnimations: ['idle'] };
    if (route === '/api/appearance') return { size: 339, position: { corner: 'bottom-right', marginX: 20, marginY: 12 }, display: 'desktop', metrics: { visibleHeightRatio: .35390625, minWidth: 160, maxWidth: 1200, defaultWidth: 562, defaultVisibleHeight: 200 } };
    if (route === '/api/usage') return { selection: { status: 'unknown' } };
    if (route === '/api/account-usage') return {};
    throw Error('fixture-route-not-allowed');
  } };
  owner = new BrowserWindow({ x:1200,y:400,width:1,height:1,show:false,skipTaskbar:true });
  await owner.loadURL('about:blank');
  panel = createPanelController({ BrowserWindow: AuditWindow, ipcMain: auditIpc, screen,
    shell: { openExternal: async () => { throw Error('no-external-links'); } }, client, getScale: () => scale, isPetWindow: win => win === owner });
  if (inputReplay) { await replayShortcuts(); return; }
  await manualCheckpoint();
  if(physicalInput){
    report.checks.physicalShortcuts = physicalTabs.every(tab=>report.nativePointerEvents.filter(row=>row.trusted&&row.shortcut&&row.target===tab).length===1);
    report.checks.openedFromPhysicalShortcuts=report.nativeToolOpens.length===physicalTabs.length&&report.nativeToolOpens.every(row=>row.reveals===1&&row.afterLoad);
    report.checks.noControlWrites=requests.every(row=>!row.write);
    report.checks.retainedWorkingState=fixtureControl.state==='working'&&!fixtureControl.paused&&!fixtureControl.preempted;
    report.checks.settingsAndMediaUnchanged=JSON.stringify(fingerprints())===JSON.stringify(before);
    report.checks.sourceUnchanged=sourceFiles.every(p=>hash(join(root,p))===report.sourceHashes[p]);
    report.ok=Object.values(report.checks).every(Boolean);return;
  }
  for (const condition of ['working','paused','manual','idle']) {
    fixtureControl={state:condition==='working'?'working':'idle',paused:condition==='paused',preempted:condition==='manual'};
    const retained=JSON.stringify(fixtureControl), offset=requests.length;
    for(const tab of ['focus','journal','notes']){
      await panel.open(owner);const card=panel.window;
      await until(()=>evalIn(card,`!!document.querySelector('[data-desk=\"${tab}\"]')&&!document.querySelector('[data-desk=\"${tab}\"]').disabled`),'priority-shortcut-'+condition+'-'+tab);
      await evalIn(card,`document.querySelector('[data-desk=\"${tab}\"]').click()`);
      await ready(tab);await closeDesk();
      assert.equal(JSON.stringify(fixtureControl),retained,'browsing-must-retain-control-'+condition);
    }
    assert.ok(requests.slice(offset).every(row=>!row.write),'browsing-must-be-read-only-'+condition);
    report.interactions.push('visible-browsing-retains-'+condition+'-with-no-control-or-animation-request');
  }
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
      if (factor === 1 && tab === 'memories' && report.screenshots.length < 2) { headroom(); const file = 'our-days-' + locale + '.png'; fs.writeFileSync(join(output, file), (await win.webContents.capturePage()).toPNG()); report.screenshots.push(file); }
    }
    await closeDesk();
  }
  report.checks.onlySyntheticDeskWrites=requests.filter(row=>row.write).every(row=>row.route==='/api/desk');
  report.checks.noFocusStealingOverride=true;
  report.checks.visibleNativeWindows=true;
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
  report.limitations = inputReplay ? ['inputOrigin=electron-sendInputEvent: events are replayed inside actual BrowserWindow webContents at DOM-measured shortcut positions. This is not physical OS mouse evidence.', 'isTrusted is recorded only as an Electron event property; it does not establish OS mouse origin.', 'Production frame/styles and independent fixture data are used. No screenshots, real task inputs, account requests, settings changes or media edits are performed.', focusReplay?'Standard show/focus is enabled; each shortcut has six native/document visibility samples over five seconds. readyMs includes this stability observation and is not first-open latency.':'Native windows use showInactive; the harness suppresses programmatic focus. Physical mouse evidence is recorded separately.'] : [physicalInput?'Physical-input-only mode; automatic DOM/IPC/layout workflows intentionally skipped.':'Clock changes and clicks are explicit fixture inputs; no OS sleep, real data or live pet is manipulated.', physicalInput?'Production window frame/styles are retained; standard show/focus and mouse input are enabled in this owned QA fixture. Actual root Computer Use results are recorded separately.':'Native windows are visible (opacity one, offscreen disabled) and revealed with showInactive; programmatic focus is suppressed by the test harness. Root-owned Computer Use observations are recorded separately.', holdCard?'QA-only blur hold keeps the transient card alive across Computer Use observations; external-click dismissal is deliberately not validated.':'Layout scale uses production zoom and bounds; it is not a physical monitor DPI change.'];
  try {
    report.checks.settingsAndMediaUnchanged=JSON.stringify(fingerprints())===JSON.stringify(before);
    report.checks.sourceUnchanged=sourceFiles.every(p=>hash(join(root,p))===report.sourceHashes[p]);
    report.ok&&=report.checks.settingsAndMediaUnchanged&&report.checks.sourceUnchanged;
  } catch(error) { report.preservationError=error.name; report.ok=false; }
  try { headroom(); fs.writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  catch { report.reportWriteSkipped = true; report.ok = false; }
  publishManual('finished',{ok:report.ok});
  console.log(JSON.stringify({ ok: report.ok, output, firstClicks: report.firstClicks, layouts: report.layouts.length, failure: report.failure }));
  app.exit(report.ok ? 0 : 1);
});
