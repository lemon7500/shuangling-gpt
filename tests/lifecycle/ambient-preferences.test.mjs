import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getLifecyclePreferences, setLifecyclePreferences } from '../../src/lifecycle/index.mjs';
import { validPreferences } from '../../src/lifecycle/preferences.mjs';

test('ambient defaults and edits retain language, launch and unrelated settings without lifecycle work', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'shuangling-ambient-'));
  const taskCalls = [];
  const options = { projectRoot: dataDir, dataDir, pluginEnabledImpl: async () => true, taskController: async action => { taskCalls.push(action); } };
  let preferences = await getLifecyclePreferences(options);
  assert.equal(preferences.ambientEnabled, true); assert.equal(preferences.ambientFrequency, 'normal');
  const file = join(dataDir, 'plugin-config.json');
  await writeFile(file, '{"language":"en","autoLaunch":false,"retained":{"position":42}}\n');
  for (const ambientFrequency of ['quiet', 'normal', 'lively']) {
    preferences = await setLifecyclePreferences(options, { ambientFrequency });
    assert.equal(preferences.ambientFrequency, ambientFrequency); assert.equal(preferences.language, 'en'); assert.equal(preferences.autoLaunch, false);
  }
  preferences = await setLifecyclePreferences(options, { ambientEnabled: false });
  assert.equal(preferences.ambientEnabled, false); assert.equal(preferences.ambientFrequency, 'lively'); assert.deepEqual(taskCalls, []);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { language: 'en', autoLaunch: false, retained: { position: 42 }, ambientFrequency: 'lively', ambientEnabled: false });
  for (const input of [{ ambientEnabled: 1 }, { ambientFrequency: 'low' }, { ambientFrequency: 'high' }, { ambientFrequency: null }, { ambientEnabled: true, url: 'arbitrary' }]) {
    assert.equal(validPreferences(input), false); await assert.rejects(setLifecyclePreferences(options, input), /invalid-preferences/);
  }
});
