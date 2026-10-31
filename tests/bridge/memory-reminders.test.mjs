import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryReminders } from '../../src/desk/reminders.mjs';

function fixture(overrides = {}) {
  const calls = [], prompt = { id: 'daily:2026-10-27', kind: 'daily', date: '2026-10-27' };
  let claimed = false;
  const controller = { status: { state: 'idle' }, closed: false, paused: false, preempted: false, surfaceReloading: false,
    lockId: 'existing-lease', interaction: { phase: 'settled' }, client: { appearance: async () => ({ display: 'desktop' }) },
    observeRestInteraction: async () => {}, companionNotice: async text => { calls.push(['notice', text]); return true; }, ...overrides };
  const desk = { snapshot: async () => ({ memories: { enabled: true, reminders: true, prompt } }),
    claimMemoryPrompt: async id => { calls.push(['claim', id]); if (claimed) return false; claimed = true; return true; } };
  const pump = createMemoryReminders({ desk, controller, getLanguage: async () => 'en', autoTick: false });
  return { controller, desk, pump, calls, prompt };
}

test('daily hints claim once and use the chosen language without requesting animation or a new lease', async () => {
  const f = fixture();
  assert.equal(await f.pump.tick(), true);
  assert.equal(await f.pump.tick(), false);
  assert.equal(f.calls.filter(c => c[0] === 'notice').length, 1);
  assert.match(f.calls.find(c => c[0] === 'notice')[1], /A new page/);
  await f.pump.close();
  assert.equal(await f.pump.tick(), false);
});

test('work, waiting, pause, manual control, dragging, absent lease and hidden pet never claim a hint', async () => {
  for (const overrides of [{ status: { state: 'working' } }, { status: { state: 'waiting' } }, { paused: true }, { preempted: true },
    { surfaceReloading: true }, { lockId: null }, { interaction: { phase: 'dragging' } }, { interaction: { phase: 'throwing' } },
    { client: { appearance: async () => ({ display: 'none' }) } }, { client: { appearance: async () => ({ display: 'web' }) } }]) {
    const f = fixture(overrides);
    assert.equal(await f.pump.tick(), false);
    assert.deepEqual(f.calls, []);
    await f.pump.close();
  }
});

test('disabled collection or reminders and a native takeover during read-only probing suppress hints', async () => {
  for (const memory of [{ enabled: false, reminders: true }, { enabled: true, reminders: false }, { enabled: true, reminders: true, prompt: null }]) {
    const f = fixture(); f.desk.snapshot = async () => ({ memories: { prompt: f.prompt, ...memory } });
    assert.equal(await f.pump.tick(), false); assert.deepEqual(f.calls, []); await f.pump.close();
  }
  const f = fixture(); f.controller.observeRestInteraction = async () => { f.controller.preempted = true; };
  assert.equal(await f.pump.tick(), false); assert.deepEqual(f.calls, []); await f.pump.close();
});

test('concurrent timer ticks share one delivery and a failed delivery is not replayed', async () => {
  const f = fixture(); let release;
  f.desk.snapshot = async () => { await new Promise(r => { release = r; }); return { memories: { enabled: true, reminders: true, prompt: f.prompt } }; };
  const a = f.pump.tick(), b = f.pump.tick(); assert.equal(a, b); release();
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(f.calls.filter(c => c[0] === 'notice').length, 1); await f.pump.close();
  const failed = fixture(); failed.controller.companionNotice = async () => { failed.calls.push(['failed']); throw Error('offline'); };
  assert.equal(await failed.pump.tick(), false); assert.equal(await failed.pump.tick(), false);
  assert.equal(failed.calls.filter(c => c[0] === 'failed').length, 1); await failed.pump.close();
});

test('continuation and Traditional Chinese messages stay local and do not embed bookmark text', async () => {
  const f = fixture(); f.prompt.kind = 'continue';
  const pump = createMemoryReminders({ desk: f.desk, controller: f.controller, getLanguage: async () => 'zh-TW', autoTick: false });
  assert.equal(await pump.tick(), true);
  assert.match(f.calls.find(c => c[0] === 'notice')[1], /書籤/);
  assert.equal(f.calls.find(c => c[0] === 'notice').length, 2);
  await pump.close(); await f.pump.close();
});

test('task activity beginning while the durable claim is saved suppresses delivery', async () => {
  const f = fixture(); f.desk.claimMemoryPrompt = async () => { f.controller.status.state = 'working'; return true; };
  assert.equal(await f.pump.tick(), false);
  assert.deepEqual(f.calls, []); await f.pump.close();
});
