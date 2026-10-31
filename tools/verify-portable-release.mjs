import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, link, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { validatePackagedAnimationInventory } from './portable-media-inventory.mjs';

// This opt-in smoke check never installs a plugin/task or uses a real Codex home.
// Its private state stays under release/validation; it does not clean up files.
const execFileAsync = promisify(execFile);
const delay = ms => new Promise(done => setTimeout(done, ms));
const startedAt = Date.now();
const rootArg = process.argv[2];
if (!rootArg || process.platform !== 'win32') throw Error('Usage on Windows: node tools/verify-portable-release.mjs <staged-package>');
const packageRoot = await realpath(resolve(rootArg));
const manifest = JSON.parse(await readFile(join(packageRoot, 'PACKAGE-MANIFEST.json'), 'utf8'));
assert.equal(manifest.platform, 'win32');
assert.equal(manifest.arch, 'x64');
assert.ok(Array.isArray(manifest.files) && manifest.files.length > 30, 'a packaged manifest is required');
const runRoot = join(dirname(packageRoot), 'validation', 'portable-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
const dataDir = join(runRoot, 'isolated-data'), codexHome = join(runRoot, 'fake-codex-home');
await mkdir(dataDir, { recursive: true }); await mkdir(codexHome, { recursive: true });
await writeFile(join(codexHome, 'config.toml'), '# Isolated release validation; no enabled plugins or credentials.\n');
const report = {
  version: manifest.version, startedAt: new Date(startedAt).toISOString(), checks: {},
  limitations: ['No human drag, click-through, monitor-boundary, or visual animation-quality acceptance was performed.'],
};
const env = {
  ...process.env, CODEX_HOME: codexHome, SHUANGLING_DATA_DIR: dataDir,
  SHUANGLING_NO_OPEN: '1', SHUANGLING_SILENT_ERRORS: '1',
  // Prevent even a read-only native account query during isolated testing.
  SHUANGLING_CODEX_EXE: join(codexHome, 'no-native-account-reader.exe'),
};
for (const key of ['CODEX_THREAD_ID', 'SHUANGLING_LIFECYCLE_INTENT', 'ELECTRON_RUN_AS_NODE']) delete env[key];
const node = join(packageRoot, 'windows', 'runtime', 'node', 'node.exe');
const launcher = join(packageRoot, 'windows', 'start.mjs');
const lockFile = join(dataDir, 'desktop-runtime.json');
const nativeFile = join(dataDir, 'dsh-home', 'dsh-pet', 'standalone-runtime.json');
const json = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(operation, timeout = 15000) {
  const untilAt = Date.now() + timeout;
  while (Date.now() < untilAt) { const value = await operation(); if (value) return value; await delay(100); }
  throw Error('isolated-check-timeout');
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function spawnNode(args) {
  const child = spawn(node, args, { cwd: packageRoot, env, windowsHide: true, stdio: 'ignore' });
  const exited = new Promise((done, reject) => { child.once('error', reject); child.once('exit', (code, signal) => done({ code, signal })); });
  return { child, exited };
}
async function runNode(args, timeout = 10000) {
  const process = spawnNode(args);
  let timer;
  try {
    const result = await Promise.race([process.exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('isolated-command-timeout')), timeout); })]);
    assert.equal(result.code, 0, 'isolated command succeeds');
  } finally { clearTimeout(timer); if (process.child.exitCode === null) process.child.kill(); }
}
async function request(base, path, token, body, header = 'x-dsh-pet-token', method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, {
    method, headers: { [header]: token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(2500),
  });
  assert.ok(response.ok, 'isolated authenticated request succeeds');
  return response.json();
}
function localBase(port) { assert.ok(Number.isInteger(port) && port > 0 && port <= 65535); return 'http://127.0.0.1:' + port; }
let managerProcess, managerIdentity, nativeIdentity;
async function stopOwned() {
  const identity = managerIdentity || await json(lockFile);
  if (identity?.pid === managerProcess?.child.pid && alive(identity.pid)) {
    await request(localBase(identity.managerPort), '/stop', identity.token, {}, 'x-shuangling-token').catch(() => {});
  }
  if (managerProcess) {
    await until(() => !alive(managerProcess.child.pid), 10000).catch(() => {});
    if (alive(managerProcess.child.pid)) managerProcess.child.kill();
  }
}
try {
  const paths = new Set();
  for (const entry of manifest.files) {
    assert.equal(typeof entry.path, 'string');
    assert.ok(!isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes('..'), 'manifest file stays inside package');
    assert.ok(!paths.has(entry.path)); paths.add(entry.path);
    const file = resolve(packageRoot, entry.path);
    assert.ok(!relative(packageRoot, file).startsWith('..' + sep));
    assert.equal((await stat(file)).size, entry.bytes, 'packaged length matches ' + entry.path);
    assert.equal(await sha256(file), entry.sha256, 'packaged bytes match ' + entry.path);
  }
  report.checks.packageHashes = { passed: true, fileCount: paths.size };
  // Exercise relocation in a disposable skeleton, never overwrite the release's
  // disabled MCP template or the user's installed .mcp.json.
  const preparationRoot = join(runRoot, 'plugin preparation 中文');
  await mkdir(join(preparationRoot, 'windows', 'runtime', 'node'), { recursive: true });
  await mkdir(join(preparationRoot, 'src', 'plugin'), { recursive: true });
  await mkdir(join(preparationRoot, 'plugin-marketplace', 'plugins', 'shuangling-gpt'), { recursive: true });
  await writeFile(join(preparationRoot, 'windows', 'runtime', 'node', 'node.exe'), '');
  await writeFile(join(preparationRoot, 'src', 'plugin', 'server.mjs'), '');
  const { installPlugin } = await import(pathToFileURL(join(packageRoot, 'windows', 'install-plugin.mjs')));
  let externalCalls = 0;
  const forbidden = () => { externalCalls++; throw Error('native-registration-forbidden-in-validation'); };
  const prepared = await installPlugin({ projectRoot: preparationRoot, prepareOnly: true, runCli: forbidden, findCli: forbidden });
  assert.ok(prepared.ok && prepared.preparedOnly); assert.equal(externalCalls, 0);
  const generated = (await json(join(preparationRoot, 'plugin-marketplace', 'plugins', 'shuangling-gpt', '.mcp.json'))).mcpServers.shuangling_gpt;
  const slash = file => resolve(file).replaceAll('\\', '/');
  assert.equal(generated.command, slash(join(preparationRoot, 'windows', 'runtime', 'node', 'node.exe')));
  assert.equal(generated.cwd, slash(preparationRoot));
  assert.deepEqual(generated.args, [slash(join(preparationRoot, 'src', 'plugin', 'server.mjs'))]);
  report.checks.pluginPrepareOnly = { passed: true, nativeRegistrationCalls: externalCalls };
  // Hard links save disk during the smoke test. The distributable itself has
  // full files, and the normal launcher still verifies every runtime asset.
  const assets = JSON.parse(await readFile(join(packageRoot, 'reports', 'windows-assets.json'), 'utf8'));
  const packageOutlineContract = await import(pathToFileURL(join(packageRoot, 'windows', 'outline-contract.mjs')));
  const { names: animationNames, legacyContract } = validatePackagedAnimationInventory(assets, packageOutlineContract);
  const runtimeAssets = join(dataDir, 'dsh-home', 'dsh-pet', 'main-animation', 'webm');
  await mkdir(runtimeAssets, { recursive: true });
  for (const animation of assets.animations) {
    const name = animation.name; assert.match(name, /^[a-z-]+$/);
    await link(join(packageRoot, 'windows', 'assets', 'shuangling', name + '.webm'), join(runtimeAssets, name + '.webm'));
  }
  await access(node);
  managerProcess = spawnNode([launcher, 'start']);
  managerIdentity = await until(async () => {
    const identity = await json(lockFile);
    if (identity?.pid !== managerProcess.child.pid || !identity.managerPort || !identity.settingsUrl) return null;
    const health = await request(localBase(identity.managerPort), '/health', identity.token, undefined, 'x-shuangling-token').catch(() => null);
    return health?.instanceId === identity.instanceId && health.ready ? identity : null;
  });
  nativeIdentity = await json(nativeFile);
  const nativeBase = localBase(nativeIdentity.port);
  const health = await request(nativeBase, '/health', nativeIdentity.token);
  assert.equal(health.pid, nativeIdentity.pid);
  assert.equal(resolve(health.pluginRoot), join(packageRoot, 'vendor', 'dsh-pet'));
  const settingsUrl = new URL(managerIdentity.settingsUrl);
  assert.equal(settingsUrl.hostname, '127.0.0.1');
  const settingsToken = settingsUrl.hash.slice(1), settingsBase = settingsUrl.origin;
  const state = await request(settingsBase, '/api/state', settingsToken, undefined, 'x-shuangling-token');
  assert.equal(state.status.scope, 'codex');
  assert.equal(state.defaultUsageThreadId, null);
  assert.equal(state.usageThreadId, null);
  await request(settingsBase, '/api/settings', settingsToken, { paused: true }, 'x-shuangling-token');
  report.checks.isolatedStartup = { passed: true, globalActivityScope: true, unboundFirstLaunch: true };
  const denied = await fetch(nativeBase + '/dsh-pet-7340/interaction?pet=shuangling&surface=desktop', { headers: { 'x-dsh-pet-token': 'invalid' }, signal: AbortSignal.timeout(2500) });
  assert.equal(denied.status, 403);
  for (const animation of assets.animations) {
    const response = await fetch(nativeBase + '/dsh-pet-7340/thumb/main/' + animation.name + '.webm', { method: 'HEAD', signal: AbortSignal.timeout(2500) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /video\/webm/);
  }
  report.checks.nativeApiAndAnimationResources = { passed: true, resourceCount: animationNames.length, legacyOutlineContract: legacyContract, invalidCapabilityDenied: true };
  await runNode([launcher, 'start']);
  const same = await json(lockFile);
  assert.equal(same.pid, managerIdentity.pid); assert.equal(same.instanceId, managerIdentity.instanceId);
  assert.equal((await json(nativeFile)).pid, nativeIdentity.pid);
  report.checks.singleInstance = { passed: true };
  const { PetClient } = await import(pathToFileURL(join(packageRoot, 'src', 'bridge', 'pet-client.mjs')));
  const client = new PetClient({ dshHome: join(dataDir, 'dsh-home') });
  await until(async () => { const interaction = await client.interaction().catch(() => null); return interaction?.ok !== false && interaction?.interaction?.phase !== 'unavailable' ? interaction : null; }, 8000);
  const lock = await until(() => client.lock(undefined, 15000).catch(() => null), 3000);
  assert.ok(lock.lockId);
  const playback = await client.play('waving', lock.lockId); assert.ok(playback.playbackId);
  const ended = await until(async () => {
    const receipt = await client.playback(playback.playbackId);
    if (receipt.status === 'failed' || receipt.status === 'cancelled') throw Error('isolated-playback-' + receipt.status);
    return receipt.status === 'ended' ? receipt : null;
  }, 12000);
  assert.equal(ended.name, 'waving'); await client.release(lock.lockId);
  report.checks.renderedPlaybackReceipt = { passed: true, animation: 'waving', finalStatus: ended.status };
  await runNode([launcher, 'stop']);
  await until(() => !alive(managerIdentity.pid) && !alive(nativeIdentity.pid), 10000);
  // Query only the staged Electron executable, excluding the real running pet.
  const electronPath = join(packageRoot, 'windows', 'runtime', 'electron', 'electron.exe');
  const escaped = electronPath.replaceAll("'", "''");
  const command = "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.ExecutablePath -eq '" + escaped + "' }).Count";
  await until(async () => {
    const result = await execFileAsync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000 });
    return Number(result.stdout.trim()) === 0;
  }, 10000);
  report.checks.fullShutdown = { passed: true, managerExited: true, hostExited: true, stagedElectronProcesses: 0 };
  report.ok = true;
} catch (error) {
  report.ok = false;
  // Assertions contain local paths at most; never serialize request identities,
  // settings URLs, response objects or arbitrary process output.
  report.failure = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0].slice(0, 220) : /^[a-z0-9-]+$/.test(error.message || '') ? error.message : 'portable-validation-failed';
} finally {
  await stopOwned();
  report.finishedAt = new Date().toISOString(); report.elapsedSeconds = Math.round((Date.now() - startedAt) / 100) / 10;
  await writeFile(join(runRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ...report, reportDirectory: relative(dirname(packageRoot), runRoot).replaceAll('\\', '/') }, null, 2));
process.exitCode = report.ok ? 0 : 1;
