import test from 'node:test';
import assert from 'node:assert/strict';
import { PetClient } from '../../src/bridge/pet-client.mjs';

test('live panel geometry uses a limited route, retains coordinates and validates the acknowledgement', async () => {
  const calls = [];
  const client = new PetClient({ dshHome: 'test-only' });
  client.request = async (route, options) => {
    calls.push({ route, options });
    return { size: 396, position: { corner: 'bottom-right', marginX: 20, marginY: 12 }, display: 'desktop' };
  };
  const input = { size: 396, corner: 'bottom-right', marginX: 20, marginY: 12, live: true };
  assert.equal((await client.updateAppearanceLive(input)).size, 396);
  assert.deepEqual(calls, [{ route: 'shuangling-appearance', options: {
    method: 'PUT', surface: false,
    body: { petId: 'shuangling', size: 396, corner: 'bottom-right', marginX: 20, marginY: 12 },
  } }]);
  for (const invalidInput of [{ size: 0 }, { ...input, size: Infinity }, { ...input, corner: 'missing' }, { ...input, marginX: -1 }]) {
    await assert.rejects(client.updateAppearanceLive(invalidInput), /invalid-appearance/);
  }
  assert.equal(calls.length, 1);
  client.request = async () => ({ size: 400, position: { corner: 'bottom-right', marginX: 20, marginY: 12 } });
  await assert.rejects(client.updateAppearanceLive(input), /appearance-not-applied/);
});
