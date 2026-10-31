import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readingScenarios, pendingControlScenarios, pendingTaskCheckpoint, isReadingNeutral, validPaintOwner, visibleHandoffCommit, summarizeReadingScenario, installReadingProbe, readingProbeBootstrap, mainInstrumentation, selfCheck, performanceReplayProtocol, performanceOnlyReplayProtocol, readingAuditProtocol, cadenceGapThresholdMs, videoQualityDelta, summarizePerformanceReplay, sanitizeAuditText } from '../../tools/verify-reading-handoff.mjs';

const scenario = kind => readingScenarios.find(row => row.kind === kind);
function evidence() {
  return {
    reading: { id: 'reading-1', name: 'reading', generation: 1, status: 'ended', paints: 30, cleanupTrusted: true, endedAt: 100 },
    incoming: { id: 'waiting-2', name: 'waiting', generation: 2, status: 'ended', paints: 30, cleanupTrusted: true, firstTime: 0, startedAt: 101 },
    readingGates: [{ committed: true, from: { name: 'reading', generation: 1, time: 239 / 24 }, to: 'waiting', generation: 2, playbackId: 'waiting-2' }],
    playCalls: [{ name: 'waiting', at: 60 }],
    control: { paused: false, preempted: false, lockHeld: true }, afterInputAt: 50,
    final: { errors: [], issues: [] },
  };
}

test('the isolated matrix covers entry, reading and stow without a combinatorial run', () => {
  assert.deepEqual(selfCheck(), { ok: true, scenarios: 8, nativeStarted: false, filesWritten: 0 });
  assert.equal(new Set(readingScenarios.map(row => row.id)).size, 8);
  assert.ok(readingScenarios.some(row => row.at < 1));
  assert.ok(readingScenarios.some(row => row.at > 8));
  for (const kind of ['task', 'latest', 'pause', 'manual', 'drag', 'throw']) assert.ok(readingScenarios.some(row => row.kind === kind));
});

test('reading neutral accepts the authored endpoints and rejects the unfinished stow', () => {
  for (const time of [0, 1 / 24, 239 / 24, 10]) assert.equal(isReadingNeutral(time), true);
  for (const time of [2 / 24, 238 / 24, 4.5, -1, 10.1, NaN, Infinity]) assert.equal(isReadingNeutral(time), false);
  const value = evidence(); value.readingGates[0].from.time = 10;
  const summary = summarizeReadingScenario(scenario('task'), value);
  assert.deepEqual(summary.readingExitMediaTimes, [10]);
  assert.deepEqual(summary.readingExitFrames, [239]);
});

test('target paint ownership checks generation, front slot and authored native drag entry', () => {
  const active = { isFront: true, generation: 7, videoGeneration: 7, mediaTime: 4.5 };
  assert.equal(validPaintOwner(active), true);
  assert.equal(validPaintOwner({ ...active, generation: 6 }), false);
  assert.equal(validPaintOwner({ ...active, isFront: false }), false);
  const pending = { isFront: false, generation: 8, videoGeneration: 2, pendingGeneration: 8, mediaTime: 0 };
  assert.equal(validPaintOwner(pending), true);
  assert.equal(validPaintOwner({ ...pending, generation: 7 }), false);
  assert.equal(validPaintOwner({ ...pending, mediaTime: 1 / 24 }), false);
  assert.equal(validPaintOwner({ ...pending, pendingName: 'drag-lower', nativeStartTime: 1.25 / 24, mediaTime: 1 / 24 }), true);
  assert.equal(validPaintOwner({ ...pending, pendingName: 'drag-lower', nativeStartTime: 1.25 / 24, mediaTime: 2 / 24 }), false);
  assert.equal(validPaintOwner({ ...pending, pendingName: 'waiting', nativeStartTime: 1.25 / 24, mediaTime: 1 / 24 }), false);
});

test('a cancelled or missing gate cannot pass as a real neutral transition', () => {
  const selected = readingScenarios.find(row => row.id === 'reading-waiting');
  assert.equal(summarizeReadingScenario(selected, evidence()).ok, true);
  for (const gates of [[], [{ committed: false, from: { time: 239 / 24 } }], [{ committed: true, from: { time: 238 / 24 } }]]) {
    const result = summarizeReadingScenario(selected, { ...evidence(), readingGates: gates });
    assert.equal(result.ok, false);
    assert.equal(result.checks.commonNeutralExit, false);
  }
  const value = evidence(); value.incoming.id = value.reading.id;
  assert.equal(summarizeReadingScenario(selected, value).checks.distinctPlaybackIdentity, false);
  const stale = evidence(); stale.readingGates[0].owned = false;
  assert.equal(summarizeReadingScenario(selected, stale).checks.noExpiredCommit, false);
});

test('a stale noop callback returning undefined cannot be reported as a visible commit', () => {
  const transaction = { gen: 8, anim: 'waiting', playbackId: 'waiting-2' };
  const visible = { generation: 7, displayedAnim: 'reading', playbackId: 'reading-1' };
  const noop = () => {};
  assert.equal(noop(), undefined);
  assert.equal(visibleHandoffCommit(transaction, visible), false);
  assert.equal(visibleHandoffCommit(transaction, { ...visible, generation: 8, displayedAnim: 'waiting', playbackId: 'older-waiting' }), false);
  assert.equal(visibleHandoffCommit(transaction, { generation: 8, displayedAnim: 'waiting', playbackId: 'waiting-2' }), true);
  assert.equal(visibleHandoffCommit({ gen: 8, anim: 'waving' }, { generation: 8, displayedAnim: 'waving', playbackId: null }), true);
});

test('early reading return requires native neutral commit and fresh F0 instead of an old superseded receipt', () => {
  const selected = scenario('latest');
  assert.equal(summarizeReadingScenario(selected, evidence()).ok, true);
  const before = evidence(); before.incoming.startedAt = 99;
  assert.equal(summarizeReadingScenario(selected, before).checks.oldReleasedBeforeNewPlaying, false);
  const early = evidence(); early.reading.status = 'cancelled'; early.reading.reason = 'superseded';
  assert.equal(summarizeReadingScenario(selected, early).ok, true);
  early.reading.reason = 'user-interaction';
  assert.equal(summarizeReadingScenario(selected, early).checks.oldReadingReleasedHonestly, false);
  const wrongCommit = evidence(); wrongCommit.readingGates[0].playbackId = 'obsolete';
  assert.equal(summarizeReadingScenario(selected, wrongCommit).checks.confirmedNativeTaskCommit, false);
  const duplicate = evidence(); duplicate.incomingPlaybacks = [duplicate.incoming, { ...duplicate.incoming, id: 'unnecessary-restart' }];
  assert.equal(summarizeReadingScenario(selected, duplicate).checks.singleNativeTaskStart, false);
  const skipped = evidence(); skipped.incoming.firstTime = 1 / 24;
  assert.equal(summarizeReadingScenario(selected, skipped).checks.incomingStartsAtDecodedF0, false);
  assert.equal(summarizeReadingScenario(selected, { ...evidence(), playCalls: [{ name: 'running', at: 60 }, { name: 'waiting', at: 70 }] }).ok, true, 'preparing an obsolete target is safe only if it never commits');
  assert.equal(summarizeReadingScenario(selected, { ...evidence(), localGenerations: [{ name: 'running', paints: 1 }] }).checks.noSupersededRunningCommit, false);
  const slow = evidence(); slow.playCalls[0].at = 1100;
  assert.equal(summarizeReadingScenario(selected, slow).checks.promptTargetPreparation, false);
  slow.incoming.startedAt = 6000;
  assert.equal(summarizeReadingScenario(selected, slow).checks.boundedObservedReturn, false);
  assert.equal(summarizeReadingScenario(selected, { ...evidence(), paintViolations: [{ generation: 6 }] }).checks.noCrossGenerationPaint, false);
});

test('pause and manual takeover never use timeout or artwork changes to grant control', () => {
  const paused = { ...evidence(), playCalls: [], control: { paused: true, lockHeld: false } };
  assert.equal(summarizeReadingScenario(scenario('pause'), paused).ok, true);
  assert.equal(summarizeReadingScenario(scenario('pause'), { ...paused, readingGates: [] }).ok, false);
  assert.equal(summarizeReadingScenario(scenario('pause'), { ...paused, playCalls: [{ at: 60 }] }).checks.noQueuedTaskAfterPause, false);
  const manual = { ...evidence(), playCalls: [], control: { preempted: true, lockHeld: false }, localGenerations: [{ name: 'waving', paints: 8 }],
    readingGates: [{ committed: true, from: { name: 'reading', time: 0 }, to: 'waving' }], final: { interaction: { resumable: false } } };
  assert.equal(summarizeReadingScenario(scenario('manual'), manual).ok, true);
  manual.final.interaction.resumable = true;
  assert.equal(summarizeReadingScenario(scenario('manual'), manual).checks.manualTakeoverPreserved, false);
});

test('a throw must observe actual native flight and settle before resuming', () => {
  const value = { ...evidence(), observedThrow: true,
    readingGates: [{ committed: true, from: { time: 0 }, to: 'drag-lift' }],
    localGenerations: ['drag-lift', 'drag-hover', 'drag-lower'].map(name => ({ name, paints: 8 })),
    final: { interaction: { kind: 'drag', phase: 'settled', resumable: true }, inputs: [{ operation: 'drag.begin' }, { operation: 'drag.release' }] } };
  assert.equal(summarizeReadingScenario(scenario('throw'), value).ok, true);
  assert.equal(summarizeReadingScenario(scenario('throw'), { ...value, observedThrow: false }).checks.flightMatchesScenario, false);
  assert.equal(summarizeReadingScenario(scenario('drag'), value).checks.flightMatchesScenario, false);
  assert.equal(summarizeReadingScenario(scenario('throw'), { ...value, final: { ...value.final, throwActive: true } }).checks.dragActuallySettled, false);
});

test('the optional performance protocol remains a separate fixed three-play observation', () => {
  assert.deepEqual(performanceReplayProtocol, { name: 'stretching-wings', repeats: 3, leaseTtlMs: 30000 });
  assert.equal(readingScenarios.length, 8);
  const animation = { durationMs: 4500, fps: 24 };
  const observation = summarizePerformanceReplay(animation, { id: 'native-play-3', name: 'stretching-wings', generation: 17, status: 'ended',
    paints: 95, startedAt: 1000, endedAt: 5500, maxPaintGapMs: 120,
    qualityStart: { totalVideoFrames: 10, droppedVideoFrames: 1 }, qualityEnd: { totalVideoFrames: 118, droppedVideoFrames: 3 } });
  assert.equal(observation.ended, true); assert.equal(observation.expectedFrames, 108);
  assert.equal(observation.paints, 95); assert.equal(observation.paintCoverage, 95 / 108);
  assert.equal(observation.elapsedMs, 4500); assert.equal(observation.maxPaintGapMs, 120);
  assert.deepEqual(observation.nativeQuality.delta, { available: true, totalVideoFrames: 108, droppedVideoFrames: 2, corruptedVideoFrames: null });
  assert.equal('smooth' in observation, false); assert.equal('noGhosting' in observation, false);
  assert.equal(summarizePerformanceReplay(animation, null).ended, false);
});

test('performance-only schedules six native replays and no synthetic task or pointer cases', () => {
  assert.equal(performanceOnlyReplayProtocol.repeats, 6);
  const only = readingAuditProtocol({ performanceOnly: true });
  assert.deepEqual(only.scenarios, []);
  assert.equal(only.syntheticStateAndPointerInput, false);
  assert.equal(only.performanceReplayPlan.repeats, 6);
  assert.equal(readingAuditProtocol().scenarios.length, 8);
  assert.equal(readingAuditProtocol().performanceReplayPlan.repeats, 3);
  assert.equal(readingAuditProtocol({ performanceReplay: false }).performanceReplayPlan.enabled, false);
  assert.throws(() => readingAuditProtocol({ performanceOnly: true, performanceReplay: false }), /requires-performance-replay/);
});

test('pending-control-only selects two accepted-task priority cases without adding wing playback', () => {
  const only = readingAuditProtocol({ pendingControlOnly: true });
  assert.deepEqual(only.scenarios, pendingControlScenarios);
  assert.deepEqual(only.scenarios.map(row => row.kind), ['pause', 'manual']);
  assert.ok(only.scenarios.every(row => row.prepareTask === true && row.at === 4.5));
  assert.equal(only.performanceReplayPlan.enabled, false);
  assert.equal(only.syntheticStateAndPointerInput, true);
  assert.equal(readingAuditProtocol({ performanceReplay: false }).scenarios.length, 8);
  assert.equal(readingAuditProtocol({ performanceOnly: true }).scenarios.length, 0);
  assert.throws(() => readingAuditProtocol({ pendingControlOnly: true, performanceOnly: true }), /exclusive-audit-modes/);
});

function pendingFixture() {
  const task = { playbackId: 'pending-running', name: 'running', at: 52 };
  const native = { ready: true, current: { playbackId: 'reading-1', name: 'reading' }, records: {}, gates: [], generations: [], errors: [], issues: [] };
  const checkpoint = pendingTaskCheckpoint({ task, receipt: { status: 'accepted' }, native, caseId: 'pending-case', readingPlaybackId: 'reading-1', taskInputAt: 50, observedAt: 55 });
  return { task, native, checkpoint };
}

test('pending task checkpoints require an actual accepted receipt before any visible native start', () => {
  const f = pendingFixture();
  assert.equal(f.checkpoint.ok, true);
  for (const status of ['playing', 'ended', 'cancelled', 'failed', undefined]) {
    assert.equal(pendingTaskCheckpoint({ task: f.task, receipt: { status }, native: f.native, caseId: 'pending-case', readingPlaybackId: 'reading-1', taskInputAt: 50, observedAt: 55 }).checks.hostActuallyAccepted, false);
  }
  for (const native of [
    { ...f.native, records: { 'pending-running': { status: 'playing' } } },
    { ...f.native, current: { name: 'running', playbackId: 'pending-running' } },
    { ...f.native, gates: [{ playbackId: 'pending-running', committed: true }] },
    { ...f.native, generations: [{ caseId: 'pending-case', name: 'running', paints: 1 }] },
  ]) assert.equal(pendingTaskCheckpoint({ task: f.task, receipt: { status: 'accepted' }, native, caseId: 'pending-case', readingPlaybackId: 'reading-1', taskInputAt: 50, observedAt: 55 }).ok, false);
  assert.equal(pendingTaskCheckpoint({ task: f.task, receipt: { status: 'accepted' }, native: f.native, caseId: 'pending-case', readingPlaybackId: 'reading-1', taskInputAt: 60, observedAt: 55 }).ok, false);
});

test('priority after accepted task must cancel its real receipt and prevent a late native commit', () => {
  const f = pendingFixture();
  const base = { ...evidence(), readingGates: [{ committed: true, from: { name: 'reading', time: 0 }, to: 'idle' }],
    playCalls: [f.task], afterInputAt: 56, control: { paused: true, preempted: false, lockHeld: false },
    pendingTask: { ...f.checkpoint, finalReceipt: { status: 'cancelled', reason: 'superseded' } }, final: { errors: [], issues: [], casePlaybacks: [{ id: 'reading-1', name: 'reading', status: 'cancelled' }] } };
  const paused = pendingControlScenarios[0];
  assert.equal(summarizeReadingScenario(paused, base).ok, true);
  assert.equal(summarizeReadingScenario(paused, { ...base, afterInputAt: 54 }).checks.taskAcceptedBeforePriorityInput, false);
  assert.equal(summarizeReadingScenario(paused, { ...base, pendingTask: { ...base.pendingTask, finalReceipt: { status: 'accepted' } } }).checks.pendingTaskCancelledHonestly, false);
  assert.equal(summarizeReadingScenario(paused, { ...base, localGenerations: [{ name: 'running', paints: 1 }] }).checks.obsoleteTaskNeverVisible, false);
  assert.equal(summarizeReadingScenario(paused, { ...base, readingGates: [...base.readingGates, { committed: true, from: { time: 0 }, to: 'running', playbackId: f.task.playbackId }] }).checks.obsoleteTaskNeverVisible, false);
  assert.equal(summarizeReadingScenario(paused, { ...base, final: { ...base.final, casePlaybacks: [{ id: f.task.playbackId, name: 'running', status: 'cancelled' }] } }).checks.obsoleteTaskNeverVisible, false, 'an already visible task cannot pass merely because it was later cancelled');
  const manual = { ...base, control: { paused: false, preempted: true, lockHeld: false },
    readingGates: [{ committed: true, from: { name: 'reading', time: 0 }, to: 'waving' }],
    localGenerations: [{ name: 'waving', paints: 8 }], final: { ...base.final, interaction: { resumable: false } } };
  assert.equal(summarizeReadingScenario(pendingControlScenarios[1], manual).ok, true);
  assert.equal(summarizeReadingScenario(pendingControlScenarios[1], { ...manual, playCalls: [...manual.playCalls, { name: 'running', at: 60 }] }).checks.noAutoResume, false);
});

test('cadence is separate from ended and cannot pass duplicate paints, a long gap, or unknown decoder counters', () => {
  const animation = { durationMs: 4500, fps: 24 };
  const complete = { id: 'wing-1', status: 'ended', paints: 109, frameIndices: Array.from({ length: 108 }, (_, index) => index), maxPaintGapMs: 65,
    startedAt: 0, endedAt: 4505, qualityStart: { totalVideoFrames: 4, droppedVideoFrames: 0, corruptedVideoFrames: 0 },
    qualityEnd: { totalVideoFrames: 108, droppedVideoFrames: 0, corruptedVideoFrames: 0 } };
  assert.equal(cadenceGapThresholdMs, 125);
  assert.equal(summarizePerformanceReplay(animation, complete).cadencePass, true);
  const missing = summarizePerformanceReplay(animation, { ...complete, qualityStart: null, qualityEnd: null });
  assert.equal(missing.cadencePass, null);
  assert.equal(missing.cadenceChecks.noDecoderDrops, null);
  assert.equal(missing.nativeQuality.delta.available, false);
  const skipped = summarizePerformanceReplay(animation, { ...complete, paints: 95, frameIndices: complete.frameIndices.slice(13), maxPaintGapMs: 625 });
  assert.equal(skipped.ended, true);
  assert.equal(skipped.cadencePass, false);
  assert.equal(skipped.cadenceChecks.gapWithinThreshold, false);
  assert.equal(skipped.cadenceChecks.distinctFramesComplete, false);
  assert.equal(summarizePerformanceReplay(animation, { ...complete, paints: 109, frameIndices: [0, 0, 1, 1] }).cadencePass, false);
});

test('decoder counter resets and missing quality data remain unknown rather than zero drops', () => {
  for (const [start, end] of [[null, null], [{ totalVideoFrames: 1 }, { totalVideoFrames: 9 }],
    [{ totalVideoFrames: 10, droppedVideoFrames: 1 }, { totalVideoFrames: 2, droppedVideoFrames: 0 }]]) {
    assert.deepEqual(videoQualityDelta(start, end), { available: false, reason: 'unsupported-or-reset-counters' });
  }
  assert.deepEqual(videoQualityDelta({ totalVideoFrames: 0, droppedVideoFrames: 0, corruptedVideoFrames: 0 },
    { totalVideoFrames: 108, droppedVideoFrames: 0, corruptedVideoFrames: 1 }),
    { available: true, totalVideoFrames: 108, droppedVideoFrames: 0, corruptedVideoFrames: 1 });
});

test('fixture diagnostics keep the actionable error and stack without endpoint credentials', () => {
  const text = sanitizeAuditText('TypeError: broken\n at sprite.js:902\nhttp://127.0.0.1:1234/#private-fragment token=private-token\n' + 'a'.repeat(64));
  assert.match(text, /TypeError: broken\n at sprite\.js:902/);
  assert.doesNotMatch(text, /1234|private-fragment|private-token|a{64}/);
  assert.ok(sanitizeAuditText('x'.repeat(4000)).length <= 2400);
});

test('the exact serialized renderer bootstrap passes callable observers to real request wrapper', () => {
  const video = generation => ({ petPlaybackGeneration: generation, petOutlineAssetName: 'reading', petPaintedMediaTime: 0, addEventListener() {} });
  const sprite = { gen: 8, front: 0, videoA: video(7), videoB: video(2), displayedAnim: 'reading', playback: 'reading-1',
    paintVideoFrame() {}, reportPlayback() {}, handoff: { request(_transaction, callback) { return callback(); } } };
  const sandbox = vm.createContext({ sprites: [sprite], performance, window: { __dshPetDebug: { errors: ['Synthetic failure at sprite.js:902 http://127.0.0.1:1234/#credential'] } } });
  vm.runInContext(readingProbeBootstrap(), sandbox);
  const transaction = sprite.pending = { gen: 8, anim: 'waiting', playbackId: 'waiting-2' };
  assert.doesNotThrow(() => sprite.handoff.request(transaction, () => {}));
  let snapshot = sandbox.window.__readingHandoffAudit.snapshot();
  assert.equal(snapshot.gates[0].committed, false);
  assert.match(snapshot.errors[0].message, /Synthetic failure at sprite\.js:902/);
  assert.doesNotMatch(snapshot.errors[0].message, /credential|1234/);
  sprite.handoff.request(transaction, () => { sprite.front = 1; sprite.videoB.petPlaybackGeneration = 8; sprite.displayedAnim = 'waiting'; sprite.playback = 'waiting-2'; });
  snapshot = sandbox.window.__readingHandoffAudit.snapshot();
  assert.equal(snapshot.gates[1].committed, true);
});

test('the actual main probe waits for bootstrap readiness without dereferencing a missing snapshot', async () => {
  let tick, interval, command, captures = 0, mainNow = 0;
  const writes = [], scripts = [];
  const renderer = vm.createContext({ sprites: [], performance, window: { __dshPetDebug: { errors: [], configOk: true, spriteCount: 1 } } });
  const win = { isDestroyed: () => false, getOpacity: () => 0, isFocusable: () => false,
    webContents: { async executeJavaScript(code) { scripts.push(code); return vm.runInContext(code, renderer); }, async capturePage() { captures++; throw Error('capture-disabled'); } } };
  const main = vm.createContext({
    require(name) { if (name === 'node:path') return { parse: () => ({ root: 'D:\\' }) };
      if (name === 'node:perf_hooks') return { performance: { now: () => mainNow } };
      assert.equal(name, 'node:fs'); return { statfsSync: () => ({ bavail: 10 * 1024 ** 3, bsize: 1 }),
        writeFileSync(_file, value) { writes.push(JSON.parse(value)); }, readFileSync() { if (command) return JSON.stringify(command); throw Error('no-command'); } }; },
    app: { on() {} }, windows: new Map([[1, win]]),
    process: { env: { READING_AUDIT_OUTPUT: 'D:\\qa', READING_AUDIT_PROBE: 'probe', READING_AUDIT_COMMAND: 'command' }, pid: 1, on() {} },
    setInterval(callback, value) { tick = callback; interval = value; return { unref() {} }; },
  });
  vm.runInContext(mainInstrumentation({ captureEnabled: false }), main);
  assert.equal(interval, 150);
  await tick();
  assert.equal(writes.at(-1).ready, false); assert.deepEqual(writes.at(-1).issues, []);
  assert.equal(scripts.length, 1, 'an unready bootstrap must not call the snapshot global');
  const video = () => ({ currentTime: 0, addEventListener() {} });
  renderer.sprites.push({ gen: 0, front: 0, videoA: video(), videoB: video(), paintVideoFrame() {}, reportPlayback() {} });
  await tick();
  assert.equal(writes.at(-1).ready, true); assert.deepEqual(writes.at(-1).errors, []); assert.deepEqual(writes.at(-1).issues, []);
  assert.equal(scripts.length, 2, 'the first ready bootstrap already returns the real snapshot');
  mainNow += 775;
  await tick();
  assert.equal(scripts.length, 3, 'later ticks retrieve one snapshot without reinstalling the probe');
  assert.equal(writes.at(-1).mainEventLoop.maxDelayMs, 625);
  command = { id: 'mark-1', operation: 'mark', caseId: 'wing-replay', capture: true };
  await tick();
  assert.equal(captures, 0);
  assert.equal(writes.at(-1).observer.captureEnabled, false);
  assert.equal(writes.at(-1).observer.periodicPixelCapture, false);
  assert.deepEqual(writes.at(-1).issues, []);
});

test('the actual renderer probe deduplicates native frame indices and records loop delay without pixel reads', () => {
  let now = 0, loop;
  const video = () => ({ duration: 4.5, currentTime: 0, petPlaybackGeneration: 7, petOutlineAssetName: 'stretching-wings',
    addEventListener() {}, getVideoPlaybackQuality: () => ({ totalVideoFrames: 108, droppedVideoFrames: 0, corruptedVideoFrames: 0 }) });
  const sprite = { gen: 7, front: 0, videoA: video(), videoB: video(), playback: 'wing-1', displayedAnim: 'stretching-wings',
    outlineMaskSourceRect() { return [0, 0, 1, 1]; }, paintVideoFrame() {}, reportPlayback() {} };
  const sandbox = vm.createContext({ sprites: [sprite], performance: { timeOrigin: 1000, now: () => now },
    window: { setInterval(callback, interval) { assert.equal(interval, 100); loop = callback; } } });
  vm.runInContext(readingProbeBootstrap(), sandbox);
  sprite.paintVideoFrame(sprite.videoA, 0, 7);
  sprite.reportPlayback('wing-1', 'playing');
  for (const time of [0, 1 / 24, 1 / 24, 2 / 24, 4.5]) { now += 42; sprite.paintVideoFrame(sprite.videoA, time, 7); }
  now = 725; loop();
  const row = sandbox.window.__readingHandoffAudit.snapshot().records['wing-1'];
  assert.equal(row.paints, 6);
  assert.equal(row.distinctNativeFrames, 4);
  assert.deepEqual(Array.from(row.frameIndices), [0, 1, 2, 107]);
  assert.equal(row.rendererEventLoop.samples, 1);
  assert.equal(row.rendererEventLoop.maxDelayMs, 625);
});

test('real renderer wrapper forwards every paint argument and observes cleanup invocation', () => {
  let received, receiver, calls = 0;
  const video = generation => ({ petPlaybackGeneration: generation, petOutlineAssetName: 'reading', currentTime: 0, addEventListener() {} });
  const sprite = { gen: 7, front: 0, videoA: video(7), videoB: video(2), outlineMaskSourceRect() { return [0, 0, 1, 1]; },
    paintVideoFrame(...args) { received = args; receiver = this; sandbox.window.ShuanglingFrostCleanup.apply(); return 'original'; }, reportPlayback() {} };
  const sandbox = vm.createContext({ sprites: [sprite], performance, window: { ShuanglingFrostCleanup: { apply() { calls++; } } } });
  vm.runInContext('(' + installReadingProbe.toString() + ')(' + visibleHandoffCommit.toString() + ',' + sanitizeAuditText.toString() + ')', sandbox);
  const extra = {};
  assert.equal(sprite.paintVideoFrame(sprite.videoA, 0, 7, extra), 'original');
  assert.equal(receiver, sprite); assert.deepEqual(received, [sprite.videoA, 0, 7, extra]); assert.equal(calls, 1);
  assert.equal(sandbox.window.__readingHandoffAudit.snapshot().generations[0].cleanupTrusted, true);
  sprite.pending = { gen: 8, anim: 'waiting' };
  sprite.paintVideoFrame(sprite.videoB, 0, 8);
  assert.equal(sandbox.window.__readingHandoffAudit.snapshot().violations.length, 0);
  sprite.paintVideoFrame(sprite.videoB, .5, 2);
  assert.equal(sandbox.window.__readingHandoffAudit.snapshot().violations.length, 1);
});
