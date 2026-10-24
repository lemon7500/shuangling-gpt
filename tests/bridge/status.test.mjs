import test from 'node:test';
import assert from 'node:assert/strict';
import { StatusReducer } from '../../src/bridge/status.mjs';

const timestamp = '2026-10-21T01:00:00Z';
const event = (type, payload) => ({ type, timestamp, payload });
const meta = id => event('session_meta', { id, base_instructions: 'PRIVATE BODY' });
const start = (turn_id = 'turn-1', extra = {}) => event('event_msg', { type: 'task_started', turn_id, root_turn_id: turn_id, ...extra });
const item = (type, call_id, extra = {}) => event('response_item', { type, call_id, ...extra });

test('verified root turn, matched input IDs, completion, interruption and duplicate replay', () => {
  const changes = [];
  const r = new StatusReducer('root', s => changes.push(s.state));
  r.accept(meta('root'));
  r.accept(start());
  r.accept(item('function_call', 'ask-1', { name: 'functions.request_user_input', arguments: 'PRIVATE BODY' }));
  r.accept({ ...start(), timestamp: '2026-10-21T01:00:01Z' });
  assert.equal(r.snapshot().state, 'waiting', 'repeated start must not clear pending input');
  r.accept(item('function_call_output', 'other-tool', { output: 'tool failed PRIVATE BODY' }));
  assert.equal(r.snapshot().state, 'waiting');
  r.accept(item('function_call', 'ask-2', { name: 'request_user_input_async' }));
  r.accept(item('function_call_output', 'ask-1'));
  assert.equal(r.snapshot().state, 'waiting');
  r.accept(item('function_call_output', 'ask-2'));
  assert.equal(r.snapshot().state, 'working');
  const complete = event('event_msg', { type: 'task_complete', turn_id: 'turn-1', last_agent_message: 'PRIVATE BODY' });
  r.accept(complete); r.accept(complete); r.accept(start());
  assert.equal(r.snapshot().state, 'complete');
  r.accept(start('turn-2'));
  r.accept(event('event_msg', { type: 'turn_aborted', turn_id: 'turn-2', reason: 'PRIVATE BODY' }));
  assert.equal(r.snapshot().state, 'interrupted');
  assert.deepEqual(changes, ['idle', 'working', 'waiting', 'working', 'complete', 'working', 'interrupted']);
  assert.ok(!JSON.stringify(r.snapshot()).includes('PRIVATE BODY'));
});

test('other threads, nested turns, subagents and tool failures cannot finish current root', () => {
  const r = new StatusReducer('root');
  r.accept(meta('root')); r.accept(start());
  r.accept(start('child', { root_turn_id: 'turn-1' }));
  r.accept(event('event_msg', { type: 'task_complete', turn_id: 'child', root_turn_id: 'turn-1' }));
  r.accept(event('event_msg', { type: 'task_complete', turn_id: 'turn-1', thread_id: 'other' }));
  r.accept(item('function_call_output', 'tool', { output: 'Error' }));
  r.accept(event('event_msg', { type: 'agent_message', message: 'done' }));
  assert.equal(r.snapshot().state, 'working');
  const child = new StatusReducer('child');
  child.accept(event('session_meta', { id: 'child', session_id: 'root', thread_source: 'subagent' }));
  child.accept(start());
  assert.equal(child.snapshot().state, 'unknown');
});

test('unknown state never invents completion and reset clears attribution', () => {
  const r = new StatusReducer('root');
  r.accept(start()); assert.equal(r.snapshot().state, 'unknown');
  r.accept(meta('root')); r.accept(start());
  r.unavailable('log-permission-denied'); assert.equal(r.snapshot().state, 'unknown');
  r.reset();
  assert.equal(r.snapshot().rootTurnId, null);
  assert.equal(r.snapshot().turnId, null);
});
