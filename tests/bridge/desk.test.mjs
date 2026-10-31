import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeskService, validDeskCommand } from '../../src/desk/service.mjs';
import { STORIES, STORY_IDS } from '../../src/desk/stories.mjs';

const MINUTE = 60_000;
const flush = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-desk-'));
  let at = 1_800_000_000_000;
  const now = () => at;
  const service = await createDeskService({ dataDir, now, autoTick: false, ...extra });
  t.after(() => service.close());
  return { service, dataDir, now, advance: ms => { at += ms; } };
}

test('desk starts with local 25/5 defaults and six complete fictional translations', async t => {
  const { service } = await fixture(t);
  const value = await service.snapshot();
  assert.equal(value.focus.status, 'idle'); assert.equal(value.focus.phase, 'focus');
  assert.equal(value.focus.focusMinutes, 25); assert.equal(value.focus.breakMinutes, 5);
  assert.equal(value.focus.remainingMs, 25 * MINUTE); assert.equal(value.focus.endsAt, null);
  assert.deepEqual(value.notes, []); assert.equal(value.journal.fictional, true);
  assert.equal(value.journal.originalArtist.name, '@ZipZipPipe'); assert.equal(value.journal.permission, 'non-commercial');
  assert.deepEqual(STORIES.map(story => story.title['zh-CN']), ['风铃下的名字', '那枚玫瑰', '歪了一点的书签', '没写满的一页', '窗边的微光', '第一条见闻']);
  assert.equal(new Set(STORY_IDS).size, 6);
  for (const story of STORIES) {
    const count = [...story.body['zh-CN'].matchAll(/\p{Script=Han}/gu)].length;
    assert.ok(count >= 150 && count <= 250, `${story.id}: ${count}`);
    for (const language of ['zh-CN', 'zh-TW', 'en']) {
      assert.ok(story.title[language].length > 0); assert.ok(story.body[language].length > 100);
      assert.equal(story.body[language].includes('\uFFFD'), false);
    }
  }
  value.journal.entries[0].body.en = 'changed';
  assert.notEqual((await service.snapshot()).journal.entries[0].body.en, 'changed');
});

test('desk command whitelist rejects invalid ranges, extra capabilities and non-user note sources', () => {
  const bad = [null, [], {}, { type: 'fetch', url: 'https://example.invalid' }, { type: 'focus.pause', path: '../data' },
    { type: 'focus.configure', focusMinutes: 9, breakMinutes: 5 }, { type: 'focus.configure', focusMinutes: 121, breakMinutes: 5 },
    { type: 'focus.configure', focusMinutes: 25, breakMinutes: 0 }, { type: 'focus.configure', focusMinutes: 25, breakMinutes: 31 },
    { type: 'focus.configure', focusMinutes: 25.5, breakMinutes: 5 }, { type: 'focus.start', phase: 'automatic' },
    { type: 'focus.suspend', reason: 'user-is-tired' }, { type: 'story.select', id: '../other-file' },
    { type: 'story.position', id: STORY_IDS[0], position: 1.01 }, { type: 'story.position', id: STORY_IDS[0], position: NaN },
    { type: 'note.create', text: 'from chat', threadId: 'chat' }, { type: 'note.create', text: ' ' },
    { type: 'note.create', text: 'a'.repeat(1001) }, { type: 'note.create', text: 'bad\u0000text' }];
  for (const value of bad) assert.equal(validDeskCommand(value), false, JSON.stringify(value));
  for (const value of [{ type: 'focus.start' }, { type: 'focus.start', phase: 'break' }, { type: 'focus.suspend' },
    { type: 'focus.configure', focusMinutes: 10, breakMinutes: 1 }, { type: 'focus.configure', focusMinutes: 120, breakMinutes: 30 },
    { type: 'story.favorite', id: STORY_IDS[0], favorite: true }, { type: 'story.position', id: STORY_IDS[0], position: 0 },
    { type: 'note.create', text: '手动便签\nNext step' }]) assert.equal(validDeskCommand(value), true);
});

test('focus pause/resume preserves time, completes once and starts neither break nor next round', async t => {
  const notices = [];
  const f = await fixture(t, { onNotice: async notice => { notices.push(notice); await f.service.consumeNotice(notice.id); } });
  await f.service.command({ type: 'focus.configure', focusMinutes: 10, breakMinutes: 1 });
  const running = await f.service.command({ type: 'focus.start', phase: 'focus' });
  assert.equal(running.focus.endsAt, f.now() + 10 * MINUTE);
  await assert.rejects(f.service.command({ type: 'focus.start' }), { reason: 'focus-busy', status: 409 });
  await assert.rejects(f.service.command({ type: 'focus.configure', focusMinutes: 20, breakMinutes: 5 }), { reason: 'focus-busy' });
  f.advance(2 * MINUTE);
  let value = await f.service.command({ type: 'focus.pause' });
  assert.equal(value.focus.remainingMs, 8 * MINUTE); assert.equal(value.focus.pauseReason, 'manual');
  f.advance(60 * MINUTE);
  assert.equal((await f.service.snapshot()).focus.remainingMs, 8 * MINUTE);
  await f.service.command({ type: 'focus.resume' });
  f.advance(8 * MINUTE);
  const finished = await f.service.tick(); await flush();
  assert.equal(finished.snapshot.focus.status, 'completed'); assert.equal(finished.snapshot.focus.phase, 'focus');
  assert.equal(notices.length, 1); assert.equal(notices[0].phase, 'focus');
  f.advance(10 * MINUTE);
  await f.service.tick(); await f.service.snapshot(); await flush();
  assert.equal(notices.length, 1); assert.equal((await f.service.snapshot()).focus.status, 'completed');
  await f.service.command({ type: 'focus.start', phase: 'break' });
  f.advance(MINUTE); await f.service.tick(); await flush();
  assert.equal(notices.length, 2); assert.equal(notices[1].phase, 'break');
  assert.equal((await f.service.snapshot()).focus.status, 'completed');
  value = await f.service.command({ type: 'focus.stop' });
  assert.equal(value.focus.status, 'idle'); assert.equal(value.focus.phase, 'focus'); assert.equal(value.focus.remainingMs, 10 * MINUTE);
});

test('sleep suspend and missing timer ticks pause rather than finish while away', async t => {
  const f = await fixture(t, { detectSleep: true });
  await f.service.command({ type: 'focus.start' });
  f.advance(5000); await f.service.tick();
  f.advance(60 * MINUTE);
  let value = await f.service.tick();
  assert.equal(value.snapshot.focus.status, 'paused'); assert.equal(value.snapshot.focus.pauseReason, 'sleep');
  assert.equal(value.snapshot.focus.remainingMs, 25 * MINUTE - 5000); assert.deepEqual(value.notices, []);
  await f.service.command({ type: 'focus.resume' });
  f.advance(3000); value = await f.service.suspend('sleep');
  assert.equal(value.focus.remainingMs, 25 * MINUTE - 8000); assert.equal(value.focus.pauseReason, 'sleep');
});

test('a rejected first wake operation cannot commit its sleep-observation clock or complete the timer', async t => {
  const notices = [], f = await fixture(t, { detectSleep: true, onNotice: notice => notices.push(notice) });
  await f.service.command({ type: 'focus.start' });
  f.advance(5000); await f.service.tick();
  f.advance(60 * MINUTE);
  // The sleep detector has already paused the transaction draft. Rejecting a
  // manual pause may not make the following read count the intervening hour.
  await assert.rejects(f.service.command({ type: 'focus.pause' }), { reason: 'focus-not-running' });
  f.advance(1);
  const value = await f.service.snapshot(); await flush();
  assert.equal(value.focus.status, 'paused'); assert.equal(value.focus.pauseReason, 'sleep');
  assert.equal(value.focus.remainingMs, 25 * MINUTE - 5000); assert.deepEqual(notices, []);
});

async function temporarilyBlockDeskWrites(dataDir) {
  const file = join(dataDir, 'desk.json'), retained = join(dataDir, 'retained-desk.json');
  await rename(file, retained);
  await mkdir(file); // Make atomic replacement fail; no real user path is involved.
  return async () => {
    // Retain every test artifact, including the empty blocker; do not delete.
    await rename(file, join(dataDir, 'retained-blocker-directory'));
    await rename(retained, file);
  };
}

test('a failed sleep checkpoint keeps the prior clock and retries paused without a false notice', async t => {
  const notices = [], f = await fixture(t, { detectSleep: true, onNotice: notice => notices.push(notice) });
  await f.service.command({ type: 'focus.start' });
  f.advance(5000); await f.service.tick();
  const restoreWrites = await temporarilyBlockDeskWrites(f.dataDir);
  try {
    f.advance(60 * MINUTE);
    await assert.rejects(f.service.tick(), { reason: 'desk-storage-unavailable' });
    await flush(); assert.deepEqual(notices, []);
  } finally { await restoreWrites(); }
  f.advance(1);
  const value = await f.service.snapshot(); await flush();
  assert.equal(value.focus.status, 'paused'); assert.equal(value.focus.pauseReason, 'sleep');
  assert.equal(value.focus.remainingMs, 25 * MINUTE - 5000); assert.deepEqual(notices, []);
  const stored = JSON.parse(await readFile(join(f.dataDir, 'desk.json'), 'utf8'));
  assert.equal(stored.focus.status, 'paused'); assert.deepEqual(stored.notices, []);
});

test('a failed completion write emits nothing, then commits exactly one real completion after recovery', async t => {
  const notices = [], f = await fixture(t, { detectSleep: false, onNotice: notice => notices.push(notice) });
  await f.service.command({ type: 'focus.start' });
  const restoreWrites = await temporarilyBlockDeskWrites(f.dataDir);
  try {
    f.advance(25 * MINUTE);
    await assert.rejects(f.service.tick(), { reason: 'desk-storage-unavailable' });
    await flush(); assert.deepEqual(notices, []);
  } finally { await restoreWrites(); }
  const value = await f.service.snapshot(); await flush();
  assert.equal(value.focus.status, 'completed'); assert.equal(value.focus.remainingMs, 0); assert.equal(notices.length, 1);
  await f.service.tick(); await flush(); assert.equal(notices.length, 1);
});

test('closing pauses persistently, keeps notes and reading preferences, and restart needs manual resume', async t => {
  const f = await fixture(t);
  await f.service.command({ type: 'note.create', text: 'only what I typed' });
  await f.service.command({ type: 'story.select', id: STORY_IDS[2] });
  await f.service.command({ type: 'story.favorite', id: STORY_IDS[2], favorite: true });
  await f.service.command({ type: 'story.position', id: STORY_IDS[2], position: 0.625 });
  await f.service.command({ type: 'focus.start' });
  f.advance(65_000); await f.service.close();
  f.advance(24 * 60 * MINUTE);
  const notices = [];
  const recovered = await createDeskService({ dataDir: f.dataDir, now: f.now, autoTick: false, onNotice: n => notices.push(n) });
  t.after(() => recovered.close());
  const value = await recovered.snapshot();
  assert.equal(value.focus.status, 'paused'); assert.equal(value.focus.pauseReason, 'app-exit');
  assert.equal(value.focus.remainingMs, 25 * MINUTE - 65_000); assert.equal(value.focus.endsAt, null);
  assert.equal(value.notes[0].text, 'only what I typed'); assert.equal(value.journal.selectedId, STORY_IDS[2]);
  assert.equal(value.journal.positionById[STORY_IDS[2]], 0.625);
  assert.equal(value.journal.entries.find(s => s.id === STORY_IDS[2]).favorite, true);
  assert.equal(value.journal.entries.find(s => s.id === STORY_IDS[2]).read, true); assert.deepEqual(notices, []);
});

test('crash recovery pauses from its checkpoint and never replays historical pending completion', async t => {
  const f = await fixture(t);
  await f.service.command({ type: 'focus.start' });
  f.advance(20_000); await f.service.tick(); await f.service.close();
  const file = join(f.dataDir, 'desk.json');
  const stored = JSON.parse(await readFile(file, 'utf8'));
  stored.focus.status = 'running'; stored.focus.endsAt = f.now() + stored.focus.remainingMs; stored.focus.pauseReason = null;
  await writeFile(file, JSON.stringify(stored));
  f.advance(12 * 60 * MINUTE);
  let calls = 0;
  const recovered = await createDeskService({ dataDir: f.dataDir, now: f.now, autoTick: false, onNotice: () => { calls++; } });
  assert.equal((await recovered.snapshot()).focus.status, 'paused');
  assert.equal((await recovered.snapshot()).focus.remainingMs, 25 * MINUTE - 20_000);
  await recovered.command({ type: 'focus.resume' });
  f.advance(25 * MINUTE); await recovered.tick(); await flush();
  assert.equal(calls, 1); await recovered.close();
  const again = await createDeskService({ dataDir: f.dataDir, now: f.now, autoTick: false, onNotice: () => { calls++; } });
  t.after(() => again.close()); await again.tick(); await flush();
  assert.equal((await again.snapshot()).focus.status, 'completed'); assert.equal(calls, 1);
  assert.deepEqual((await again.tick()).notices, []);
});

test('manual notes CRUD, pin/archive and story writes are serialized without dropping concurrent changes', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dataDir, 'plugin-config.json'), '{"language":"en","unrelated":true}\n');
  await Promise.all(Array.from({ length: 25 }, (_, i) => f.service.command({ type: 'note.create', text: `note ${i}` })));
  let value = await f.service.snapshot(); assert.equal(value.notes.length, 25);
  assert.equal(new Set(value.notes.map(note => note.text)).size, 25);
  const id = value.notes[0].id;
  await Promise.all([
    f.service.command({ type: 'note.update', id, text: '<script>literal user text</script>' }),
    f.service.command({ type: 'note.pin', id, pinned: true }),
    f.service.command({ type: 'note.archive', id, archived: true }),
    f.service.command({ type: 'story.favorite', id: STORY_IDS[1], favorite: true }),
    f.service.command({ type: 'story.position', id: STORY_IDS[1], position: 0.9 }),
  ]);
  value = await f.service.snapshot();
  assert.equal(value.notes[0].id, id); assert.equal(value.notes[0].text, '<script>literal user text</script>');
  assert.equal(value.notes[0].pinned, true); assert.equal(value.notes[0].archived, true);
  assert.equal(value.journal.positionById[STORY_IDS[1]], 0.9); assert.equal(value.journal.entries[1].favorite, true);
  value = await f.service.command({ type: 'note.delete', id }); assert.equal(value.notes.length, 24);
  await assert.rejects(f.service.command({ type: 'note.update', id, text: 'missing' }), { reason: 'desk-note-not-found' });
  assert.equal(await readFile(join(f.dataDir, 'plugin-config.json'), 'utf8'), '{"language":"en","unrelated":true}\n');
  assert.deepEqual((await readdir(f.dataDir)).sort(), ['desk.json', 'plugin-config.json']);
});

test('corrupt or incompatible local state is preserved instead of silently overwritten', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-desk-invalid-'));
  const file = join(dataDir, 'desk.json');
  for (const text of ['half {', '{"schemaVersion":99}', '{"schemaVersion":1,"notes":[]}']) {
    await writeFile(file, text);
    await assert.rejects(createDeskService({ dataDir, autoTick: false }), e => /^desk-storage-(invalid|incompatible)$/.test(e.reason));
    assert.equal(await readFile(file, 'utf8'), text);
  }
});

test('one writer owns a data directory and notification callback failures are contained', async t => {
  const f = await fixture(t, { onNotice: async () => { throw new Error('simulated notification failure'); } });
  await assert.rejects(createDeskService({ dataDir: f.dataDir, autoTick: false }), { reason: 'desk-already-open', status: 409 });
  await f.service.command({ type: 'focus.configure', focusMinutes: 10, breakMinutes: 1 });
  await f.service.command({ type: 'focus.start' });
  f.advance(10 * MINUTE); const result = await f.service.tick(); await flush();
  assert.equal(result.notices.length, 1); assert.equal(result.snapshot.focus.status, 'completed');
  const id = result.notices[0].id;
  assert.deepEqual(await f.service.consumeNotice(id), { consumed: true });
  assert.deepEqual(await f.service.consumeNotice(id), { consumed: false });
  await assert.rejects(f.service.consumeNotice('../file'), { reason: 'invalid-desk-notice' });
  await f.service.close();
  await assert.rejects(f.service.command({ type: 'focus.start' }), { reason: 'desk-unavailable' });
});

test('timer ticks independently of a tools window and reaches completed while no snapshot is requested', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-desk-tick-'));
  let at = 1_800_000_000_000, received;
  const noticeReady = new Promise(resolve => { received = resolve; });
  const service = await createDeskService({ dataDir, now: () => at, autoTick: true, detectSleep: false, tickIntervalMs: 50, onNotice: received });
  t.after(() => service.close());
  await service.command({ type: 'focus.start' }); at += 25 * MINUTE;
  const notice = await Promise.race([noticeReady, new Promise((_, reject) => setTimeout(() => reject(new Error('timer did not tick')), 1500))]);
  assert.equal(notice.phase, 'focus'); assert.equal((await service.snapshot()).focus.status, 'completed');
});
