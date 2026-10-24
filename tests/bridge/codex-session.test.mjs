import test from 'node:test';
import assert from 'node:assert/strict';
import { currentCodexSessionStartedAt } from '../../src/bridge/index.mjs';

const utcTicks = time => String((BigInt(time) + 62135596800000n) * 10000n);
const now = Date.parse('2026-10-24T05:00:00Z');

test('global work session uses the earliest verified Codex GUI process creation time across windows', () => {
  assert.equal(currentCodexSessionStartedAt({ active: true, epochProcesses: [`12:${utcTicks(now - 3000)}`, `13:${utcTicks(now - 1000)}`] }, now), now - 3000);
  assert.equal(currentCodexSessionStartedAt({ active: true, windows: [`12:${utcTicks(now - 3000)}:999`] }, now), now - 3000);
  assert.equal(currentCodexSessionStartedAt({ active: true, epochProcesses: ['47624:639283773243217054'] }, now), Date.parse('2026-10-23T18:35:24.321Z'));
});

test('inactive, malformed and future process observations cannot become a global work session boundary', () => {
  for (const session of [null, { active: false, epochProcesses: [`12:${utcTicks(now - 3000)}`] }, { active: true, epochProcesses: ['invalid', 42, `12:${utcTicks(now + 1)}`] }]) {
    assert.equal(currentCodexSessionStartedAt(session, now), null);
  }
});
