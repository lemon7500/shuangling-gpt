'use strict';
// Reproduce README screenshots with the production panel and in-memory demo data.
// Run with Electron, not Node. No live pet, account, chat, manager or settings API.
const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = resolve(__dirname, '..');
const helper = join(root, 'vendor/dsh-pet/runtime/electron-helper');
const output = join(root, 'docs/media');
const { createPanelController } = require(join(helper, 'panel-main.cjs'));
const userData = mkdtempSync(join(tmpdir(), 'shuangling-readme-panels-'));
app.setPath('userData', userData);
app.setPath('sessionData', userData);
app.setName('shuangling-readme-screenshots');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
mkdirSync(output, { recursive: true });

const sleep = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const at = new Date().toISOString();
const demoThread = { threadId: 'readme-demo-chat', threadName: '代码审阅（示例）', projectName: '示例项目' };
const account = { planType: 'plus', observedAt: at,
  fiveHour: { status: 'available', observedAt: at, remainingPercent: 64, usedPercent: 36, windowMinutes: 300, resetsAt: Math.floor(Date.now() / 1000) + 7200 },
  weekly: { status: 'available', observedAt: at, remainingPercent: 81, usedPercent: 19, windowMinutes: 10080, resetsAt: Math.floor(Date.now() / 1000) + 86400 * 4 },
};
const fixtures = {
  '/api/state': { status: { state: 'working', scope: 'codex', activeCount: 2, workingCount: 1, waitingCount: 1, unknownCount: 0, updatedAt: at }, control: { paused: false, preempted: false } },
  '/api/usage': { selection: { status: 'available', ...demoThread, source: 'selected-chat', observedAt: at, choices: [demoThread] },
    context: { status: 'available', observedAt: at, remainingTokens: 128000, windowTokens: 256000, remainingPercent: 50, sample: 'last-model-request' },
    project: { status: 'available', scope: 'thread', usedTokens: 1234567, threadCount: 1, sampledThreadCount: 1, observedAt: at }, account },
  '/api/account-usage': account,
  '/api/appearance': { size: 562, position: { corner: 'bottom-right', marginX: 20, marginY: 12 }, display: 'desktop', metrics: { minWidth: 160, maxWidth: 1200, visibleHeightRatio: .35390625, defaultWidth: 562, defaultVisibleHeight: 200 } },
  '/api/preferences': { autoLaunch: true, lifecycle: { available: true, taskInstalled: true, taskEnabled: true, pluginEnabled: true, observerRunning: true, sessionActive: true, windowCount: 1 } },
};
const client = { async request(route, body) {
  if (body !== undefined || !Object.hasOwn(fixtures, route)) throw Error('demo-read-only');
  return structuredClone(fixtures[route]);
} };

// Production controller calls show/focus; the capture window remains hidden.
class CaptureWindow extends BrowserWindow {
  constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }); }
  show() {}
  focus() {}
}
let controller, owner;
app.whenReady().then(async () => {
  owner = new BrowserWindow({ width: 1, height: 1, show: false, skipTaskbar: true });
  await owner.loadURL('about:blank');
  controller = createPanelController({ BrowserWindow: CaptureWindow, ipcMain,
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    shell: { openExternal: async () => { throw Error('demo-no-external-links'); } },
    client, getScale: () => 2, isPetWindow: win => win === owner,
  });
  await controller.open(owner, { anchor: { x: 1000, y: 500, width: 200, height: 260 } });
  const panel = controller.window;
  const deadline = Date.now() + 10000;
  while (!await panel.webContents.executeJavaScript("!document.getElementById('pause').disabled && document.getElementById('project-value').textContent==='1,234,567'")) {
    if (Date.now() > deadline) throw Error('demo-panel-not-ready');
    await sleep(40);
  }
  await panel.webContents.executeJavaScript('document.fonts.ready');
  const captures = [];
  for (const tab of ['overview', 'actions', 'settings']) {
    await panel.webContents.executeJavaScript(`document.getElementById('tab-${tab}').click()`);
    await sleep(250);
    const image = await panel.webContents.capturePage();
    const png = image.toPNG();
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (width !== 704 || height !== 1040) throw Error('unexpected-capture-resolution');
    const file = `panel-${tab}.png`;
    writeFileSync(join(output, file), png);
    captures.push({ file, width, height, cssWidth: 352, cssHeight: 520,
      devicePixelRatio: await panel.webContents.executeJavaScript('window.devicePixelRatio'),
      nativeScaleFactors: image.getScaleFactors(),
    });
  }
  console.log(JSON.stringify({ ok: true, productionPanel: true, syntheticDataOnly: true, liveRequests: 0, captures }));
  controller.destroy(); owner.destroy(); app.quit();
}).catch(error => {
  console.error(error.message);
  controller?.destroy(); owner?.destroy(); app.exit(1);
});
