/**
 * Isolated reading handoff audit. Uses production PetController/PetClient and
 * the actual native decoder/pose gate with explicit synthetic state/input.
 * Never opens a real chat, real data directory, or a generation service.
 * No media/runtime copies: media are hardlinked and runtimes are junctions.
 */
import assert from 'node:assert/strict';
import { copyFile, cp, link, mkdir, readFile, statfs, symlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { validateAssets, assertAuditDiskHeadroom } from './verify-companion-native.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const readingSha256 = '88b5cfffa8393a9327ff705fe45bf8d73cefaa2192e6a72275f21b761292ed40';
const delay = ms => new Promise(done => setTimeout(done, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
const alive = pid => { if (!Number.isSafeInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

/** Bounded diagnostics from this no-account fixture; never retain endpoint credentials. */
export function sanitizeAuditText(value) {
  return String(value ?? '').replace(/(?:https?|dsh-pet-bridge):\/\/[^\s"'<>]+/gi, '[local-endpoint]')
    .replace(/\b(?:token|authorization|cookie|password|secret|api[_-]?key)\b[\s"']*[:=][\s"']*[^\s,;\]}]+/gi, '[credential-redacted]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[opaque-id]').slice(0, 2400);
}
async function diskHeadroom(path) { const value = await statfs(parse(path).root); return assertAuditDiskHeadroom(value.bavail * value.bsize); }
async function until(operation, timeout, reason) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await operation(); if (value) return value; await delay(70); }
  throw Error(reason + '-timeout');
}
async function request(base, route, token, body) {
  const response = await fetch(new URL(route, base), { method: body === undefined ? 'GET' : 'POST', headers: { 'x-shuangling-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(4000) });
  assert.ok(response.ok, 'isolated-api-' + response.status); return response.json();
}

export const readingScenarios = Object.freeze([
  Object.freeze({ id: 'entry-working', at: .3, kind: 'task', state: 'working', expected: 'running' }),
  Object.freeze({ id: 'reading-waiting', at: 4.5, kind: 'task', state: 'waiting', expected: 'waiting' }),
  Object.freeze({ id: 'stowing-working', at: 8.4, kind: 'task', state: 'working', expected: 'running' }),
  Object.freeze({ id: 'reading-latest-waiting', at: 4.5, kind: 'latest', state: 'waiting', expected: 'waiting' }),
  Object.freeze({ id: 'reading-pause', at: 4.5, kind: 'pause' }),
  Object.freeze({ id: 'reading-manual-wave', at: 4.5, kind: 'manual' }),
  Object.freeze({ id: 'entry-gentle-drop', at: .3, kind: 'drag' }),
  Object.freeze({ id: 'reading-throw-land', at: 4.5, kind: 'throw' }),
]);
export const pendingControlScenarios = Object.freeze([
  Object.freeze({ id: 'pending-task-pause', at: 4.5, kind: 'pause', prepareTask: true }),
  Object.freeze({ id: 'pending-task-manual-wave', at: 4.5, kind: 'manual', prepareTask: true }),
]);
export const performanceReplayProtocol = Object.freeze({ name: 'stretching-wings', repeats: 3, leaseTtlMs: 30000 });
export const performanceOnlyReplayProtocol = Object.freeze({ ...performanceReplayProtocol, repeats: 6 });
export const cadenceGapThresholdMs = 125;

/** A small comparison run does not quietly execute the handoff matrix. */
export function readingAuditProtocol({ performanceReplay = true, performanceOnly = false, pendingControlOnly = false } = {}) {
  assert.equal(typeof performanceReplay, 'boolean', 'performance-replay-must-be-boolean');
  assert.equal(typeof performanceOnly, 'boolean', 'performance-only-must-be-boolean');
  assert.equal(typeof pendingControlOnly, 'boolean', 'pending-control-only-must-be-boolean');
  assert.ok(!performanceOnly || performanceReplay, 'performance-only-requires-performance-replay');
  assert.ok(!performanceOnly || !pendingControlOnly, 'exclusive-audit-modes');
  return { scenarios: pendingControlOnly ? pendingControlScenarios : performanceOnly ? [] : readingScenarios, performanceOnly, pendingControlOnly,
    performanceReplayPlan: { enabled: performanceReplay && !pendingControlOnly, ...(performanceOnly ? performanceOnlyReplayProtocol : performanceReplayProtocol) },
    estimatedMinutes: performanceOnly || pendingControlOnly ? [1, 2] : [3, 5], syntheticStateAndPointerInput: !performanceOnly };
}

/** Host acceptance is sampled before priority input, independently of native playing. */
export function pendingTaskCheckpoint({ task, receipt, native, caseId, readingPlaybackId, taskInputAt, observedAt }) {
  const taskId = typeof task?.playbackId === 'string' && task.playbackId ? task.playbackId : null;
  const checks = {
    knownTaskRequest: !!taskId && task.name === 'running' && Number.isFinite(task.at) && Number.isFinite(taskInputAt) && task.at >= taskInputAt,
    hostActuallyAccepted: receipt?.status === 'accepted',
    sampledAfterRequest: Number.isFinite(observedAt) && Number.isFinite(task?.at) && observedAt >= task.at,
    readingStillVisible: !!readingPlaybackId && native?.current?.playbackId === readingPlaybackId && native.current.name === 'reading',
    taskNotNativeStarted: !!taskId && !native?.records?.[taskId] && native?.current?.playbackId !== taskId &&
      !native?.gates?.some(row => row.playbackId === taskId && row.committed) &&
      !native?.generations?.some(row => row.caseId === caseId && row.name === 'running' && row.paints > 0),
    nativeSnapshotReady: native?.ready === true && Array.isArray(native.errors) && native.errors.length === 0 && Array.isArray(native.issues) && native.issues.length === 0,
  };
  return { ok: Object.values(checks).every(Boolean), checks, playbackId: taskId, requestedAt: task?.at ?? null, taskInputAt, observedAt,
    hostStatus: receipt?.status || null, nativeCurrent: native?.current ? { ...native.current } : null };
}

/** Browser decoder counters are cumulative within one media load, not pixel evidence. */
export function videoQualityDelta(start, end) {
  const keys = ['totalVideoFrames', 'droppedVideoFrames'];
  if (!keys.every(key => Number.isSafeInteger(start?.[key]) && start[key] >= 0 && Number.isSafeInteger(end?.[key]) && end[key] >= start[key]))
    return { available: false, reason: 'unsupported-or-reset-counters' };
  return { available: true, ...Object.fromEntries(keys.map(key => [key, end[key] - start[key]])),
    corruptedVideoFrames: Number.isSafeInteger(start?.corruptedVideoFrames) && start.corruptedVideoFrames >= 0 &&
      Number.isSafeInteger(end?.corruptedVideoFrames) && end.corruptedVideoFrames >= start.corruptedVideoFrames ? end.corruptedVideoFrames - start.corruptedVideoFrames : null };
}

export function summarizePerformanceReplay(animation, record) {
  const expectedFrames = Math.round(animation.durationMs / 1000 * animation.fps);
  const nativeQualityDelta = videoQualityDelta(record?.qualityStart, record?.qualityEnd);
  const distinctNativeFrames = Number.isSafeInteger(record?.distinctNativeFrames) ? record.distinctNativeFrames :
    Array.isArray(record?.frameIndices) ? new Set(record.frameIndices).size : null;
  const gapWithinThreshold = Number.isFinite(record?.maxPaintGapMs) ? record.maxPaintGapMs <= cadenceGapThresholdMs : null;
  const distinctFramesComplete = distinctNativeFrames === null ? null : distinctNativeFrames === expectedFrames;
  const noDecoderDrops = nativeQualityDelta.available ? nativeQualityDelta.droppedVideoFrames === 0 : null;
  const noDecoderCorruption = nativeQualityDelta.available && nativeQualityDelta.corruptedVideoFrames !== null ? nativeQualityDelta.corruptedVideoFrames === 0 : null;
  const decoderFramesComplete = nativeQualityDelta.available ? record.qualityEnd.totalVideoFrames >= expectedFrames : null;
  const cadenceChecks = { gapWithinThreshold, distinctFramesComplete, noDecoderDrops, noDecoderCorruption, decoderFramesComplete };
  const cadenceValues = Object.values(cadenceChecks);
  const cadencePass = record?.status !== 'ended' || cadenceValues.includes(false) ? false : cadenceValues.includes(null) ? null : true;
  return { playbackId: record?.id || null, name: record?.name || null, generation: record?.generation ?? null,
    ended: record?.status === 'ended', paints: record?.paints || 0, expectedFrames,
    distinctNativeFrames, cadencePass, cadenceGapThresholdMs, cadenceChecks,
    paintCoverage: expectedFrames > 0 && Number.isFinite(record?.paints) ? record.paints / expectedFrames : null,
    elapsedMs: Number.isFinite(record?.startedAt) && Number.isFinite(record?.endedAt) ? record.endedAt - record.startedAt : null,
    nominalDurationMs: animation.durationMs, maxPaintGapMs: record?.maxPaintGapMs ?? null,
    loopDelay: { renderer: record?.rendererEventLoop || null, main: record?.mainEventLoop || null },
    nativeQuality: { start: record?.qualityStart || null, end: record?.qualityEnd || null, delta: nativeQualityDelta } };
}

/** Exact authored neutral ranges; never accept the frame before stow finishes. */
export function isReadingNeutral(time) {
  if (!Number.isFinite(time) || time < 0 || time > 10) return false;
  const frame = Math.max(0, Math.min(239, Math.round(time * 24)));
  return frame <= 1 || frame === 239;
}

/** A commit paints paused target F0 before its slot becomes the front slot. */
export function validPaintOwner({ isFront, generation, videoGeneration, pendingGeneration, mediaTime, pendingName, nativeStartTime = 0 }) {
  if (!Number.isSafeInteger(generation) || generation < 0) return false;
  if (isFront && generation === videoGeneration) return true;
  if (generation !== pendingGeneration || !Number.isFinite(mediaTime)) return false;
  if (Math.abs(mediaTime) <= .0001 && nativeStartTime === 0) return true;
  // A real held/release interruption can enter an authored internal drag clip
  // at an explicitly verified native frame. Other clips still require F0.
  return ['drag-lift', 'drag-hover', 'drag-lower'].includes(pendingName) && nativeStartTime > 0 &&
    Math.round(mediaTime * 24) === Math.floor(nativeStartTime * 24);
}

/** A callback return value is not evidence that the visible transaction committed. */
export function visibleHandoffCommit(transaction, snapshot) {
  return Number.isSafeInteger(transaction?.gen) && snapshot?.generation === transaction.gen &&
    snapshot.displayedAnim === transaction.anim && (!transaction.playbackId || snapshot.playbackId === transaction.playbackId);
}

/** Pure receipt/identity assertions; metadata proves gates, not artwork anatomy. */
export function summarizeReadingScenario(scenario, evidence) {
  const { reading, incoming, incomingPlaybacks = incoming ? [incoming] : [], readingGates = [], paintViolations = [], control = {}, playCalls = [], afterInputAt, final = {}, observedThrow = false, localGenerations = [], pendingTask = null } = evidence;
  const committedGates = readingGates.filter(row => row.committed);
  const neutralExit = committedGates.length > 0 && committedGates.every(row => isReadingNeutral(row.from.time));
  const checks = {
    outgoingReadingStarted: reading?.name === 'reading' && typeof reading.id === 'string' && reading.paints >= 3,
    readingCleanupActive: reading?.cleanupTrusted === true,
    noCrossGenerationPaint: paintViolations.length === 0,
    noExpiredCommit: !readingGates.some(row => row.committed && row.owned === false),
    noRendererErrors: !(final.errors?.length || final.issues?.length),
  };
  if (scenario.kind === 'task' || scenario.kind === 'latest') {
    // /anim accepts and supersedes the old host receipt before the visible
    // return finishes. Only the actual native commit and successor playing
    // identify a completed handoff; a cancelled receipt alone proves nothing.
    checks.oldReadingReleasedHonestly = (reading?.status === 'ended' || reading?.status === 'cancelled' && reading.reason === 'superseded') && Number.isFinite(reading.endedAt);
    checks.distinctPlaybackIdentity = !!incoming?.id && incoming.id !== reading?.id;
    checks.latestTargetStarted = incoming?.name === scenario.expected && incoming.paints >= 2;
    checks.singleNativeTaskStart = incomingPlaybacks.length === 1;
    checks.oldReleasedBeforeNewPlaying = Number.isFinite(reading?.endedAt) && Number.isFinite(incoming?.startedAt) && incoming.startedAt >= reading.endedAt;
    checks.confirmedNativeTaskCommit = committedGates.some(row => row.to === scenario.expected && row.playbackId === incoming?.id && row.generation === incoming?.generation && row.from.generation === reading?.generation);
    checks.startsAfterTaskInput = Number.isFinite(afterInputAt) && Number.isFinite(incoming?.startedAt) && incoming.startedAt >= afterInputAt;
    const prepared = playCalls.find(row => row.name === scenario.expected && row.at >= afterInputAt);
    checks.promptTargetPreparation = !!prepared && prepared.at - afterInputAt <= 1000;
    checks.boundedObservedReturn = Number.isFinite(incoming?.startedAt) && incoming.startedAt - afterInputAt <= 5000;
    checks.incomingStartsAtDecodedF0 = incoming?.firstTime === 0;
    checks.incomingCleanupActive = incoming?.cleanupTrusted === true;
    checks.commonNeutralExit = neutralExit;
    if (scenario.kind === 'latest') checks.noSupersededRunningCommit = !localGenerations.some(row => row.name === 'running' && row.paints > 0) && !committedGates.some(row => row.to === 'running');
  } else if (scenario.kind === 'pause') {
    checks.pausePreserved = control.paused === true && control.lockHeld === false;
    checks.noQueuedTaskAfterPause = !playCalls.some(row => row.at > afterInputAt + .001);
    checks.commonNeutralExit = neutralExit;
  } else if (scenario.kind === 'manual') {
    checks.manualWaveReallyPlayed = localGenerations.some(row => row.name === 'waving' && row.paints >= 3);
    checks.manualTakeoverPreserved = control.preempted === true && control.lockHeld === false && final.interaction?.resumable === false;
    checks.noAutoResume = !playCalls.some(row => row.at > afterInputAt + .001);
    checks.commonNeutralExit = readingGates.some(row => row.committed && row.to === 'waving') && readingGates.filter(row => row.committed).every(row => isReadingNeutral(row.from.time));
  } else {
    checks.dragLiftAndHeldAndLowerPainted = ['drag-lift', 'drag-hover', 'drag-lower'].every(name => localGenerations.some(row => row.name === name && row.paints >= 2));
    checks.realPointerPath = final.inputs?.some(row => row.operation === 'drag.begin') && final.inputs?.some(row => row.operation === 'drag.release');
    checks.flightMatchesScenario = scenario.kind === 'throw' ? observedThrow : !observedThrow;
    checks.dragActuallySettled = final.interaction?.kind === 'drag' && final.interaction?.phase === 'settled' && final.interaction?.resumable === true && !final.dragActive && !final.dragVisualActive && !final.throwActive;
    checks.resumableControlReturned = control.paused === false && control.preempted === false && control.lockHeld === true;
    checks.commonNeutralExit = readingGates.some(row => row.committed && row.to === 'drag-lift') && readingGates.filter(row => row.committed).every(row => isReadingNeutral(row.from.time));
  }
  if (scenario.prepareTask) {
    checks.taskAcceptedBeforePriorityInput = pendingTask?.ok === true && pendingTask.hostStatus === 'accepted' &&
      Object.values(pendingTask.checks || {}).length >= 6 && Object.values(pendingTask.checks).every(value => value === true) &&
      Number.isFinite(afterInputAt) && Number.isFinite(pendingTask.observedAt) && afterInputAt >= pendingTask.observedAt &&
      pendingTask.nativeCurrent?.playbackId === reading?.id;
    checks.acceptedTaskIdentityRecorded = !!pendingTask?.playbackId && playCalls.some(row => row.playbackId === pendingTask.playbackId && row.name === 'running' && row.at === pendingTask.requestedAt && row.at <= afterInputAt);
    checks.pendingTaskCancelledHonestly = pendingTask?.finalReceipt?.status === 'cancelled';
    checks.obsoleteTaskNeverVisible = !localGenerations.some(row => row.name === 'running' && row.paints > 0) &&
      !readingGates.some(row => row.committed && (row.to === 'running' || row.playbackId === pendingTask?.playbackId)) &&
      !(final.casePlaybacks || []).some(row => row.id === pendingTask?.playbackId || row.name === 'running');
  }
  return { id: scenario.id, kind: scenario.kind, requestedAtReadingSeconds: scenario.at, preparedTask: scenario.prepareTask === true, ok: Object.values(checks).every(Boolean), checks, readingPlaybackId: reading?.id || null, incomingPlaybackId: incoming?.id || null, responseMs: incoming && Number.isFinite(afterInputAt) ? incoming.startedAt - afterInputAt : null, readingExitMediaTimes: committedGates.map(row => row.from.time), readingExitFrames: committedGates.map(row => Math.max(0, Math.min(239, Math.round(row.from.time * 24)))), control: { ...control }, observedThrow };
}

/** Runs only in an owned native page. Wrappers forward every original argument. */
export function installReadingProbe(commitVisible, sanitizeText) {
  const p = typeof sprites !== 'undefined' ? sprites[0] : null;
  if (!p) return { ready: false };
  if (window.__readingHandoffAudit) return window.__readingHandoffAudit.snapshot();
  let caseId = 'startup', commandId = null, pointer = null, cleanupInvocations = 0;
  const records = new Map(), generations = new Map(), gates = [], inputs = [], errors = [], violations = [];
  const front = () => p.front === 0 ? p.videoA : p.videoB;
  const stamp = () => performance.timeOrigin + performance.now();
  // Opt-in fault injection for this owned fixture only. Keep the wrapper
  // installed before a long poll starts so an arm command can affect its
  // next successful response even when that request is already in flight.
  const statePollRecovery = { version: 1, enabled: false, limit: 20, rows: [] };
  let armedStatePoll = null, recoveringStatePoll = null;
  const sharedState = typeof S !== 'undefined' ? S : null;
  const originalStateFetch = typeof sharedState?.fetchState === 'function' ? sharedState.fetchState : null;
  const pollAnimation = (value, expected) => {
    const pets = value?.pets;
    const leaf = p.pet?.id ? pets?.[p.pet.id]?.anim : Object.values(pets || {}).map(entry => entry?.anim).find(entry => entry?.data?.name === expected);
    const data = leaf?.data;
    return { name: typeof data?.name === 'string' ? data.name.slice(0, 80) : null,
      playbackId: typeof data?.playbackId === 'string' ? data.playbackId.slice(0, 160) : null,
      leafCounter: Number.isSafeInteger(leaf?.counter) ? leaf.counter : null,
      responseCounter: Number.isSafeInteger(value?.counter) ? value.counter : null };
  };
  if (originalStateFetch) sharedState.fetchState = function (...args) {
    const requestedAt = stamp();
    return Promise.resolve(originalStateFetch.apply(this, args)).then(value => {
      const receivedAt = stamp();
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      if (armedStatePoll) {
        const row = armedStatePoll; armedStatePoll = null; recoveringStatePoll = row;
        Object.assign(row, { originalRequestedAt: requestedAt, originalResponseAt: receivedAt,
          injectedAt: stamp(), injectedCount: 1, affected: pollAnimation(value, row.expectedAnimation) });
        return null;
      }
      if (recoveringStatePoll) {
        const row = recoveringStatePoll; recoveringStatePoll = null;
        Object.assign(row, { recoveryRequestedAt: requestedAt, recoveredAt: receivedAt,
          recovered: pollAnimation(value, row.expectedAnimation) });
      }
      return value;
    });
  };
  // Only this owned fixture retains a bounded transition timeline. No URLs,
  // credentials, frames or media sources are copied into the diagnostic rows.
  const transitionLimit = 128, transitions = [];
  let transitionSequence = 0, transitionsDropped = 0, activeSwitch = null;
  const transitionFor = (id, generation) => {
    for (let index = transitions.length - 1; index >= 0; index--) {
      const row = transitions[index];
      if ((id ? row.playbackId === id : row.playbackId === null) && row.generation === generation) return row;
    }
    return null;
  };
  const bindTransition = transaction => {
    if (!transaction) return null;
    const id = transaction.playbackId || null;
    let row = activeSwitch || transitionFor(id, transaction.gen);
    if (!row) for (let index = transitions.length - 1; index >= 0; index--) {
      const value = transitions[index];
      if (value.playbackId === id && value.name === transaction.anim && value.generation === null) { row = value; break; }
    }
    if (row) row.generation = transaction.gen;
    return row || null;
  };
  const originalSwitch = p.switchTo;
  p.switchTo = function (...args) {
    const [name, , playbackId, url] = args, spare = this.front === 0 ? this.videoB : this.videoA;
    const source = url || this.assetBase + encodeURIComponent(name) + '.webm';
    const sameSource = !!spare && spare.petAnimationSource === source;
    const ready = !!spare && spare.readyState >= 2 && !spare.error;
    const preloaded = sameSource && ready && spare.petPreloadedSource === source &&
      !spare.seeking && Math.abs(spare.currentTime) <= .0001;
    const row = { sequence: ++transitionSequence, caseId, name: /^[a-z][a-z0-9-]{0,79}$/.test(name ?? '') ? name : '[external-animation]',
      playbackId: typeof playbackId === 'string' ? playbackId.slice(0, 160) : null, generation: null,
      switchAt: stamp(), slot: { cache: url ? 'external' : preloaded ? 'preloaded' : sameSource && ready ? 'warm' : 'cold',
        sameSource, readyState: spare?.readyState ?? null, seeking: spare?.seeking ?? null,
        currentTime: Number.isFinite(spare?.currentTime) ? spare.currentTime : null, error: !!spare?.error },
      handoffRequestedAt: null, commitAt: null, handoffCommitConfirmedAt: null, firstPaintAt: null, nativePlayingAt: null };
    transitions.push(row);
    if (transitions.length > transitionLimit) { transitions.shift(); transitionsDropped++; }
    const previous = activeSwitch; activeSwitch = row;
    try { return originalSwitch.apply(this, args); }
    finally {
      if (this.pending?.playbackId === row.playbackId && this.pending?.anim === name) bindTransition(this.pending);
      activeSwitch = previous;
    }
  };
  const rendererLoop = { available: typeof window.setInterval === 'function', intervalMs: 100, samples: 0, maxDelayMs: null };
  let rendererLoopAt = performance.now();
  if (rendererLoop.available) window.setInterval(() => {
    const now = performance.now(), lag = Math.max(0, now - rendererLoopAt - rendererLoop.intervalMs); rendererLoopAt = now;
    rendererLoop.samples++; rendererLoop.maxDelayMs = Math.max(rendererLoop.maxDelayMs ?? 0, lag);
    const row = records.get(p.playback);
    if (row?.status === 'playing') { row.rendererEventLoop.samples++; row.rendererEventLoop.maxDelayMs = Math.max(row.rendererEventLoop.maxDelayMs ?? 0, lag); }
  }, rendererLoop.intervalMs);
  const serializable = row => { const { frameIndices, ...fields } = row; return { ...fields, frameIndices: [...frameIndices], distinctNativeFrames: frameIndices.size }; };
  const quality = video => { try {
    if (typeof video?.getVideoPlaybackQuality !== 'function') return null;
    const value = video.getVideoPlaybackQuality();
    return { totalVideoFrames: value.totalVideoFrames, droppedVideoFrames: value.droppedVideoFrames, corruptedVideoFrames: value.corruptedVideoFrames };
  } catch { return null; } };
  const view = video => ({ name: video?.petOutlineAssetName, generation: video?.petPlaybackGeneration, time: video?.petPaintedMediaTime ?? null });
  const cleanup = window.ShuanglingFrostCleanup;
  if (cleanup) window.ShuanglingFrostCleanup = { ...cleanup, apply(...args) { cleanupInvocations++; return cleanup.apply.apply(this, args); } };
  const originalPaint = p.paintVideoFrame;
  p.paintVideoFrame = function (...args) {
    const [video, time, explicitGeneration] = args;
    const mediaTime = Number.isFinite(time) ? time : video.currentTime;
    const generation = explicitGeneration ?? video.petPlaybackGeneration ?? this.gen;
    const isFront = video === front(), pendingGeneration = this.pending?.gen;
    const startTime = this.pending?.nativeStartTime || 0;
    const pendingStart = startTime === 0 ? Math.abs(mediaTime) <= .0001 :
      ['drag-lift', 'drag-hover', 'drag-lower'].includes(this.pending?.anim) && Math.round(mediaTime * 24) === Math.floor(startTime * 24);
    const valid = Number.isSafeInteger(generation) && generation >= 0 && (isFront && generation === video.petPlaybackGeneration || generation === pendingGeneration && pendingStart);
    if (!valid) violations.push({ caseId, at: stamp(), name: video.petOutlineAssetName, generation, videoGeneration: video.petPlaybackGeneration ?? null, pendingGeneration: pendingGeneration ?? null, isFront, time: mediaTime });
    const cleanupBefore = cleanupInvocations;
    const result = originalPaint.apply(this, args);
    const stage = activeSwitch || bindTransition(this.pending) || transitionFor(this.playback || null, generation);
    if (stage && (stage.generation === null || stage.generation === generation)) {
      stage.generation = generation; stage.firstPaintAt ??= stamp();
    }
    const name = video.petOutlineAssetName;
    let row = generations.get(generation);
    if (!row) { row = { caseId, generation, name, paints: 0, firstTime: mediaTime, lastTime: mediaTime, firstAt: stamp(), lastAt: stamp(), maxPaintGapMs: 0, frameIndices: new Set(), cleanupTrusted: true, qualityStart: quality(video) }; generations.set(generation, row); }
    const frameCount = Math.round(video.duration * 24);
    if (frameCount > 0 && Number.isFinite(mediaTime)) row.frameIndices.add(Math.max(0, Math.min(frameCount - 1, Math.round(mediaTime * 24))));
    row.paints++; row.lastTime = mediaTime; row.maxPaintGapMs = Math.max(row.maxPaintGapMs, stamp() - row.lastAt); row.lastAt = stamp();
    row.qualityEnd = quality(video);
    row.cleanupTrusted &&= !!p.outlineMaskSourceRect(video, 0) && cleanupInvocations > cleanupBefore;
    const receipt = records.get(p.playback);
    if (receipt && receipt.generation === generation) { receipt.paints++; receipt.firstTime ??= row.firstTime; receipt.frameIndices = row.frameIndices; receipt.cleanupTrusted &&= row.cleanupTrusted; receipt.maxPaintGapMs = row.maxPaintGapMs; receipt.qualityEnd = row.qualityEnd; }
    return result;
  };
  const originalReceipt = p.reportPlayback;
  p.reportPlayback = function (...args) {
    const [id, status, reason] = args;
    if (status === 'playing') {
      const video = front(), generation = video.petPlaybackGeneration, painted = generations.get(generation);
      const stage = activeSwitch || transitionFor(id, generation);
      if (stage) { stage.generation = generation; stage.nativePlayingAt ??= stamp(); }
      records.set(id, { caseId, id, name: p.displayedAnim, generation, status, startedAt: stamp(), endedAt: null, firstTime: painted?.firstTime ?? null, paints: painted?.paints || 0, frameIndices: painted?.frameIndices || new Set(), cleanupTrusted: painted?.cleanupTrusted === true, maxPaintGapMs: painted?.maxPaintGapMs ?? 0, qualityStart: painted?.qualityStart || quality(video), qualityEnd: quality(video), rendererEventLoop: { available: rendererLoop.available, intervalMs: rendererLoop.intervalMs, samples: 0, maxDelayMs: null } });
    }
    const row = records.get(id);
    if (row) { row.status = status; row.reason = reason || null; if (['ended', 'cancelled', 'failed'].includes(status)) { row.endedAt = stamp(); if (row.generation === front()?.petPlaybackGeneration) row.qualityEnd = quality(front()); } }
    return originalReceipt.apply(this, args);
  };
  const handoff = p.handoff;
  if (handoff) p.handoff = {
    ...handoff,
    onCommit(...args) {
      const [video, generation] = args, stage = activeSwitch || transitionFor(p.playback || null, generation);
      const result = handoff.onCommit.apply(this, args);
      if (stage && video === front() && video.petPlaybackGeneration === generation) {
        stage.generation = generation; stage.commitAt ??= stamp();
      }
      return result;
    },
    request(transaction, callback) {
      const stage = bindTransition(transaction);
      if (stage) stage.handoffRequestedAt ??= stamp();
      return handoff.request(transaction, (...args) => {
        const from = view(front());
        const owned = p.pending === transaction && p.gen === transaction.gen;
        const result = callback(...args);
        const committed = commitVisible(transaction, { generation: front()?.petPlaybackGeneration, displayedAnim: p.displayedAnim, playbackId: p.playback });
        if (stage && committed) stage.handoffCommitConfirmedAt ??= stamp();
        gates.push({ caseId, at: stamp(), from, to: transaction.anim, generation: transaction.gen, playbackId: transaction.playbackId || null, nativeDragReturn: transaction.nativeDragReturn === true, owned, committed });
        return result;
      });
    },
  };
  for (const video of [p.videoA, p.videoB]) video.addEventListener('error', () => errors.push({ caseId, name: 'video-error', code: video.error?.code ?? null }));
  function event(type, dx = 0, dy = 0) {
    return { type, button: 0, pointerId: 1, screenX: (pointer?.x || 800) + dx, screenY: (pointer?.y || 500) + dy, clientX: p.margin.l + p.hitRect.x + p.hitRect.w / 2, clientY: p.margin.t + p.hitRect.y + p.hitRect.h / 2 };
  }
  window.__readingHandoffAudit = {
    async command(command) {
      if (!command || typeof command.id !== 'string' || command.id === commandId) return;
      commandId = command.id;
      if (command.operation === 'mark') { caseId = command.caseId; pointer = null; return; }
      inputs.push({ caseId, at: stamp(), operation: command.operation });
      if (command.operation === 'state-poll.fail-once') {
        if (!originalStateFetch || armedStatePoll || recoveringStatePoll || statePollRecovery.rows.length >= statePollRecovery.limit || command.animation !== 'reading') throw Error('state-poll-fault-not-armable');
        const row = { commandId: command.id, caseId, expectedAnimation: command.animation, armedAt: stamp(),
          originalRequestedAt: null, originalResponseAt: null, injectedAt: null, injectedCount: 0,
          affected: null, recoveryRequestedAt: null, recoveredAt: null, recovered: null };
        statePollRecovery.enabled = true; statePollRecovery.rows.push(row); armedStatePoll = row;
      }
      else if (command.operation === 'manual') { p.beginInteraction('menu', 'blocked', false); p.yieldUserControl(true); p.onMenuAction({ anim: 'waving' }); }
      else if (command.operation === 'drag.begin') {
        pointer = { x: 800, y: 500 }; p.onPointerDown(event('pointerdown')); const moved = event('pointermove', 24, -12); p.onPointerMove(moved); pointer = { x: moved.screenX, y: moved.screenY };
      } else if (command.operation === 'drag.move') {
        const moved = event('pointermove', Number(command.dx) || 0, Number(command.dy) || 0); p.onPointerMove(moved); pointer = { x: moved.screenX, y: moved.screenY };
      } else if (command.operation === 'drag.throw') {
        // Real pointer methods receive a timed synthetic trajectory. The
        // production estimator and physical flight decide whether it throws.
        for (let step = 0; step < 7; step++) {
          await new Promise(done => setTimeout(done, 18));
          const moved = event('pointermove', 18, -7); p.onPointerMove(moved); pointer = { x: moved.screenX, y: moved.screenY };
        }
        inputs.push({ caseId, at: stamp(), operation: 'drag.release' });
        p.onPointerUp(event('pointerup'));
      } else if (command.operation === 'drag.release') p.onPointerUp(event(command.cancelled ? 'pointercancel' : 'pointerup'));
      else throw Error('unsupported-audit-command');
    },
    snapshot() {
      return { ready: true, caseId, commandId, configOk: window.__dshPetDebug?.configOk === true, spriteCount: window.__dshPetDebug?.spriteCount,
        current: { ...view(front()), playbackId: p.playback || null, displayed: p.displayedAnim }, interaction: p.interaction ? { kind: p.interaction.kind, phase: p.interaction.phase, resumable: p.interaction.resumable, revision: p.interaction.revision } : null,
        dragActive: p.dragState?.active === true, dragVisualActive: p.dragVisual?.active() === true, throwActive: p.throwRef != null,
        records: Object.fromEntries([...records].map(([id, row]) => [id, { ...serializable(row), transition: transitionFor(id, row.generation) || null }])),
        transitionTimeline: { version: 1, limit: transitionLimit, dropped: transitionsDropped, rows: transitions },
        statePollRecovery: { ...statePollRecovery, armed: !!armedStatePoll, recovering: !!recoveringStatePoll },
        generations: [...generations.values()].map(serializable), rendererEventLoop: { ...rendererLoop }, gates, inputs, errors: [...errors, ...(window.__dshPetDebug?.errors || []).map(message => ({ name: 'renderer-debug-error', message: sanitizeText(message) }))], violations };
    },
  };
  return window.__readingHandoffAudit.snapshot();
}

/** Exactly the script sent through executeJavaScript, with callable observers. */
export function readingProbeBootstrap() {
  return '(' + installReadingProbe.toString() + ')((' + visibleHandoffCommit.toString() + '),(' + sanitizeAuditText.toString() + '))';
}

export function mainInstrumentation({ captureEnabled = true } = {}) {
  assert.equal(typeof captureEnabled, 'boolean', 'capture-enabled-must-be-boolean');
  return `\n// Owned handoff fixture only; fixed simulated input commands, no live IPC additions.\n(() => {
 const afs=require('node:fs'),apath=require('node:path'),clock=require('node:perf_hooks').performance,safe=(${sanitizeAuditText.toString()});let busy=false,installed=false,lastCommand='',captures=0,lastProbe={ready:false};const issues=[],loopByPlayback=new Map(),pollMs=150;
 const loop={available:true,intervalMs:pollMs,samples:0,maxDelayMs:null};let lastTick=clock.now();
 const publish=(probe,win)=>{lastProbe={...probe,nativePid:process.pid,opacity:win.getOpacity(),focusable:win.isFocusable(),captures,mainEventLoop:{...loop},observer:{pollMs,periodicPixelCapture:false,captureEnabled:${captureEnabled}}};afs.writeFileSync(process.env.READING_AUDIT_PROBE,JSON.stringify({...lastProbe,issues:issues.slice(-16)}));};
 app.on('web-contents-created',(_event,contents)=>{contents.on('console-message',event=>{if(event.level==='error'||event.level===3)issues.push({kind:'console-error',message:safe(event.message),source:safe(event.sourceId),line:event.lineNumber});});contents.on('render-process-gone',(_event,details)=>issues.push('renderer-gone:'+details.reason));});
 process.on('uncaughtExceptionMonitor',error=>issues.push({kind:'main-exception',name:error.name,message:safe(error.message),stack:safe(error.stack)}));
 setInterval(async()=>{const tick=clock.now(),lag=Math.max(0,tick-lastTick-pollMs);lastTick=tick;loop.samples++;loop.maxDelayMs=Math.max(loop.maxDelayMs??0,lag);
  const priorId=lastProbe.current?.playbackId;if(priorId&&lastProbe.records?.[priorId]?.status==='playing'){let value=loopByPlayback.get(priorId);if(!value){value={available:true,intervalMs:pollMs,samples:0,maxDelayMs:null};loopByPlayback.set(priorId,value);}value.samples++;value.maxDelayMs=Math.max(value.maxDelayMs??0,lag);}
  if(busy)return;busy=true;try{
  const disk=afs.statfsSync(apath.parse(process.env.READING_AUDIT_OUTPUT).root);if(disk.bavail*disk.bsize<=3*1024**3+16*1024**2){issues.push('disk-safety-stop');return;}
  const win=[...windows.values()].find(value=>!value.isDestroyed());if(!win)return;
  let probe;if(!installed){probe=await win.webContents.executeJavaScript(${JSON.stringify(readingProbeBootstrap())});if(!probe?.ready){publish(probe,win);return;}installed=true;}
  let command;try{command=JSON.parse(afs.readFileSync(process.env.READING_AUDIT_COMMAND,'utf8'));}catch{}
  if(command?.id&&command.id!==lastCommand){lastCommand=command.id;await win.webContents.executeJavaScript('window.__readingHandoffAudit.command('+JSON.stringify(command)+')');probe=null;if(${captureEnabled}&&command.capture===true&&captures<2){const image=await win.webContents.capturePage();afs.writeFileSync(apath.join(process.env.READING_AUDIT_OUTPUT,'handoff-'+(++captures)+'.png'),image.toPNG());}}
  if(!probe)probe=await win.webContents.executeJavaScript('window.__readingHandoffAudit?.snapshot() || {ready:false}');
  if(!probe?.ready){installed=false;publish(probe,win);return;}
  for(const [id,row]of Object.entries(probe.records||{}))row.mainEventLoop=loopByPlayback.get(id)||{available:true,intervalMs:pollMs,samples:0,maxDelayMs:null};
  publish(probe,win);
 }catch(error){issues.push({kind:'probe',name:error.name,message:safe(error.message),stack:safe(error.stack)});try{afs.writeFileSync(process.env.READING_AUDIT_PROBE,JSON.stringify({...lastProbe,issues:issues.slice(-16)}));}catch{}}finally{busy=false;}},150).unref();
})();\n`;
}

export async function auditReadingHandoffs(target, { runtimeRoot = target, plan = false, performanceReplay = true, performanceOnly = false, pendingControlOnly = false } = {}) {
  const source = resolve(target), runtime = resolve(runtimeRoot);
  const protocol = readingAuditProtocol({ performanceReplay, performanceOnly, pendingControlOnly });
  const replayProtocol = protocol.performanceReplayPlan;
  await diskHeadroom(runtime);
  const assets = validateAssets(await json(join(source, 'reports/windows-assets.json')));
  const reading = assets.animations.find(row => row.name === 'reading');
  assert.equal(reading?.webmSha256, readingSha256, 'reviewed-reading-required');
  assert.equal(reading.durationMs, 10000); assert.equal(reading.fps, 24);
  for (const row of assets.animations) assert.equal(hash(await readFile(join(source, 'windows/assets/shuangling', row.name + '.webm'))), row.webmSha256, 'media-identity-' + row.name);
  const proposal = { sourceMediaRoot: source, runtimeRoot: runtime, ...protocol, observer: { pollMs: 150, periodicPixelCapture: false, captureEnabled: !performanceOnly }, realNativePlayback: true, realMouseInput: false, liveSettingsWrites: 0, newGenerationCredits: 0, mediaCopies: 0, runtimeCopies: 0 };
  if (plan) return { ok: true, planOnly: true, ...proposal };
  assert.equal(process.platform, 'win32', 'windows-required');
  assert.equal(parse(source).root.toLowerCase(), parse(runtime).root.toLowerCase(), 'same-volume-required');
  await diskHeadroom(runtime);
  const output = join(runtime, 'qa/reading-handoff-20261028', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  const isolated = join(output, 'isolated'), skeleton = join(isolated, 'source'), data = join(isolated, 'data'), home = join(isolated, 'fake-codex-home');
  const probeFile = join(isolated, 'probe.json'), commandFile = join(isolated, 'command.json');
  const report = { ...proposal, startedAt: new Date().toISOString(), reportDirectory: output, results: [], checks: {}, ok: false };
  let manager, identity, native, helperPid, client, controller = null, performanceLockId;
  const apiCalls = [];
  async function probe() { await diskHeadroom(runtime); return until(() => json(probeFile), 5000, 'complete-probe-snapshot'); }
  async function command(operation, extra = {}) {
    await diskHeadroom(runtime); const id = randomUUID();
    await writeFile(commandFile, JSON.stringify({ id, operation, ...extra }));
    return until(async () => { const value = await probe(); return value?.commandId === id ? value : null; }, 5000, 'command-' + operation);
  }
  async function stopOwned() {
    if (identity && manager?.pid === identity.pid && alive(identity.pid)) await request(`http://127.0.0.1:${identity.managerPort}`, '/stop', identity.token, {}).catch(() => {});
    if (manager?.pid) await until(() => !alive(manager.pid), 12000, 'manager-exit').catch(() => {});
  }
  try {
    for (const folder of [skeleton, data, join(home, 'sessions')]) await mkdir(folder, { recursive: true });
    await writeFile(join(home, 'config.toml'), '# Owned handoff fixture; no accounts or conversation content.\n');
    await writeFile(join(data, 'plugin-config.json'), JSON.stringify({ autoLaunch: false, language: 'zh-CN', ambientEnabled: false }));
    await writeFile(join(data, 'bridge-config.json'), JSON.stringify({ threadId: null, paused: true }));
    for (const directory of ['src', 'vendor/dsh-pet/runtime/electron-helper']) { await diskHeadroom(runtime); await cp(join(source, directory), join(skeleton, directory), { recursive: true }); }
    const files = ['package.json', 'windows/start.mjs', 'windows/outline-contract.mjs', 'windows/default-config.json', 'windows/runtime-config.json', 'windows/hd-geometry.json', 'windows/animation-timing.json', 'vendor/dsh-pet/lib/standalone.js', 'vendor/dsh-pet/package.json', 'vendor/dsh-pet/assets/config.jsonc', 'vendor/dsh-pet/assets/logo.png', 'reports/windows-assets.json', assets.motionManifest];
    for (const file of new Set(files)) { await mkdir(dirname(join(skeleton, file)), { recursive: true }); await copyFile(join(source, file), join(skeleton, file)); }
    await symlink(join(runtime, 'windows/runtime'), join(skeleton, 'windows/runtime'), 'junction');
    await symlink(join(runtime, 'vendor/dsh-pet/node_modules'), join(skeleton, 'vendor/dsh-pet/node_modules'), 'junction');
    const media = join(skeleton, 'windows/assets/shuangling'), nativeMedia = join(data, 'dsh-home/dsh-pet/main-animation/webm');
    await mkdir(media, { recursive: true }); await mkdir(nativeMedia, { recursive: true });
    for (const row of assets.animations) { await diskHeadroom(runtime); const file = join(source, 'windows/assets/shuangling', row.name + '.webm'); await link(file, join(media, row.name + '.webm')); await link(file, join(nativeMedia, row.name + '.webm')); }
    const launcher = join(skeleton, 'windows/start.mjs'), launcherSource = await readFile(launcher, 'utf8');
    assert.equal(launcherSource.split("DSH_PET_CADENCE_TEST: '0'").length, 2, 'passive-launch-marker-changed');
    await writeFile(launcher, launcherSource.replace("DSH_PET_CADENCE_TEST: '0'", "DSH_PET_CADENCE_TEST: '1'"));
    const main = join(skeleton, 'vendor/dsh-pet/runtime/electron-helper/main.js');
    report.productionSourceHashes = Object.fromEntries(await Promise.all(['src/bridge/controller.mjs', 'vendor/dsh-pet/runtime/electron-helper/sprite.js', 'vendor/dsh-pet/runtime/electron-helper/shuangling-handoff.js', 'vendor/dsh-pet/runtime/electron-helper/shuangling-drag.js'].map(async file => [file, hash(await readFile(join(source, file)))])));
    await writeFile(main, await readFile(main, 'utf8') + mainInstrumentation({ captureEnabled: !performanceOnly }));
    const env = { ...process.env, CODEX_HOME: home, DSH_HOME: join(data, 'dsh-home'), SHUANGLING_DATA_DIR: data, SHUANGLING_NO_OPEN: '1', SHUANGLING_SILENT_ERRORS: '1', SHUANGLING_CODEX_EXE: join(home, 'missing-account-client.exe'), READING_AUDIT_PROBE: probeFile, READING_AUDIT_COMMAND: commandFile, READING_AUDIT_OUTPUT: output };
    for (const key of ['CODEX_THREAD_ID', 'ELECTRON_RUN_AS_NODE', 'SHUANGLING_LIFECYCLE_INTENT', 'DSH_PET_SMOKE', 'DSH_PET_INTERACTION_TEST']) delete env[key];
    manager = spawn(join(skeleton, 'windows/runtime/node/node.exe'), [launcher, 'start'], { cwd: skeleton, env, windowsHide: true, stdio: 'ignore' }); manager.unref();
    let spawnError; manager.once('error', error => { spawnError = error.code || 'spawn-failed'; });
    identity = await until(async () => { if (spawnError) throw Error(spawnError); const value = await json(join(data, 'desktop-runtime.json')); return value?.pid === manager.pid && value?.settingsUrl ? value : null; }, 25000, 'manager-start');
    native = await until(() => json(join(data, 'dsh-home/dsh-pet/standalone-runtime.json')), 20000, 'native-runtime');
    const settings = new URL(identity.settingsUrl); assert.equal(settings.hostname, '127.0.0.1'); assert.equal(settings.protocol, 'http:');
    await request(settings.origin, '/api/settings', settings.hash.slice(1), { paused: true });
    const ready = await until(async () => { const value = await probe(); return value?.ready && value.configOk && value.spriteCount === 1 ? value : null; }, 25000, 'native-renderer');
    helperPid = ready.nativePid;
    assert.equal(ready.opacity, 0, 'passive-window-opacity'); assert.equal(ready.focusable, false, 'passive-window-focusable'); assert.deepEqual(ready.errors, [], 'native-startup-renderer-errors'); assert.deepEqual(ready.issues, [], 'native-startup-main-or-probe-errors');
    report.checks.passiveOwnedNative = true;
    const { PetClient } = await import(pathToFileURL(join(skeleton, 'src/bridge/pet-client.mjs')));
    const { PetController } = await import(pathToFileURL(join(skeleton, 'src/bridge/controller.mjs')));
    client = new PetClient({ dshHome: join(data, 'dsh-home') });
    const originalPlay = client.play.bind(client);
    client.play = async (...args) => { const at = Date.now(), result = await originalPlay(...args); apiCalls.push({ caseId: report.currentCase, at, name: args[0], playbackId: result.playbackId }); return result; };
    const status = (state, suffix = '') => ({ state, scope: 'codex', threadId: 'synthetic-root', turnId: 'fixture-' + report.currentCase + suffix, updatedAt: new Date().toISOString() });
    for (const scenario of protocol.scenarios) {
      report.currentCase = scenario.id;
      await command('mark', { caseId: scenario.id });
      const baseline = await probe(), initialIds = new Set(Object.keys(baseline.records));
      controller = new PetController({ client, animationMap: { idle: 'reading' }, availableAnimations: assets.animations.map(row => row.name), ambientPreferences: { ambientEnabled: false }, initialPaused: true });
      controller.update(status('idle'));
      controller.setPaused(false);
      const started = await until(async () => { const value = await probe(); const row = Object.values(value.records).find(row => !initialIds.has(row.id) && row.name === 'reading' && row.status === 'playing' && row.paints >= 2); return row ? { native: value, row } : null; }, 20000, 'reading-start-' + scenario.id);
      const readingId = started.row.id;
      controller.animations.idle = 'idle';
      if (['drag', 'throw'].includes(scenario.kind)) await client.position(.45, .35, controller.lockId);
      const phase = await until(async () => { const value = await probe(); return value.current.playbackId === readingId && value.current.time >= scenario.at ? value : null; }, 15000, 'reading-phase-' + scenario.id);
      let pendingTask = null;
      if (scenario.prepareTask) {
        const taskInputAt = Date.now();
        controller.update(status('working', '-accepted-before-priority'));
        pendingTask = await until(async () => {
          const task = apiCalls.find(row => row.caseId === scenario.id && row.name === 'running' && row.at >= taskInputAt);
          if (!task) return null;
          // No time-based stand-in: observe the host's actual accepted receipt
          // and fail if the native target has already become visible.
          const receipt = await client.playback(task.playbackId, { waitTimeoutMs: 0 });
          const native = await probe();
          const checkpoint = pendingTaskCheckpoint({ task, receipt, native, caseId: scenario.id, readingPlaybackId: readingId, taskInputAt, observedAt: Date.now() });
          assert.ok(checkpoint.ok, 'task-not-pending-before-priority-' + scenario.id + ':' + JSON.stringify(checkpoint.checks));
          return checkpoint;
        }, 5000, 'task-accepted-before-priority-' + scenario.id);
      }
      const afterInputAt = Date.now(); let observedThrow = false;
      if (scenario.kind === 'task' || scenario.kind === 'latest') {
        controller.update(status(scenario.kind === 'latest' ? 'working' : scenario.state, '-first'));
        if (scenario.kind === 'latest') { await delay(150); controller.update(status('waiting', '-latest')); }
      } else if (scenario.kind === 'pause') controller.setPaused(true);
      else if (scenario.kind === 'manual') await command('manual', { capture: true });
      else {
        await command('drag.begin');
        await until(async () => { const value = await probe(); return value.current.name === 'drag-hover' && value.generations.some(row => row.caseId === scenario.id && row.name === 'drag-hover' && row.paints >= 5) ? value : null; }, 16000, 'held-native-' + scenario.id);
        // Keep the authored held cycle active for more than one complete loop.
        await delay(1800);
        if (scenario.kind === 'throw') { const release = await command('drag.throw'); observedThrow ||= release.throwActive; }
        else { await delay(350); await command('drag.release', { cancelled: false }); }
      }
      let final;
      const deadline = Date.now() + 23000;
      while (Date.now() < deadline) {
        const value = await probe();
        assert.deepEqual(value.errors, [], 'renderer-errors-' + scenario.id); assert.deepEqual(value.issues, [], 'main-errors-' + scenario.id);
        observedThrow ||= value.throwActive;
        const control = controller.snapshot();
        const records = Object.values(value.records).filter(row => row.caseId === scenario.id);
        const local = value.generations.filter(row => row.caseId === scenario.id);
        const taskRecords = records.filter(row => row.id !== readingId && row.name === scenario.expected && row.paints >= 2);
        const incoming = taskRecords.find(row => row.status === 'ended') || taskRecords[0];
        const manualFinished = local.some(row => row.name === 'waving' && row.lastTime >= 117 / 24) && value.interaction?.phase === 'settled' && !value.interaction.resumable;
        const readingReturned = value.gates.some(row => row.caseId === scenario.id && row.from.name === 'reading' && row.committed);
        const dragSettled = value.interaction?.kind === 'drag' && value.interaction.phase === 'settled' && !value.dragActive && !value.dragVisualActive && !value.throwActive;
        const done = scenario.kind === 'task' || scenario.kind === 'latest' ? incoming?.status === 'ended'
          : scenario.kind === 'pause' ? control.paused && !controller.lockId && readingReturned
          : scenario.kind === 'manual' ? control.preempted && manualFinished
          : dragSettled && !control.preempted && !!controller.lockId;
        if (done) { final = value; break; }
        await delay(70);
      }
      assert.ok(final, 'scenario-finish-' + scenario.id);
      await delay(800);
      final = await probe(); observedThrow ||= final.throwActive;
      const control = controller.snapshot(), rows = Object.values(final.records).filter(row => row.caseId === scenario.id);
      if (pendingTask) {
        const receipt = await client.playback(pendingTask.playbackId, { waitTimeoutMs: 0 });
        pendingTask.finalReceipt = { status: receipt.status || null, reason: /^[a-z][a-z0-9-]{0,60}$/.test(receipt.reason || '') ? receipt.reason : null, sampledAt: Date.now() };
      }
      const incomingPlaybacks = rows.filter(row => row.id !== readingId && row.name === scenario.expected);
      const evidence = { reading: rows.find(row => row.id === readingId), incoming: incomingPlaybacks.find(row => row.status === 'ended') || incomingPlaybacks[0], incomingPlaybacks, readingGates: final.gates.filter(row => row.caseId === scenario.id && row.from.name === 'reading'), paintViolations: final.violations.filter(row => row.caseId === scenario.id), control: { paused: control.paused, preempted: control.preempted, issue: control.issue, lockHeld: !!controller.lockId }, playCalls: apiCalls.filter(row => row.caseId === scenario.id), afterInputAt, final: { errors: final.errors, issues: final.issues, interaction: final.interaction, dragActive: final.dragActive, dragVisualActive: final.dragVisualActive, throwActive: final.throwActive, inputs: final.inputs.filter(row => row.caseId === scenario.id), casePlaybacks: rows.map(row => ({ id: row.id, name: row.name, status: row.status })) }, observedThrow, localGenerations: final.generations.filter(row => row.caseId === scenario.id), pendingTask };
      const result = summarizeReadingScenario(scenario, evidence);
      result.observedInjectionAtSeconds = phase.current.time; result.evidence = evidence;
      report.results.push(result);
      await controller.close(); controller = null;
      assert.ok(result.ok, 'scenario-assertions-' + scenario.id);
      await delay(200);
    }
    if (replayProtocol.enabled) {
      assert.equal(controller, null, 'controller-must-be-closed-before-performance-replay');
      const animation = assets.animations.find(row => row.name === replayProtocol.name);
      assert.ok(animation, 'stretching-wings-media-required');
      report.performanceReplay = { protocol: replayProtocol, controllerClosed: true, sameNativeWindow: true, clips: [], ok: false, cadencePass: null,
        interpretation: 'Paint counts, intervals and native decoder counters describe observed playback. They do not prove the absence of visible pauses or ghosting.' };
      const lease = await until(() => client.lock(undefined, replayProtocol.leaseTtlMs).catch(() => null), 6000, 'performance-lease');
      performanceLockId = lease.lockId; assert.ok(performanceLockId, 'performance-lease-id-required');
      try {
        for (let index = 0; index < replayProtocol.repeats; index++) {
          report.currentCase = 'performance-stretching-wings-' + (index + 1);
          await command('mark', { caseId: report.currentCase });
          const renewed = await client.lock(performanceLockId, replayProtocol.leaseTtlMs);
          assert.equal(renewed.lockId, performanceLockId, 'performance-lease-identity');
          const accepted = await client.play(replayProtocol.name, performanceLockId);
          assert.ok(accepted.playbackId, 'performance-playback-id');
          await until(async () => {
            await diskHeadroom(runtime);
            const receipt = await client.playback(accepted.playbackId);
            if (['cancelled', 'failed'].includes(receipt.status)) throw Error('performance-playback-' + receipt.status);
            return receipt.status === 'ended' ? receipt : null;
          }, animation.durationMs + 15000, 'performance-real-ended');
          const ended = await until(async () => {
            const value = await probe();
            return value.records[accepted.playbackId]?.status === 'ended' ? value : null;
          }, 4000, 'performance-ended-probe');
          assert.deepEqual(ended.errors, []); assert.deepEqual(ended.issues, []);
          const observation = summarizePerformanceReplay(animation, ended.records[accepted.playbackId]);
          assert.equal(observation.name, replayProtocol.name); assert.ok(observation.ended && observation.paints >= 2);
          report.performanceReplay.clips.push(observation);
        }
        report.performanceReplay.ok = report.performanceReplay.clips.length === replayProtocol.repeats &&
          new Set(report.performanceReplay.clips.map(row => row.playbackId)).size === replayProtocol.repeats;
        const cadence = report.performanceReplay.clips.map(row => row.cadencePass);
        report.performanceReplay.cadencePass = cadence.includes(false) ? false : cadence.includes(null) ? null : true;
      } finally { await client.release(performanceLockId); performanceLockId = null; }
      report.checks.performanceReplayCompleted = report.performanceReplay.ok;
    }
    const final = await probe();
    report.checks.noRendererErrors = final.errors.length === 0 && final.issues.length === 0;
    report.checks.noCrossGenerationPaint = final.violations.length === 0;
    report.checks.noExpiredCommit = !final.gates.some(row => row.committed && !row.owned);
    report.checks.fixtureBridgeRemainedPaused = (await request(settings.origin, '/api/state', settings.hash.slice(1))).control.paused === true;
    report.checks.productionSourceUnchanged = true;
    for (const [file, expected] of Object.entries(report.productionSourceHashes)) if (hash(await readFile(join(source, file))) !== expected) report.checks.productionSourceUnchanged = false;
    report.checks.mediaUnchanged = true;
    for (const row of assets.animations) if (hash(await readFile(join(source, 'windows/assets/shuangling', row.name + '.webm'))) !== row.webmSha256) report.checks.mediaUnchanged = false;
    report.screenshots = Array.from({ length: final.captures }, (_, index) => 'handoff-' + (index + 1) + '.png');
    report.loopDelay = { renderer: final.rendererEventLoop, main: final.mainEventLoop };
    report.ok = report.results.length === protocol.scenarios.length && report.results.every(row => row.ok) && Object.values(report.checks).every(Boolean);
  } catch (error) {
    report.failure = sanitizeAuditText(error.message);
    report.failureDetails = { name: error.name, code: error.code || null, message: sanitizeAuditText(error.message), stack: sanitizeAuditText(error.stack).split('\n').slice(0, 9), scenario: report.currentCase || 'startup' };
    const failedProbe = await json(probeFile);
    report.nativeFailureDiagnostics = failedProbe ? { ready: failedProbe.ready, current: failedProbe.current, errors: failedProbe.errors, issues: failedProbe.issues } : { probeUnavailable: true };
  }
  finally {
    if (controller) await controller.close().catch(() => {});
    if (client && performanceLockId) await client.release(performanceLockId).catch(() => {});
    await stopOwned();
    for (const pid of [native?.pid, helperPid]) if (pid) await until(() => !alive(pid), 10000, 'native-exit').catch(() => {});
    report.checks.fullExit = !alive(manager?.pid) && !alive(native?.pid) && !alive(helperPid);
    report.ok &&= report.checks.fullExit;
    report.finishedAt = new Date().toISOString(); delete report.currentCase;
    report.limitations = ['Task states and pointer trajectories are explicit isolated test inputs, not real Codex tasks or OS mouse interaction.', 'The initial idle map points to reading only to arrange a repeatable outgoing clip; this is not evidence of autonomous weighted selection.', 'The probe forwards every original paint argument and allows decoded target F0 or verified authored internal-drag entry before the front-slot switch.', 'Neutral-frame metadata, generation identity and real receipts prove code-path constraints; they do not by themselves prove anatomical quality or absence of all visible ghosting.', 'Cached reverse frames are drawn by the real handoff cache and update the native painted timestamp; no additional decoder, seek, interpolation or media edit is introduced by this probe.', 'All files are retained; no existing file is deleted. Junctions point to existing runtimes/dependencies, and media are hardlinks.'];
    try { await diskHeadroom(runtime); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); } catch { report.reportWriteSkipped = 'disk-safety-stop-or-report-unavailable'; }
  }
  return report;
}

export function selfCheck() {
  new Function(mainInstrumentation());
  new Function(readingProbeBootstrap());
  assert.equal(typeof new Function('return (' + installReadingProbe.toString() + ')')(), 'function');
  assert.equal(readingScenarios.length, 8);
  assert.ok(isReadingNeutral(0) && isReadingNeutral(1 / 24) && isReadingNeutral(239 / 24));
  assert.ok(!isReadingNeutral(238 / 24) && !isReadingNeutral(4.5) && !isReadingNeutral(NaN));
  assert.equal(validPaintOwner({ isFront: true, generation: 7, videoGeneration: 7, mediaTime: .5 }), true);
  assert.equal(validPaintOwner({ isFront: false, generation: 8, videoGeneration: 2, pendingGeneration: 8, mediaTime: 0 }), true);
  assert.equal(validPaintOwner({ isFront: false, generation: 7, videoGeneration: 7, pendingGeneration: 8, mediaTime: .5 }), false);
  // A tiny in-memory player exercises wrapper forwarding, per-generation
  // identity and eviction. It has no Electron, decoder, I/O or timer activity.
  let ticks = 0, capturedArgs = null;
  const video = () => ({ currentTime: 0, duration: 1, readyState: 2, seeking: false,
    petAnimationSource: 'fixture/idle.webm', petPreloadedSource: null, petPlaybackGeneration: 0,
    addEventListener() {}, getVideoPlaybackQuality() { return { totalVideoFrames: 1, droppedVideoFrames: 0, corruptedVideoFrames: 0 }; } });
  const sprite = { front: 0, gen: 0, videoA: video(), videoB: video(), assetBase: 'fixture/',
    paintVideoFrame() {}, reportPlayback() { return 'receipt-forwarded'; }, outlineMaskSourceRect() { return null; },
    handoff: { request(transaction, callback) { return callback(transaction); }, onCommit() { return 'commit-forwarded'; } },
    switchTo(...args) {
      capturedArgs = args;
      const [name, once, playbackId] = args, target = this.front === 0 ? this.videoB : this.videoA;
      const transaction = { anim: name, once, playbackId, gen: ++this.gen }; this.pending = transaction;
      return this.handoff.request(transaction, () => {
        target.petOutlineAssetName = name;
        this.paintVideoFrame(target, 0, transaction.gen);
        this.front = this.front === 0 ? 1 : 0; this.pending = null; this.playback = playbackId;
        this.displayedAnim = name; target.petPlaybackGeneration = transaction.gen;
        assert.equal(this.handoff.onCommit(target, transaction.gen), 'commit-forwarded');
        return this.reportPlayback(playbackId, 'playing');
      });
    } };
  const fakeWindow = { setInterval() {}, __dshPetDebug: { configOk: true, spriteCount: 1 } };
  const context = { sprites: [sprite], window: fakeWindow, performance: { timeOrigin: 1000, now: () => ++ticks } };
  runInNewContext(readingProbeBootstrap(), context);
  for (let index = 0; index < 130; index++)
    assert.equal(sprite.switchTo('idle', true, 'fixture-' + index, undefined, false), 'receipt-forwarded');
  assert.deepEqual(capturedArgs, ['idle', true, 'fixture-129', undefined, false]);
  const evidence = fakeWindow.__readingHandoffAudit.snapshot(), last = evidence.records['fixture-129'].transition;
  assert.equal(evidence.transitionTimeline.limit, 128); assert.equal(evidence.transitionTimeline.rows.length, 128);
  assert.equal(evidence.transitionTimeline.dropped, 2); assert.equal(evidence.records['fixture-0'].transition, null);
  assert.equal(last.generation, 130); assert.equal(last.playbackId, 'fixture-129'); assert.equal(last.slot.cache, 'warm');
  assert.ok(last.switchAt < last.handoffRequestedAt && last.handoffRequestedAt < last.firstPaintAt &&
    last.firstPaintAt < last.commitAt && last.commitAt < last.nativePlayingAt && last.nativePlayingAt < last.handoffCommitConfirmedAt);
  return { ok: true, scenarios: readingScenarios.length, nativeStarted: false, filesWritten: 0 };
}

/** Exercise the actual injected wrapper, including an already-pending poll. */
export async function statePollRecoverySelfCheck() {
  let ticks = 0, resolvePoll, rejectPoll, receivedArguments;
  const shared = { fetchState(...args) { receivedArguments = args; return new Promise((resolve, reject) => { resolvePoll = resolve; rejectPoll = reject; }); } };
  const video = () => ({ addEventListener() {} });
  const sprite = { pet: { id: 'fixture' }, videoA: video(), videoB: video(), front: 0 };
  const fakeWindow = { setInterval() {}, __dshPetDebug: {} };
  runInNewContext(readingProbeBootstrap(), { sprites: [sprite], S: shared, window: fakeWindow, performance: { timeOrigin: 1000, now: () => ++ticks } });
  const audit = fakeWindow.__readingHandoffAudit, options = { since: 9, timeoutMs: 1000 };
  const pending = shared.fetchState('fixture-state', options);
  await audit.command({ id: 'fixture-fault', operation: 'state-poll.fail-once', animation: 'reading' });
  const payload = { counter: 10, pets: { fixture: { anim: { counter: 10, data: { name: 'reading', playbackId: 'fixture-reading' } } } } };
  resolvePoll(payload); assert.equal(await pending, null);
  assert.equal(receivedArguments[0], 'fixture-state'); assert.equal(receivedArguments[1], options);
  let evidence = audit.snapshot().statePollRecovery;
  assert.equal(evidence.rows.length, 1); assert.equal(evidence.rows[0].injectedCount, 1);
  assert.ok(evidence.rows[0].originalRequestedAt < evidence.rows[0].armedAt, 'in-flight-poll-can-be-armed');
  assert.equal(evidence.rows[0].affected.playbackId, 'fixture-reading');
  assert.equal(evidence.armed, false); assert.equal(evidence.recovering, true);
  const recovery = shared.fetchState('fixture-state', options); resolvePoll(payload);
  assert.equal(await recovery, payload, 'successful-real-response-preserved-by-identity');
  evidence = audit.snapshot().statePollRecovery;
  assert.equal(evidence.recovering, false); assert.equal(evidence.rows[0].recovered.playbackId, 'fixture-reading');
  assert.ok(evidence.rows[0].injectedAt < evidence.rows[0].recoveryRequestedAt && evidence.rows[0].recoveryRequestedAt < evidence.rows[0].recoveredAt);
  const normal = shared.fetchState('fixture-state', options); resolvePoll(payload); assert.equal(await normal, payload);
  assert.equal(audit.snapshot().statePollRecovery.rows[0].injectedCount, 1, 'fault-never-repeats-without-new-arm');
  const failure = shared.fetchState('fixture-state', options), error = new Error('fixture-fetch-failure'); rejectPoll(error);
  await assert.rejects(failure, value => value === error, 'original-rejection-preserved');
  return { ok: true, statePollRecovery: true, nativeStarted: false, filesWritten: 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--self-check')) { const checked = selfCheck(); await statePollRecoverySelfCheck(); console.log(JSON.stringify(checked)); }
    else if (args.includes('--help')) console.log('node tools/verify-reading-handoff.mjs <source-and-media-root> --runtime-root <bundled-runtime-root> [--plan] [--skip-performance-replay | --performance-only | --pending-control-only]\n--self-check performs pure assertion checks only. Normal runs retain a unique isolated fixture under <runtime-root>/qa/reading-handoff-20261028. The same native window replays stretching-wings three times after the eight handoff cases unless skipped. --performance-only skips all eight cases and replays the wing clip six times without captures or synthetic task/pointer input. --pending-control-only runs only two cases: priority pause/manual-wave after a real accepted task receipt, before native playing; it never replays wings. Cadence observations are separate from completion. No real settings, chats, generation, or release operations.');
    else {
      const target = args[0] && !args[0].startsWith('--') ? args[0] : projectRoot;
      const runtimeIndex = args.indexOf('--runtime-root');
      assert.ok(runtimeIndex === -1 || args[runtimeIndex + 1] && !args[runtimeIndex + 1].startsWith('--'), 'runtime-root-value-required');
      const result = await auditReadingHandoffs(target, { runtimeRoot: runtimeIndex < 0 ? target : args[runtimeIndex + 1], plan: args.includes('--plan'), performanceReplay: !args.includes('--skip-performance-replay'), performanceOnly: args.includes('--performance-only'), pendingControlOnly: args.includes('--pending-control-only') });
      console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) { console.error(String(error.message).split('\n')[0].slice(0, 160)); process.exitCode = 1; }
}
