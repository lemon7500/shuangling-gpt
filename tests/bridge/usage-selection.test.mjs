import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageSelectionStore } from '../../src/bridge/usage-selection.mjs';
import { UsageTargetSelection } from '../../src/bridge/active-usage.mjs';
import { ActiveSelectionReader } from '../../src/bridge/active-selection.mjs';

const selection = id => ({ status: 'available', threadId: id, scope: 'thread' });
const navigation = () => ({
  snapshot: async () => ({ status: 'unknown' }),
  listThreads: async () => ['a', 'b', 'c'].map(threadId => ({ threadId })),
  resolveThread: async id => ['a', 'b', 'c'].includes(id) ? selection(id) : { status: 'unknown' },
});

function memoryStore(initial) {
  const files = new Map();
  const writes = [];
  let failWrite = false, failRename = false;
  const options = {
    dataDir: 'X:/isolated-usage-preference',
    readFileImpl: async file => {
      if (!files.has(file)) throw Object.assign(Error('missing'), { code: 'ENOENT' });
      return files.get(file);
    },
    writeFileImpl: async (file, text, mode) => {
      if (failWrite) throw Object.assign(Error('unwritable'), { code: 'EACCES' });
      writes.push({ file, text, mode }); files.set(file, text);
    },
    renameImpl: async (from, to) => {
      if (failRename) throw Object.assign(Error('blocked'), { code: 'EPERM' });
      files.set(to, files.get(from)); files.delete(from);
    },
  };
  const store = new UsageSelectionStore(options);
  if (initial !== undefined) files.set(store.path, initial);
  return { store, options, files, writes,
    setFailWrite: value => { failWrite = value; },
    setFailRename: value => { failRename = value; } };
}

test('usage store treats missing, damaged, oversized and invalid saved IDs as unselected', async () => {
  const fixture = memoryStore();
  assert.equal(await fixture.store.read(), null);
  for (const raw of ['not json', 'null', '[]', '{}', '{"version":2,"threadId":"a"}',
    '{"version":1,"threadId":"../a"}', '{"version":1,"threadId":""}',
    '{"version":1,"threadId":42}', JSON.stringify({ version: 1, threadId: 'x'.repeat(121) }),
    ' '.repeat(4097)]) {
    fixture.files.set(fixture.store.path, raw);
    assert.equal(await fixture.store.read(), null, raw.slice(0, 80));
  }
  const inaccessible = new UsageSelectionStore({ dataDir: 'X:/isolated', readFileImpl: async () => { throw Error('EACCES'); } });
  assert.equal(await inaccessible.read(), null);
});

test('usage store writes only a version and ID using a private atomic replacement', async () => {
  const { store, options, files, writes } = memoryStore();
  await store.save('a'); await store.save('b');
  assert.equal(await new UsageSelectionStore(options).read(), 'b');
  assert.deepEqual(JSON.parse(files.get(store.path)), { version: 1, threadId: 'b' });
  assert.equal(writes.length, 2);
  for (const write of writes) {
    assert.notEqual(write.file, store.path, 'the existing choice is never overwritten in place');
    assert.deepEqual(write.mode, { mode: 0o600 });
    assert.deepEqual(Object.keys(JSON.parse(write.text)).sort(), ['threadId', 'version']);
  }
  assert.notEqual(writes[0].file, writes[1].file, 'each operation has its own temporary file');
  assert.equal(files.size, 1);
  await assert.rejects(store.save('../untrusted'));
  assert.equal(writes.length, 2);
});

test('write and rename failures preserve the previous durable choice and reject the switch', async () => {
  for (const failure of ['write', 'rename']) {
    const fixture = memoryStore(JSON.stringify({ version: 1, threadId: 'a' }));
    if (failure === 'write') fixture.setFailWrite(true); else fixture.setFailRename(true);
    await assert.rejects(fixture.store.save('b'), { reason: 'usage-selection-save-failed' });
    assert.equal(await fixture.store.read(), 'a');
    assert.deepEqual(JSON.parse(fixture.files.get(fixture.store.path)), { version: 1, threadId: 'a' });
  }
});

test('concurrent choices publish and persist in request order, never before the save completes', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let durable = 'a'; const trace = [];
  const target = new UsageTargetSelection({ navigationReader: navigation(), boundThreadId: () => 'a', selectedThreadId: 'a',
    persistSelection: async id => { trace.push(id); if (id === 'b') await barrier; durable = id; } });
  const first = target.choose('b'), second = target.choose('c');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(trace, ['b']); assert.equal(durable, 'a'); assert.equal(target.selectedThreadId, 'a');
  assert.equal((await target.snapshot()).threadId, 'a');
  release(); await Promise.all([first, second]);
  assert.deepEqual(trace, ['b', 'c']); assert.equal(durable, 'c'); assert.equal(target.selectedThreadId, 'c');
});

test('a failed choice leaves the visible selection intact and does not poison the next save', async () => {
  const binding = { threadId: 'a', paused: true };
  const fixture = memoryStore(JSON.stringify({ version: 1, threadId: 'a' }));
  const target = new UsageTargetSelection({ navigationReader: navigation(), boundThreadId: () => binding.threadId,
    selectedThreadId: await fixture.store.read(), persistSelection: id => fixture.store.save(id) });
  fixture.setFailRename(true);
  await assert.rejects(target.choose('b'), { reason: 'usage-selection-save-failed' });
  assert.equal(target.selectedThreadId, 'a'); assert.equal(await fixture.store.read(), 'a');
  fixture.setFailRename(false); await target.choose('c');
  assert.equal(target.selectedThreadId, 'c'); assert.equal(await fixture.store.read(), 'c');
  assert.deepEqual(binding, { threadId: 'a', paused: true });
});

test('invalid, unlisted and unverified selections cannot reach persistent storage', async () => {
  let saves = 0;
  const nav = navigation();
  nav.resolveThread = async id => id === 'b' ? selection('wrong') : { status: 'unknown' };
  const target = new UsageTargetSelection({ navigationReader: nav, boundThreadId: () => 'a', selectedThreadId: 'a',
    persistSelection: async () => { saves++; } });
  await assert.rejects(target.choose('../b'), { reason: 'invalid-usage-thread' });
  await assert.rejects(target.choose('child'), { reason: 'usage-thread-unavailable' });
  await assert.rejects(target.choose('a'), { reason: 'usage-thread-unavailable' });
  await assert.rejects(target.choose('b'), { reason: 'usage-thread-unavailable' });
  assert.equal(saves, 0); assert.equal(target.selectedThreadId, 'a');
});

test('a reconstructed selection revalidates saved roots and keeps an unavailable ID for recovery', async () => {
  const fixture = memoryStore(); await fixture.store.save('b');
  let metadataBroken = false;
  const metadata = { index: new Map([['a', { metadata: { source: 'root' } }], ['b', { metadata: { source: 'root' } }]]),
    refreshIndex: async () => { if (metadataBroken) throw Error('EACCES'); } };
  const nav = new ActiveSelectionReader({ metadataReader: metadata, readState: async () => ({}), readNameIndex: async () => '' });
  const target = new UsageTargetSelection({ navigationReader: nav, boundThreadId: () => 'a',
    selectedThreadId: await new UsageSelectionStore(fixture.options).read() });
  assert.equal((await target.snapshot()).threadId, 'b');
  assert.equal((await target.snapshot()).source, 'selected-chat');
  metadata.index.get('b').metadata.source = 'subagent';
  let result = await target.snapshot();
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'thread-not-root');
  assert.equal(result.threadId, 'b'); assert.equal(target.selectedThreadId, 'b');
  metadata.index.delete('b');
  assert.equal((await target.snapshot()).status, 'unknown');
  metadataBroken = true;
  assert.equal((await target.snapshot()).reason, 'thread-metadata-unavailable');
  metadataBroken = false; metadata.index.set('b', { metadata: { source: 'root' } });
  result = await target.snapshot(); assert.equal(result.status, 'available'); assert.equal(result.threadId, 'b');
  assert.equal(await fixture.store.read(), 'b', 'transient failures never erase the saved preference');
});

test('restoring an old verified root does not depend on the recent chat choice limit', async () => {
  const index = new Map(Array.from({ length: 205 }, (_, i) => [`recent-${i}`, { metadata: { source: 'root', timestamp: '2026-10-24T00:00:00Z' } }]));
  index.set('old-root', { metadata: { source: 'root', timestamp: '2020-01-01T00:00:00Z' } });
  const nav = new ActiveSelectionReader({ metadataReader: { index, refreshIndex: async () => {} }, readState: async () => ({}), readNameIndex: async () => '' });
  assert.ok(!(await nav.listThreads({ limit: 200 })).some(item => item.threadId === 'old-root'));
  const target = new UsageTargetSelection({ navigationReader: nav, boundThreadId: () => 'recent-0', selectedThreadId: 'old-root' });
  const result = await target.snapshot();
  assert.equal(result.status, 'available'); assert.equal(result.threadId, 'old-root'); assert.equal(result.source, 'selected-chat');
  assert.equal(result.choices[0].threadId, 'old-root');
  assert.ok(result.choices.length <= 200);
  assert.equal((await target.choose('old-root')).threadId, 'old-root');
});
