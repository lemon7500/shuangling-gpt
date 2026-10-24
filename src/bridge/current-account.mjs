import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { UsageReducer } from './usage.mjs';

const PLANS = new Set(['free', 'go', 'plus', 'pro', 'max', 'team', 'business', 'enterprise', 'edu']);
const unavailable = reason => ({ observedAt: null, planType: null,
  fiveHour: { status: 'unknown', reason, observedAt: null }, weekly: { status: 'unknown', reason, observedAt: null } });
const error = reason => Object.assign(new Error(reason), { accountReason: reason });
const closedClients = new WeakSet();
const closeClient = client => {
  if (!client || !['object', 'function'].includes(typeof client) || closedClients.has(client)) return;
  closedClients.add(client);
  try { client.close?.(); } catch { /* no source data is exposed as an error */ }
};

/** Only metadata is read here. Authentication remains inside the native client. */
export async function readAuthFileStamp(codexHome, statFile = stat) {
  const value = await statFile(join(codexHome, 'auth.json'), { bigint: true });
  if (!value.isFile()) throw error('account-auth-unavailable');
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');
}

function abortable(operation, signal) {
  if (signal.aborted) return Promise.reject(error('account-read-cancelled'));
  let cancel;
  const aborted = new Promise((resolve, reject) => {
    cancel = () => reject(error('account-read-cancelled'));
    signal.addEventListener('abort', cancel, { once: true });
  });
  return Promise.race([operation, aborted]).finally(() => signal.removeEventListener('abort', cancel));
}

/** Numeric quota for the current native authentication epoch, never a chat. */
export class CurrentAccountUsage {
  constructor({ codexHome, transportFactory, readAuthStamp, now = Date.now,
    pollIntervalMs = 1000, refreshIntervalMs = 30000,
    setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
    if (typeof transportFactory !== 'function') throw error('account-transport-required');
    if (!readAuthStamp && (typeof codexHome !== 'string' || !codexHome)) throw error('codex-home-required');
    this.transportFactory = transportFactory;
    this.readAuthStamp = readAuthStamp ?? (() => readAuthFileStamp(codexHome));
    this.now = now;
    this.pollIntervalMs = Math.max(100, Number(pollIntervalMs) || 1000);
    this.refreshIntervalMs = Math.max(1000, Number(refreshIntervalMs) || 30000);
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.secret = randomBytes(32);
    this.generation = 0;
    this.stamp = null;
    this.identity = null;
    this.pending = null;
    this.checking = null;
    this.reducer = null;
    this.value = unavailable('account-source-initializing');
    this.nextRefreshAt = Infinity;
    this.failures = 0;
    this.timer = null;
    this.closed = false;
  }

  invalidate(reason) {
    this.generation++;
    const old = this.pending;
    this.pending = null;
    old?.controller.abort();
    closeClient(old?.client);
    this.identity = null;
    this.reducer = null;
    this.value = unavailable(reason);
  }

  fingerprint(account) {
    if (account?.type !== 'chatgpt' || typeof account.email !== 'string' || !account.email || account.email.length > 1000 || !PLANS.has(account.planType)) {
      throw error(account === null ? 'account-signed-out' : 'account-identity-unavailable');
    }
    return createHmac('sha256', this.secret).update(JSON.stringify([account.type, account.email, account.planType])).digest('hex');
  }

  isCurrent(attempt) { return !this.closed && !attempt.controller.signal.aborted && this.pending === attempt && this.generation === attempt.generation; }

  tick() {
    if (this.closed) return Promise.resolve();
    if (this.checking) return this.checking;
    this.checking = this.checkAuth().finally(() => { this.checking = null; });
    return this.checking;
  }

  async checkAuth() {
    let stamp;
    try {
      stamp = await this.readAuthStamp();
      if (typeof stamp !== 'string' || !stamp) throw error('account-auth-unavailable');
    } catch (cause) {
      if (this.closed) return;
      this.stamp = null;
      this.nextRefreshAt = Infinity;
      this.invalidate(cause?.code === 'ENOENT' ? 'account-signed-out' : 'account-auth-unavailable');
      return;
    }
    if (this.closed) return;
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      this.invalidate('account-changing');
      this.failures = 0;
      this.nextRefreshAt = this.now();
    }
    if (!this.pending && this.now() >= this.nextRefreshAt) this.beginRead();
  }

  beginRead() {
    const attempt = { generation: this.generation, stamp: this.stamp, controller: new AbortController(), client: null, done: null };
    this.pending = attempt;
    this.nextRefreshAt = Infinity;
    attempt.done = this.read(attempt).finally(() => { if (this.pending === attempt) this.pending = null; });
  }

  async read(attempt) {
    const signal = attempt.controller.signal;
    let client;
    try {
      const creating = Promise.resolve().then(() => this.transportFactory({ signal }));
      // A factory may resolve after cancellation. Close it without using it.
      creating.then(value => { if (signal.aborted || this.closed) closeClient(value); }, () => {});
      client = await abortable(creating, signal);
      attempt.client = client;
      if (!this.isCurrent(attempt)) return;
      const before = await abortable(client.call('account/read', { refreshToken: false }), signal);
      const beforeKey = this.fingerprint(before?.account);
      const response = await abortable(client.call('account/rateLimits/read', {}), signal);
      const after = await abortable(client.call('account/read', { refreshToken: false }), signal);
      if (!this.isCurrent(attempt)) return;
      if (beforeKey !== this.fingerprint(after?.account)) throw error('account-changed-during-read');
      const finalStamp = await this.readAuthStamp();
      if (!this.isCurrent(attempt)) return;
      if (finalStamp !== attempt.stamp) {
        this.stamp = typeof finalStamp === 'string' && finalStamp ? finalStamp : null;
        this.invalidate('account-changing');
        this.nextRefreshAt = this.stamp ? this.now() : Infinity;
        return;
      }
      const buckets = response?.rateLimitsByLimitId;
      const bucket = buckets !== undefined && buckets !== null ? buckets.codex : response?.rateLimits;
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket) || (bucket.limitId && bucket.limitId !== 'codex') || bucket.planType !== before.account.planType) {
        throw error('account-quota-unavailable');
      }
      if (typeof response.accountId !== 'string' || !response.accountId || response.accountId.length > 1000) throw error('account-identity-unavailable');
      const limits = { limit_id: 'codex', plan_type: bucket.planType };
      for (const name of ['primary', 'secondary']) {
        if (!Object.hasOwn(bucket, name)) continue;
        const window = bucket[name];
        limits[name] = window === null ? null : { usedPercent: window?.usedPercent, windowDurationMins: window?.windowDurationMins, resetsAt: window?.resetsAt };
      }
      const reducer = new UsageReducer('current-account', { now: this.now });
      reducer.accept({ type: 'session_meta', payload: { id: 'current-account', thread_source: 'user' } });
      reducer.accept({ type: 'event_msg', timestamp: new Date(this.now()).toISOString(), payload: { type: 'token_count', rate_limits: limits } });
      const account = reducer.snapshot().account;
      if (!['fiveHour', 'weekly'].some(name => account[name].status === 'available')) throw error('account-quota-unavailable');
      this.identity = createHmac('sha256', this.secret).update(beforeKey).update(response.accountId).digest('hex');
      this.reducer = reducer;
      this.value = account;
      this.failures = 0;
      this.nextRefreshAt = this.now() + this.refreshIntervalMs;
    } catch (cause) {
      if (!this.isCurrent(attempt)) return;
      this.reducer = null;
      this.identity = null;
      this.value = unavailable(cause?.accountReason ?? 'account-source-unavailable');
      const delays = [1000, 3000, 10000];
      this.nextRefreshAt = this.now() + (delays[this.failures++] ?? this.refreshIntervalMs);
    } finally {
      closeClient(client);
    }
  }

  snapshot() {
    const account = this.reducer ? this.reducer.snapshot(this.now()).account : this.value;
    // These allowlisted numeric values contain no account identity or credits.
    return { ...account, fiveHour: { ...account.fiveHour }, weekly: { ...account.weekly } };
  }

  async start() {
    if (this.closed || this.timer !== null) return;
    await this.tick();
    if (this.closed) return;
    this.timer = this.setIntervalFn(() => { void this.tick(); }, this.pollIntervalMs);
    this.timer?.unref?.();
  }

  async settle() { while (this.pending) await this.pending.done; }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== null) this.clearIntervalFn(this.timer);
    this.timer = null;
    this.invalidate('account-source-closed');
    this.secret.fill(0);
  }
}
