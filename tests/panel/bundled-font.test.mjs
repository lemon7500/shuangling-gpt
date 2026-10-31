import test from 'node:test';
import assert from 'node:assert/strict';
import { auditBundledFont } from '../../tools/audit-ui-font.mjs';

test('author-published font bytes, original license and complete shipped SC/TC/English text are preserved', async () => {
  const report = await auditBundledFont();
  assert.equal(report.ok, true);
  assert.equal(report.originalUnmodified, true);
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    assert.ok(report.languages[language].stringsChecked > 200);
    assert.deepEqual(report.languages[language].missing, []);
  }
});
