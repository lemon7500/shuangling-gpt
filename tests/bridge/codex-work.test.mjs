import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexWorkWatcher } from '../../src/bridge/codex-work.mjs';
import { RolloutWatcher } from '../../src/bridge/rollouts.mjs';

const at = Date.parse('2026-10-24T05:00:00Z');
const timestamp = value => new Date(value).toISOString();
function fake(t, options = {}) {
  let now = at, discovers = 0, parallel = 0, maxParallel = 0;
  const roots = new Map(), made = [], events = [];
  const home = join(tmpdir(), 'codex-work-fake');
  const metadata = { index: new Map(), indexAt: -Infinity, indexProblem: null, refreshIndex: async () => {
    discovers++; options.discover?.(discovers);
    metadata.index = new Map([...roots].map(([id, root]) => [id, root.entry]));
  } };
  const add = (id, state = 'working', extra = {}) => {
    const root = { state, turnId: `${id}-turn`, updatedAt: timestamp(now), reason: null, count: 0, ...extra };
    root.entry = { path: join(home, extra.archived ? 'archived_sessions' : 'sessions', `rollout-${id}.jsonl`),
      mtimeMs: extra.mtimeMs ?? now, metadata: { id, source: 'root', ...extra.metadata } };
    roots.set(id, root); return root;
  };
  const watcherFactory = async ({ threadId }) => {
    const root = roots.get(threadId); made.push(threadId);
    let latest = { state: 'unknown', threadId, turnId: null, updatedAt: null };
    return { path: null, tick: async () => {
      root.count++; parallel++; maxParallel = Math.max(maxParallel, parallel);
      try {
        if (root.delay) await new Promise(resolve => setTimeout(resolve, root.delay));
        if (root.fail) throw Error('PRIVATE ERROR');
        latest = { state: root.state, threadId, turnId: root.turnId, rootTurnId: root.turnId, updatedAt: root.updatedAt, reason: root.reason };
      } finally { parallel--; }
    }, snapshot: () => latest, usageSnapshot: () => root.usage ?? { context: { status: 'unknown' }, account: {} }, close: async () => { root.closed = true; } };
  };
  const watcher = new CodexWorkWatcher({ codexHome: home, threadId: 'diagnostic', metadataReader: metadata, watcherFactory,
    now: () => now, sessionStartedAt: at - 60000, terminalHoldMs: 1000, onChange: value => events.push(value), ...options });
  t.after(() => watcher.close());
  const change = (id, state, extra = {}) => { const root = roots.get(id); Object.assign(root, { state, updatedAt: timestamp(now), ...extra }); root.entry.mtimeMs = now; return root; };
  return { watcher, roots, add, change, made, events, metadata, advance: ms => { now += ms; }, get discovers() { return discovers; }, get maxParallel() { return maxParallel; }, get now() { return now; } };
}

test('all verified roots share one stable working batch, with working ahead of waiting', async t => {
  const f = fake(t); f.add('a'); f.add('b', 'waiting');
  await f.watcher.tick();
  const first = f.watcher.snapshot();
  assert.equal(first.scope, 'codex'); assert.equal(first.threadId, 'codex'); assert.equal(first.sourceThreadId, 'diagnostic');
  assert.equal(first.state, 'working'); assert.equal(first.activeCount, 2); assert.equal(first.workingCount, 1); assert.equal(first.waitingCount, 1);
  f.advance(301); f.change('a', 'waiting'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'waiting'); assert.equal(f.watcher.snapshot().waitingCount, 2);
  assert.equal(f.watcher.snapshot().turnId, first.turnId);
  f.watcher.setDiagnosticThread('another-source');
  f.advance(301); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().threadId, 'codex'); assert.equal(f.watcher.snapshot().turnId, first.turnId);
});

test('one root finishing cannot complete another working or waiting root', async t => {
  const f = fake(t); f.add('a'); f.add('b'); await f.watcher.tick();
  const turn = f.watcher.snapshot().turnId;
  f.advance(301); f.change('a', 'complete'); f.change('b', 'waiting'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'waiting'); assert.equal(f.watcher.snapshot().activeCount, 1);
  assert.equal(f.events.filter(value => value.state === 'complete').length, 0);
  f.advance(301); f.change('b', 'complete'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'complete'); assert.equal(f.watcher.snapshot().turnId, turn);
  f.advance(301); await f.watcher.tick();
  assert.equal(f.events.filter(value => value.state === 'complete').length, 1);
  f.advance(1000); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'idle'); assert.equal(f.watcher.snapshot().reason, 'no-observed-work');
  f.advance(5001); await f.watcher.tick();
  assert.equal(f.events.filter(value => value.state === 'complete').length, 1);
});

test('a cancelled member yields one global interrupted result after other work explicitly ends', async t => {
  const f = fake(t); f.add('a'); f.add('b', 'waiting'); await f.watcher.tick();
  f.advance(301); f.change('a', 'interrupted'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'waiting');
  f.advance(301); f.change('b', 'complete'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'interrupted');
  f.advance(301); await f.watcher.tick();
  assert.equal(f.events.filter(value => value.state === 'interrupted').length, 1);
});

test('history terminals and stale unfinished ghosts cannot generate startup work or celebrations', async t => {
  const f = fake(t);
  f.add('done', 'complete'); f.add('aborted', 'interrupted');
  f.add('old-untouched', 'working', { mtimeMs: at - 3600000, updatedAt: timestamp(at - 3600000) });
  f.add('old-touched', 'working', { updatedAt: timestamp(at - 3600000) });
  f.add('archive', 'working', { archived: true });
  await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'idle'); assert.equal(f.watcher.snapshot().activeCount, 0);
  assert.equal(f.watcher.snapshot().staleCount, 1); assert.equal(f.watcher.snapshot().unknownCount, 0);
  assert.ok(!f.made.includes('old-untouched')); assert.ok(!f.made.includes('archive'));
  assert.ok(!f.events.some(value => ['complete', 'interrupted'].includes(value.state)));
  f.advance(5001); f.change('old-touched', 'working', { turnId: 'fresh-turn' }); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'working'); assert.equal(f.watcher.snapshot().activeCount, 1);
});

test('subagent, guardian, parented and object-source entries are excluded even with fresh timestamps', async t => {
  const f = fake(t); f.add('root');
  f.add('child', 'working', { metadata: { source: 'subagent' } });
  f.add('guardian', 'working', { metadata: { thread_source: 'guardian_review' } });
  f.add('parented', 'working', { metadata: { parentThreadId: 'root' } });
  f.add('object', 'working', { metadata: { source: { subagent: { other: 'guardian' } } } });
  await f.watcher.tick();
  assert.deepEqual(f.made, ['root']); assert.equal(f.watcher.snapshot().activeCount, 1);
});

test('new root discovery joins an active batch without restarting its global turn', async t => {
  const f = fake(t); f.add('a'); await f.watcher.tick();
  const turn = f.watcher.snapshot().turnId;
  f.advance(1000); f.add('b'); await f.watcher.tick(); assert.equal(f.made.length, 1);
  f.advance(4001); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().activeCount, 2); assert.equal(f.watcher.snapshot().turnId, turn);
  assert.equal(f.discovers, 2);
});

test('a final transition refreshes discovery and notices new work in an existing slow-polled root', async t => {
  const f = fake(t); f.add('a'); f.add('b', 'complete'); await f.watcher.tick();
  f.advance(301); f.change('a', 'complete'); f.change('b', 'working', { turnId: 'b-next' }); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'working'); assert.equal(f.watcher.snapshot().activeCount, 1);
  assert.equal(f.events.filter(value => value.state === 'complete').length, 0);
  assert.equal(f.discovers, 2);
});

test('active permission loss becomes unknown and blocks completion until explicit recovery', async t => {
  const f = fake(t); f.add('a'); const b = f.add('b'); await f.watcher.tick();
  const turn = f.watcher.snapshot().turnId;
  f.advance(301); f.change('a', 'complete'); b.fail = true; await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'unknown'); assert.equal(f.watcher.snapshot().unknownCount, 1);
  assert.equal(f.watcher.snapshot().activeCount, 1); assert.equal(f.watcher.snapshot().turnId, turn);
  f.advance(24 * 3600000); await f.watcher.tick(); assert.equal(f.watcher.snapshot().state, 'unknown');
  b.fail = false; f.advance(301); f.change('b', 'waiting'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'waiting'); assert.equal(f.watcher.snapshot().turnId, turn);
  f.advance(301); f.change('b', 'complete'); await f.watcher.tick(); assert.equal(f.watcher.snapshot().state, 'complete');
});

test('silence never finishes admitted work, and a new batch gets a new turn identifier', async t => {
  const f = fake(t); f.add('a'); await f.watcher.tick(); const oldTurn = f.watcher.snapshot().turnId;
  f.advance(7 * 86400000); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'working'); assert.equal(f.watcher.snapshot().turnId, oldTurn);
  f.advance(301); f.change('a', 'complete'); await f.watcher.tick();
  f.advance(5001); f.change('a', 'working', { turnId: 'new-task' }); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'working'); assert.notEqual(f.watcher.snapshot().turnId, oldTurn);
});

test('a missing explicit terminal before another same-chat turn cannot fabricate global completion', async t => {
  const f = fake(t); f.add('a'); await f.watcher.tick();
  f.advance(301); f.change('a', 'working', { turnId: 'a-next' }); await f.watcher.tick();
  f.advance(301); f.change('a', 'complete'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'unknown'); assert.equal(f.watcher.snapshot().unknownCount, 1);
  assert.equal(f.events.filter(value => value.state === 'complete').length, 0);
});

test('initial root replays are concurrency bounded and closed without child timers', async t => {
  const f = fake(t, { maxConcurrent: 3 });
  for (let i = 0; i < 11; i++) f.add(`a${i}`, 'working', { delay: 5 });
  const first = f.watcher.tick(), next = f.watcher.tick(); assert.equal(first, next);
  await first; assert.equal(f.maxParallel, 3); assert.equal(f.watcher.snapshot().activeCount, 11);
  await f.watcher.close(); assert.ok([...f.roots.values()].every(root => root.closed));
});

test('discovery uncertainty blocks a final celebration and retries at discovery frequency', async t => {
  const f = fake(t); f.add('a'); await f.watcher.tick();
  f.advance(301); f.change('a', 'complete'); f.metadata.indexProblem = 'log-permission-denied'; await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'unknown'); assert.equal(f.watcher.snapshot().reason, 'log-permission-denied');
  const scans = f.discovers;
  f.advance(301); await f.watcher.tick();
  f.advance(301); await f.watcher.tick();
  assert.equal(f.discovers, scans); assert.equal(f.events.filter(value => value.state === 'complete').length, 0);
  f.metadata.indexProblem = null; f.advance(5001); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'complete');
  assert.equal(f.events.filter(value => value.state === 'complete').length, 1);
});

test('bounded-capacity omissions cannot claim the unobserved work is finished', async t => {
  const f = fake(t, { maxWatchers: 1 }); f.add('a'); f.add('b'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'working'); assert.equal(f.watcher.snapshot().omittedCount, 1);
  f.advance(301); f.change('a', 'complete'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'unknown'); assert.equal(f.watcher.snapshot().reason, 'work-capacity-exceeded');
  assert.equal(f.events.filter(value => value.state === 'complete').length, 0);
});

test('an initially unknown but verified recent turn stays unresolved until a readable explicit ending', async t => {
  const f = fake(t); f.add('a', 'unknown', { reason: 'log-format-incompatible' }); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'unknown'); assert.equal(f.watcher.snapshot().activeCount, 1);
  assert.equal(f.watcher.snapshot().unknownCount, 1);
  f.advance(301); f.change('a', 'waiting'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'waiting');
  f.advance(301); f.change('a', 'complete'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'complete');
});

test('without a proven lifecycle boundary old activity is not claimed as the current app session', async t => {
  const f = fake(t, { sessionStartedAt: undefined });
  f.add('old-untouched', 'working', { mtimeMs: at - 1000, updatedAt: timestamp(at - 1000) });
  const touched = f.add('old-touched', 'working', { updatedAt: timestamp(at - 1000) });
  touched.usage = { context: { sample: 'last-model-request', observedAt: timestamp(at - 1) },
    account: { weekly: { status: 'available', observedAt: timestamp(at - 1), remainingPercent: 70 } } };
  await f.watcher.tick();
  const initial = f.watcher.snapshot();
  assert.equal(initial.state, 'unknown'); assert.equal(initial.activeCount, 0);
  assert.equal(initial.source, 'codex-local-root-events/since-observer-start');
  assert.equal(initial.boundaryReason, 'session-boundary-unavailable');
  assert.equal(initial.reason, 'session-boundary-unavailable');
  assert.ok(!f.made.includes('old-untouched'));
  assert.equal(f.watcher.usageSnapshot().account.weekly.status, 'unknown');
  f.advance(5001); f.add('new'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'working'); assert.equal(f.watcher.snapshot().activeCount, 1);
  assert.equal(f.watcher.snapshot().boundaryReason, 'session-boundary-unavailable');
  f.advance(301); f.change('new', 'complete'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'complete');
  f.advance(1001); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'idle');
  assert.equal(f.watcher.snapshot().source, 'codex-local-root-events/since-observer-start');
});

test('invalid or future lifecycle boundaries degrade to observer coverage instead of backdating trust', async t => {
  for (const sessionStartedAt of ['not-a-time', at + 10000, -1]) {
    const f = fake(t, { sessionStartedAt }); f.add(`root-${String(sessionStartedAt)}`);
    await f.watcher.tick();
    assert.equal(f.watcher.snapshot().state, 'unknown'); assert.equal(f.watcher.snapshot().activeCount, 0);
    assert.equal(f.watcher.snapshot().boundaryReason, 'session-boundary-unavailable');
  }
});

test('an unreadable discovered candidate without a turn ID blocks a premature ending without fabricating a task', async t => {
  const f = fake(t); f.add('a'); f.add('broken', 'unknown', { turnId: null, updatedAt: null, reason: 'log-format-incompatible' });
  await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'working'); assert.equal(f.watcher.snapshot().unverifiedCount, 1);
  assert.equal(f.watcher.batch.members.has('broken'), false);
  f.advance(301); f.change('a', 'complete'); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'unknown'); assert.equal(f.watcher.snapshot().reason, 'unverified-root-log');
  assert.equal(f.events.filter(value => value.state === 'complete').length, 0);
  f.advance(301); f.change('broken', 'idle', { turnId: null }); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state, 'complete'); assert.equal(f.watcher.snapshot().unverifiedCount, 0);
  assert.equal(f.watcher.batch.members.has('broken'), false);
});

test('unified account snapshots choose recent verified sources without changing with diagnostic focus', async t => {
  const f = fake(t); const a = f.add('a'); const b = f.add('b');
  a.usage = { account: { weekly: { status: 'available', observedAt: timestamp(at - 1000), remainingPercent: 70 } } };
  b.usage = { account: { weekly: { status: 'available', observedAt: timestamp(at), remainingPercent: 65 } } };
  await f.watcher.tick();
  assert.equal(f.watcher.usageSnapshot().account.weekly.remainingPercent, 65);
  f.watcher.setDiagnosticThread('a'); assert.equal(f.watcher.usageSnapshot().account.weekly.remainingPercent, 65);
  assert.equal(f.watcher.usageSnapshot('a').account.weekly.remainingPercent, 70);
  b.usage.account.weekly = { status: 'stale', reason: 'sample-expired', observedAt: timestamp(at) };
  assert.equal(f.watcher.usageSnapshot().account.weekly.status, 'stale');
  assert.equal(f.watcher.usageSnapshot().account.weekly.remainingPercent, undefined);
  assert.equal(f.watcher.usageSnapshot('missing').account.weekly.status, 'unknown');
});

function quotaAccount(time, { planType = 'plus', fiveHour = 80, weekly = 93, status = 'available', reason } = {}) {
  const observedAt = timestamp(time);
  const window = (minutes, remainingPercent) => status !== 'available'
    ? { status, reason, observedAt }
    : remainingPercent === null ? { status: 'not-applicable', reason: 'window-not-applicable', observedAt }
      : { status, observedAt, windowMinutes: minutes, remainingPercent, usedPercent: 100 - remainingPercent,
        resetsAt: Math.floor(at / 1000) + minutes * 60, ageSeconds: 0 };
  return { observedAt, planType, fiveHour: window(300, fiveHour), weekly: window(10080, weekly) };
}

test('shared quota switches the complete account event and never revives an older five-hour window', async t => {
  const f = fake(t), old = f.add('old'), current = f.add('current');
  old.usage = { account: quotaAccount(at - 1000) };
  current.usage = { account: quotaAccount(at, { planType: 'pro', fiveHour: null, weekly: 87 }) };
  await f.watcher.tick();
  const shared = f.watcher.usageSnapshot().account;
  assert.equal(shared.observedAt, timestamp(at));
  assert.equal(shared.planType, 'pro');
  assert.equal(shared.fiveHour.status, 'not-applicable');
  assert.equal(shared.fiveHour.remainingPercent, undefined);
  assert.equal(shared.weekly.remainingPercent, 87);
  f.watcher.setDiagnosticThread('old');
  assert.deepEqual(f.watcher.usageSnapshot().account, shared);
});

test('newer unknown, permission failures and expired account events never fall back to an older balance', async t => {
  const f = fake(t), old = f.add('old'), current = f.add('current');
  old.usage = { account: quotaAccount(at - 1000) };
  current.usage = { account: quotaAccount(at) };
  await f.watcher.tick();
  for (const [status, reason] of [['unknown', 'not-reported'], ['unknown', 'log-permission-denied'],
    ['stale', 'sample-expired'], ['stale', 'reset-passed']]) {
    current.usage.account = quotaAccount(at, { status, reason });
    const shared = f.watcher.usageSnapshot().account;
    for (const key of ['fiveHour', 'weekly']) {
      assert.equal(shared[key].status, status);
      assert.equal(shared[key].reason, reason);
      assert.equal(shared[key].remainingPercent, undefined);
    }
  }
});

test('equivalent account notifications deduplicate despite independently changing age', async t => {
  const f = fake(t), a = f.add('a'), b = f.add('b');
  a.usage = { account: quotaAccount(at) };
  b.usage = { account: quotaAccount(at) };
  b.usage.account.fiveHour.ageSeconds = 2;
  b.usage.account.weekly.ageSeconds = 3;
  await f.watcher.tick();
  const shared = f.watcher.usageSnapshot().account;
  assert.equal(shared.fiveHour.remainingPercent, 80);
  assert.equal(shared.weekly.remainingPercent, 93);
});

test('same-time quota conflicts invalidate the entire event independent of root insertion order', async t => {
  const variants = [
    { planType: 'pro', fiveHour: null, weekly: 87 },
    { weekly: 87 },
    { planType: 'pro' },
    { status: 'unknown', reason: 'log-permission-denied' },
    { status: 'stale', reason: 'sample-expired' },
  ];
  for (const change of variants) for (const reversed of [false, true]) {
    const f = fake(t), a = f.add('a'), b = f.add('b');
    a.usage = { account: quotaAccount(at) };
    b.usage = { account: quotaAccount(at, change) };
    await f.watcher.tick();
    if (reversed) f.watcher.records = new Map([...f.watcher.records].reverse());
    const shared = f.watcher.usageSnapshot().account;
    assert.equal(shared.observedAt, timestamp(at));
    assert.equal(shared.planType, null);
    for (const key of ['fiveHour', 'weekly']) {
      assert.equal(shared[key].status, 'unknown');
      assert.equal(shared[key].reason, 'conflicting-account-samples');
      assert.equal(shared[key].remainingPercent, undefined);
    }
  }
});

test('a newer complete quota event resolves older conflicts without leaking pre-session or future samples', async t => {
  const f = fake(t), a = f.add('a'), b = f.add('b'), current = f.add('current'), future = f.add('future');
  a.usage = { account: quotaAccount(at - 1000) };
  b.usage = { account: quotaAccount(at - 1000, { weekly: 87 }) };
  current.usage = { account: quotaAccount(at, { planType: 'pro', fiveHour: null, weekly: 86 }) };
  future.usage = { account: quotaAccount(at + 61_000, { weekly: 99 }) };
  await f.watcher.tick();
  let shared = f.watcher.usageSnapshot().account;
  assert.equal(shared.weekly.remainingPercent, 86);
  assert.equal(shared.fiveHour.status, 'not-applicable');
  current.usage.account = quotaAccount(at - 61_000, { weekly: 100 });
  f.watcher.records.delete('a'); f.watcher.records.delete('b');
  shared = f.watcher.usageSnapshot().account;
  assert.equal(shared.weekly.status, 'unknown');
  assert.equal(shared.weekly.remainingPercent, undefined);
});

test('real append-only root logs aggregate without exposing payloads or spawning child watcher timers', async t => {
  const home = await fs.mkdtemp(join(tmpdir(), 'shuangling-codex-work-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(join(home, 'sessions'));
  let now = Date.now();
  const line = (type, payload) => JSON.stringify({ type, timestamp: timestamp(now), payload }) + '\n';
  const root = id => line('session_meta', { id, thread_source: 'user', base_instructions: 'PRIVATE BODY' }) + line('event_msg', { type: 'task_started', turn_id: id });
  const a = join(home, 'sessions', 'rollout-a.jsonl'), b = join(home, 'sessions', 'rollout-b.jsonl');
  await fs.writeFile(a, root('a')); await fs.writeFile(b, root('b'));
  const watcher = new CodexWorkWatcher({ codexHome: home, now: () => now, sessionStartedAt: now - 1000 });
  t.after(() => watcher.close());
  await watcher.tick(); assert.equal(watcher.snapshot().workingCount, 2);
  assert.ok([...watcher.records.values()].every(record => !record.watcher.timer));
  now += 301;
  await fs.appendFile(a, line('event_msg', { type: 'task_complete', turn_id: 'a', last_agent_message: 'PRIVATE BODY' }));
  await fs.appendFile(b, line('response_item', { type: 'function_call', name: 'request_user_input', call_id: 'ask', arguments: 'PRIVATE BODY' }));
  await watcher.tick(); assert.equal(watcher.snapshot().state, 'waiting');
  now += 301; await fs.appendFile(b, line('event_msg', { type: 'turn_aborted', turn_id: 'b' }));
  await watcher.tick(); assert.equal(watcher.snapshot().state, 'interrupted');
  assert.doesNotMatch(JSON.stringify(watcher.snapshot()), /PRIVATE/);
});

test('multiple explicit turn transitions inside one append poll do not strand a completed old turn', async t => {
  const home = await fs.mkdtemp(join(tmpdir(), 'shuangling-codex-turns-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(join(home, 'sessions'));
  let now = Date.now();
  const line = (type, payload) => JSON.stringify({ type, timestamp: timestamp(now), payload }) + '\n';
  const path = join(home, 'sessions', 'rollout-a.jsonl');
  await fs.writeFile(path, line('session_meta', { id: 'a' }) + line('event_msg', { type: 'task_started', turn_id: 't1' }));
  const watcher = new CodexWorkWatcher({ codexHome: home, now: () => now, sessionStartedAt: now - 1000 });
  t.after(() => watcher.close());
  await watcher.tick(); const turn = watcher.snapshot().turnId;
  now += 301;
  await fs.appendFile(path, line('event_msg', { type: 'task_complete', turn_id: 't1' })
    + line('event_msg', { type: 'task_started', turn_id: 't2' }));
  await watcher.tick(); assert.equal(watcher.snapshot().state, 'working'); assert.equal(watcher.snapshot().turnId, turn);
  now += 301;
  await fs.appendFile(path, line('event_msg', { type: 'task_complete', turn_id: 't2' }));
  await watcher.tick(); assert.equal(watcher.snapshot().state, 'complete');
  assert.equal(watcher.batch.members.get('a').unresolvedPrior, false);
});

test('permission recovery replays history only as a final baseline rather than reopening old completed turns', async t => {
  const home = await fs.mkdtemp(join(tmpdir(), 'shuangling-codex-recovery-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(join(home, 'sessions'));
  let now = Date.now(), denied = false;
  const line = (type, payload) => JSON.stringify({ type, timestamp: timestamp(now), payload }) + '\n';
  const path = join(home, 'sessions', 'rollout-a.jsonl');
  await fs.writeFile(path, line('session_meta', { id: 'a' })
    + line('event_msg', { type: 'task_started', turn_id: 'old' }) + line('event_msg', { type: 'task_complete', turn_id: 'old' })
    + line('event_msg', { type: 'task_started', turn_id: 'current' }));
  const fsApi = { ...fs, open: async (...args) => {
    if (denied) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return fs.open(...args);
  } };
  const watcher = new CodexWorkWatcher({ codexHome: home, now: () => now, sessionStartedAt: now - 1000,
    watcherFactory: options => new RolloutWatcher({ ...options, fsApi }) });
  t.after(() => watcher.close());
  await watcher.tick(); const turn = watcher.snapshot().turnId;
  denied = true; now += 301; await watcher.tick(); assert.equal(watcher.snapshot().state, 'unknown');
  denied = false; now += 301; await watcher.tick();
  assert.equal(watcher.snapshot().state, 'working'); assert.equal(watcher.snapshot().turnId, turn);
  assert.equal(watcher.batch.members.get('a').turnId, 'current'); assert.equal(watcher.batch.members.get('a').unresolvedPrior, false);
  now += 301; await fs.appendFile(path, line('event_msg', { type: 'task_complete', turn_id: 'current' }));
  await watcher.tick(); assert.equal(watcher.snapshot().state, 'complete');
});
