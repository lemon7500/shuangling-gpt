import test from 'node:test';
import assert from 'node:assert/strict';
import { CurrentAccountUsage, readAuthFileStamp } from '../../src/bridge/current-account.mjs';

const at = Date.parse('2026-10-24T06:00:00Z');
const slot = (minutes, usedPercent = 7) => ({ usedPercent, windowDurationMins: minutes, resetsAt: at / 1000 + 86400 });
const fixture = (name = 'a', planType = 'pro', used = 7) => ({
  account: { type: 'chatgpt', email: `${name}@PRIVATE.example`, planType },
  quota: { accountId: `PRIVATE-ID-${name}`, rateLimitsByLimitId: { codex: { limitId: 'codex', planType, primary: planType === 'plus' ? slot(300, 20) : slot(10080, used), secondary: planType === 'plus' ? slot(10080, used) : null, credits: { balance: 'PRIVATE-CREDIT' } } } },
});
function harness(options = {}) {
  let now = at, stamp = 'auth-a', current = fixture(), error = null;
  const calls = [], clients = [], intervals = new Map();
  const service = new CurrentAccountUsage({
    codexHome: 'D:/fixture-only', now: () => now,
    readAuthStamp: async () => { if (error) throw error; return stamp; },
    setIntervalFn: callback => { const id = intervals.size + 1; intervals.set(id, callback); return id; },
    clearIntervalFn: id => intervals.delete(id),
    transportFactory: async ({ signal }) => {
      const captured = current;
      const client = { closed: false, async call(method, params) {
        calls.push({ method, params });
        return method === 'account/read' ? { account: captured.account } : captured.quota;
      }, close() { this.closed = true; } };
      clients.push(client); return client;
    }, ...options,
  });
  return { service, calls, clients, intervals,
    advance: ms => { now += ms; }, setAccount: value => { current = value; },
    setStamp: value => { stamp = value; }, setError: value => { error = value; },
  };
}

test('current account switches Plus to Pro to Max without a chat request and never exports identity', async t => {
  const h = harness(); t.after(() => h.service.close());
  for (const [index, plan] of ['plus', 'pro', 'max'].entries()) {
    h.setAccount(fixture(plan, plan, 7 + index)); h.setStamp(plan);
    await h.service.tick();
    assert.equal(h.service.snapshot().weekly.status, 'unknown', 'an auth change clears the prior balance before the new request returns');
    await h.service.settle();
    const value = h.service.snapshot();
    assert.equal(value.planType, plan);
    assert.equal(value.weekly.remainingPercent, 93 - index);
    assert.equal(value.fiveHour.status, plan === 'plus' ? 'available' : 'not-applicable');
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE|email|accountId|credits/);
  }
  assert.ok(h.calls.every(call => ['account/read', 'account/rateLimits/read'].includes(call.method)));
  assert.deepEqual(h.calls.filter(call => call.method === 'account/read').map(call => call.params), Array(6).fill({ refreshToken: false }));
});

test('same-plan account replacement refreshes ownership instead of keeping the old account percentage', async t => {
  const h = harness(); t.after(() => h.service.close()); await h.service.start(); await h.service.settle();
  assert.equal(h.service.snapshot().weekly.remainingPercent, 93);
  h.setAccount(fixture('b', 'pro', 60)); h.setStamp('auth-b'); await h.service.tick();
  assert.equal(h.service.snapshot().weekly.remainingPercent, undefined);
  await h.service.settle(); assert.equal(h.service.snapshot().weekly.remainingPercent, 40);
  assert.equal(h.clients.length, 2); assert.ok(h.clients.every(client => client.closed));
});

test('auth replacement cancels an old slow response and cannot overwrite the new account', async t => {
  let releaseOld, made = 0;
  const old = fixture('old', 'plus', 90), next = fixture('new', 'max', 10);
  const h = harness({ transportFactory: async () => {
    const index = made++, captured = index === 0 ? old : next;
    return { call: async method => method === 'account/read' ? { account: captured.account }
      : index === 0 ? new Promise(resolve => { releaseOld = () => resolve(captured.quota); }) : captured.quota, close() {} };
  } });
  t.after(() => h.service.close()); await h.service.tick();
  for (let count = 0; !releaseOld && count < 10; count++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(releaseOld);
  h.setStamp('new-auth'); await h.service.tick(); await h.service.settle();
  assert.equal(h.service.snapshot().weekly.remainingPercent, 90);
  assert.equal(h.service.snapshot().fiveHour.status, 'not-applicable');
  releaseOld(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.service.snapshot().weekly.remainingPercent, 90);
});

test('identity, plan and auth stamp are rechecked before a quota is committed', async t => {
  for (const fault of ['identity', 'plan', 'stamp', 'bucket', 'account-id']) {
    const a = fixture(), b = fixture('b', 'max'); let reads = 0, stamp = 'a';
    const h = harness({ readAuthStamp: async () => stamp, transportFactory: async () => ({
      async call(method) {
        if (method === 'account/read') return { account: fault === 'identity' && ++reads > 1 ? b.account : a.account };
        if (fault === 'stamp') stamp = 'b';
        if (fault === 'plan') return { ...a.quota, rateLimitsByLimitId: { codex: { ...a.quota.rateLimitsByLimitId.codex, planType: 'max' } } };
        if (fault === 'bucket') return { ...a.quota, rateLimitsByLimitId: { other: a.quota.rateLimitsByLimitId.codex } };
        if (fault === 'account-id') return { ...a.quota, accountId: undefined };
        return a.quota;
      }, close() {},
    }) });
    t.after(() => h.service.close());
    await h.service.tick(); await h.service.settle();
    assert.equal(h.service.snapshot().weekly.status, 'unknown', fault);
  }
});

test('missing auth, permission loss, disconnect and logout clear a prior balance without fallback', async t => {
  const h = harness(); t.after(() => h.service.close()); await h.service.tick(); await h.service.settle();
  for (const code of ['EACCES', 'ENOENT']) {
    h.setError(Object.assign(Error('PRIVATE-ERROR'), { code })); await h.service.tick();
    const value = h.service.snapshot(); assert.equal(value.weekly.status, 'unknown');
    assert.equal(value.weekly.remainingPercent, undefined); assert.doesNotMatch(JSON.stringify(value), /PRIVATE-ERROR/);
    h.setError(null); h.setStamp(code); await h.service.tick(); await h.service.settle();
    assert.equal(h.service.snapshot().weekly.remainingPercent, 93);
  }
  const offline = harness({ transportFactory: async () => { throw Error('PRIVATE-CONNECTION'); } });
  t.after(() => offline.service.close()); await offline.service.tick(); await offline.service.settle();
  assert.equal(offline.service.snapshot().weekly.status, 'unknown');
  const loggedOut = harness({ transportFactory: async () => ({ call: async () => ({ account: null }), close() {} }) });
  t.after(() => loggedOut.service.close()); await loggedOut.service.tick(); await loggedOut.service.settle();
  assert.equal(loggedOut.service.snapshot().fiveHour.status, 'unknown');
});

test('periodic refresh, bounded retries and freshness need no model request or chat selection', async t => {
  let fail = false, attempts = 0;
  const h = harness({ transportFactory: async () => {
    attempts++;
    if (fail) throw Error('unavailable'); const value = fixture();
    return { call: async method => method === 'account/read' ? { account: value.account } : value.quota, close() {} };
  } });
  t.after(() => h.service.close()); await h.service.start(); await h.service.settle();
  const first = h.service.snapshot().observedAt;
  h.advance(30001); await h.service.tick(); await h.service.settle();
  assert.notEqual(h.service.snapshot().observedAt, first);
  h.advance(301000); assert.equal(h.service.snapshot().weekly.status, 'stale');
  fail = true; await h.service.tick(); await h.service.settle();
  assert.equal(h.service.snapshot().weekly.status, 'unknown');
  const attempt = attempts;
  for (let count = 0; count < 5; count++) { await h.service.tick(); await h.service.settle(); }
  assert.equal(attempts, attempt);
  h.advance(1000); await h.service.tick(); await h.service.settle();
  assert.equal(attempts, attempt + 1);
  assert.equal(h.intervals.size, 1);
});

test('start does not wait for account RPC, and close aborts work and stops subsequent polling', async () => {
  let closed = 0;
  const h = harness({ transportFactory: async () => ({ call: () => new Promise(() => {}), close() { closed++; } }) });
  await h.service.start(); assert.equal(h.intervals.size, 1);
  await h.service.close(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.intervals.size, 0); assert.equal(closed, 1);
  await h.service.tick(); assert.equal(closed, 1);
  assert.equal(h.service.snapshot().weekly.status, 'unknown');
});

test('auth file stamps use metadata only and detect atomic replacement even with equal size and mtime', async () => {
  let ino = 1n, location, options;
  const stat = async (path, opts) => { location = path; options = opts; return { isFile: () => true, dev: 1n, ino, size: 100n, mtimeNs: 200n, ctimeNs: 300n }; };
  const a = await readAuthFileStamp('D:/safe', stat); ino = 2n;
  const b = await readAuthFileStamp('D:/safe', stat);
  assert.notEqual(a, b); assert.match(location.replaceAll('\\', '/'), /D:\/safe\/auth.json$/);
  assert.deepEqual(options, { bigint: true });
});
