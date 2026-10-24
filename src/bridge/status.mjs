/** Read-only Codex rollout reduction. Never retain messages, arguments, or outputs. */
export const STATES = Object.freeze(['idle', 'working', 'waiting', 'complete', 'interrupted', 'unknown']);

const inputTool = (name) => /(?:^|[./:])request_user_input(?:_async)?$/.test(String(name ?? ''));
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : null;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;

export class StatusReducer {
  constructor(threadId, onChange = () => {}) {
    this.threadId = threadId;
    this.onChange = onChange;
    this.seen = new Set();
    this.finished = new Set();
    this.pendingInput = new Set();
    this.state = { state: 'unknown', threadId, turnId: null, rootTurnId: null, updatedAt: null, reason: 'initializing' };
    this.verified = false;
    this.activeTurn = null;
  }

  snapshot() { return { ...this.state }; }

  reset(reason = 'log-reloaded') {
    this.seen.clear();
    this.finished.clear();
    this.pendingInput.clear();
    this.verified = false;
    this.activeTurn = null;
    this.state.rootTurnId = null;
    this.state.updatedAt = null;
    this.set('unknown', null, reason);
  }

  unavailable(reason = 'log-unavailable') { this.set('unknown', null, reason); }

  set(state, event, reason = null) {
    const next = {
      state,
      threadId: this.threadId,
      turnId: this.activeTurn,
      rootTurnId: identifier(event?.payload?.root_turn_id) ?? this.state.rootTurnId,
      updatedAt: timestamp(event?.timestamp) ?? this.state.updatedAt,
      reason,
    };
    const changed = state !== this.state.state || next.turnId !== this.state.turnId || reason !== this.state.reason;
    this.state = next;
    if (changed) this.onChange(this.snapshot());
  }

  accept(event) {
    if (!event || typeof event !== 'object') return;
    const p = event.payload;
    if (!p || typeof p !== 'object') return;
    if (event.type === 'session_meta') {
      this.verified = p.id === this.threadId && p.thread_source !== 'subagent';
      if (this.verified) this.set('idle', event);
      else this.unavailable('wrong-thread');
      return;
    }
    if (!this.verified) return;
    const attributed = p.thread_id ?? p.threadId ?? p.turn_attribution?.thread_id ?? event.thread_id;
    if (attributed && attributed !== this.threadId) return;
    const turn = identifier(p.turn_id);
    const kind = p.type;
    const key = [identifier(event.type), identifier(kind), identifier(p.call_id), turn, timestamp(event.timestamp), identifier(p.name)].join('|');
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 8192) this.seen.delete(this.seen.values().next().value);

    if (event.type === 'event_msg') {
      if (kind === 'task_started' && turn && !this.finished.has(turn)) {
        if (turn === this.activeTurn) return;
        // Nested-turn events cannot replace the active root turn.
        if (this.activeTurn && p.root_turn_id === this.activeTurn && turn !== this.activeTurn) return;
        this.activeTurn = turn;
        this.pendingInput.clear();
        this.set('working', event);
      } else if ((kind === 'task_complete' || kind === 'turn_aborted') && turn && turn === this.activeTurn) {
        this.finished.add(turn);
        if (this.finished.size > 256) this.finished.delete(this.finished.values().next().value);
        this.pendingInput.clear();
        this.set(kind === 'task_complete' ? 'complete' : 'interrupted', event);
      }
      return;
    }

    if (event.type !== 'response_item' || !this.activeTurn || this.finished.has(this.activeTurn)) return;
    if (turn && turn !== this.activeTurn) return;
    const callId = identifier(p.call_id);
    if (!callId) return;
    if ((kind === 'function_call' || kind === 'custom_tool_call') && inputTool(p.name)) {
      this.pendingInput.add(callId);
      this.set('waiting', event);
    } else if (kind === 'function_call_output' || kind === 'custom_tool_call_output') {
      if (this.pendingInput.delete(callId) && this.pendingInput.size === 0) this.set('working', event);
    }
  }
}
