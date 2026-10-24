import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { RolloutWatcher } from './rollouts.mjs';
import { ProjectUsageReader } from './project-usage.mjs';

const live = state => state === 'working' || state === 'waiting';
const terminal = state => state === 'complete' || state === 'interrupted';
const keyPath = value => String(value).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
const milliseconds = value => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const unknownAccount = (reason = 'not-reported', observedAt = null) => ({ observedAt, planType: null,
  fiveHour: { status: 'unknown', reason, observedAt }, weekly: { status: 'unknown', reason, observedAt } });
const accountKeys = ['fiveHour', 'weekly'];
const accountTime = account => milliseconds(account?.observedAt)
  ?? accountKeys.reduce((latest, key) => Math.max(latest ?? -Infinity, milliseconds(account?.[key]?.observedAt) ?? -Infinity), null);
// Age changes while duplicate events are read; the event's values and validity
// do not. Comparing an allowlist also avoids retaining unrelated source fields.
const accountFingerprint = account => JSON.stringify([account.planType,
  ...accountKeys.map(key => ['status', 'reason', 'observedAt', 'windowMinutes', 'usedPercent', 'remainingPercent', 'resetsAt']
    .map(field => account[key]?.[field] ?? null))]);

async function concurrent(items, limit, operation) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) { const item = items[index++]; await operation(item); }
  }));
}

/** Read-only, all-root Codex work state. Navigation never selects its owner. */
export class CodexWorkWatcher {
  constructor({ codexHome, threadId = null, onChange = () => {}, intervalMs = 300, discoveryMs = 5000,
    sessionStartedAt, terminalHoldMs = 15000,
    maxConcurrent = 4, maxWatchers = 200, metadataReader, watcherFactory, now = Date.now } = {}) {
    if (typeof codexHome !== 'string' || !codexHome) throw new Error('codex-home-required');
    this.codexHome = codexHome;
    this.sourceThreadId = threadId;
    this.onChange = onChange;
    this.intervalMs = intervalMs;
    this.discoveryMs = discoveryMs;
    this.now = now;
    const sessionAt = milliseconds(sessionStartedAt);
    this.observerStartedAt = now();
    this.hasSessionBoundary = sessionAt !== null && sessionAt >= 0 && sessionAt <= this.observerStartedAt;
    // Missing lifecycle evidence cannot be replaced with an arbitrary recent
    // time window and then described as the whole current app session.
    this.boundary = this.hasSessionBoundary ? sessionAt : this.observerStartedAt;
    this.boundaryReason = this.hasSessionBoundary ? null : 'session-boundary-unavailable';
    this.terminalHoldMs = terminalHoldMs;
    this.maxConcurrent = Math.max(1, Math.min(16, Math.floor(maxConcurrent) || 4));
    this.maxWatchers = Math.max(1, Math.floor(maxWatchers) || 200);
    this.metadata = metadataReader ?? new ProjectUsageReader({ codexHome, now, indexMaxAgeMs: discoveryMs });
    this.watcherFactory = watcherFactory ?? (options => new RolloutWatcher(options));
    this.records = new Map();
    this.nextDiscoveryAt = -Infinity;
    this.discoveryReason = null;
    this.omittedCount = 0;
    this.epoch = randomUUID();
    this.sequence = 0;
    this.batch = null;
    this.lastPublished = null;
    this.closed = false;
    this.pending = null;
    this.value = this.compose(this.hasSessionBoundary ? 'idle' : 'unknown', null, null,
      { activeCount: 0, workingCount: 0, waitingCount: 0, unknownCount: 0 }, this.boundaryReason || 'no-observed-work');
  }

  setDiagnosticThread(threadId) { this.sourceThreadId = threadId; }
  snapshot() { return { ...this.value }; }

  compose(state, turnId, updatedAt, counts, reason = null) {
    return { state, scope: 'codex', source: this.hasSessionBoundary ? 'codex-local-root-events/current-app-session' : 'codex-local-root-events/since-observer-start',
      boundaryReason: this.boundaryReason, threadId: 'codex', sourceThreadId: this.sourceThreadId,
      turnId, rootTurnId: turnId, updatedAt, reason, ...counts,
      staleCount: [...this.records.values()].filter(record => record.stale).length,
      unverifiedCount: [...this.records.values()].filter(record => record.unverified).length,
      discoveryReason: this.discoveryReason, omittedCount: this.omittedCount };
  }

  async discover(force = false) {
    if (!force && this.now() < this.nextDiscoveryAt) return [];
    this.nextDiscoveryAt = this.now() + this.discoveryMs;
    const created = [];
    try {
      // A potential final transition merits a fresh discovery pass: another
      // root may have started since the last five-second directory scan.
      if (force && typeof this.metadata.indexAt === 'number') this.metadata.indexAt = -Infinity;
      await this.metadata.refreshIndex();
      this.discoveryReason = this.metadata.indexProblem ?? null;
      const sessionDirectory = `${keyPath(join(this.codexHome, 'sessions'))}/`;
      const entries = [...this.metadata.index.values()].filter(entry => entry?.metadata?.source === 'root'
        && !entry.metadata.parentThreadId && !entry.metadata.parent_thread_id
        && !['subagent', 'guardian_review'].includes(entry.metadata.thread_source));
      for (const entry of entries) {
        const known = this.records.get(entry.metadata.id);
        if (!known) continue;
        if (known.path !== entry.path) { known.path = entry.path; known.watcher.path = entry.path; known.nextPollAt = -Infinity; }
        if (entry.mtimeMs !== known.mtimeMs) { known.mtimeMs = entry.mtimeMs; known.nextPollAt = -Infinity; }
      }
      const candidates = entries.filter(entry => !this.records.has(entry.metadata.id)
        && keyPath(entry.path).startsWith(sessionDirectory)
        && Number.isFinite(entry.mtimeMs) && entry.mtimeMs >= this.boundary)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      const free = Math.max(0, this.maxWatchers - this.records.size);
      this.omittedCount = Math.max(0, candidates.length - free);
      for (const entry of candidates.slice(0, free)) {
        const watcher = await this.watcherFactory({ codexHome: this.codexHome, threadId: entry.metadata.id, intervalMs: this.intervalMs });
        // Reuse the index's verified exact path instead of doing one full tree
        // walk per child watcher. Only this parent owns a polling timer.
        watcher.path = entry.path;
        const record = { id: entry.metadata.id, path: entry.path, mtimeMs: entry.mtimeMs, watcher,
          latest: null, nextPollAt: -Infinity, stale: false, completed: new Set(),
          hasBaseline: false, reloaded: false, transitions: [], overflow: false, unverified: false };
        if (watcher.reducer && typeof watcher.reducer.reset === 'function') {
          const reset = watcher.reducer.reset.bind(watcher.reducer);
          watcher.reducer.reset = (...args) => {
            record.reloaded = true; record.transitions = [];
            return reset(...args);
          };
          const changed = watcher.reducer.onChange;
          watcher.reducer.onChange = status => {
            // The reducer already allowlists these values. Initial/history
            // replay is never queued; ordinary appends preserve an explicit
            // end followed by another start inside the same 300-ms poll.
            if (record.hasBaseline && !record.reloaded) {
              if (record.transitions.length < 1024) record.transitions.push({ ...status });
              else record.overflow = true;
            }
            changed?.(status);
          };
        }
        this.records.set(record.id, record);
        created.push(record);
      }
    } catch {
      this.discoveryReason = 'discovery-unavailable';
    }
    return created;
  }

  async poll(records) {
    await concurrent(records, this.maxConcurrent, async record => {
      record.transitions = []; record.reloaded = false; record.overflow = false;
      let latest;
      try {
        // ENOENT must not trigger RolloutWatcher.find() and scan the entire
        // history every 300 ms. Discovery is responsible for locating moves.
        if (!record.watcher.path) record.watcher.path = record.path;
        await record.watcher.tick();
        latest = record.watcher.snapshot();
      } catch {
        latest = { state: 'unknown', threadId: record.id, turnId: record.latest?.turnId ?? null,
          updatedAt: record.latest?.updatedAt ?? null, reason: 'log-unavailable' };
      }
      if (record.hasBaseline && !record.reloaded && !record.overflow) {
        for (const transition of record.transitions) { record.latest = transition; this.observe(record); }
      }
      record.latest = record.overflow ? { ...latest, state: 'unknown', reason: 'log-event-overflow' } : latest;
      this.observe(record);
      record.hasBaseline = true;
      record.transitions = [];
      const member = this.batch?.members.get(record.id);
      record.nextPollAt = this.now() + (member && !terminal(member.state) || record.unverified ? this.intervalMs : this.discoveryMs);
    });
  }

  withinBoundary(at) {
    return at !== null && (this.hasSessionBoundary ? at >= this.boundary : at > this.boundary) && at <= this.now() + 60_000;
  }

  recentProof(record) {
    const statusAt = milliseconds(record.latest?.updatedAt);
    if (this.withinBoundary(statusAt)) return true;
    // A long-running turn may have begun before the window/session boundary.
    // A recently reported model request is additional positive activity
    // evidence; file mtime alone is deliberately insufficient.
    let context;
    try { context = record.watcher.usageSnapshot?.().context; } catch { return false; }
    const requestAt = milliseconds(context?.observedAt);
    return context?.sample === 'last-model-request' && this.withinBoundary(requestAt);
  }

  beginBatch() {
    this.batch = { id: `codex:${this.epoch}:${++this.sequence}`, members: new Map(), openedAt: this.now(), terminalAt: null, terminalState: null, lastFinalDiscoveryAt: -Infinity };
  }

  observe(record) {
    const status = record.latest;
    if (!status) return;
    let member = this.batch?.members.get(record.id);
    // A verified candidate whose body cannot yet be reduced is uncertainty,
    // even before a turn ID is available. Do not invent a task to model it.
    record.unverified = status.state === 'unknown' && (!member || terminal(member.state));
    if (live(status.state) && status.turnId && !record.completed.has(status.turnId)) {
      // A previously observed active task survives arbitrary log silence. Only
      // first admission uses the freshness boundary, never ongoing ownership.
      const trusted = member && !terminal(member.state) || this.recentProof(record);
      record.stale = !trusted;
      if (!trusted) return;
      record.unverified = false;
      if (!this.batch || this.batch.terminalState) { this.beginBatch(); member = null; }
      if (!member) {
        member = { turnId: status.turnId, state: status.state, updatedAt: status.updatedAt, unresolvedPrior: false };
        this.batch.members.set(record.id, member);
      } else {
        if (member.turnId !== status.turnId && !terminal(member.state)) member.unresolvedPrior = true;
        member.turnId = status.turnId; member.state = status.state; member.updatedAt = status.updatedAt;
      }
      return;
    }
    if (status.state === 'unknown' && status.turnId && !record.completed.has(status.turnId) && this.recentProof(record)) {
      // A verified task can be followed by a malformed/partially unavailable
      // record during its initial replay. It is unresolved work, not idle.
      if (!this.batch || this.batch.terminalState) { this.beginBatch(); member = null; }
      if (!member) {
        member = { turnId: status.turnId, state: 'unknown', updatedAt: status.updatedAt, unresolvedPrior: false };
        this.batch.members.set(record.id, member);
      } else { member.state = 'unknown'; member.updatedAt = status.updatedAt; }
      record.stale = false;
      record.unverified = false;
      return;
    }
    record.stale = false;
    if (terminal(status.state) && status.turnId) {
      record.completed.add(status.turnId);
      if (record.completed.size > 256) record.completed.delete(record.completed.values().next().value);
      // Initial replayed terminal records establish a baseline only; they did
      // not correspond to an active turn observed by this watcher.
      if (member && !terminal(member.state) && member.turnId === status.turnId) {
        member.state = member.unresolvedPrior ? 'unknown' : status.state;
        member.updatedAt = status.updatedAt;
      } else if (member && !terminal(member.state)) {
        // A different final turn cannot prove the previously observed turn
        // ended when no ordered append transitions were available.
        member.state = 'unknown';
      }
    } else if (member && !terminal(member.state)) {
      member.state = 'unknown';
      // Missing, truncated and unreadable logs cannot silently finish work.
    }
  }

  aggregate() {
    const counts = { activeCount: 0, workingCount: 0, waitingCount: 0, unknownCount: 0 };
    let updatedAt = null;
    const members = this.batch ? [...this.batch.members.values()] : [];
    for (const member of members) {
      if (milliseconds(member.updatedAt) !== null && (!updatedAt || Date.parse(member.updatedAt) > Date.parse(updatedAt))) updatedAt = member.updatedAt;
      if (terminal(member.state)) continue;
      counts.activeCount++;
      if (member.state === 'working') counts.workingCount++;
      else if (member.state === 'waiting') counts.waitingCount++;
      else counts.unknownCount++;
    }
    const turnId = this.batch?.id ?? null;
    if (counts.workingCount) return this.compose('working', turnId, updatedAt, counts);
    if (counts.waitingCount) return this.compose('waiting', turnId, updatedAt, counts);
    if (counts.unknownCount) return this.compose('unknown', turnId, updatedAt, counts, 'active-log-unavailable');
    const unverifiedCount = [...this.records.values()].filter(record => record.unverified).length;
    if (this.discoveryReason || this.omittedCount || unverifiedCount) {
      return this.compose('unknown', turnId, updatedAt, counts, this.discoveryReason || (this.omittedCount ? 'work-capacity-exceeded' : 'unverified-root-log'));
    }
    if (members.length) {
      if (!this.batch.terminalState) {
        this.batch.terminalState = members.some(member => member.state === 'interrupted') ? 'interrupted' : 'complete';
        this.batch.terminalAt = this.now();
      }
      if (this.now() - this.batch.terminalAt < this.terminalHoldMs) {
        return this.compose(this.batch.terminalState, turnId, new Date(this.batch.terminalAt).toISOString(), counts);
      }
    }
    // Old unfinished records are diagnostic staleCount entries, not immortal
    // active ghosts. Discovery errors never manufacture a completion event.
    if (!this.hasSessionBoundary && !this.batch) return this.compose('unknown', null, null, counts, this.boundaryReason);
    return this.compose('idle', null, null, counts, 'no-observed-work');
  }

  publish() {
    this.value = this.aggregate();
    const key = JSON.stringify(this.value);
    if (key !== this.lastPublished) { this.lastPublished = key; this.onChange(this.snapshot()); }
  }

  tick() {
    if (this.closed) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = (async () => {
      await this.discover();
      await this.poll([...this.records.values()].filter(record => this.now() >= record.nextPollAt));
      const members = this.batch ? [...this.batch.members.values()] : [];
      if (members.length && !this.batch.terminalState && members.every(member => terminal(member.state))
        && this.now() - this.batch.lastFinalDiscoveryAt >= this.discoveryMs) {
        this.batch.lastFinalDiscoveryAt = this.now();
        await this.discover(true);
        // Existing terminal/idle roots can also have a new turn appended since
        // their slower poll. Discovery marks changed files immediately due.
        const due = [...this.records.values()].filter(record => this.now() >= record.nextPollAt);
        if (due.length) await this.poll(due);
      }
      if (!this.closed) this.publish();
    })().finally(() => { this.pending = null; });
    return this.pending;
  }

  usageSnapshot(threadId) {
    if (threadId !== undefined) {
      try {
        const usage = this.records.get(threadId)?.watcher.usageSnapshot?.();
        if (usage) return usage;
      } catch { /* The caller receives explicit unknown, never another root. */ }
      return { source: 'local-codex-rollout', threadId, account: unknownAccount() };
    }
    let account = unknownAccount();
    let latestAt = null;
    let fingerprint = null;
    let conflict = false;
    for (const record of this.records.values()) {
      let usage;
      try { usage = record.watcher.usageSnapshot?.(); } catch { continue; }
      const raw = usage?.account;
      const at = accountTime(raw);
      if (!this.withinBoundary(at) || latestAt !== null && at < latestAt) continue;
      const observedAt = new Date(at).toISOString();
      const sample = { ...unknownAccount('not-reported', observedAt),
        planType: typeof raw?.planType === 'string' ? raw.planType : null,
        ...Object.fromEntries(accountKeys.filter(key => raw?.[key] && typeof raw[key] === 'object')
          .map(key => [key, { ...raw[key] }])) };
      const nextFingerprint = accountFingerprint(sample);
      if (latestAt === null || at > latestAt) {
        account = sample; latestAt = at; fingerprint = nextFingerprint; conflict = false;
      } else if (nextFingerprint !== fingerprint) {
        conflict = true;
      }
    }
    // Root logs may duplicate an account notification. Conflicting events with
    // equal timestamps cannot be ordered, so neither is a safe shared balance.
    if (conflict) account = unknownAccount('conflicting-account-samples', new Date(latestAt).toISOString());
    return { source: 'local-codex-rollout', threadId: 'codex', account };
  }

  async start() {
    await this.tick();
    if (!this.closed && !this.timer) { this.timer = setInterval(() => void this.tick(), this.intervalMs); this.timer.unref?.(); }
    return this;
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.pending;
    await concurrent([...this.records.values()], this.maxConcurrent, async record => { await record.watcher.close(); });
  }
}
