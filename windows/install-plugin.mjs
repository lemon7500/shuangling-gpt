// Install only this local companion plugin, using Codex's native plugin CLI.
// The installed MCP paths are regenerated for the current extraction directory.
import { access, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve, normalize, basename, dirname, isAbsolute } from 'node:path';
import { atomicJson } from '../src/lifecycle/index.mjs';

const marketplaceName = 'shuangling-local';
const pluginName = 'shuangling-gpt';
const id = `${pluginName}@${marketplaceName}`;
const slash = value => value.replaceAll('\\', '/').replace(/\/$/, '');
const equalPath = (a, b) => normalize(a || '').replace(/[\\/]+$/, '').toLowerCase() === normalize(b || '').replace(/[\\/]+$/, '').toLowerCase();
const sourceAt = market => join(market, 'plugins', pluginName);
const failure = error => /^[a-z0-9-]+$/.test(error?.message) ? error.message : 'plugin-install-failed';
const retirementFile = root => join(root, 'reports', 'observer-retirement.json');

async function validateRetirementSource(root, market) {
  if (typeof market !== 'string' || !isAbsolute(market) || basename(market).toLowerCase() !== 'plugin-marketplace' || equalPath(market, join(root, 'plugin-marketplace'))) throw new Error('old-source-root-unverified');
  let manifest;
  try {
    const file = join(market, '.agents', 'plugins', 'marketplace.json');
    if ((await stat(file)).size > 65536) throw Error('oversized');
    manifest = JSON.parse(await readFile(file, 'utf8'));
  } catch { throw new Error('old-source-root-unverified'); }
  const entry = manifest?.plugins?.[0];
  if (!manifest || manifest.name !== marketplaceName || !Array.isArray(manifest.plugins) || manifest.plugins.length !== 1 || entry.name !== pluginName || entry.source?.source !== 'local' || typeof entry.source.path !== 'string' || !equalPath(resolve(market, entry.source.path), sourceAt(market))) throw new Error('old-source-root-unverified');
  return resolve(market);
}
async function readPendingRetirement(root) {
  let value;
  try {
    const file = retirementFile(root);
    if ((await stat(file)).size > 4096) throw Error('oversized');
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('observer-retirement-marker-unverified');
  }
  if (value?.schemaVersion !== 1 || !equalPath(value.projectRoot, root)) throw new Error('observer-retirement-marker-unverified');
  if (value.pendingMarketplaceRoot === null && value.pendingPluginSource === null) return null;
  if (typeof value.pendingMarketplaceRoot !== 'string' || typeof value.pendingPluginSource !== 'string' || !equalPath(value.pendingPluginSource, sourceAt(value.pendingMarketplaceRoot))) throw new Error('observer-retirement-marker-unverified');
  return validateRetirementSource(root, value.pendingMarketplaceRoot);
}
async function persistPendingRetirement(root, market) {
  await mkdir(join(root, 'reports'), { recursive: true });
  await atomicJson(retirementFile(root), { schemaVersion: 1, projectRoot: root,
    pendingMarketplaceRoot: market, pendingPluginSource: market ? sourceAt(market) : null });
}

async function codexPath() {
  if (process.env.SHUANGLING_CODEX_EXE) {
    const explicit = resolve(process.env.SHUANGLING_CODEX_EXE);
    await access(explicit); return explicit;
  }
  const bin = join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  const candidates = [];
  for (const entry of await readdir(bin, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const path = join(bin, entry.name, 'codex.exe');
    try { candidates.push({ path, time: (await stat(path)).mtimeMs }); } catch { /* other runtime */ }
  }
  if (!candidates.length) throw new Error('codex-cli-not-found');
  return candidates.sort((a, b) => b.time - a.time)[0].path;
}
async function nativeRun(cli, args, root) {
  return new Promise((resolveCall, reject) => {
    const child = spawn(cli, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('native-cli-timeout')); }, 60000);
    child.stdout.on('data', bytes => { output += bytes; });
    // Drain stderr, but never persist or return native diagnostic content.
    child.stderr.on('data', () => {});
    child.once('error', cause => { clearTimeout(timer); reject(cause); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error('native-plugin-command-failed')); return; }
      try { resolveCall(JSON.parse(output)); } catch { reject(new Error('native-cli-invalid-response')); }
    });
  });
}

// Dependencies are injectable only through this module API so migration and
// partial-commit failures can be tested without changing any native install.
export async function installPlugin({ projectRoot, runCli = nativeRun, findCli = codexPath, prepareOnly = false, configureLifecycle }) {
  const root = resolve(projectRoot);
  const market = join(root, 'plugin-marketplace');
  const report = { startedAt: new Date().toISOString(), pluginId: id, projectRoot: root, ok: false };
  const desired = { mcpServers: { shuangling_gpt: {
    command: slash(join(root, 'windows', 'runtime', 'node', 'node.exe')),
    args: [slash(join(root, 'src', 'plugin', 'server.mjs'))],
    cwd: slash(root), env: { SHUANGLING_PROJECT_ROOT: slash(root) }, enabled: true,
    startup_timeout_sec: 30, tool_timeout_sec: 30,
  } } };
  let cli, oldMarket, previousInstall, pendingRetirement = null, mutationAttempted = false;
  const call = args => runCli(cli, args, root);
  const readMarket = async () => {
    const result = await call(['plugin', 'marketplace', 'list', '--json']);
    if (!Array.isArray(result?.marketplaces)) throw new Error('native-marketplace-state-unreadable');
    return result.marketplaces.find(item => item.name === marketplaceName) || null;
  };
  const readPlugins = async () => {
    const result = await call(['plugin', 'list', '--marketplace', marketplaceName, '--json']);
    if (!Array.isArray(result?.installed)) throw new Error('native-plugin-state-unreadable');
    return result.installed;
  };
  const ownInstall = entries => entries.find(item => item.pluginId === id && item.installed === true) || null;
  async function assertExclusive(current, entries) {
    if (entries.some(item => item.pluginId !== id && item.installed === true)) throw new Error('marketplace-has-other-plugins');
    let manifest;
    try { manifest = JSON.parse(await readFile(join(current.root, '.agents', 'plugins', 'marketplace.json'), 'utf8')); }
    catch { throw new Error('marketplace-ownership-unverified'); }
    if (manifest.name !== marketplaceName || !Array.isArray(manifest.plugins)) throw new Error('marketplace-ownership-unverified');
    if (manifest.plugins.some(item => item.name !== pluginName)) throw new Error('marketplace-has-other-plugins');
    const installed = ownInstall(entries);
    if (installed && !equalPath(installed.source?.path, sourceAt(current.root))) throw new Error('existing-plugin-source-conflict');
  }
  const mutate = async args => {
    // A timed-out/failed CLI call may already have committed. Rollback inspects
    // actual state rather than trusting only successful command receipts.
    mutationAttempted = true;
    return call(args);
  };
  async function restorePrevious() {
    let current = await readMarket();
    if (current && !equalPath(current.root, market) && !equalPath(current.root, oldMarket?.root)) throw new Error('rollback-source-conflict');
    if (current) {
      const entries = await readPlugins();
      await assertExclusive(current, entries);
      if (!oldMarket || !equalPath(current.root, oldMarket.root)) {
        if (ownInstall(entries)) await call(['plugin', 'remove', id, '--json']);
        await call(['plugin', 'marketplace', 'remove', marketplaceName, '--json']);
        current = null;
      }
    }
    if (oldMarket) {
      if (!current) await call(['plugin', 'marketplace', 'add', oldMarket.root, '--json']);
      const restored = ownInstall(await readPlugins());
      if (previousInstall) {
        if (restored && !equalPath(restored.source?.path, previousInstall.source.path)) throw new Error('rollback-source-conflict');
        if (restored && !restored.enabled) await call(['plugin', 'remove', id, '--json']);
        if (!restored || !restored.enabled) await call(['plugin', 'add', id, '--json']);
      } else if (restored) await call(['plugin', 'remove', id, '--json']);
    }
    const finalMarket = await readMarket();
    if (!oldMarket) {
      if (finalMarket) throw new Error('rollback-verification-failed');
    } else {
      if (!finalMarket || !equalPath(finalMarket.root, oldMarket.root)) throw new Error('rollback-verification-failed');
      const restored = ownInstall(await readPlugins());
      if (!!restored !== !!previousInstall || previousInstall && (!restored.enabled || !equalPath(restored.source?.path, previousInstall.source.path))) throw new Error('rollback-verification-failed');
    }
  }
  try {
    await Promise.all([access(desired.mcpServers.shuangling_gpt.command), access(join(root, 'src', 'plugin', 'server.mjs'))]);
    if (!prepareOnly) {
      cli = await findCli();
      oldMarket = await readMarket();
      const previous = oldMarket ? await readPlugins() : [];
      previousInstall = ownInstall(previous);
      const matching = oldMarket && equalPath(oldMarket.root, market) && previousInstall?.enabled && equalPath(previousInstall.source?.path, sourceAt(market));
      if (matching) {
        // The original enabled, same-location path remains idempotent, with no
        // native mutation, even if other entries were added to this marketplace.
        report.alreadyInstalledAtThisLocation = true;
      } else if (oldMarket) {
        if (previousInstall && !previousInstall.enabled) throw new Error('existing-plugin-disabled');
        await assertExclusive(oldMarket, previous);
      }
      if (configureLifecycle) {
        pendingRetirement = await readPendingRetirement(root);
        if (oldMarket && !equalPath(oldMarket.root, market)) {
          const verifiedSource = await validateRetirementSource(root, oldMarket.root);
          if (pendingRetirement && !equalPath(pendingRetirement, verifiedSource)) throw new Error('observer-retirement-source-conflict');
          pendingRetirement = verifiedSource;
          // Persist before registration changes. A process exit after native
          // commit, rollback, or failed retirement cannot lose the old owner.
          await persistPendingRetirement(root, pendingRetirement);
        }
      }
    }
    await writeFile(join(market, 'plugins', pluginName, '.mcp.json'), JSON.stringify(desired, null, 2) + '\n');
    report.pathsRegenerated = true;
    if (prepareOnly) { report.ok = true; report.preparedOnly = true; }
    else {
      if (!report.alreadyInstalledAtThisLocation) {
        if (previousInstall) await mutate(['plugin', 'remove', id, '--json']);
        if (oldMarket && !equalPath(oldMarket.root, market)) await mutate(['plugin', 'marketplace', 'remove', marketplaceName, '--json']);
        if (!oldMarket || !equalPath(oldMarket.root, market)) await mutate(['plugin', 'marketplace', 'add', market, '--json']);
        await mutate(['plugin', 'add', id, '--json']);
      }
      const finalMarket = await readMarket();
      const installedFinal = finalMarket ? ownInstall(await readPlugins()) : null;
      report.installed = !!installedFinal;
      report.enabled = !!installedFinal?.enabled;
      report.correctSource = equalPath(finalMarket?.root, market) && equalPath(installedFinal?.source?.path, sourceAt(market));
      report.ok = report.installed && report.enabled && report.correctSource;
      if (!report.ok) throw new Error('native-plugin-verification-failed');
    }
  } catch (error) {
    report.failure = failure(error);
    if (mutationAttempted) {
      report.rollbackAttempted = true;
      try { await restorePrevious(); report.previousStateRestored = true; }
      catch (restoreError) { report.previousStateRestored = false; report.rollbackFailure = failure(restoreError); }
      // Historical report field retained, but true now requires a final read.
      report.previousSourceRestored = report.previousStateRestored;
    }
  }
  // Lifecycle ownership changes run only after native plugin registration has
  // been verified. A failed registration/rollback never retires the old task.
  if (report.ok && !prepareOnly && configureLifecycle) {
    try {
      if (pendingRetirement) await validateRetirementSource(root, pendingRetirement);
      const lifecycle = await configureLifecycle({ projectRoot: root,
        previousMarketplaceRoot: pendingRetirement,
        onRetired: async () => { await persistPendingRetirement(root, null); pendingRetirement = null; } });
      Object.assign(report, lifecycle);
    } catch (error) {
      report.lifecycleIssue = failure(error);
      if (report.lifecycleIssue === 'observer-handover-pet-running') report.lifecycleAction = 'exit-pet-and-all-codex-windows-then-run-installer-again';
    }
  }
  report.finishedAt = new Date().toISOString();
  await mkdir(join(root, 'reports'), { recursive: true });
  await writeFile(join(root, 'reports', 'codex-plugin-install.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

// Explicit installer phase, injectable independently from native registration.
// It preserves all user preferences and session suppression; no manual-start
// operation is used to manufacture a successful automatic-start check.
export async function configureInstalledLifecycle({ projectRoot, previousMarketplaceRoot = null,
  getPreferences, taskController, onRetired } = {}) {
  const root = resolve(projectRoot);
  const get = getPreferences || (await import('../src/lifecycle/index.mjs')).getLifecyclePreferences;
  const task = taskController || (await import('./lifecycle/task.mjs')).runTaskCommand;
  const saved = await get({ projectRoot: root });
  if (previousMarketplaceRoot) {
    const oldMarket = resolve(previousMarketplaceRoot);
    if (basename(oldMarket).toLowerCase() !== 'plugin-marketplace') throw new Error('old-source-root-unverified');
    const previousRoot = dirname(oldMarket);
    if (equalPath(previousRoot, root)) throw new Error('old-source-root-unverified');
    const retired = await task({ projectRoot: previousRoot, action: 'retire' });
    if (retired?.retired !== true || retired.enabled !== false) throw new Error('old-observer-not-retired');
    if (onRetired) await onRetired();
  }
  if (!saved.autoLaunch) {
    const disabled = await task({ projectRoot: root, action: 'disable' });
    if (disabled?.enabled !== false) throw new Error('login-task-unavailable');
    return { autoLaunch: false, loginTaskInstalled: disabled.installed === true, loginTaskEnabled: false };
  }
  await task({ projectRoot: root, action: 'install' });
  // This bypasses the ordinary healthy-heartbeat shortcut. Copied heartbeat
  // files and a still-alive legacy MCP watcher cannot masquerade as handover.
  const owned = await task({ projectRoot: root, action: 'handover' });
  if (owned?.observerOwned !== true || owned.running !== true || owned.enabled !== true || owned.installed !== true) throw new Error('observer-task-not-ready');
  return { autoLaunch: true, loginTaskInstalled: owned.installed === true, loginTaskEnabled: true,
    observerScheduled: true };
}

if (process.argv[1] && equalPath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const report = await installPlugin({ projectRoot, prepareOnly: process.argv.includes('--prepare-only'), configureLifecycle: configureInstalledLifecycle });
  process.exitCode = report.ok && !report.lifecycleIssue ? 0 : 1;
  console.log(JSON.stringify(report));
}
