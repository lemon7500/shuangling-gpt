import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startBridge } from '../../src/bridge/index.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 2500) { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() > end) assert.fail('timed out'); await pause(10); } }
const line = (type, payload, timestamp = new Date().toISOString()) => JSON.stringify({ type, timestamp, payload }) + '\n';

test('full bridge follows all root chats, keeps usage selection independent and exits cleanly', async t => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'shuangling-integration-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const codexHome = join(dir, 'codex'); const sessions = join(codexHome, 'sessions');
  const dataDir = join(dir, 'data'); const dshHome = join(dataDir, 'dsh-home');
  await fs.mkdir(sessions, { recursive: true });
  await fs.mkdir(join(dshHome, 'dsh-pet'), { recursive: true });
  const sessionAt = BigInt(Date.now() - 120000) * 10000n + 621355968000000000n;
  await fs.writeFile(join(dataDir, 'lifecycle-session.json'), JSON.stringify({ active: true, epochProcesses: [`1234:${sessionAt}`] }));
  await fs.mkdir(join(dir, 'windows'), { recursive: true });
  await fs.writeFile(join(dir, 'windows', 'runtime-config.json'), JSON.stringify({ appearance: { visibleHeightRatio: (158 * 300 / 208) / 640, minWidth: 160, maxWidth: 1200, defaultWidth: 562, defaultVisibleHeight: 200 } }));
  const rootPath = join(sessions, 'rollout-root.jsonl');
  await fs.writeFile(rootPath, line('session_meta', { id: 'root', timestamp: new Date().toISOString(), base_instructions: 'PRIVATE BODY' }) + line('event_msg', { type: 'task_started', turn_id: 't1', root_turn_id: 't1' }));
  await fs.writeFile(join(sessions, 'rollout-second.jsonl'), line('session_meta', { id: 'second' }));
  await fs.writeFile(join(sessions, 'rollout-child.jsonl'), line('session_meta', { id: 'child', session_id: 'root', thread_source: 'subagent' }));
  const token = 'X'.repeat(43); const calls = [];
  const initialAt = Date.now() - 1000;
  let nativeInteraction = { id: 'old-renderer-0', phase: 'settled', kind: 'click', startedAt: initialAt, updatedAt: initialAt, endedAt: initialAt, revision: 0, resumable: false };
  let main = { pets: [{ id: 'shuangling', name: '霜铃', size: 356, balanceEnabled: false, display: 'desktop', position: { corner: 'bottom-right', marginX: 24, marginY: 24 } }] };
  const host = createServer(async (req, res) => {
    assert.equal(req.headers['x-dsh-pet-token'], token);
    const url = new URL(req.url, 'http://localhost'); const route = url.pathname.split('/').slice(2).join('/');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ route, body });
    let reply = { ok: true };
    if (route === 'lock') reply.lockId = 'lease';
    if (route === 'anim') reply.playbackId = `p${calls.length}`;
    if (route.startsWith('playback/')) reply.status = 'playing';
    if (route === 'interaction') reply.interaction = nativeInteraction;
    if (route === 'config') {
      if (req.method === 'PUT') {
        main = body;
        setTimeout(() => { const at = Date.now(); nativeInteraction = { ...nativeInteraction, id: `new-renderer-${at}-0`, startedAt: at, updatedAt: at, endedAt: at }; }, 30);
      }
      reply = { main };
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply));
  });
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { host.close(resolve); host.closeIdleConnections(); }));
  await fs.writeFile(join(dshHome, 'dsh-pet', 'standalone-runtime.json'), JSON.stringify({ port: host.address().port, token }));
  let shutdown = false;
  let account = { fiveHour: { status: 'unknown' }, weekly: { status: 'unknown' } };
  const accountSource = { async start() {}, async close() {}, snapshot: () => account };
  const bridge = await startBridge({ projectRoot: dir, dataDir, dshHome, threadId: 'root', codexHome, accountSource, onShutdown: async () => { shutdown = true; } });
  t.after(() => bridge.close());
  const settings = new URL(bridge.settingsUrl); const headers = { 'x-shuangling-token': settings.hash.slice(1), 'content-type': 'application/json' };
  const api = async (path, body) => { const r = await fetch(settings.origin + '/api/' + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined }); return { code: r.status, data: await r.json() }; };
  assert.equal((await api('state')).data.status.state, 'working');
  assert.equal((await api('state')).data.status.scope, 'codex');
  assert.equal((await api('state')).data.status.threadId, 'codex');
  assert.equal((await api('state')).data.status.workingCount, 1);
  assert.equal((await api('usage')).data.context.status, 'unknown');
  const resetsAt = Math.floor(Date.now() / 1000) + 86400;
  const accountAt = new Date().toISOString();
  account = { planType: 'pro', observedAt: accountAt, fiveHour: { status: 'not-applicable', observedAt: accountAt },
    weekly: { status: 'available', observedAt: accountAt, usedPercent: 7, remainingPercent: 93, windowMinutes: 10080, resetsAt } };
  await fs.appendFile(rootPath, line('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 987654321 }, last_token_usage: { total_tokens: 1200 }, model_context_window: 2400 }, rate_limits: { limit_id: 'codex', primary: { used_percent: 7, window_minutes: 10080, resets_at: resetsAt }, secondary: null, credits: { balance: 'PRIVATE BODY' } } }));
  await until(async () => { const usage = (await api('usage')).data; return usage.context.remainingTokens === 1200 && usage.account.weekly.remainingPercent === 93; });
  const usage = (await api('usage')).data;
  assert.equal(usage.account.weekly.remainingPercent, 93);
  assert.equal(usage.account.fiveHour.status, 'not-applicable');
  assert.equal(usage.project.scope, 'thread');
  assert.equal(usage.project.usedTokens, 987654321);
  assert.equal(usage.project.threadCount, 1);
  assert.doesNotMatch(usage.summaryText, /5 小时/);
  assert.deepEqual((await api('account-usage')).data, usage.account);
  assert.ok(!JSON.stringify(usage).includes('PRIVATE BODY'));
  await fs.appendFile(join(sessions, 'rollout-second.jsonl'), line('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 555 }, last_token_usage: { total_tokens: 100 }, model_context_window: 1000 }, rate_limits: { limit_id: 'codex', primary: { used_percent: 90, window_minutes: 10080, resets_at: resetsAt } } }, new Date(Date.now() - 16 * 60000).toISOString()));
  assert.equal((await api('usage-target', { threadId: 'second' })).code, 200);
  assert.equal((await api('state')).data.usageThreadId, 'second');
  const selectedUsage = (await api('usage')).data;
  assert.equal(selectedUsage.context.remainingTokens, 900);
  assert.equal(selectedUsage.context.status, 'historical');
  assert.match(selectedUsage.summaryText, /历史采样/);
  assert.equal(selectedUsage.project.usedTokens, 555);
  assert.equal(selectedUsage.project.threadCount, 1);
  assert.equal(selectedUsage.project.scope, 'thread');
  assert.equal(selectedUsage.account.weekly.observedAt, usage.account.weekly.observedAt);
  assert.equal(selectedUsage.account.weekly.remainingPercent, 93, 'selected chat historic quota must not replace the shared quota');
  assert.equal((await api('state')).data.status.threadId, 'codex');
  assert.equal((await api('usage-target', { threadId: 'root' })).code, 200);
  const appearance = (await api('appearance')).data;
  assert.equal(appearance.metrics.visibleHeightRatio, (158 * 300 / 208) / 640);
  assert.equal(appearance.metrics.defaultWidth, 562);
  await until(() => calls.some(c => c.route === 'anim' && c.body.name === 'running'));
  const oldPlayback = (await api('state')).data.control.lastPlayback?.playbackId;
  const resized = await api('appearance', { size: 400, corner: 'top-left', marginX: 20, marginY: 22 });
  assert.equal(resized.code, 200);
  assert.equal(resized.data.size, 400);
  await until(async () => { const control = (await api('state')).data.control; return control.lastPlayback?.playbackId !== oldPlayback && control.lastPlayback?.status === 'playing' && !control.surfaceReloading; });
  const playCount = calls.filter(c => c.route === 'anim').length;
  assert.equal((await api('appearance', { size: 400, corner: 'top-left', marginX: 20, marginY: 22 })).code, 200);
  assert.equal((await api('appearance', { size: 0, corner: 'top-left', marginX: 20, marginY: 22 })).code, 400);
  assert.equal(calls.filter(c => c.route === 'anim').length, playCount, 'no-op and invalid saves do not restart playback');
  await fs.appendFile(rootPath, line('response_item', { type: 'function_call', call_id: 'ask', name: 'request_user_input', arguments: 'PRIVATE BODY' }));
  await until(async () => (await api('state')).data.status.state === 'waiting');
  await fs.appendFile(rootPath, line('response_item', { type: 'function_call_output', call_id: 'ask', output: 'PRIVATE BODY' }));
  await until(async () => (await api('state')).data.status.state === 'working');
  // Ending one chat must discover a second chat's new task before celebrating.
  const secondPath = join(sessions, 'rollout-second.jsonl');
  await fs.appendFile(secondPath, line('event_msg', { type: 'task_started', turn_id: 't2', root_turn_id: 't2' }));
  const firstBatch = (await api('state')).data.status.turnId;
  await fs.appendFile(rootPath, line('event_msg', { type: 'task_complete', turn_id: 't1' }));
  await until(async () => { const status = (await api('state')).data.status; return status.state === 'working' && status.workingCount === 1 && status.turnId === firstBatch; });
  // Wait for the reducer to have consumed the first completion, then only the
  // second root's request can make the aggregate wait.
  await fs.appendFile(secondPath, line('response_item', { type: 'function_call', call_id: 'ask2', name: 'request_user_input_async', arguments: 'PRIVATE BODY' }));
  await until(async () => { const status = (await api('state')).data.status; return status.state === 'waiting' && status.waitingCount === 1 && status.workingCount === 0; }, 6500);
  const celebrationCount = calls.filter(call => call.route === 'anim' && ['waving', 'jumping'].includes(call.body.name)).length;
  assert.equal(celebrationCount, 0, 'one completed root cannot celebrate while another is active');
  await fs.appendFile(secondPath, line('event_msg', { type: 'task_complete', turn_id: 't2' }));
  await until(async () => (await api('state')).data.status.state === 'complete');
  assert.equal((await api('state')).data.status.activeCount, 0);
  assert.equal((await api('settings', { threadId: 'child' })).code, 400);
  await api('settings', { threadId: 'second', paused: true });
  assert.equal((await api('state')).data.status.threadId, 'codex');
  assert.equal((await api('state')).data.defaultUsageThreadId, 'second');
  assert.equal((await api('usage')).data.context.remainingTokens, 1200, 'explicit usage choice remains independent of the legacy default');
  assert.equal((await api('state')).data.control.paused, true);
  const stored = await fs.readFile(join(dataDir, 'bridge-config.json'), 'utf8');
  assert.deepEqual(JSON.parse(stored), { threadId: 'second', paused: true });
  assert.ok(!stored.includes('PRIVATE BODY'));
  assert.equal((await api('settings', { arbitrary: 'PRIVATE BODY' })).code, 400);
  await api('shutdown', {}); await until(() => shutdown);
  await assert.rejects(fs.access(join(dataDir, 'bridge-runtime.json')));
});

test('first launch without a bound chat follows global work and offers explicit local usage choices', async t => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'shuangling-first-launch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const codexHome = join(dir, 'codex'); const sessions = join(codexHome, 'sessions');
  const dataDir = join(dir, 'data');
  await fs.mkdir(sessions, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  const sessionAt = BigInt(Date.now() - 120000) * 10000n + 621355968000000000n;
  await fs.writeFile(join(dataDir, 'lifecycle-session.json'), JSON.stringify({ active: true, epochProcesses: [`1234:${sessionAt}`] }));
  const earlier = new Date(Date.now() - 60000).toISOString();
  await fs.writeFile(join(sessions, 'rollout-first.jsonl'), line('session_meta', { id: 'first', timestamp: earlier }) +
    line('event_msg', { type: 'task_started', turn_id: 'first-turn', root_turn_id: 'first-turn' }) +
    line('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 400 }, last_token_usage: { total_tokens: 100 }, model_context_window: 1000 } }));
  await fs.writeFile(join(sessions, 'rollout-latest.jsonl'), line('session_meta', { id: 'latest', timestamp: new Date().toISOString() }));
  await fs.writeFile(join(codexHome, 'session_index.jsonl'), JSON.stringify({ id: 'first', thread_name: 'First local chat', updated_at: new Date().toISOString() }) + '\n');
  const account = { planType: 'pro', weekly: { status: 'available', usedPercent: 5, remainingPercent: 95, windowMinutes: 10080 }, fiveHour: { status: 'not-applicable' } };
  let started = 0, stopped = 0;
  const accountSource = { async start() { started++; }, async close() { stopped++; }, snapshot: () => account };
  const previousThread = process.env.CODEX_THREAD_ID;
  let bridge;
  delete process.env.CODEX_THREAD_ID;
  try { bridge = await startBridge({ projectRoot: dir, codexHome, dataDir, accountSource }); }
  finally { if (previousThread === undefined) delete process.env.CODEX_THREAD_ID; else process.env.CODEX_THREAD_ID = previousThread; }
  t.after(() => bridge.close());
  const settings = new URL(bridge.settingsUrl);
  const headers = { 'x-shuangling-token': settings.hash.slice(1), 'content-type': 'application/json' };
  const api = async (route, body) => {
    const response = await fetch(`${settings.origin}/api/${route}`, { headers, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.status, 200); return response.json();
  };
  const state = await api('state');
  assert.equal(state.status.scope, 'codex');
  assert.equal(state.status.state, 'working');
  assert.equal(state.status.workingCount, 1);
  assert.equal(state.defaultUsageThreadId, null);
  assert.equal(state.usageThreadId, null);
  assert.deepEqual(JSON.parse(await fs.readFile(join(dataDir, 'bridge-config.json'), 'utf8')), { threadId: null, paused: false });
  const unselected = await api('usage');
  assert.equal(unselected.threadId, null, 'neither the active task nor latest chat is automatically selected');
  assert.equal(unselected.context.status, 'unknown');
  assert.equal(unselected.project.status, 'unknown');
  assert.deepEqual(unselected.selection.choices.map(choice => choice.threadId).sort(), ['first', 'latest']);
  assert.equal(unselected.selection.choices.find(choice => choice.threadId === 'first').threadName, 'First local chat');
  assert.deepEqual(await api('account-usage'), account);
  assert.deepEqual(unselected.account, account);
  await api('usage-target', { threadId: 'first' });
  const selected = await api('usage');
  assert.equal(selected.threadId, 'first');
  assert.equal(selected.context.remainingTokens, 900);
  assert.equal(selected.project.usedTokens, 400);
  assert.equal((await api('state')).defaultUsageThreadId, null, 'usage choice does not silently create a saved default');
  assert.equal((await api('state')).status.state, 'working');
  assert.deepEqual(selected.account, account);
  await api('settings', { paused: true });
  assert.deepEqual(JSON.parse(await fs.readFile(join(dataDir, 'bridge-config.json'), 'utf8')), { threadId: null, paused: true });
  await bridge.close();
  assert.equal(started, 1);
  assert.equal(stopped, 1);
  await assert.rejects(fs.access(join(dataDir, 'bridge-runtime.json')));
});

test('startup keeps saved, explicit, default and environment binding precedence and rejects malformed input', async t => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'shuangling-binding-priority-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const previousThread = process.env.CODEX_THREAD_ID;
  t.after(() => { if (previousThread === undefined) delete process.env.CODEX_THREAD_ID; else process.env.CODEX_THREAD_ID = previousThread; });
  process.env.CODEX_THREAD_ID = 'environment';
  const cases = [
    { saved: 'saved', threadId: 'explicit', defaultThreadId: 'default', expected: 'saved' },
    { saved: null, threadId: 'explicit', defaultThreadId: 'default', expected: 'explicit' },
    { saved: 'malformed id', defaultThreadId: 'default', expected: 'default' },
    { expected: 'environment' },
  ];
  for (const [index, entry] of cases.entries()) {
    const dataDir = join(dir, String(index));
    await fs.mkdir(dataDir, { recursive: true });
    if (entry.saved !== undefined) await fs.writeFile(join(dataDir, 'bridge-config.json'), JSON.stringify({ threadId: entry.saved, paused: true }));
    const accountSource = { async start() {}, async close() {}, snapshot: () => null };
    const bridge = await startBridge({ projectRoot: dir, codexHome: join(dir, 'codex'), dataDir, accountSource, threadId: entry.threadId, defaultThreadId: entry.defaultThreadId });
    try {
      const settings = new URL(bridge.settingsUrl);
      const response = await fetch(`${settings.origin}/api/state`, { headers: { 'x-shuangling-token': settings.hash.slice(1) } });
      assert.equal((await response.json()).defaultUsageThreadId, entry.expected);
    } finally { await bridge.close(); }
  }
  let accountStarts = 0;
  const accountSource = { async start() { accountStarts++; }, async close() {}, snapshot: () => null };
  for (const explicit of [{ threadId: 'invalid id' }, { defaultThreadId: '' }]) {
    await assert.rejects(startBridge({ projectRoot: dir, codexHome: join(dir, 'codex'), dataDir: join(dir, '0'), accountSource, ...explicit }), /valid root chat thread ID/);
  }
  assert.equal(accountStarts, 0, 'invalid explicit input is rejected before starting the account source');
});
