import test from 'node:test';
import assert from 'node:assert/strict';
import { ActiveUsageService, UsageTargetSelection } from '../../src/bridge/active-usage.mjs';

const selection = id => ({ status: 'available', threadId: id, projectId: `project-${id}`, projectName: id, projectThreadIds: [id], source: 'test-selected-page' });
const sample = id => ({ threadId: id, context: { status: 'available', remainingTokens: id === 'a' ? 100 : 200, windowTokens: 1000, remainingPercent: id === 'a' ? 10 : 20 }, account: {}, project: { status: 'available', usedTokens: id === 'a' ? 111 : 222, scope: 'thread' } });

test('usage follows the selected page while the caller task binding stays untouched', async () => {
  let active = 'a';
  const calls = [];
  const service = new ActiveUsageService({
    selectionReader: { snapshot: async () => selection(active) },
    projectReader: { snapshot: async input => { calls.push(input); return sample(input.threadId); } },
  });
  assert.equal((await service.snapshot()).project.usedTokens, 111);
  active = 'b';
  assert.equal((await service.snapshot()).project.usedTokens, 222);
  assert.deepEqual(calls.map(call => call.threadId), ['a', 'b']);
  assert.deepEqual(calls, [{ threadId: 'a', scope: 'thread' }, { threadId: 'b', scope: 'thread' }]);
});

test('default cumulative scope excludes other chats even when the selection has project membership', async () => {
  const service = new ActiveUsageService({
    selectionReader: { snapshot: async () => ({ ...selection('a'), projectThreadIds: ['a', 'b'], projectRoot: 'D:/shared' }) },
    projectReader: { snapshot: async input => ({ ...sample('a'), project: { status: 'available', scope: input.scope, usedTokens: input.scope === 'project' ? 333 : 111 } }) },
  });
  const result = await service.snapshot();
  assert.equal(result.project.scope, 'thread');
  assert.equal(result.project.usedTokens, 111);
  assert.match(result.summaryText, /本聊天已用：111/);
});

test('switching chats preserves the shared account sample while context and cumulative values change', async () => {
  let active = 'a';
  let account = { fiveHour: { status: 'available', remainingPercent: 61, resetsAt: 9999999999 }, weekly: { status: 'available', remainingPercent: 42, resetsAt: 9999999999 } };
  const service = new ActiveUsageService({
    selectionReader: { snapshot: async () => active ? selection(active) : { status: 'unknown' } },
    projectReader: { snapshot: async input => ({ ...sample(input.threadId), account: { fiveHour: { status: 'available', remainingPercent: input.threadId === 'a' ? 99 : 1 } } }) },
    accountSnapshot: () => account,
  });
  const first = await service.snapshot();
  active = 'b';
  const second = await service.snapshot();
  assert.notEqual(first.context.remainingTokens, second.context.remainingTokens);
  assert.notEqual(first.project.usedTokens, second.project.usedTokens);
  assert.deepEqual(first.account, account);
  assert.deepEqual(second.account, first.account);
  account = { fiveHour: { status: 'stale', reason: 'sample-expired' }, weekly: { status: 'unknown', reason: 'log-permission-denied' } };
  assert.deepEqual((await service.snapshot()).account, account);
  active = null;
  assert.deepEqual((await service.snapshot()).account, account);
});

test('an unavailable account source never falls back to the selected chat historic quota', async () => {
  for (const accountSnapshot of [() => null, () => { throw Error('unavailable'); }]) {
    const service = new ActiveUsageService({
      selectionReader: { snapshot: async () => selection('a') },
      projectReader: { snapshot: async () => ({ ...sample('a'), account: { fiveHour: { status: 'available', remainingPercent: 99 } } }) },
      accountSnapshot,
    });
    const result = await service.snapshot();
    assert.equal(result.account.fiveHour.status, 'unknown');
    assert.equal(result.account.fiveHour.remainingPercent, undefined);
    assert.equal(result.account.weekly.status, 'unknown');
  }
});

test('unknown current page clears context and totals instead of falling back to the bound task', async () => {
  let active = selection('a'), reads = 0;
  const service = new ActiveUsageService({
    selectionReader: { snapshot: async () => active },
    projectReader: { snapshot: async () => { reads++; return sample('a'); } },
    accountSnapshot: () => ({ fiveHour: { status: 'available', remainingPercent: 50 }, weekly: { status: 'unknown' } }),
  });
  await service.snapshot();
  active = { status: 'unknown', reason: 'no-selected-page' };
  const result = await service.snapshot();
  assert.equal(result.context.status, 'unknown');
  assert.equal(result.context.remainingTokens, undefined);
  assert.equal(result.project.usedTokens, undefined);
  assert.equal(result.threadId, null);
  assert.equal(result.account.fiveHour.remainingPercent, 50);
  assert.equal(reads, 1);
});

test('switching page during a slow read discards old totals and rereads the current page', async () => {
  let active = 'a';
  const service = new ActiveUsageService({
    selectionReader: { snapshot: async () => selection(active) },
    projectReader: { snapshot: async input => { if (input.threadId === 'a') active = 'b'; return sample(input.threadId); } },
  });
  const result = await service.snapshot();
  assert.equal(result.selection.threadId, 'b');
  assert.equal(result.context.remainingTokens, 200);
  assert.equal(result.project.usedTokens, 222);
});

test('repeated navigation and unreadable sources never leak the previous page numeric values', async () => {
  let number = 0;
  const service = new ActiveUsageService({
    selectionReader: { snapshot: async () => selection(`chat-${number++}`) },
    projectReader: { snapshot: async () => sample('a') },
  });
  const moving = await service.snapshot();
  assert.equal(moving.selection.reason, 'active-page-changing');
  assert.equal(moving.context.remainingTokens, undefined);
  const broken = new ActiveUsageService({ selectionReader: { snapshot: async () => { throw Error('private data'); } } });
  const unknown = await broken.snapshot();
  assert.equal(unknown.selection.reason, 'usage-source-unavailable');
  assert.ok(!JSON.stringify(unknown).includes('private data'));
});

test('concurrent view requests share a single read without adding background polling', async () => {
  let release, reads = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const service = new ActiveUsageService({
    selectionReader: { snapshot: async () => selection('a') },
    projectReader: { snapshot: async () => { reads++; await gate; return sample('a'); } },
  });
  const first = service.snapshot(), second = service.snapshot();
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  release();
  await first;
});

test('explicit usage selection never mutates the task binding or pretends to be current navigation', async () => {
  const binding = { threadId: 'a', paused: true };
  const reader = new UsageTargetSelection({
    boundThreadId: () => binding.threadId,
    navigationReader: {
      snapshot: async () => ({ status: 'unknown', reason: 'navigation-not-exposed' }),
      resolveThread: async id => ['a', 'b'].includes(id) ? { ...selection(id), threadName: id === 'a' ? '制作桌宠' : '核对数据' } : { status: 'unknown' },
      listThreads: async () => [{ threadId: 'a', threadName: '制作桌宠', projectName: 'A', body: 'PRIVATE BODY' }, { threadId: 'b', threadName: '核对数据', projectName: 'B' }],
    },
  });
  const first = await reader.snapshot();
  assert.equal(first.threadId, 'a');
  assert.equal(first.source, 'bound-chat');
  assert.equal(first.threadName, '制作桌宠');
  assert.deepEqual(first.choices[0], { threadId: 'a', threadName: '制作桌宠', projectName: 'A' });
  assert.ok(!JSON.stringify(first).includes('PRIVATE BODY'));
  await reader.choose('b');
  const second = await reader.snapshot();
  assert.equal(second.threadId, 'b');
  assert.equal(second.source, 'selected-chat');
  assert.equal(second.threadName, '核对数据');
  assert.deepEqual(binding, { threadId: 'a', paused: true });
  await assert.rejects(reader.choose('child'), { reason: 'usage-thread-unavailable' });
  assert.equal((await reader.snapshot()).threadId, 'b');
});

test('a verified chat without project membership stays labeled as chat usage', async () => {
  let requested;
  const service = new ActiveUsageService({
    selectionReader: { snapshot: async () => ({ ...selection('a'), scope: 'thread' }) },
    projectReader: { snapshot: async input => { requested = input; return { ...sample('a'), project: { ...sample('a').project, scope: input.scope } }; } },
  });
  const result = await service.snapshot();
  assert.equal(requested.scope, 'thread');
  assert.equal(result.project.scope, 'thread');
  assert.match(result.summaryText, /本聊天已用/);
});
