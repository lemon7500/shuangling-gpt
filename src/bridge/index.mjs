import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { listThreads } from './rollouts.mjs';
import { CodexWorkWatcher } from './codex-work.mjs';
import { PetClient } from './pet-client.mjs';
import { PetController } from './controller.mjs';
import { ActiveUsageService, UsageTargetSelection } from './active-usage.mjs';
import { UsageSelectionStore } from './usage-selection.mjs';
import { ActiveSelectionReader } from './active-selection.mjs';
import { ProjectUsageReader } from './project-usage.mjs';
import { CurrentAccountUsage } from './current-account.mjs';
import { openNativeAccountClient } from './native-account-client.mjs';
import { startSettings } from '../settings/server.mjs';
import { createDeskService } from '../desk/service.mjs';
import { createMemoryReminders } from '../desk/reminders.mjs';
import { acknowledgeDeskCommand } from '../desk/feedback.mjs';
import { deliverFocusNotice } from '../desk/focus-notices.mjs';
import { getLifecyclePreferences, getLifecycleSession, setLifecyclePreferences, markManualStop } from '../lifecycle/index.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const invalid = () => Object.assign(new Error('invalid-settings'), { reason: 'invalid-settings' });

export function currentCodexSessionStartedAt(session, now = Date.now()) {
  if (session?.active !== true) return null;
  const values = Array.isArray(session.epochProcesses) && session.epochProcesses.length ? session.epochProcesses
    : Array.isArray(session.windows) ? session.windows.map(value => typeof value === 'string' ? value.split(':').slice(0, 2).join(':') : '') : [];
  const times = values.flatMap(value => {
    const match = typeof value === 'string' && /^[0-9]+:([0-9]{16,20})$/.exec(value);
    if (!match) return [];
    try {
      // Watcher.cs records Process.StartTime.ToUniversalTime().Ticks: the
      // .NET year-1 epoch, rather than the Windows FILETIME year-1601 epoch.
      const time = Number(BigInt(match[1]) / 10000n - 62135596800000n);
      return Number.isSafeInteger(time) && time > 0 && time <= now ? [time] : [];
    } catch { return []; }
  });
  return times.length ? Math.min(...times) : null;
}

export async function startBridge({ projectRoot, dataDir = join(projectRoot, 'windows', 'data'), dshHome = join(dataDir, 'dsh-home'), threadId, defaultThreadId, codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), petId = 'shuangling', animationMap, initialPreempted = false, onShutdown = async () => {}, usageScope = 'thread', accountSource }) {
  await mkdir(dataDir, { recursive: true });
  const configPath = join(dataDir, 'bridge-config.json');
  const runtimePath = join(dataDir, 'bridge-runtime.json');
  let saved = {};
  try { saved = JSON.parse(await readFile(configPath, 'utf8')); } catch { /* first launch */ }
  // The Windows exporter owns the final visible geometry; the transparent
  // video canvas is larger than the standing character.
  let appearanceMetrics = { visibleHeightRatio: (158 * 300 / 208) / 640, minWidth: 160, maxWidth: 1200, defaultWidth: 562, defaultVisibleHeight: 200 };
  try {
    const metadata = JSON.parse(await readFile(join(projectRoot, 'windows', 'runtime-config.json'), 'utf8')).appearance;
    if (metadata && Number.isFinite(metadata.visibleHeightRatio) && metadata.visibleHeightRatio > 0 && metadata.visibleHeightRatio <= 1 && metadata.minWidth === 160 && metadata.maxWidth === 1200) {
      appearanceMetrics = { visibleHeightRatio: metadata.visibleHeightRatio, minWidth: metadata.minWidth, maxWidth: metadata.maxWidth, defaultWidth: metadata.defaultWidth, defaultVisibleHeight: metadata.defaultVisibleHeight };
    }
  } catch { /* development fixture without Windows metadata uses frozen geometry */ }
  // A fresh installation has no private chat binding. Global work following
  // and account usage do not need one; a chat is chosen explicitly in the UI.
  // Keep legacy precedence, while rejecting malformed explicit arguments even
  // when a valid saved binding would otherwise mask them.
  if ([threadId, defaultThreadId].some(value => value != null && !validId(value))) throw new Error('A valid root chat thread ID is required');
  let config = { threadId: validId(saved.threadId) ? saved.threadId : threadId ?? defaultThreadId ?? process.env.CODEX_THREAD_ID ?? null, paused: saved.paused === true };
  if (config.threadId !== null && !validId(config.threadId)) throw new Error('A valid root chat thread ID is required');
  let status = { state: 'unknown', scope: 'codex', threadId: 'codex', turnId: null, rootTurnId: null, activeCount: 0, workingCount: 0, waitingCount: 0, unknownCount: 0, updatedAt: null, reason: 'initializing' };
  let watcher;
  let settings;
  let desk;
  let memoryReminders;
  let deskIssue = null;
  let closed = false;
  let changing = Promise.resolve();
  let changingAppearance = Promise.resolve();
  const projectUsage = new ProjectUsageReader({ codexHome });
  const accountUsage = accountSource ?? new CurrentAccountUsage({ codexHome,
    transportFactory: ({ signal }) => openNativeAccountClient({ signal, codexHome }),
  });
  const usageSelectionStore = new UsageSelectionStore({ dataDir });
  const usageSelection = new UsageTargetSelection({
    navigationReader: new ActiveSelectionReader({ codexHome, projectRoot, metadataReader: projectUsage }),
    boundThreadId: () => config.threadId,
    selectedThreadId: await usageSelectionStore.read(),
    persistSelection: threadId => usageSelectionStore.save(threadId),
  });
  const usageView = new ActiveUsageService({
    selectionReader: usageSelection, projectReader: projectUsage, scope: usageScope,
    accountSnapshot: () => accountUsage.snapshot(),
  });
  const client = new PetClient({ dshHome, petId });
  const availableAnimations = [];
  let acceptedMedia = new Set();
  try {
    const metadata = JSON.parse(await readFile(join(projectRoot, 'reports', 'windows-assets.json'), 'utf8'));
    acceptedMedia = new Set((Array.isArray(metadata.animations) ? metadata.animations : [])
      .filter(row => typeof row?.name === 'string' && /^[a-f0-9]{64}$/.test(row.webmSha256 ?? ''))
      .map(row => row.name));
  } catch { /* A staging file without accepted metadata never becomes available. */ }
  for (const name of ['idle', 'running', 'review', 'waiting', 'waving', 'jumping', 'failed', 'running-left', 'running-right', 'reading', 'looking-around', 'stretching-wings']) {
    try { if (acceptedMedia.has(name) && (await stat(join(projectRoot, 'windows', 'assets', 'shuangling', `${name}.webm`))).size > 1024) availableAnimations.push(name); } catch { /* Unaccepted or missing media is never offered to the director. */ }
  }
  // Install existing user priority before any watcher or lease can start.
  const controller = new PetController({ client, animationMap, availableAnimations,
    initialPaused: config.paused, initialPreempted });
  async function persist() {
    const temp = `${configPath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
    await rename(temp, configPath);
  }
  try {
  controller.setAmbientPreferences(await getLifecyclePreferences({ projectRoot, dataDir }));
  try { desk = await createDeskService({ dataDir, onNotice: notice => deliverFocusNotice(notice, { desk, controller,
    getLanguage: async () => (await getLifecyclePreferences({ projectRoot, dataDir })).language }) }); }
  catch { deskIssue = 'desk-storage-unavailable'; }
  if (desk) memoryReminders = createMemoryReminders({ desk, controller,
    getLanguage: async () => (await getLifecyclePreferences({ projectRoot, dataDir })).language });
  await accountUsage.start();
  const session = await getLifecycleSession({ projectRoot, dataDir });
  watcher = new CodexWorkWatcher({ codexHome, metadataReader: projectUsage,
    sessionStartedAt: currentCodexSessionStartedAt(session),
    onChange: next => { status = next; controller.update(next); },
    onCompletedTurn: event => { if (!closed) return desk?.recordTask(event); },
  });
  await watcher.start();
  await persist();
  settings = await startSettings({
    getState: () => ({ status: { ...status }, control: controller.snapshot(), availableAnimations: [...availableAnimations], defaultUsageThreadId: config.threadId, usageThreadId: usageSelection.selectedThreadId || config.threadId }),
    getDesk: () => desk ? desk.snapshot() : { ok: false, error: deskIssue ?? 'desk-unavailable' },
    deskCommand: async input => {
      if (!desk) throw Object.assign(new Error('desk-unavailable'), { reason: 'desk-unavailable' });
      const result = await desk.command(input);
      if (input.type === 'story.select') await controller.companionNotice(null, 'reading');
      void acknowledgeDeskCommand(input, { controller,
        getLanguage: async () => (await getLifecyclePreferences({ projectRoot, dataDir })).language });
      return result;
    },
    getUsage: () => usageView.snapshot(),
    getAccountUsage: () => usageView.readAccount(),
    setUsageTarget: input => usageSelection.choose(input.threadId),
    getThreads: () => listThreads(codexHome),
    update: input => {
      const operation = async () => {
        if (closed || !input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(k => !['threadId', 'paused'].includes(k)) || !Object.keys(input).length || input.threadId !== undefined && !validId(input.threadId) || input.paused !== undefined && typeof input.paused !== 'boolean') throw invalid();
        if (input.threadId !== undefined && input.threadId !== config.threadId) {
          // Legacy callers may still set a default usage chat. Task following
          // remains global and this never replaces the work watcher.
          const threads = await listThreads(codexHome, { limit: 500 });
          if (!threads.some(t => t.id === input.threadId)) throw invalid();
          config.threadId = input.threadId;
        }
        if (input.paused !== undefined) { config.paused = input.paused; controller.setPaused(config.paused); }
        await persist();
        return { ok: true };
      };
      const pending = changing.then(operation, operation);
      changing = pending.catch(() => {});
      return pending;
    },
    getAppearance: async () => ({ ...await client.appearance(), metrics: { ...appearanceMetrics } }),
    getPreferences: () => getLifecyclePreferences({ projectRoot, dataDir }),
    setPreferences: async input => {
      const preferences = await setLifecyclePreferences({ projectRoot, dataDir }, input);
      controller.setAmbientPreferences(preferences);
      return preferences;
    },
    setAppearance: input => {
      const operation = () => input?.live === true
        ? client.updateAppearanceLive(input)
        : client.updateAppearance(input, { apply: change => controller.withSurfaceReload(change) });
      const pending = changingAppearance.then(operation, operation);
      changingAppearance = pending.catch(() => {});
      return pending;
    },
    shutdown: async () => { await markManualStop({ projectRoot, dataDir }); await close(); await onShutdown(); },
  });
  // The Windows manager owns the private settings capability. This diagnostic
  // file deliberately omits it because mode 0600 alone is not an NTFS ACL.
  await writeFile(runtimePath, JSON.stringify({ pid: process.pid, port: settings.port }, null, 2), { mode: 0o600 });
  } catch (error) { await close(); throw error; }

  async function close() {
    if (closed) return;
    closed = true;
    // A private tool-file write failure must never prevent the pet, watcher,
    // account transport or local settings server from shutting down.
    for (const finish of [() => memoryReminders?.close(), () => watcher?.close(), () => desk?.close(), () => accountUsage.close(),
      () => controller.close(), () => settings?.close()]) {
      try { await finish(); } catch { /* Continue the remaining independent cleanup. */ }
    }
    try {
      const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
      if (runtime.pid === process.pid) await unlink(runtimePath);
    } catch { /* already removed */ }
  }
  return { close, settingsUrl: settings.settingsUrl, usageUrl: settings.settingsUrl.replace('/#', '/?view=usage#'), port: settings.port };
}
