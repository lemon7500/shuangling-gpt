import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { presentUsage, presentState, presentSelection, presentProjectUsage, usageChoices, appearanceModel, appearanceCommand, createPoller } = require('../../vendor/dsh-pet/runtime/electron-helper/panel-ui.js');
const now = Date.parse('2026-10-24T08:00:00Z');
const sample = { status: 'available', observedAt: new Date(now - 1000).toISOString(), remainingTokens: 80000, windowTokens: 100000, remainingPercent: 80, resetsAt: now / 1000 + 3600 };
const appearance = { size: 396, position: { corner: 'bottom-right', marginX: 20, marginY: 12 }, metrics: { visibleHeightRatio: 453 / 1280, minWidth: 160, maxWidth: 1200 } };

test('context displays the sampled remaining count, including a true zero', () => {
  assert.equal(presentUsage(sample, { context: true, now }).value, '80,000');
  const empty = presentUsage({ ...sample, remainingTokens: 0, remainingPercent: 0 }, { context: true, now });
  assert.equal(empty.available, true);
  assert.equal(empty.value, '0');
});

test('only an explicitly inapplicable quota window is hidden, including while disconnected', () => {
  for (const disconnected of [false, true]) {
    const quota = presentUsage({ status: 'not-applicable', remainingPercent: 99 }, { now, disconnected });
    assert.equal(quota.hidden, true);
    assert.equal(quota.bar, null);
    assert.equal(quota.value, '');
  }
  assert.notEqual(presentUsage({ status: 'unknown' }, { now }).hidden, true);
  assert.notEqual(presentUsage(null, { now }).hidden, true);
  assert.notEqual(presentUsage({ status: 'not-applicable' }, { now, context: true }).hidden, true);
});

test('unknown, stale, reset and disconnection never render a numerical balance', () => {
  for (const [value, options] of [
    [{ status: 'unknown' }, {}],
    [{ ...sample, status: 'stale' }, {}],
    [{ ...sample, resetsAt: now / 1000 }, {}],
    [{ ...sample, observedAt: new Date(now - 301000).toISOString() }, {}],
    [sample, { disconnected: true }],
    [{ ...sample, observedAt: 'not-a-date' }, {}],
    [{ ...sample, remainingPercent: 101 }, {}],
    [{ ...sample, remainingTokens: -1 }, { context: true }],
  ]) {
    const result = presentUsage(value, { now, ...options });
    assert.equal(result.value, '未知');
    assert.equal(result.bar, null);
  }
});

test('context and account apply their own freshness windows without inferring a reset', () => {
  const old = { ...sample, observedAt: new Date(now - 6 * 60000).toISOString() };
  assert.equal(presentUsage(old, { context: true, now }).available, true);
  assert.equal(presentUsage(old, { now }).available, false);
  const stale = presentUsage({ ...old, reason: 'reset-passed', status: 'stale' }, { now });
  assert.match(stale.time, /等待新采样/);
});

test('verified historical request context remains readable with a dated label, never as a quota balance', () => {
  const historical = { ...sample, status: 'historical', sample: 'last-model-request', observedAt: new Date(now - 86400000).toISOString() };
  const view = presentUsage(historical, { context: true, now });
  assert.equal(view.available, true);
  assert.equal(view.historical, true);
  assert.equal(view.state, 'historical');
  assert.equal(view.value, '80,000');
  assert.match(view.time, /历史采样/);
  assert.match(view.time, /2026/);
  assert.equal(presentUsage(historical, { now }).available, false, 'account quotas never gain historical numbers');
  assert.equal(presentUsage(historical, { context: true, now, disconnected: true }).available, false);
  assert.equal(presentUsage({ ...historical, remainingTokens: -1 }, { context: true, now }).available, false);
  assert.equal(presentUsage({ ...historical, sample: 'unverified' }, { context: true, now }).available, false);
  const agedAvailable = presentUsage({ ...sample, observedAt: historical.observedAt }, { context: true, now });
  assert.equal(agedAvailable.historical, true, 'an open panel labels its known context after freshness elapses');
});

test('manual ownership and saved pause both expose resume without losing their distinction', () => {
  const manual = presentState({ status: { state: 'working' }, control: { preempted: true } });
  assert.equal(manual.badge, '你在控制');
  assert.equal(manual.resume, true);
  assert.equal(manual.hint, '');
  const paused = presentState({ status: { state: 'working' }, control: { paused: true, preempted: true } });
  assert.equal(paused.badge, '联动已暂停');
  assert.equal(paused.resume, true);
  const disconnected = presentState({ status: { state: 'working' }, control: {} }, true);
  assert.equal(disconnected.label, '本机连接已断开');
  assert.equal(disconnected.dot, 'unknown');
});

test('current-page usage is independent of the task binding and unknown selection clears its identity', () => {
  const selected = presentSelection({ status: 'available', threadId: 'other-chat', threadName: '优化桌宠', projectName: '另一个项目', projectRoot: 'D:/other' });
  assert.equal(selected.label, '优化桌宠 · 另一个项目');
  assert.equal(selected.title, '优化桌宠\n另一个项目\nD:/other\nother-chat');
  assert.equal(selected.threadId, 'other-chat');
  assert.equal(presentState({ status: { threadId: 'bound-chat' } }).threadId, 'bound-chat');
  for (const options of [{}, { disconnected: true }]) {
    const unknown = presentSelection({ status: 'unknown', threadId: 'old-chat', projectName: '旧项目' }, options);
    assert.equal(unknown.available, false);
    assert.equal(unknown.label, '用量来源未知');
    assert.equal(unknown.threadId, '');
    assert.equal(unknown.title, '');
  }
});

test('usage choices are limited to safe distinct IDs, and only verified page sources claim current page', () => {
  const choices = usageChoices({ choices: [{ threadId: 'chat-a', projectName: '项目' }, { threadId: 'chat-a', projectName: '重复' }, { threadId: '<script>', projectName: '错误' }, { threadId: 'chat-b' }] });
  assert.equal(choices.length, 2);
  assert.equal(choices[0].label, '未命名聊天 · 项目 · chat-a');
  assert.equal(choices[1].label, '未命名聊天 · 未归入项目 · chat-b');
  const available = { status: 'available', threadId: 'chat' };
  assert.equal(presentSelection({ ...available, source: 'bound-chat' }).caption, '默认聊天');
  assert.equal(presentSelection({ ...available, source: 'selected-chat' }).caption, '所选聊天');
  assert.equal(presentSelection({ ...available, source: 'active-page' }).caption, '当前页面');
});

test('chat names lead usage choices, equal names are disambiguated only within their project', () => {
  const choices = usageChoices({ choices: [
    { threadId: 'chat-a', threadName: '修复面板', projectName: '桌宠' },
    { threadId: 'chat-b', threadName: '修复面板', projectName: '桌宠' },
    { threadId: 'chat-c', threadName: '修复面板', projectName: '另一项目' },
    { threadId: 'chat-d', threadName: '  已有\n 聊天\t标题  ', projectName: '桌宠' },
  ] });
  assert.equal(choices[0].label, '修复面板 · 桌宠 · chat-a');
  assert.equal(choices[1].label, '修复面板 · 桌宠 · chat-b');
  assert.equal(choices[2].label, '修复面板 · 另一项目');
  assert.equal(choices[3].label, '已有 聊天 标题 · 桌宠');
  assert.equal(choices[3].title, '已有 聊天 标题\n桌宠\nchat-d');
  assert.equal(usageChoices({ choices: [{ threadId: 'long-name', threadName: '长'.repeat(300) }] })[0].title.split('\n')[0].length, 200);
});

test('project totals distinguish a verified zero, unknown, incomplete records and chat-only scope', () => {
  const selection = { status: 'available', threadId: 'chat', projectName: '项目' };
  const total = { status: 'available', scope: 'project', usedTokens: 1234567, threadCount: 3, observedAt: new Date(now).toISOString() };
  assert.equal(presentProjectUsage(total, { selection, now }).value, '1,234,567');
  assert.equal(presentProjectUsage({ ...total, usedTokens: 0 }, { selection, now }).value, '0');
  const partial = presentProjectUsage({ ...total, status: 'partial' }, { selection, now });
  assert.equal(partial.value, '≥ 1,234,567');
  assert.match(partial.time, /部分记录/);
  assert.equal(presentProjectUsage({ ...total, scope: 'thread' }, { selection, now }).label, '本聊天已用');
  assert.equal(presentProjectUsage(null, { selection, now }).label, '本聊天已用');
  for (const [sample, options] of [[{ ...total, status: 'unknown' }, {}], [total, { selection: { status: 'unknown', threadId: 'chat' } }], [total, { disconnected: true }], [{ ...total, usedTokens: -1 }, {}], [{ ...total, usedTokens: Number.MAX_SAFE_INTEGER + 1 }, {}], [{ ...total, observedAt: 'bad-date' }, {}]]) {
    assert.equal(presentProjectUsage(sample, { selection, now, ...options }).value, '未知');
  }
});

test('chat binding uses a short validated identifier and never accepts markup', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  assert.equal(presentState({ status: { threadId: id } }).shortThread, '11111111…5555');
  assert.equal(presentState({ status: { threadId: '<script>secret</script>' } }).shortThread, '尚未绑定');
});

test('Codex scope exposes verified aggregate counts without changing the usage selection', () => {
  const snapshot = { status: { state: 'working', scope: 'codex', threadId: 'diagnostic-chat', activeCount: 4, workingCount: 2, waitingCount: 1, unknownCount: 1 }, control: {} };
  const state = presentState(snapshot);
  assert.equal(state.shortThread, '整个 Codex');
  assert.equal(state.threadId, 'diagnostic-chat');
  assert.equal(state.counts, '运行 2 · 等待 1 · 未知 1');
  assert.match(state.headerLabel, /^整个 Codex/);
  assert.equal(presentState({ ...snapshot, control: { paused: true } }).hint, '恢复后继续跟随整个 Codex。');
  assert.equal(presentState(snapshot, true).headerLabel, '本机连接已断开');
  assert.equal(presentState({ status: { scope: 'codex', state: 'unknown' } }).counts, '');
});

test('docking retains native width and margins instead of re-rounding visible height', () => {
  assert.equal(appearanceModel(appearance).height, 140);
  assert.deepEqual(appearanceCommand(appearance, { corner: 'top-left' }), { type: 'appearance', size: 396, corner: 'top-left', marginX: 20, marginY: 12 });
});

test('height control converts visible pixels and clamps both ends to allowed native widths', () => {
  const target = appearanceCommand(appearance, { height: 200 });
  assert.equal(target.size, 565);
  assert.equal(Math.round(target.size * appearance.metrics.visibleHeightRatio), 200);
  assert.equal(appearanceCommand(appearance, { height: 9999 }).size, 1200);
  assert.ok(appearanceCommand(appearance, { height: -1 }).size >= 160);
  assert.throws(() => appearanceCommand(appearance, { height: NaN }), /invalid-height/);
  assert.throws(() => appearanceCommand({ size: 396 }), /appearance-unavailable/);
});

const settle = () => new Promise(resolve => setImmediate(resolve));
function pollerHarness(snapshot) {
  let time = 0, sequence = 0;
  const timers = new Map(), received = [], failures = [];
  const poller = createPoller({ snapshot, receive: (v, meta) => received.push({ v, meta }), failure: e => failures.push(e), now: () => time, setTimer(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; }, clearTimer: id => timers.delete(id) });
  return { poller, received, failures, timers, async next() { const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || []; assert.ok(timer, 'timer scheduled'); timers.delete(id); time = timer.at; timer.fn(); await settle(); } };
}

test('polling reads state every second and usage every five seconds in one request lane', async () => {
  const calls = [];
  const harness = pollerHarness(async options => { calls.push(options); return { ok: true }; });
  harness.poller.start(); await settle();
  for (let i = 0; i < 5; i++) await harness.next();
  assert.deepEqual(calls.map(v => v.includeUsage), [true, false, false, false, false, true]);
  harness.poller.stop();
  assert.equal(harness.timers.size, 0);
});

test('slow snapshots do not overlap and closing ignores late results', async () => {
  let complete, calls = 0;
  const harness = pollerHarness(() => { calls++; return new Promise(resolve => { complete = resolve; }); });
  harness.poller.start();
  harness.poller.refresh(); harness.poller.refresh({ usage: true });
  assert.equal(calls, 1);
  harness.poller.stop();
  complete({ ok: true }); await settle();
  assert.equal(harness.received.length, 0);
  assert.equal(harness.timers.size, 0);
});

test('a failed IPC read remains recoverable and does not end polling', async () => {
  let calls = 0;
  const harness = pollerHarness(async () => { if (++calls === 1) throw new Error('disconnected'); return { ok: true, status: { state: 'idle' } }; });
  harness.poller.start(); await settle();
  assert.equal(harness.failures.length, 1);
  await harness.next();
  assert.equal(harness.received[0].v.status.state, 'idle');
  harness.poller.stop();
});
