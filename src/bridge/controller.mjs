import { firstAnimation, naturalAnimation, quietDelay, ambientActions } from './natural-schedule.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const terminal = new Set(['ended', 'failed', 'cancelled']);
const readingTaskTargets = new Set(['idle', 'running', 'review', 'waiting', 'waving', 'jumping', 'failed']);
const readingTaskStates = new Set(['idle', 'working', 'waiting', 'complete', 'interrupted']);
const readingReceiptWaitMs = 150;
const readingReturnStartTimeoutMs = 12000;
const focusWingCooldownMs = ambientActions.find(action => action.name === 'stretching-wings').cooldownMs;
const focusCueAllowed = (controller, name) => name === 'stretching-wings' && !controller.cue &&
  (!controller.activePlayback || controller.activePlayback.name === firstAnimation(controller.animations.idle)) &&
  controller.previousAmbient !== name && (!Number.isFinite(controller.lastAmbientEnded[name]) || controller.now() - controller.lastAmbientEnded[name] >= focusWingCooldownMs);
const preemptions = new Set(['locked', 'lock-lost', 'preempted', 'pet-hidden', 'pet-not-found', 'pet-not-displayed', 'unknown-pet', 'surface-unavailable']);
preemptions.add('interaction-active');
const handoffReasons = new Set(['lock-lost', 'preempted', 'interaction-active']);
const busyPhases = new Set(['pointer', 'dragging', 'throwing', 'blocked']);
function interactionRecord(value) {
  const r = value?.interaction;
  if (!r || !/^[A-Za-z0-9_.:-]{1,160}$/.test(r.id ?? '') || !['pointer', 'dragging', 'throwing', 'settled', 'blocked'].includes(r.phase) || !['drag', 'click', 'menu', 'info'].includes(r.kind) || !Number.isSafeInteger(r.startedAt) || r.startedAt <= 0 || !Number.isSafeInteger(r.updatedAt) || r.updatedAt <= 0 || !Number.isSafeInteger(r.revision) || r.revision < 0 || typeof r.resumable !== 'boolean') return null;
  if (r.endedAt !== null && (!Number.isSafeInteger(r.endedAt) || r.endedAt < r.startedAt)) return null;
  return { id: r.id, phase: r.phase, kind: r.kind, startedAt: r.startedAt, updatedAt: r.updatedAt, endedAt: r.endedAt, revision: r.revision, resumable: r.resumable };
}
const captions = { waiting: '等你回来，我在这里。', complete: '这一轮完成啦！', interrupted: '已停下，陪你等一会儿。', unknown: '状态未知 · 仍在陪伴' };
const initialInteraction = record => record?.kind === 'click' && record.phase === 'settled' && record.revision === 0 && record.endedAt === record.startedAt && !record.resumable;

/** Lease and playback receipts remain the upstream host's authority. */
export class PetController {
  constructor({ client, animationMap = {}, availableAnimations = [], ambientPreferences = {}, initialPaused = false, initialPreempted = false, onChange = () => {}, retryMs = 1800, startTimeoutMs = 5000, maxStartRetries = 3, interactionPollMs = 300, interactionProbeMs = 1500, surfaceReadyTimeoutMs = 12000, now = Date.now, sleepImpl = sleep, random = Math.random }) {
    this.client = client;
    this.animations = { idle: 'idle', working: 'running', waiting: 'waiting', complete: ['waving', 'jumping'], interrupted: 'failed', unknown: 'idle', ...animationMap };
    this.onChange = onChange;
    this.retryMs = retryMs;
    // Acquiring the first lease can freeze a local gesture mid-pose. Allow
    // its real return plus decoder preparation before retrying an accepted play.
    this.startTimeoutMs = startTimeoutMs;
    this.maxStartRetries = maxStartRetries;
    this.interactionPollMs = interactionPollMs;
    this.interactionProbeMs = interactionProbeMs;
    this.surfaceReadyTimeoutMs = surfaceReadyTimeoutMs;
    this.now = now;
    this.sleep = sleepImpl;
    this.random = random;
    this.availableAnimations = [...availableAnimations];
    this.ambient = { enabled: ambientPreferences.ambientEnabled !== false, frequency: ['quiet', 'normal', 'lively'].includes(ambientPreferences.ambientFrequency) ? ambientPreferences.ambientFrequency : 'normal' };
    this.lastAmbientEnded = {};
    this.previousAmbient = null;
    this.cue = null;
    this.status = { state: 'unknown', threadId: null, turnId: null, updatedAt: null };
    this.paused = initialPaused === true;
    this.preempted = initialPreempted === true;
    this.pendingHandoff = null;
    this.issue = this.preempted ? 'preempted' : null;
    this.lastPlayback = null;
    this.activePlayback = null;
    this.interaction = null;
    this.controlStartedAt = 0;
    this.controlInteractionId = null;
    this.generation = 0;
    this.handledGeneration = -1;
    this.lockId = null;
    this.renewAt = 0;
    this.closed = false;
    this.replayed = false;
    this.runPromise = null;
    this.surfaceReloading = false;
    this.surfacePriority = null;
    this.surfaceResumeGuard = null;
    this.terminalEntries = new Set();
    this.schedule = { state: 'unknown', phase: 'stopped', animation: null, nextActionAt: null, lastAction: null, lastActionAt: null };
  }

  snapshot() { return { paused: this.paused, preempted: this.preempted, issue: this.issue, surfaceReloading: this.surfaceReloading, lastPlayback: this.lastPlayback ? { ...this.lastPlayback } : null, interaction: this.interaction ? { ...this.interaction } : null, schedule: { ...this.schedule } }; }
  changed() { this.onChange(this.snapshot()); }
  update(status) {
    const prior = this.status;
    const changed = prior.state !== status.state || prior.turnId !== status.turnId || prior.threadId !== status.threadId;
    this.status = { ...status };
    if (!changed && this.replayed) return;
    this.replayed = true;
    this.generation++;
    this.changed();
    this.kick();
  }
  setPaused(paused) {
    this.paused = Boolean(paused);
    this.pendingHandoff = null;
    if (!this.paused) this.preempted = false;
    if (!this.paused && this.surfacePriority) this.surfacePriority.preempted = false;
    if (!this.paused && !this.surfaceReloading) this.surfaceResumeGuard = null;
    this.generation++;
    this.changed();
    this.kick();
  }
  setAmbientPreferences(preferences) {
    this.ambient = { enabled: preferences.ambientEnabled !== false, frequency: ['quiet', 'normal', 'lively'].includes(preferences.ambientFrequency) ? preferences.ambientFrequency : 'normal' };
    this.changed();
  }
  /** A local notice never acquires control, changes task state, or unhides a pet. */
  async companionNotice(text, animation = null, { idleOnly = false, requireVisible = false, cuePolicy = null } = {}) {
    const generation = this.generation, lockId = this.lockId;
    const blocked = () => this.closed || this.paused || this.preempted || this.surfaceReloading || !lockId || this.lockId !== lockId ||
      this.generation !== generation || idleOnly && this.status.state !== 'idle';
    const visible = value => ['desktop', 'both'].includes(value?.display);
    if (blocked()) return false;
    try {
      if (requireVisible && (!visible(await this.client.appearance()) || blocked())) return false;
      await this.observeRestInteraction();
      if (blocked()) return false;
      if (text) await this.client.broadcast(text, lockId, 4500);
      // A notice cannot regain an old task or lease after an in-flight reply.
      if (blocked()) return false;
      if (requireVisible && (!visible(await this.client.appearance()) || blocked())) return false;
      if (requireVisible) { await this.observeRestInteraction(); if (blocked()) return false; }
      if (animation && this.status.state === 'idle' && this.availableAnimations.includes(animation) &&
          (cuePolicy !== 'focus' || focusCueAllowed(this, animation)))
        this.cue = { name: animation, generation, expiresAt: this.now() + 6000, ...(cuePolicy === 'focus' ? { source: 'focus' } : {}) };
      return true;
    } catch { return false; }
  }
  kick() {
    if (this.closed || this.surfaceReloading) return;
    if (this.runPromise) return;
    this.runPromise = this.run().finally(() => { this.runPromise = null; if (!this.closed && this.generation !== this.handledGeneration) this.kick(); });
  }
  async release() {
    const id = this.lockId;
    this.lockId = null;
    this.renewAt = 0;
    this.activePlayback = null;
    if (id) { try { await this.client.release(id); } catch { /* already preempted or host closed */ } }
  }
  async lease(force = false) {
    if (!force && this.lockId && this.now() < this.renewAt) return;
    const acquiring = !this.lockId;
    const startedAt = this.now();
    let acquiringInteraction = null;
    if (acquiring && typeof this.client.interaction === 'function') {
      let record;
      try { record = interactionRecord(await this.client.interaction()); }
      catch (error) {
        const unsupported = error?.reason === 'api-http-error' && [404, 405].includes(error?.status);
        const notReportedYet = error?.reason === 'interaction-unavailable' && (!this.interaction || this.interaction.phase === 'settled');
        if (!unsupported && !notReportedYet) throw error;
      }
      if (!record && this.interaction && busyPhases.has(this.interaction.phase)) throw Object.assign(new Error('interaction-unavailable'), { reason: 'interaction-unavailable' });
      if (record) { this.noteInteraction(record); acquiringInteraction = record; }
      if (this.surfaceResumeGuard && (!record || record.id !== this.surfaceResumeGuard.id)) {
        throw Object.assign(new Error('preempted'), { reason: 'preempted' });
      }
      if (record && busyPhases.has(record.phase)) throw Object.assign(new Error('interaction-active'), { reason: 'interaction-active' });
    }
    const resumeGuard = acquiring ? this.surfaceResumeGuard : null;
    const result = await this.client.lock(this.lockId ?? undefined, 30000);
    if (!result?.lockId) throw Object.assign(new Error('invalid-lock-receipt'), { reason: 'invalid-lock-receipt' });
    this.lockId = result.lockId;
    if (resumeGuard) {
      const record = interactionRecord(await this.client.interaction());
      if (!initialInteraction(record) || record.id !== resumeGuard.id) throw Object.assign(new Error('preempted'), { reason: 'preempted' });
      this.noteInteraction(record);
      acquiringInteraction = record;
    }
    this.surfaceResumeGuard = null;
    if (acquiring) {
      this.controlStartedAt = startedAt;
      this.controlInteractionId = initialInteraction(acquiringInteraction) ? acquiringInteraction.id : null;
    }
    this.renewAt = this.now() + 10000;
  }
  noteInteraction(record) {
    if (JSON.stringify(record) !== JSON.stringify(this.interaction)) { this.interaction = record; this.changed(); }
  }
  async waitForHandoff(generation, allowManualEnd = false) {
    if (typeof this.client.interaction !== 'function') return false;
    const earliest = allowManualEnd ? 0 : this.controlStartedAt;
    const probeDeadline = this.now() + this.interactionProbeMs;
    let observedId = null;
    let revision = -1;
    while (!this.closed && this.generation === generation && !this.paused) {
      let record;
      try { record = interactionRecord(await this.client.interaction()); } catch { return false; }
      if (!record || record.startedAt < earliest) {
        // Renderer pose reporting and forced lease release are separate local
        // requests. A short read-only probe tolerates their arrival order; the
        // deadline itself never grants a lease or substitutes for a receipt.
        if (this.now() >= probeDeadline) return false;
        await this.sleep(this.interactionPollMs);
        continue;
      }
      if (record.id === observedId && record.revision < revision) { await this.sleep(this.interactionPollMs); continue; }
      observedId = record.id;
      revision = record.revision;
      this.noteInteraction(record);
      if (record.phase === 'settled') {
        // A retained, confirmed drag/flight receipt can be read after a very
        // quick release. Neither elapsed time nor a quiet log grants control.
        return !!record.endedAt && (allowManualEnd || ['drag', 'info', 'click'].includes(record.kind) && record.resumable);
      }
      // Keep observing an open menu without taking control: its eventual
      // choice can be a read-only usage view (info), or a non-resumable manual
      // animation. Only the settled receipt decides which actually occurred.
      await this.sleep(this.interactionPollMs);
    }
    return false;
  }
  async waitForPlaybackBoundary(generation, nextName = null) {
    const active = this.activePlayback;
    if (!active || active.generation === generation) return true;
    // Most gestures retain their real ended boundary. A controller-owned
    // reading clip can instead prepare a known task's native pose gate early;
    // the renderer still returns through genuine frames before target F0.
    while (!this.closed && this.generation === generation && !this.paused && !this.preempted && !this.surfaceReloading) {
      await this.lease();
      await this.observeRestInteraction();
      const readingBoundary = active.name === 'reading' || !!active.readingReturn;
      // Pending optional gestures must yield before the decoder starts them.
      // A normal ended long-poll could itself let that gesture become visible.
      const record = await this.client.playback(active.playbackId, active.optionalCue ? { waitTimeoutMs: 0 } : readingBoundary ? { waitTimeoutMs: readingReceiptWaitMs } : undefined);
      if (this.activePlayback !== active) return true;
      // An accepted successor may still be sharing reading's pending return.
      // Once it really starts, later states use its ordinary ended boundary.
      if (record?.status === 'playing' && active.readingReturn) delete active.readingReturn;
      if (record?.status === 'playing' && active.optionalCue) delete active.optionalCue;
      if (record?.status === 'ended') {
        this.activePlayback = null;
        return this.generation === generation && !this.closed && !this.paused && !this.preempted && !this.surfaceReloading;
      }
      if (record?.status === 'cancelled') throw Object.assign(new Error('preempted'), { reason: 'preempted' });
      if (record?.status === 'failed') throw Object.assign(new Error('playback-failed'), { reason: 'playback-failed' });
      const startGrace = active.readingReturn ? Math.max(this.startTimeoutMs, readingReturnStartTimeoutMs) : this.startTimeoutMs;
      if (record?.status === 'accepted' && this.now() - active.requestedAt >= startGrace)
        throw Object.assign(new Error('playback-not-started'), { reason: 'playback-not-started' });
      if (this.closed || this.generation !== generation || this.paused || this.preempted || this.surfaceReloading) return false;
      // An optional focus gesture that has not started must not get ahead of
      // newer work. The next real play supersedes it through the native gate.
      if (active.optionalCue && record?.status === 'accepted' && readingTaskStates.has(this.status.state) && readingTaskTargets.has(nextName)) return true;
      if (readingTaskStates.has(this.status.state) && readingTaskTargets.has(nextName) && ['accepted', 'playing'].includes(record?.status)) {
        const readingReturn = active.name === 'reading'
          ? { playbackId: active.playbackId, generation: active.generation }
          : record.status === 'accepted' ? active.readingReturn : null;
        if (readingReturn) return { readingReturn: { ...readingReturn } };
      }
      await this.sleep(60);
    }
    return false;
  }
  async one(name, generation, { observeInteraction = false, optionalCue = false, cueExpiresAt = Infinity } = {}) {
    await this.lease();
    const boundary = await this.waitForPlaybackBoundary(generation, name);
    if (!boundary) return false;
    let readingReturn = boundary.readingReturn || null;
    let nextInteractionPoll = 0;
    const observe = async () => {
      if (observeInteraction && this.now() >= nextInteractionPoll) {
        await this.observeRestInteraction();
        nextInteractionPoll = this.now() + this.interactionPollMs;
      }
    };
    await observe();
    if (this.closed || this.generation !== generation || this.paused || this.preempted || this.surfaceReloading) return false;
    // Optional reminders expire while native checks are in flight too. A
    // dropped cue is not an ended gesture and must not consume its cooldown.
    if (optionalCue && this.now() > cueExpiresAt) return 'skipped';
    let receipt = await this.client.play(name, this.lockId);
    if (!receipt?.playbackId) throw Object.assign(new Error('invalid-playback-receipt'), { reason: 'invalid-playback-receipt' });
    let requestedAt = this.now();
    this.activePlayback = { playbackId: receipt.playbackId, name, generation, requestedAt, ...(readingReturn ? { readingReturn } : {}), ...(optionalCue ? { optionalCue: true } : {}) };
    let startRetries = 0;
    while (!this.closed && this.generation === generation && !this.paused && !this.preempted) {
      await this.lease();
      const record = await this.client.playback(receipt.playbackId, optionalCue && this.activePlayback?.optionalCue ? { waitTimeoutMs: 0 } : name === 'reading' || readingReturn ? { waitTimeoutMs: readingReceiptWaitMs } : undefined);
      if (record?.status === 'playing' || record?.status === 'ended') {
        readingReturn = null;
        if (this.activePlayback?.playbackId === receipt.playbackId) delete this.activePlayback.readingReturn;
        if (this.activePlayback?.playbackId === receipt.playbackId) delete this.activePlayback.optionalCue;
      }
      if (record?.status === 'ended' && this.activePlayback?.playbackId === receipt.playbackId) this.activePlayback = null;
      if (this.closed || this.generation !== generation || this.paused || this.surfaceReloading) return false;
      await observe();
      if (this.closed || this.generation !== generation || this.paused || this.preempted || this.surfaceReloading) return false;
      const diagnostic = { playbackId: receipt.playbackId, name, status: record?.status, reason: /^[a-z][a-z0-9-]{0,60}$/.test(record?.reason ?? '') ? record.reason : null, updatedAt: Number.isFinite(record?.updatedAt) ? record.updatedAt : null };
      if (JSON.stringify(diagnostic) !== JSON.stringify(this.lastPlayback)) { this.lastPlayback = diagnostic; this.changed(); }
      const startGrace = readingReturn ? Math.max(this.startTimeoutMs, readingReturnStartTimeoutMs) : this.startTimeoutMs;
      if (record?.status === 'accepted' && this.now() - requestedAt >= startGrace) {
        // A safe forward return may still be finishing the full reading tail.
        // Never replace this accepted successor at the ordinary five-second
        // edge: it could commit just before the retry and then visibly restart.
        if (readingReturn || optionalCue) throw Object.assign(new Error('playback-not-started'), { reason: 'playback-not-started' });
        if (startRetries++ >= this.maxStartRetries) throw Object.assign(new Error('playback-not-started'), { reason: 'playback-not-started' });
        // The native renderer intentionally ignores commands present in its first
        // state baseline. Recheck the old lease before resending a missed start;
        // a user takeover must never be turned into a fresh lock acquisition.
        await this.lease(true);
        if (this.closed || this.generation !== generation || this.paused || this.preempted || this.surfaceReloading) return false;
        receipt = await this.client.play(name, this.lockId);
        if (!receipt?.playbackId) throw Object.assign(new Error('invalid-playback-receipt'), { reason: 'invalid-playback-receipt' });
        requestedAt = this.now();
        this.activePlayback = { playbackId: receipt.playbackId, name, generation, requestedAt, ...(readingReturn ? { readingReturn } : {}), ...(optionalCue ? { optionalCue: true } : {}) };
        continue;
      }
      if (terminal.has(record?.status)) {
        if (record.status === 'cancelled') throw Object.assign(new Error('preempted'), { reason: 'preempted' });
        if (record.status === 'failed') throw Object.assign(new Error('playback-failed'), { reason: 'playback-failed' });
        return true;
      }
      // Both real host and test doubles may return immediately while pending.
      await this.sleep(60);
    }
    return false;
  }
  async observeRestInteraction() {
    if (typeof this.client.interaction !== 'function') return;
    let record;
    try { record = interactionRecord(await this.client.interaction()); }
    catch (error) {
      if (error?.reason === 'api-http-error' && [404, 405].includes(error?.status)) return;
      throw error;
    }
    if (!record) return;
    this.noteInteraction(record);
    const baseline = initialInteraction(record) && record.id === this.controlInteractionId;
    if (busyPhases.has(record.phase) || !baseline && record.startedAt >= this.controlStartedAt) {
      // Rest is still controlled time: even a click that ended between polls
      // must take priority, while a real settled drag/info can hand back.
      throw Object.assign(new Error('preempted'), { reason: 'preempted' });
    }
  }
  async restUntil(deadline, generation) {
    const idle = firstAnimation(this.animations.idle);
    while (!this.closed && this.generation === generation && !this.paused && !this.preempted && this.now() < deadline) {
      const cue = this.cue;
      this.cue = null;
      if (cue && cue.generation === generation && cue.expiresAt >= this.now() && this.status.state === 'idle' &&
          (cue.source !== 'focus' || focusCueAllowed(this, cue.name))) {
        await this.observeRestInteraction();
        const result = await this.one(cue.name, generation, { observeInteraction: true, ...(cue.source === 'focus' ? { optionalCue: true, cueExpiresAt: cue.expiresAt } : {}) });
        if (!result) return false;
        if (result !== 'skipped') {
          this.previousAmbient = cue.name;
          this.lastAmbientEnded[cue.name] = this.now();
          // A local timer/story cue is also a complete gesture. Give it the
          // same breathing space as an autonomous gesture before another one.
          deadline = Math.max(deadline, this.now() + quietDelay('idle', this.random, this.ambient.frequency));
          this.scheduleChanged({ phase: 'rest', nextActionAt: deadline });
        }
      }
      // A frozen renderer holds the last decoded frame after a finite clip.
      // Fill the quiet interval with complete breathing clips instead of
      // leaving that final neutral pose on screen for several seconds. The
      // deadline only chooses the next gesture; it never cuts an idle short
      // or invents an ended receipt, even if this last clip extends past it.
      const startedAt = this.now();
      if (!await this.one(idle, generation, { observeInteraction: true })) return false;
      // Real playback advances the clock. Yield if a host/test double returns
      // an immediate ended receipt, so pause and new generations still run.
      if (this.now() <= startedAt) await this.sleep(1);
    }
    return !this.closed && this.generation === generation && !this.paused && !this.preempted;
  }
  scheduleChanged(values) { this.schedule = { ...this.schedule, ...values }; this.changed(); }
  async withSurfaceReload(applyAppearance) {
    if (this.closed || this.surfaceReloading) throw Object.assign(new Error('surface-reload-unavailable'), { reason: 'surface-reload-unavailable' });
    this.surfaceReloading = true;
    const priority = this.surfacePriority = { preempted: this.preempted, issue: this.issue };
    const preservePriority = reason => { priority.preempted = this.preempted = true; priority.issue = this.issue = reason; };
    this.surfaceResumeGuard = null;
    const startedAt = this.now();
    this.generation++;
    this.scheduleChanged({ phase: 'reloading', nextActionAt: null });
    try {
      // An old helper's playing receipt will never end after that helper exits.
      // Stop its generation explicitly, without inventing an ended receipt or
      // changing the user's saved pause/preemption preference.
      await this.runPromise;
      await this.release();
      let before = null;
      try { before = interactionRecord(await this.client.interaction()); } catch { /* readiness below fails closed */ }
      if (before && (busyPhases.has(before.phase) || !initialInteraction(before) && before.startedAt >= this.controlStartedAt)) {
        preservePriority('preempted');
      }
      const result = await applyAppearance();
      if (!['desktop', 'both'].includes(result?.display)) {
        preservePriority('pet-not-displayed');
        return result;
      }
      const deadline = this.now() + this.surfaceReadyTimeoutMs;
      let ready = null;
      while (!this.closed && this.now() < deadline) {
        let record;
        try { record = interactionRecord(await this.client.interaction()); }
        catch (error) {
          if (['pet-not-displayed', 'pet-hidden', 'pet-not-found'].includes(error?.reason)) { preservePriority(error.reason); break; }
        }
        if (record) {
          this.noteInteraction(record);
          if (!initialInteraction(record) && record.startedAt >= startedAt) {
            preservePriority('preempted');
            break;
          }
          // Initial interaction records come from the real renderer's first
          // pose. A retained old pose and elapsed time cannot grant control.
          if (initialInteraction(record) && record.id !== before?.id && record.startedAt >= startedAt) { ready = record; break; }
        }
        await this.sleep(Math.min(this.interactionPollMs, 100, Math.max(1, deadline - this.now())));
      }
      if (ready) this.surfaceResumeGuard = { id: ready.id };
      else if (!this.closed && !priority.preempted) preservePriority('surface-not-ready');
      return result;
    } catch (error) {
      // Validation/conflict errors did not apply a new helper configuration.
      // Other failures can have an uncertain PUT outcome, so do not resume it.
      if (!['invalid-appearance', 'config-conflict'].includes(error?.reason)) {
        preservePriority('surface-not-ready');
      }
      throw error;
    } finally {
      this.surfaceReloading = false;
      this.surfacePriority = null;
      if (priority.preempted) { this.preempted = true; this.issue = priority.issue; }
      this.generation++;
      this.changed();
      this.kick();
    }
  }
  async run() {
    let captionGeneration = -1;
    let plan = null;
    while (!this.closed) {
      const generation = this.generation;
      if (this.surfaceReloading) { this.scheduleChanged({ phase: 'reloading', nextActionAt: null }); this.handledGeneration = generation; await this.release(); return; }
      if (this.paused || this.preempted) {
        if (!this.paused && this.pendingHandoff) {
          const resume = await this.waitForHandoff(generation, this.pendingHandoff.allowManualEnd);
          // State changes may cancel a wait, but do not cancel a resumable
          // native gesture. Its real end receipt remains the sole authority.
          if (this.generation !== generation) continue;
          this.pendingHandoff = null;
          if (resume && !this.closed && !this.paused) { this.preempted = false; this.issue = null; this.changed(); continue; }
        }
        this.scheduleChanged({ phase: this.paused ? 'paused' : 'preempted', nextActionAt: null }); this.handledGeneration = generation; await this.release(); return;
      }
      const status = this.status;
      let state = status.state;
      // Replaying an old terminal record at startup must not celebrate it anew.
      const eventTime = Date.parse(status.updatedAt);
      if (['complete', 'interrupted'].includes(state) && (!Number.isFinite(eventTime) || this.now() - eventTime > 10000)) state = 'idle';
      if (!plan || plan.generation !== generation) {
        if (['complete', 'interrupted'].includes(state)) {
          const key = JSON.stringify([status.threadId, status.turnId, state]);
          if (this.terminalEntries.has(key)) state = 'idle';
          else {
            this.terminalEntries.add(key);
            if (this.terminalEntries.size > 128) this.terminalEntries.delete(this.terminalEntries.values().next().value);
          }
        }
        const value = this.animations[state] ?? this.animations.idle;
        const entry = ['complete', 'interrupted'].includes(state) ? [...(Array.isArray(value) ? value : [value]), firstAnimation(this.animations.idle)] : [firstAnimation(value)];
        plan = { generation, state: ['complete', 'interrupted'].includes(state) ? 'idle' : state, entry, nextActionAt: null, needsIdle: false, previous: ['working', 'waiting'].includes(state) ? firstAnimation(value) : null };
        this.scheduleChanged({ state: plan.state, phase: 'entry', animation: null, nextActionAt: null, lastAction: null, lastActionAt: null });
      }
      try {
        await this.lease();
        if (captions[state] && captionGeneration !== generation) await this.client.broadcast(captions[state], this.lockId);
        captionGeneration = generation;
        if (this.generation !== generation) continue;
        this.issue = null;
        this.changed();
        if (plan.entry.length) {
          const name = plan.entry[0];
          this.scheduleChanged({ phase: 'entry', animation: name });
          if (!await this.one(name, generation)) continue;
          plan.entry.shift();
          if (plan.entry.length) continue;
          if (plan.state === 'unknown') {
            this.scheduleChanged({ phase: 'stopped', animation: name, nextActionAt: null });
            this.handledGeneration = generation; await this.release(); return;
          }
          plan.needsIdle = name !== firstAnimation(this.animations.idle);
          plan.nextActionAt = this.now() + quietDelay(plan.state, this.random, this.ambient.frequency);
        }
        if (plan.needsIdle) {
          const idle = firstAnimation(this.animations.idle);
          this.scheduleChanged({ phase: 'breathing', animation: idle, nextActionAt: plan.nextActionAt });
          if (!await this.one(idle, generation)) continue;
          plan.needsIdle = false;
        }
        this.scheduleChanged({ phase: 'rest', nextActionAt: plan.nextActionAt });
        if (!await this.restUntil(plan.nextActionAt, generation)) continue;
        const name = naturalAnimation(plan.state, this.animations, plan.state === 'idle' ? this.previousAmbient : plan.previous, this.random,
          { ...this.ambient, available: this.availableAnimations, lastEnded: this.lastAmbientEnded, now: this.now() });
        this.scheduleChanged({ phase: 'action', animation: name, nextActionAt: null, lastAction: name, lastActionAt: this.now() });
        if (!await this.one(name, generation)) continue;
        if (plan.state === 'idle' && name !== firstAnimation(this.animations.idle)) {
          this.previousAmbient = name;
          this.lastAmbientEnded[name] = this.now();
        }
        plan.previous = name;
        plan.needsIdle = true;
        plan.nextActionAt = this.now() + quietDelay(plan.state, this.random, this.ambient.frequency);
      } catch (error) {
        const reason = error?.reason ?? 'runtime-unreachable';
        // A task update can arrive while the native interaction read is in
        // flight. Its generation invalidates ordinary playback/network work,
        // but cannot erase a confirmed user takeover or hidden surface and
        // turn the next loop into permission to acquire a fresh lease.
        if (this.generation !== generation && !preemptions.has(reason)) { await this.release(); continue; }
        this.issue = /^[a-z][a-z0-9-]{0,60}$/.test(reason) ? reason : 'runtime-unreachable';
        if (preemptions.has(reason)) {
          this.preempted = true;
          this.cue = null;
        }
        this.scheduleChanged({ phase: this.preempted ? 'preempted' : 'retry', nextActionAt: null });
        await this.release();
        this.changed();
        if (this.preempted) {
          this.pendingHandoff = handoffReasons.has(reason) ? { allowManualEnd: reason === 'interaction-active' } : null;
          continue;
        }
        const retryUntil = this.now() + this.retryMs;
        while (!this.closed && this.generation === generation && !this.paused && this.now() < retryUntil) await this.sleep(Math.min(100, retryUntil - this.now()));
      }
    }
    await this.release();
  }
  async close() {
    this.closed = true;
    this.generation++;
    await this.runPromise;
    await this.release();
  }
}
