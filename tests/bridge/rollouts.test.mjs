import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RolloutWatcher, listThreads } from '../../src/bridge/rollouts.mjs';

const line = (type, payload) => JSON.stringify({ type, timestamp: '2026-10-21T01:00:00Z', payload }) + '\n';
const meta = (id = 'root', extra = {}) => line('session_meta', { id, timestamp: '2026-10-21T01:00:00Z', base_instructions: 'PRIVATE BODY', ...extra });
const start = turn_id => line('event_msg', { type: 'task_started', turn_id, root_turn_id: turn_id });
const done = turn_id => line('event_msg', { type: 'task_complete', turn_id, last_agent_message: 'PRIVATE BODY' });
async function setup(t) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'shuangling-bridge-'));
  const sessions = join(dir, 'sessions', '2026', '10', '21');
  await fs.mkdir(sessions, { recursive: true });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, sessions, path: join(sessions, 'rollout-2026-10-21-root.jsonl') };
}

test('byte-offset reader waits for newline, preserves split UTF-8, ignores duplicate/current-child events', async t => {
  const { dir, path } = await setup(t);
  const published = [];
  await fs.writeFile(path, meta() + start('t1'));
  const w = new RolloutWatcher({ codexHome: dir, threadId: 'root', onChange: s => published.push(s) });
  await w.tick(); assert.equal(w.snapshot().state, 'working');
  const complete = Buffer.from(done('t1'));
  await fs.appendFile(path, complete.subarray(0, 31));
  await w.tick(); assert.equal(w.snapshot().state, 'working');
  await fs.appendFile(path, complete.subarray(31));
  await w.tick(); assert.equal(w.snapshot().state, 'complete');
  await fs.appendFile(path, done('t1') + start('t1') + done('other'));
  await w.tick(); assert.equal(w.snapshot().state, 'complete');
  assert.equal(published.filter(s => s.state === 'complete').length, 1);
  const unicode = Buffer.from(line('event_msg', { type: 'agent_message', message: '银白龙女 PRIVATE BODY' }));
  const cut = unicode.indexOf(Buffer.from('银')) + 1;
  await fs.appendFile(path, unicode.subarray(0, cut)); await w.tick();
  await fs.appendFile(path, unicode.subarray(cut)); await w.tick();
  assert.equal(w.snapshot().state, 'complete');
  assert.ok(!JSON.stringify(published).includes('PRIVATE BODY'));
  await w.close();
});

test('truncate and replacement rotation replay once to current state; no false historic celebration', async t => {
  const { dir, path } = await setup(t);
  const states = [];
  await fs.writeFile(path, meta() + start('t1') + done('t1'));
  const w = new RolloutWatcher({ codexHome: dir, threadId: 'root', onChange: s => states.push(s.state) });
  await w.tick(); assert.deepEqual(states, ['complete']);
  await fs.writeFile(path, meta() + start('t2'));
  await w.tick(); assert.equal(w.snapshot().state, 'working');
  // A truncate/refill may already have reached the old length between polls.
  await fs.writeFile(path, meta() + start('t5'));
  await w.tick(); assert.equal(w.snapshot().turnId, 't5');
  await fs.rename(path, `${path}.old`);
  await fs.writeFile(path, meta() + start('t3') + line('event_msg', { type: 'turn_aborted', turn_id: 't3' }));
  await w.tick(); assert.equal(w.snapshot().state, 'interrupted');
  await fs.unlink(path); await w.tick(); assert.equal(w.snapshot().state, 'unknown');
  await fs.writeFile(path, meta() + start('t4')); await w.tick(); assert.equal(w.snapshot().state, 'working');
  await w.close();
});

test('permissions lost and restored without new bytes recover; malformed complete record marks unknown', async t => {
  const { dir, path } = await setup(t);
  let denied = false;
  const fsApi = { ...fs, open: async (...args) => { if (denied) throw Object.assign(new Error('PRIVATE ERROR'), { code: 'EACCES' }); return fs.open(...args); } };
  await fs.writeFile(path, meta() + start('t1'));
  const w = new RolloutWatcher({ codexHome: dir, threadId: 'root', fsApi });
  await w.tick(); denied = true; await w.tick();
  assert.equal(w.snapshot().reason, 'log-permission-denied');
  denied = false; await w.tick(); assert.equal(w.snapshot().state, 'working');
  await fs.appendFile(path, '{bad complete record}\n'); await w.tick();
  assert.equal(w.snapshot().reason, 'log-format-incompatible');
  await fs.appendFile(path, done('t1')); await w.tick(); assert.equal(w.snapshot().state, 'complete');
  await w.close();
});

test('thread picker returns only allowlisted root metadata and verifies metadata.id instead of session_id', async t => {
  const { dir, sessions, path } = await setup(t);
  await fs.writeFile(path, meta());
  await fs.writeFile(join(sessions, 'rollout-child.jsonl'), meta('child', { session_id: 'root', parent_thread_id: 'root', thread_source: 'subagent' }));
  await fs.writeFile(join(sessions, 'rollout-spoof-root.jsonl'), meta('wrong', { session_id: 'root' }));
  const threads = await listThreads(dir);
  assert.ok(!threads.some(t => t.id === 'child'));
  assert.deepEqual(Object.keys(threads[0]).sort(), ['id', 'source', 'timestamp']);
  assert.ok(!JSON.stringify(threads).includes('PRIVATE BODY'));
  await fs.unlink(path);
  const w = new RolloutWatcher({ codexHome: dir, threadId: 'root' });
  await w.tick(); assert.equal(w.snapshot().state, 'unknown');
  await w.close();
});
