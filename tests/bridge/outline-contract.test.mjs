import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyOutlineAssetContract} from '../../windows/outline-contract.mjs';

test('outline release contract rejects replacement bytes even when length and mtime are unchanged', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shuangling-outline-'));
  try {
    const names = ['idle','running-right','running-left','waving','jumping','failed','waiting','running','review'];
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    const manifestPath = join(directory, 'manifest.json'); writeFileSync(manifestPath, '{}');
    const hashes = Object.fromEntries(names.map((name, i) => {
      const bytes = Buffer.from([i, 0, 1, 2]); writeFileSync(join(directory, name + '.webm'), bytes); return [name, digest(bytes)];
    }));
    const profile = {outlineCssPx:.45, outlineMaskRoi:{assetRoot:'shuangling',canvas:[1280,720],sourceRect:[424,96,415,584],paddingNativePx:16,sourceManifestSha256:digest('{}'),webmSha256ByAnimation:hashes}};
    const animations = names.map(name => ({name, webmSha256:hashes[name]}));
    const args = {profile,manifestPath,assetDirectory:directory,animations};
    assert.equal(verifyOutlineAssetContract(args).length, 9);
    const path = join(directory, 'waiting.webm'), original = readFileSync(path), originalStat = statSync(path);
    writeFileSync(path, Buffer.from([255, 0, 1, 2]));
    utimesSync(path, originalStat.atime, originalStat.mtime);
    assert.throws(() => verifyOutlineAssetContract(args), /identity mismatch: waiting/);
    writeFileSync(path, original);
    writeFileSync(manifestPath, '{ }');
    assert.throws(() => verifyOutlineAssetContract(args), /contract mismatch/);
    writeFileSync(manifestPath, '{}');
    assert.throws(() => verifyOutlineAssetContract({...args, animations:[...animations.slice(0,-1),animations[0]]}), /identity mismatch/);
  } finally { rmSync(directory, {recursive:true,force:true}); }
});
