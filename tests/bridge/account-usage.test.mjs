import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageReducer, formatUsageSummary } from '../../src/bridge/usage.mjs';
import { ActiveUsageService } from '../../src/bridge/active-usage.mjs';
import { startSettings } from '../../src/settings/server.mjs';

const at = Date.parse('2026-10-24T05:00:00Z');
const week = { used_percent: 7, window_minutes: 10080, resets_at: at / 1000 + 86400 };
const five = { used_percent: 20, window_minutes: 300, resets_at: at / 1000 + 3600 };
function reducer() {
  const value = new UsageReducer('root', { now: () => at });
  value.accept({ type: 'session_meta', payload: { id: 'root', thread_source: 'user' } });
  return value;
}
const event = (rate_limits, timestamp = at) => ({ type: 'event_msg', timestamp: new Date(timestamp).toISOString(), payload: { type: 'token_count', rate_limits } });

test('complete weekly-only account samples hide the absent 5h window without inventing a balance', () => {
  for (const plan_type of ['pro', 'max', null]) {
    const r = reducer();
    r.accept(event({ limit_id: 'codex', plan_type: 'plus', primary: five, secondary: week }));
    assert.equal(r.snapshot().account.fiveHour.remainingPercent, 80);
    r.accept(event({ limit_id: 'codex', plan_type, primary: week, secondary: null }));
    const usage = r.snapshot();
    assert.equal(usage.account.fiveHour.status, 'not-applicable');
    assert.equal(usage.account.fiveHour.remainingPercent, undefined);
    assert.equal(usage.account.weekly.remainingPercent, 93);
    assert.equal(usage.account.observedAt, new Date(at).toISOString());
    assert.equal(usage.account.planType, plan_type);
    assert.doesNotMatch(formatUsageSummary(usage), /5 小时/);
  }
});

test('explicit windows take precedence over plan names, but missing or invalid telemetry never implies no limit', () => {
  for (const primaryFirst of [true, false]) {
    const r = reducer();
    r.accept(event({ plan_type: 'pro', primary: primaryFirst ? five : week, secondary: primaryFirst ? week : five }));
    assert.equal(r.snapshot().account.fiveHour.remainingPercent, 80);
    assert.equal(r.snapshot().account.weekly.remainingPercent, 93);
  }
  for (const limits of [
    { plan_type: 'plus', primary: week, secondary: null },
    { plan_type: 'pro', primary: week },
    { plan_type: 'pro', primary: { ...week, used_percent: -1 }, secondary: null },
    { plan_type: 'max', primary: week, secondary: { ...five, used_percent: '20' } },
    { plan_type: 'pro', primary: null, secondary: null },
  ]) {
    const r = reducer(); r.accept(event(limits));
    assert.equal(r.snapshot().account.fiveHour.status, 'unknown');
  }
  const r = reducer();
  r.accept(event({ limit_id: 'other', plan_type: 'pro', primary: week, secondary: null }));
  assert.equal(r.snapshot().account.fiveHour.status, 'unknown');
  assert.equal(r.snapshot().account.observedAt, null);
});

test('a reverse-order weekly-only sample and explicit absence retain no percentage through expiration', () => {
  const r = reducer(); r.accept(event({ plan_type: 'max', primary: null, secondary: week }));
  assert.equal(r.snapshot(at + 301000).account.weekly.status, 'stale');
  assert.equal(r.snapshot(at + 301000).account.fiveHour.status, 'not-applicable');
  assert.equal(r.snapshot(at + 301000).account.fiveHour.remainingPercent, undefined);
  r.unavailable('log-permission-denied');
  assert.equal(r.snapshot().account.fiveHour.status, 'unknown');
});

test('shared account endpoint stays responsive while a chosen chat read is pending or fails', async t => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const r = reducer(); r.accept(event({ plan_type: 'pro', primary: week, secondary: null }));
  const service = new ActiveUsageService({
    selectionReader: { snapshot: async () => ({ status: 'available', threadId: 'root' }) },
    projectReader: { snapshot: async () => { await blocked; throw Error('unreadable-chat'); } },
    accountSnapshot: () => r.snapshot().account,
  });
  const ui = await startSettings({
    getState: () => ({}), getUsage: () => service.snapshot(), getAccountUsage: () => service.readAccount(),
    getThreads: () => [], update: () => ({}), getAppearance: () => ({}), setAppearance: () => ({}), shutdown() {},
  });
  t.after(() => ui.close());
  const base = `http://127.0.0.1:${ui.port}`;
  const headers = { 'x-shuangling-token': ui.token };
  const pending = fetch(base + '/api/usage', { headers });
  try {
    assert.equal((await fetch(base + '/api/account-usage')).status, 403);
    assert.equal((await fetch(base + '/api/account-usage', { headers: { ...headers, origin: 'https://invalid.example' } })).status, 403);
    const account = await (await fetch(base + '/api/account-usage', { headers, signal: AbortSignal.timeout(1000) })).json();
    assert.equal(account.weekly.remainingPercent, 93);
    assert.equal(account.fiveHour.status, 'not-applicable');
    assert.equal(account.planType, 'pro');
    assert.equal((await fetch(base + '/api/account-usage', { method: 'POST', headers })).status, 404);
  } finally { release(); await pending; }
  const failedChat = await service.snapshot();
  assert.equal(failedChat.context.status, 'unknown');
  assert.equal(failedChat.account.weekly.remainingPercent, 93);
});
