// Inspect the bundled font's Unicode cmap; never reads accounts or user notes.
import assert from 'node:assert/strict';
import { readFile, writeFile, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completionCaptions, statusCaption } from '../src/bridge/captions.mjs';
import { STORIES } from '../src/desk/stories.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const expected = '2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b';

export function fontHasCodePoint(bytes) {
  assert.ok(bytes.length >= 12, 'invalid-font-header');
  const count = bytes.readUInt16BE(4);
  let cmap;
  for (let index = 0; index < count; index++) {
    const row = 12 + index * 16;
    assert.ok(row + 16 <= bytes.length, 'truncated-font-directory');
    if (bytes.toString('ascii', row, row + 4) === 'cmap') {
      cmap = bytes.readUInt32BE(row + 8);
      assert.ok(cmap + bytes.readUInt32BE(row + 12) <= bytes.length, 'truncated-font-cmap');
    }
  }
  assert.ok(Number.isInteger(cmap), 'font-cmap-missing');
  const subtables = [];
  for (let index = 0; index < bytes.readUInt16BE(cmap + 2); index++) {
    const row = cmap + 4 + index * 8;
    const platform = bytes.readUInt16BE(row), encoding = bytes.readUInt16BE(row + 2);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    const start = cmap + bytes.readUInt32BE(row + 4), format = bytes.readUInt16BE(start);
    if (format === 4 || format === 12) subtables.push({ start, format });
  }
  assert.ok(subtables.length, 'unicode-cmap-missing');
  return point => subtables.some(({ start, format }) => {
    if (format === 12) {
      let low = 0, high = bytes.readUInt32BE(start + 12) - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1, group = start + 16 + mid * 12;
        const first = bytes.readUInt32BE(group), last = bytes.readUInt32BE(group + 4);
        if (point < first) high = mid - 1;
        else if (point > last) low = mid + 1;
        else return bytes.readUInt32BE(group + 8) + point - first !== 0;
      }
      return false;
    }
    if (point > 0xffff) return false;
    const segments = bytes.readUInt16BE(start + 6) / 2;
    const ends = start + 14, starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2, offsets = deltas + segments * 2;
    for (let index = 0; index < segments; index++) {
      if (point > bytes.readUInt16BE(ends + index * 2)) continue;
      if (point < bytes.readUInt16BE(starts + index * 2)) return false;
      const delta = bytes.readInt16BE(deltas + index * 2);
      const offset = bytes.readUInt16BE(offsets + index * 2);
      if (!offset) return ((point + delta) & 0xffff) !== 0;
      const position = offsets + index * 2 + offset + (point - bytes.readUInt16BE(starts + index * 2)) * 2;
      if (position + 2 > bytes.length) return false;
      const glyph = bytes.readUInt16BE(position);
      return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
    }
    return false;
  });
}

export async function auditBundledFont() {
  const helper = join(root, 'vendor/dsh-pet/runtime/electron-helper');
  const bytes = await readFile(join(helper, 'fonts/wenkai/LXGWWenKai-Regular.ttf'));
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, expected, 'font-differs-from-author-release');
  const license = await readFile(join(helper, 'fonts/wenkai/OFL.txt'), 'utf8');
  assert.ok(license.includes('Copyright 2021-2026 LXGW') && license.includes('Copyright 2020 The Klee Project Authors') && license.includes('SIL OPEN FONT LICENSE Version 1.1'), 'font-copyright-and-license-required');
  const provenance = JSON.parse(await readFile(join(helper, 'fonts/wenkai/sources.json'), 'utf8'));
  assert.equal(provenance.originalUnmodified, true);
  assert.equal(provenance.files.find(row => row.file === 'LXGWWenKai-Regular.ttf')?.sha256, hash);
  const dictionaries = require(join(helper, 'panel-i18n.js')).dictionaries;
  const hasPoint = fontHasCodePoint(bytes);
  const samples = {
    'zh-CN': '霜铃 龙翼 书签 专注 剩余 这一轮完成了。0123456789，。！？“”…·% /',
    'zh-TW': '霜鈴 龍翼 書籤 專注 剩餘 這一輪完成了。0123456789，。！？「」…·% /',
    en: 'Shuangling GPT — This step is complete. It’s time to rest. 0123456789, 81% / 1,234,567'
  };
  const languages = {};
  for (const language of ['zh-CN', 'zh-TW', 'en']) {
    const texts = [...Object.values(dictionaries[language]), ...completionCaptions[language], samples[language],
      ...['waiting', 'interrupted', 'unknown'].map(state => statusCaption(state, language)),
      ...STORIES.flatMap(story => [story.title[language], story.body[language]])];
    const points = [...new Set([...texts.join('')].filter(char => !/\s/u.test(char)).map(char => char.codePointAt(0)))];
    const missing = points.filter(point => !hasPoint(point)).map(point => ({ codePoint: 'U+' + point.toString(16).toUpperCase(), character: String.fromCodePoint(point) }));
    languages[language] = { stringsChecked: texts.length, uniqueCodePoints: points.length, missing };
    assert.equal(missing.length, 0, 'missing-' + language + '-glyphs:' + missing.map(row => row.codePoint).join(','));
  }
  for (let point = 32; point <= 126; point++) assert.ok(hasPoint(point), 'missing-ascii-' + point);
  return { ok: true, at: new Date().toISOString(), font: 'LXGW WenKai', version: '1.530', sha256: hash,
    license: 'OFL-1.1', originalUnmodified: true, bytes: bytes.length, languages,
    coverageScope: 'All shipped panel/desk translations, completion/status captions, six stories, samples and printable ASCII; arbitrary user text retains system font fallback.' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await auditBundledFont();
  if (process.argv[2]) {
    const disk = await statfs(root);
    assert.ok(disk.bavail * disk.bsize > 3 * 1024 ** 3 + 32 * 1024 ** 2, 'disk-safety-stop');
    await writeFile(resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report));
}
