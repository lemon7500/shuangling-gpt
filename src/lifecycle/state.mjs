import { randomUUID } from 'node:crypto';

export const CLOSE_GRACE_MS = 3000;
export const RETRY_DELAYS_MS = Object.freeze([1000, 3000, 10000]);
export const OBSERVER_FRESH_MS = 6000;

export function emptyLifecycleState() {
  return { schemaVersion: 1, active: false, epoch: null, windows: [], zeroSince: null,
    manualSuppressed: false, ownerInstanceId: null, attempts: 0, nextAttemptAt: null,
    pendingStartAt: null, stopRequested: false, lastObservedAt: null, logonId: null, epochProcesses: [] };
}

const processIdentities = windows => [...new Set((windows || []).map(window => window.split(':').slice(0, 2).join(':')))];

// Inputs contain only authenticated manager health and native package-verified
// window identities. Window titles and conversation text never enter this state.
export function reconcileLifecycleTick(previous, input, { now = Date.now(), epoch = randomUUID } = {}) {
  const state = { ...emptyLifecycleState(), ...previous };
  const effects = [];
  if (!input.detectorAvailable) return { state, effects };
  const windows = [...new Set(input.windows || [])].sort();
  const processes = processIdentities(windows);
  const priorProcesses = state.epochProcesses?.length ? state.epochProcesses : processIdentities(state.windows);
  const changedLogon = typeof input.logonId === 'string' && state.logonId && state.logonId !== input.logonId;
  const replacedAfterGap = state.active && Number.isFinite(state.lastObservedAt) && now - state.lastObservedAt > CLOSE_GRACE_MS &&
    processes.length && priorProcesses.length && processes.every(identity => !priorProcesses.includes(identity)) &&
    input.priorEpoch === state.epoch && input.priorEpochProcessesGone === true;
  // The native AuthenticationId survives watcher/MCP restarts but changes at
  // Windows logon. A stale observation alone is never a new app session:
  // replacing all GUI owners additionally requires native proof the previous
  // epoch's exact PID + creation-time identities no longer exist.
  if (changedLogon || replacedAfterGap) Object.assign(state, emptyLifecycleState());
  if (typeof input.logonId === 'string') state.logonId = input.logonId;
  state.lastObservedAt = now;
  state.windows = windows;
  if (windows.length) {
    state.zeroSince = null;
    if (!state.active) {
      Object.assign(state, { active: true, epoch: epoch(), manualSuppressed: state.manualSuppressed,
        ownerInstanceId: null, attempts: 0, nextAttemptAt: now, pendingStartAt: null, stopRequested: false, epochProcesses: processes });
    }
    state.epochProcesses = [...new Set([...state.epochProcesses, ...processes])].sort();
  } else if (state.active) {
    if (state.zeroSince === null) state.zeroSince = now;
    if (now - state.zeroSince >= CLOSE_GRACE_MS) {
      if (state.ownerInstanceId && input.manager?.instanceId === state.ownerInstanceId && !state.stopRequested) {
        effects.push({ type: 'stop', instanceId: state.ownerInstanceId });
        state.stopRequested = true;
      }
      Object.assign(state, { active: false, manualSuppressed: false, attempts: 0, nextAttemptAt: null, pendingStartAt: null });
    }
  }
  if (!state.active && state.ownerInstanceId && input.manager?.instanceId === state.ownerInstanceId && !state.stopRequested) {
    effects.push({ type: 'stop', instanceId: state.ownerInstanceId }); state.stopRequested = true;
  }
  if (!state.active) return { state, effects };
  if (input.manager?.ready) {
    // Adopt an already-running singleton only while a verified Codex window is
    // present. Hidden/paused instances remain healthy and are never relaunched.
    state.ownerInstanceId = input.manager.instanceId;
    state.pendingStartAt = null;
    state.nextAttemptAt = null;
    return { state, effects };
  }
  if (!windows.length || !input.autoLaunch || !input.pluginEnabled || state.manualSuppressed) return { state, effects };
  if (state.pendingStartAt !== null && now - state.pendingStartAt < 25000) return { state, effects };
  if (state.pendingStartAt !== null) {
    state.pendingStartAt = null;
    state.nextAttemptAt = state.attempts <= RETRY_DELAYS_MS.length ? now + RETRY_DELAYS_MS[state.attempts - 1] : null;
  }
  // A healthy instance that subsequently disappears gets the same finite
  // retry budget. Explicit exits are marked before the manager shuts down.
  if (state.nextAttemptAt === null && state.ownerInstanceId && state.attempts < 4) {
    state.nextAttemptAt = now + RETRY_DELAYS_MS[Math.max(0, state.attempts - 1)];
    state.ownerInstanceId = null;
  }
  if (state.attempts >= 4 || state.nextAttemptAt === null || now < state.nextAttemptAt) return { state, effects };
  state.attempts++;
  state.pendingStartAt = now;
  state.nextAttemptAt = null;
  effects.push({ type: 'start', epoch: state.epoch, attempt: state.attempts });
  return { state, effects };
}

export function markStartFailure(state, now = Date.now()) {
  return { ...state, pendingStartAt: null,
    nextAttemptAt: state.attempts <= RETRY_DELAYS_MS.length ? now + RETRY_DELAYS_MS[state.attempts - 1] : null };
}
