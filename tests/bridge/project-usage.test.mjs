import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectUsageReader } from '../../src/bridge/project-usage.mjs';

const at = Date.parse('2026-10-24T01:00:00Z');
const meta = (id, extra = {}) => ({ type: 'session_meta', timestamp: new Date(at - 1000).toISOString(), payload: {
  id, thread_source: 'user', cwd: 'D:\\work\\pet', runtime_workspace_roots: ['D:\\work\\pet'], ...extra,
} });
const token = (total, milliseconds = at, extra = {}) => ({ type: 'event_msg', timestamp: new Date(milliseconds).toISOString(), payload: {
  type: 'token_count', info: { total_token_usage: { total_tokens: total, input_tokens: total - 10, cached_input_tokens: 77, output_tokens: 10 },
    last_token_usage: { total_tokens: 20 }, model_context_window: 200 }, ...extra,
} });
const lines = events => events.map(event => JSON.stringify(event)).join('\n') + '\n';
async function fixture(t, { fsApi = fs, now = () => at } = {}) {
  const home = await fs.mkdtemp(join(tmpdir(), 'shuangling-project-usage-'));
  // Fixture directories are created by this test only, never user rollouts.
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(join(home, 'sessions')); await fs.mkdir(join(home, 'archived_sessions'));
  const reader = new ProjectUsageReader({ codexHome: home, fsApi, now, indexMaxAgeMs: 0 });
  const put = async (id, events, archived = false) => {
    const path = join(home, archived ? 'archived_sessions' : 'sessions', `rollout-${id}.jsonl`);
    await fs.writeFile(path, lines(events)); return path;
  };
  return { home, reader, put };
}

test('selected chat exposes last-request context and separate cumulative total, retaining only telemetry', async t => {
  const { reader, put } = await fixture(t);
  await put('a', [meta('a', { base_instructions: 'PRIVATE INSTRUCTIONS', creator_account_id: 'PRIVATE ACCOUNT' }),
    { type: 'response_item', payload: { role: 'user', content: 'PRIVATE BODY' } }, token(100), token(150, at + 10)]);
  const result = await reader.snapshot({ threadId: 'a' });
  assert.equal(result.context.usedTokens, 20);
  assert.equal(result.context.remainingTokens, 180);
  assert.equal(result.project.usedTokens, 150);
  assert.equal(result.project.status, 'available');
  assert.equal(result.project.scope, 'thread');
  assert.equal(result.project.threadCount, 1);
  assert.equal(result.metadata.cwd, 'D:\\work\\pet');
  const retained = JSON.stringify({ result, readers: [...reader.readers.values()] });
  assert.doesNotMatch(retained, /PRIVATE|base_instructions|creator_account_id|response_item/);
});

test('explicit project membership aggregates independent root chats and archived chats, excluding unrelated chats', async t => {
  const { reader, put } = await fixture(t);
  await put('a', [meta('a'), token(100)]);
  await put('b', [meta('b'), token(200)], true);
  await put('c', [meta('c'), token(900)]);
  const result = await reader.snapshot({ threadId: 'a', scope: 'project', projectThreadIds: ['a', 'b', 'a'], projectName: '霜铃' });
  assert.equal(result.project.usedTokens, 300);
  assert.equal(result.project.threadCount, 2);
  assert.equal(result.project.label, '霜铃');
  assert.equal(result.context.usedTokens, 20);
});

test('project membership never silently infers the entire broad workspace', async t => {
  const { reader, put } = await fixture(t);
  await put('a', [meta('a', { cwd: 'D:\\work', runtime_workspace_roots: ['D:\\work'] }), token(100)]);
  await put('b', [meta('b'), token(200)]);
  const fallback = await reader.snapshot({ threadId: 'a', scope: 'project' });
  assert.equal(fallback.project.scope, 'thread');
  assert.equal(fallback.project.usedTokens, 100);
  assert.equal(fallback.project.reason, 'project-membership-unavailable');
  const narrow = await reader.snapshot({ threadId: 'a', scope: 'project', projectRoot: 'D:/work/pet' });
  assert.equal(narrow.project.usedTokens, 200);
  assert.equal(narrow.project.threadCount, 1);
});

test('root grouping respects path boundaries, case and slash variants and explicit runtime roots', async t => {
  const { reader, put } = await fixture(t);
  await put('a', [meta('a'), token(100)]);
  await put('b', [meta('b', { cwd: 'D:\\work', runtime_workspace_roots: ['d:/WORK/PET/src'] }), token(200)]);
  await put('c', [meta('c', { cwd: 'D:\\work\\pet-other', runtime_workspace_roots: ['D:\\work\\pet-other'] }), token(900)]);
  const { project } = await reader.snapshot({ threadId: 'a', scope: 'project', projectRoot: 'D:/Work/Pet/' });
  assert.equal(project.usedTokens, 300); assert.equal(project.threadCount, 2);
});

test('child, guardian and object-source agents cannot add inherited histories to project totals', async t => {
  const { reader, put } = await fixture(t);
  await put('a', [meta('a'), token(100)]);
  await put('child', [meta('child', { thread_source: 'subagent', parent_thread_id: 'a' }), token(900)]);
  await put('guardian', [meta('guardian', { thread_source: 'guardian_review', parent_thread_id: 'a' }), token(900)]);
  await put('legacy', [meta('legacy', { source: { subagent: { other: 'guardian' } } }), token(900)]);
  const result = await reader.snapshot({ threadId: 'a', scope: 'project', projectRoot: 'D:/work/pet' });
  assert.equal(result.project.usedTokens, 100); assert.equal(result.project.threadCount, 1);
  const child = await reader.snapshot({ threadId: 'child' });
  assert.equal(child.project.status, 'unknown'); assert.equal(child.context.status, 'unknown');
});

test('exact shared fork telemetry is subtracted once, while separate post-fork work remains counted', async t => {
  const { reader, put } = await fixture(t);
  const shared = token(100);
  await put('a', [meta('a'), shared, token(180, at + 20)]);
  await put('fork', [meta('fork', { forked_from_id: 'a' }), shared, token(140, at + 10)]);
  const { project } = await reader.snapshot({ threadId: 'fork', scope: 'project', projectThreadIds: ['a', 'fork'] });
  assert.equal(project.status, 'available'); assert.equal(project.usedTokens, 220);
  const onlyFork = await reader.snapshot({ threadId: 'fork' });
  assert.equal(onlyFork.project.usedTokens, 140);
});

test('unverifiable fork inheritance and missing members show partial known usage instead of double counting', async t => {
  const { reader, put } = await fixture(t);
  await put('a', [meta('a'), token(100)]);
  await put('fork', [meta('fork', { forked_from_id: 'missing' }), token(140)]);
  const { project } = await reader.snapshot({ threadId: 'a', scope: 'project', projectThreadIds: ['a', 'fork', 'missing'] });
  assert.equal(project.status, 'partial'); assert.equal(project.usedTokens, 100);
  assert.equal(project.sampledThreadCount, 1); assert.equal(project.threadCount, 2);
  assert.equal(project.reason, 'project-logs-unavailable');
});

test('missing or invalid cumulative usage stays unknown rather than displaying invented zero', async t => {
  const { reader, put } = await fixture(t);
  await put('a', [meta('a'), token(100, at, { info: { last_token_usage: { total_tokens: 20 }, model_context_window: 200 } })]);
  let result = await reader.snapshot({ threadId: 'a' });
  assert.equal(result.project.status, 'unknown'); assert.equal(result.project.usedTokens, undefined);
  assert.equal(result.context.usedTokens, 20);
  await put('a', [meta('a'), token(0)]);
  result = await reader.snapshot({ threadId: 'a' });
  assert.equal(result.project.status, 'available'); assert.equal(result.project.usedTokens, 0);
  await put('a', [meta('a'), token(100), token(-1, at + 10, { rate_limits: { primary: {
    window_minutes: 300, used_percent: 25, resets_at: at / 1000 + 3600,
  } } })]);
  result = await reader.snapshot({ threadId: 'a' });
  assert.equal(result.project.status, 'unknown'); assert.equal(result.project.usedTokens, undefined);
  assert.equal(result.context.status, 'available'); assert.equal(result.context.usedTokens, 20);
  assert.equal(result.account.fiveHour.status, 'available'); assert.equal(result.account.fiveHour.remainingPercent, 75);
  result = await reader.snapshot({ threadId: 'a' });
  assert.equal(result.project.status, 'unknown');
  assert.equal(result.context.status, 'available'); assert.equal(result.account.fiveHour.remainingPercent, 75);
});

test('out-of-thread, future, and old usage cannot alter the trusted cumulative sample', async t => {
  const { reader, put } = await fixture(t);
  await put('a', [meta('a'), token(100), token(999, at + 1, { thread_id: 'other' }), token(999, at + 120000), token(10, at - 10)]);
  const { project } = await reader.snapshot({ threadId: 'a' });
  assert.equal(project.status, 'available'); assert.equal(project.usedTokens, 100);
});

test('cumulative resets retain only a partial lower bound from the latest verified counter', async t => {
  const { reader, put } = await fixture(t);
  const path = await put('a', [meta('a'), token(100), token(70, at + 10)]);
  let { project } = await reader.snapshot({ threadId: 'a' });
  assert.equal(project.status, 'partial'); assert.equal(project.reason, 'cumulative-reset');
  assert.equal(project.usedTokens, 70, 'the reset epochs must not be added or replaced with an old maximum');
  await fs.appendFile(path, lines([token(130, at + 20)]));
  ({ project } = await reader.snapshot({ threadId: 'a' }));
  assert.equal(project.status, 'partial'); assert.equal(project.usedTokens, 130);
  assert.equal(project.observedAt, new Date(at + 20).toISOString());
});

test('oversized image, tool and compaction body records cannot hide verified usage telemetry', async t => {
  const { reader, put } = await fixture(t);
  const path = await put('a', [meta('a'), token(100)]);
  const body = 'PRIVATE BODY ' + 'x'.repeat(8 * 1024 * 1024);
  await fs.appendFile(path, lines([
    { timestamp: new Date(at).toISOString(), ordinal: 1, type: 'response_item', payload: { type: 'custom_tool_call_output', output: body } },
    { ordinal: 2, timestamp: new Date(at).toISOString(), type: 'compacted', payload: { message: body } },
    token(150, at + 10),
  ]));
  const result = await reader.snapshot({ threadId: 'a' });
  assert.equal(result.project.status, 'available'); assert.equal(result.project.usedTokens, 150);
  assert.equal(result.context.status, 'available'); assert.equal(result.context.usedTokens, 20);
  const cached = reader.readers.get(path);
  assert.equal(cached.malformed, false); assert.equal(cached.carry, ''); assert.equal(cached.carryBytes, 0);
  assert.doesNotMatch(JSON.stringify(cached), /PRIVATE BODY|custom_tool_call_output/);
});

test('oversized telemetry and unrecognized oversized headers remain explicitly unknown', async t => {
  const { reader, put } = await fixture(t);
  const body = 'x'.repeat(8 * 1024 * 1024);
  await put('telemetry', [meta('telemetry'), token(100), { ...token(150, at + 10), extra: body }]);
  const badTelemetry = await reader.snapshot({ threadId: 'telemetry' });
  assert.equal(badTelemetry.project.status, 'unknown'); assert.equal(badTelemetry.context.status, 'unknown');
  const path = await put('unknown', [meta('unknown'), token(100)]);
  await fs.appendFile(path, lines([{ payload: { body }, type: 'response_item' }]));
  const unclassified = await reader.snapshot({ threadId: 'unknown' });
  assert.equal(unclassified.project.status, 'unknown'); assert.equal(unclassified.project.usedTokens, undefined);
});

test('incomplete append is ignored until complete, then usage is updated without rereading old body content', async t => {
  const { reader, put } = await fixture(t);
  const path = await put('a', [meta('a'), token(100)]);
  await reader.snapshot({ threadId: 'a' });
  const oldOffset = [...reader.readers.values()][0].offset;
  const append = JSON.stringify(token(150, at + 10));
  await fs.appendFile(path, append.slice(0, 24));
  assert.equal((await reader.snapshot({ threadId: 'a' })).project.usedTokens, 100);
  await fs.appendFile(path, append.slice(24) + '\n');
  const result = await reader.snapshot({ threadId: 'a' });
  assert.equal(result.project.usedTokens, 150);
  const cached = [...reader.readers.values()][0];
  assert.equal(cached.samples.length, 2); assert.ok(cached.offset > oldOffset); assert.equal(cached.carry, '');
  await reader.snapshot({ threadId: 'a' });
  assert.equal(cached.samples.length, 2);
});

test('replacement and truncation reload a new verified sample without accumulating prior totals', async t => {
  const { reader, put } = await fixture(t);
  const path = await put('a', [meta('a'), token(100), token(200, at + 10)]);
  assert.equal((await reader.snapshot({ threadId: 'a' })).project.usedTokens, 200);
  const replacement = path + '.replacement';
  await fs.writeFile(replacement, lines([meta('a'), token(30)]));
  await fs.rename(replacement, path);
  assert.equal((await reader.snapshot({ threadId: 'a' })).project.usedTokens, 30);
  await put('a', [meta('a')]);
  assert.equal((await reader.snapshot({ threadId: 'a' })).project.status, 'unknown');
});

test('permission loss hides old totals and recovery rereads verified telemetry', async t => {
  let deny = false;
  const fsApi = { ...fs, open: async (...args) => {
    if (deny) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return fs.open(...args);
  } };
  const { reader, put } = await fixture(t, { fsApi });
  await put('a', [meta('a'), token(100)]);
  assert.equal((await reader.snapshot({ threadId: 'a' })).project.usedTokens, 100);
  deny = true;
  const unavailable = await reader.snapshot({ threadId: 'a' });
  assert.equal(unavailable.project.status, 'unknown'); assert.equal(unavailable.project.usedTokens, undefined);
  assert.equal(unavailable.context.status, 'unknown');
  deny = false;
  assert.equal((await reader.snapshot({ threadId: 'a' })).project.usedTokens, 100);
});

test('a duplicate root rollout in archive is canonicalized, not counted twice', async t => {
  const { reader, put } = await fixture(t);
  await put('a', [meta('a'), token(100)]);
  const newer = await put('a', [meta('a'), token(100), token(150, at + 10)], true);
  await fs.utimes(newer, new Date(), new Date(Date.now() + 1000));
  const { project } = await reader.snapshot({ threadId: 'a', scope: 'project', projectRoot: 'D:/work/pet' });
  assert.equal(project.threadCount, 1); assert.equal(project.usedTokens, 150);
});

test('an unrelated unreadable rollout does not taint explicit project members, while missing requested members remain partial', async t => {
  const fsApi = { ...fs, open: async (path, ...args) => {
    if (String(path).endsWith('rollout-blocked.jsonl')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return fs.open(path, ...args);
  } };
  const { reader, put } = await fixture(t, { fsApi });
  await put('a', [meta('a'), token(100)]);
  await put('blocked', [meta('blocked', { cwd: 'D:\\other', runtime_workspace_roots: ['D:\\other'] }), token(900)]);
  const explicit = await reader.snapshot({ threadId: 'a', scope: 'project', projectThreadIds: ['a'] });
  assert.equal(explicit.project.status, 'available'); assert.equal(explicit.project.usedTokens, 100);
  assert.equal(explicit.context.status, 'available'); assert.equal(reader.indexProblem, 'log-permission-denied');
  const inferred = await reader.snapshot({ threadId: 'a', scope: 'project', projectRoot: 'D:/work/pet' });
  assert.equal(inferred.project.status, 'partial'); assert.equal(inferred.project.reason, 'log-permission-denied');
  const missing = await reader.snapshot({ threadId: 'a', scope: 'project', projectThreadIds: ['a', 'blocked'] });
  assert.equal(missing.project.status, 'partial'); assert.equal(missing.project.reason, 'project-logs-unavailable');
  assert.equal(missing.project.usedTokens, 100); assert.equal(missing.project.sampledThreadCount, 1);
});

test('missing root, empty project membership and malformed telemetry remain explicitly unknown', async t => {
  const { reader, put } = await fixture(t);
  assert.equal((await reader.snapshot({ threadId: 'missing' })).project.status, 'unknown');
  const path = await put('a', [meta('a'), token(100)]);
  const empty = await reader.snapshot({ threadId: 'a', scope: 'project', projectThreadIds: [] });
  assert.equal(empty.project.status, 'unknown'); assert.equal(empty.project.usedTokens, undefined);
  await fs.appendFile(path, '{"type":"token_count" this-is-not-json}\n');
  const bad = await reader.snapshot({ threadId: 'a' });
  assert.equal(bad.project.status, 'unknown'); assert.equal(bad.context.status, 'unknown');
});
