import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ensureObserver, getLifecyclePreferences, setLifecyclePreferences, markManualStart, markManualStop } from '../lifecycle/index.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJson = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };

export class CompanionPlugin {
  constructor({ projectRoot, dataDir = join(projectRoot, 'windows', 'data'), startImpl, lifecycle = {} }) {
    this.root = projectRoot;
    this.data = dataDir;
    this.startImpl = startImpl;
    this.lifecycle = lifecycle;
    this.initialized = false;
  }
  lifecycleOptions() { return { projectRoot: this.root, dataDir: this.data, ...this.lifecycle }; }
  async current() {
    const identity = await readJson(join(this.data, 'desktop-runtime.json'));
    if (!Number.isInteger(identity?.managerPort) || !identity?.token) return null;
    try {
      const response = await fetch(`http://127.0.0.1:${identity.managerPort}/health`, {
        headers: { 'x-shuangling-token': identity.token }, signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return null;
      const result = await response.json();
      return result.ready && result.instanceId === identity.instanceId ? identity : null;
    } catch { return null; }
  }
  async settings(path, { method = 'GET', body } = {}) {
    const instance = await this.current();
    if (!instance) return { running: false };
    const base = new URL(instance.settingsUrl);
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1') throw new Error('invalid-local-settings');
    const response = await fetch(new URL(path, base), { method,
      headers: { 'x-shuangling-token': base.hash.slice(1), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('companion-request-rejected');
    return response.json();
  }
  async automaticStart() {
    if (this.initialized) return;
    this.initialized = true;
    // MCP connections are per chat. Only the package-verified native observer
    // owns automatic starts, including launches before any chat is opened.
    return ensureObserver(this.lifecycleOptions());
  }
  async start() {
    await markManualStart(this.lifecycleOptions());
    if (await this.current()) return { running: true, existing: true };
    if (this.startImpl) return this.startImpl();
    const child = spawn(join(this.root, 'windows', 'runtime', 'node', 'node.exe'), [join(this.root, 'windows', 'start.mjs'), 'start'], {
      cwd: this.root, detached: true, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, SHUANGLING_NO_OPEN: '1', SHUANGLING_DATA_DIR: this.data, SHUANGLING_LIFECYCLE_INTENT: 'manual' },
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { if (await this.current()) return { running: true, existing: false }; await sleep(200); }
    throw new Error('companion-start-timeout');
  }
  async status() {
    const instance = await this.current();
    const preferences = await getLifecyclePreferences(this.lifecycleOptions());
    if (!instance) return { running: false, ...preferences };
    try {
      const [state, appearance] = await Promise.all([this.settings('/api/state'), this.settings('/api/appearance')]);
      return { running: true, ...preferences, ...state, appearance };
    } catch {
      // The settings server closes before the native host during a graceful
      // exit. Report that transition instead of treating it as a tool failure.
      return { running: !!await this.current(), transitioning: true, ...preferences };
    }
  }
  async usage() { return this.settings('/api/usage'); }
  async stop() {
    await markManualStop(this.lifecycleOptions());
    const instance = await this.current();
    if (!instance) return { running: false };
    const response = await fetch(`http://127.0.0.1:${instance.managerPort}/stop`, {
      method: 'POST', headers: { 'x-shuangling-token': instance.token }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('companion-stop-rejected');
    return { stopping: true };
  }
  async pause(paused) { return this.settings('/api/settings', { method: 'POST', body: { paused } }); }
  async openSettings() {
    const instance = await this.current();
    if (!instance) return { running: false };
    const base = new URL(instance.settingsUrl);
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1') throw new Error('invalid-local-settings');
    const opener = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', base.href], { detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => { opener.once('spawn', resolve); opener.once('error', reject); });
    opener.unref();
    return { opened: true };
  }
  async setAutoLaunch(enabled) {
    return setLifecyclePreferences(this.lifecycleOptions(), { autoLaunch: enabled });
  }
}
