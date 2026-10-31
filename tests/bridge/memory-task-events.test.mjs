import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { CodexWorkWatcher } from '../../src/bridge/codex-work.mjs';

const START = Date.UTC(2026, 9, 28, 3);
const iso = at => new Date(at).toISOString();
const stableId = (thread, turn) => createHash('sha256').update(JSON.stringify(['shuangling-completed-turn-v1', thread, turn])).digest('hex');

function fixture(t, options = {}) {
  let now = START;
  const home = join(tmpdir(), 'shuangling-memory-fake-home');
  const roots = new Map(), calls = [], statusEvents = [];
  const metadata = { index: new Map(), refreshIndex: async () => {} };
  const add = (thread, state = 'working', extra = {}) => {
    const root = { thread, state, turnId: `${thread}-turn`, updatedAt: iso(now), transitions: [], ...extra };
    root.entry = { path: join(home, 'sessions', `${thread}.jsonl`), mtimeMs: now,
      metadata: { id: thread, source: 'root', ...(extra.metadata ?? {}) } };
    roots.set(thread, root); metadata.index.set(thread, root.entry); return root;
  };
  const watcher = new CodexWorkWatcher({ codexHome: home, now: () => now,
    sessionStartedAt: START - 60000, discoveryMs: 300, metadataReader: metadata,
    onChange: value => statusEvents.push(value), onCompletedTurn: value => calls.push(value),
    watcherFactory: ({ threadId }) => {
      const root = roots.get(threadId);
      let value = { state: 'unknown', threadId, turnId: null, updatedAt: null };
      const reducer = { reset() {}, onChange() {} };
      return { reducer, path: null, tick: async () => {
        if (root.fail) throw new Error('PRIVATE-ERROR');
        if (root.reset) { root.reset = false; reducer.reset(); }
        for (const change of root.transitions.splice(0)) {
          Object.assign(root, change);
          value = { state: root.state, threadId, turnId: root.turnId, updatedAt: root.updatedAt };
          reducer.onChange(value);
        }
        value = { state: root.state, threadId, turnId: root.turnId, updatedAt: root.updatedAt };
      }, snapshot: () => value, usageSnapshot: () => ({ context: { status: 'unknown' } }), close: async () => {} };
    }, ...options });
  t.after(() => watcher.close());
  const change = (thread, state, extra = {}) => {
    const root = roots.get(thread);
    root.transitions.push({ state, updatedAt: iso(now), ...extra }); root.entry.mtimeMs = now;
  };
  return { watcher, roots, add, calls, statusEvents, change,
    advance: (ms = 301) => { now += ms; }, get now() { return now; } };
}

test('memory callback reports a confirmed root turn once, even while another root stays busy', async t => {
  const f = fixture(t); f.add('one'); f.add('two', 'waiting');
  await f.watcher.tick(); assert.deepEqual(f.calls, []);
  f.advance(); f.change('one', 'complete'); await f.watcher.tick();
  assert.deepEqual(f.calls, [{ id: stableId('one', 'one-turn'), at: f.now }]);
  assert.equal(f.watcher.snapshot().state, 'waiting', 'per-turn memory must not complete the whole app');
  f.advance(); f.change('one', 'complete'); await f.watcher.tick();
  assert.equal(f.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(f.calls), /one-turn|thread|PRIVATE|jsonl|sessions/);
});

test('history complete, interrupted and whole initial replay never backfill a memory', async t => {
  const f = fixture(t); f.add('history', 'complete'); f.add('cancelled', 'interrupted');
  const replay = f.add('replay', 'working');
  replay.transitions = [{ state: 'working', turnId: 'first', updatedAt: iso(f.now) },
    { state: 'complete', turnId: 'first', updatedAt: iso(f.now) },
    { state: 'working', turnId: 'second', updatedAt: iso(f.now) },
    { state: 'complete', turnId: 'second', updatedAt: iso(f.now) }];
  await f.watcher.tick(); assert.deepEqual(f.calls, []);
  f.advance(); await f.watcher.tick(); assert.deepEqual(f.calls, []);
});

test('each explicit ordered start and complete in a single append poll is retained', async t => {
  const f = fixture(t); f.add('root'); await f.watcher.tick();
  f.advance();
  f.change('root', 'complete');
  f.change('root', 'working', { turnId: 'second' });
  f.change('root', 'complete', { turnId: 'second' });
  f.change('root', 'waiting', { turnId: 'third' });
  f.change('root', 'complete', { turnId: 'third' });
  await f.watcher.tick();
  assert.deepEqual(f.calls, ['root-turn', 'second', 'third'].map(turn => ({ id: stableId('root', turn), at: f.now })));
  assert.equal(f.watcher.snapshot().state, 'complete');
});

test('unknown-only, interruption, missing previous ending and mismatched terminal do not qualify', async t => {
  for (const kind of ['unknown-only', 'interrupted', 'missing-ending', 'mismatched']) {
    const f = fixture(t), root = f.add(kind, kind === 'unknown-only' ? 'unknown' : 'working');
    await f.watcher.tick(); f.advance();
    if (kind === 'missing-ending') { f.change(kind, 'working', { turnId: 'next' }); await f.watcher.tick(); f.advance(); }
    f.change(kind, kind === 'interrupted' ? 'interrupted' : 'complete', kind === 'mismatched' ? { turnId: 'someone-else' } : {});
    await f.watcher.tick(); assert.deepEqual(f.calls, [], kind);
    assert.ok(root);
  }
});

test('permission uncertainty cannot end a turn, while a later readable explicit ending can', async t => {
  const f = fixture(t), root = f.add('root'); await f.watcher.tick();
  f.advance(); root.fail = true; await f.watcher.tick(); assert.deepEqual(f.calls, []);
  assert.equal(f.watcher.snapshot().state, 'unknown');
  f.advance(); root.fail = false; f.change('root', 'working'); await f.watcher.tick();
  f.advance(); f.change('root', 'complete'); await f.watcher.tick(); assert.equal(f.calls.length, 1);
});

test('rotation or permission-recovery history replay never emits a remembered completion', async t => {
  const f = fixture(t), root = f.add('root'); await f.watcher.tick();
  f.advance(); root.reset = true;
  f.change('root', 'working'); f.change('root', 'complete'); await f.watcher.tick();
  assert.deepEqual(f.calls, []);
  f.advance(); f.change('root', 'complete'); await f.watcher.tick(); assert.deepEqual(f.calls, []);
  f.advance(); f.change('root', 'working', { turnId: 'fresh' }); await f.watcher.tick();
  f.advance(); f.change('root', 'complete'); await f.watcher.tick();
  assert.deepEqual(f.calls, [{ id: stableId('root', 'fresh'), at: f.now }]);
});

test('subagents and stale roots cannot generate memory facts', async t => {
  const f = fixture(t);
  f.add('child', 'working', { metadata: { source: 'subagent' } });
  f.add('parented', 'working', { metadata: { parentThreadId: 'parent' } });
  f.add('guardian', 'working', { metadata: { thread_source: 'guardian_review' } });
  f.add('old', 'working', { updatedAt: iso(START - 120000) });
  await f.watcher.tick(); f.advance();
  for (const thread of f.roots.keys()) f.change(thread, 'complete');
  await f.watcher.tick(); assert.deepEqual(f.calls, []);
});

test('callback failures, including rejected promises, do not change the work-state director', async t => {
  for (const fail of [() => { throw Error('PRIVATE'); }, () => Promise.reject(Error('PRIVATE'))]) {
    let count = 0;
    const onCompletedTurn = () => { count++; return fail(); };
    const f = fixture(t, { onCompletedTurn }); f.add('root'); await f.watcher.tick();
    f.advance(); f.change('root', 'complete'); await f.watcher.tick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(count, 1);
    assert.equal(f.watcher.snapshot().state, 'complete');
    assert.equal(f.statusEvents.filter(value => value.state === 'complete').length, 1);
  }
});

test('an overflowed append batch cannot produce partial journal facts', async t => {
  const f = fixture(t); f.add('root'); await f.watcher.tick();
  f.advance();
  for (let index = 0; index < 513; index++) {
    f.change('root', 'working', { turnId: `many-${index}` });
    f.change('root', 'complete', { turnId: `many-${index}` });
  }
  await f.watcher.tick();
  assert.deepEqual(f.calls, []);
  assert.equal(f.watcher.snapshot().state, 'unknown');
});

test('real synthetic root-log appends emit only explicit turn endings, with no payload text', async t => {
  // Synthetic test data is left in the temporary directory; no user files or
  // prior artifacts are removed by this test.
  const home = await mkdtemp(join(tmpdir(), 'shuangling-memory-root-'));
  await mkdir(join(home, 'sessions'));
  let now = Date.now();
  const line = (type, payload) => JSON.stringify({ type, timestamp: iso(now), payload }) + '\n';
  const file = join(home, 'sessions', 'rollout-a.jsonl'), calls = [];
  await writeFile(file, line('session_meta', { id: 'root', thread_source: 'user', base_instructions: 'PRIVATE-BODY' })
    + line('event_msg', { type: 'task_started', turn_id: 'old' })
    + line('event_msg', { type: 'task_complete', turn_id: 'old', last_agent_message: 'PRIVATE-BODY' })
    + line('event_msg', { type: 'task_started', turn_id: 'current' }));
  const watcher = new CodexWorkWatcher({ codexHome: home, now: () => now, sessionStartedAt: now - 1000,
    onCompletedTurn: value => calls.push(value) });
  t.after(() => watcher.close());
  await watcher.tick(); assert.deepEqual(calls, []);
  now += 301;
  await appendFile(file, line('response_item', { type: 'function_call_output', call_id: 'tool', output: 'PRIVATE-BODY failure' }));
  await watcher.tick(); assert.deepEqual(calls, []);
  assert.equal(watcher.snapshot().state, 'working');
  now += 301;
  await appendFile(file, line('event_msg', { type: 'task_complete', turn_id: 'current', last_agent_message: 'PRIVATE-BODY' })
    + line('event_msg', { type: 'task_started', turn_id: 'next' })
    + line('event_msg', { type: 'task_complete', turn_id: 'next' }));
  await watcher.tick();
  assert.deepEqual(calls, [{ id: stableId('root', 'current'), at: now }, { id: stableId('root', 'next'), at: now }]);
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE|current|next|root|jsonl|sessions/);
});

test('opaque fact identifiers are stable across observer instances and distinguish threads', async t => {
  const f = fixture(t), g = fixture(t);
  f.add('a', 'working', { turnId: 'shared-turn' }); g.add('a', 'working', { turnId: 'shared-turn' });
  g.add('b', 'working', { turnId: 'shared-turn' });
  await f.watcher.tick(); await g.watcher.tick();
  f.advance(); g.advance(); f.change('a', 'complete'); g.change('a', 'complete'); g.change('b', 'complete');
  await f.watcher.tick(); await g.watcher.tick();
  assert.equal(f.calls.length, 1); assert.equal(g.calls.length, 2);
  assert.match(f.calls[0].id, /^[a-f0-9]{64}$/);
  assert.equal(f.calls[0].id, g.calls[0].id); assert.notEqual(g.calls[0].id, g.calls[1].id);
});

test('missing, malformed or out-of-order completion timestamps are not journal evidence', async t => {
  for (const updatedAt of [null, 'not-a-date', iso(START - 1), iso(START + 61000)]) {
    const f = fixture(t); f.add('root'); await f.watcher.tick();
    f.advance(); f.change('root', 'complete', { updatedAt }); await f.watcher.tick();
    assert.deepEqual(f.calls, [], String(updatedAt));
  }
});
