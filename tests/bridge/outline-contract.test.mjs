import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DRAG_ANIMATIONS, verifyOutlineAssetContract} from '../../windows/outline-contract.mjs';

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
    const extraNames = ['reading', 'looking-around', 'stretching-wings'];
    for (const name of extraNames) {
      const bytes = Buffer.from(name); writeFileSync(join(directory, name + '.webm'), bytes);
      hashes[name] = digest(bytes); animations.push({ name, webmSha256: hashes[name] });
    }
    assert.equal(verifyOutlineAssetContract(args).length, 12, 'all extra assets remain hash-bound');
    assert.throws(() => verifyOutlineAssetContract({ ...args, animations: [...animations, { name: 'unapproved' }] }), /identity mismatch/);
    for (const name of DRAG_ANIMATIONS) {
      const bytes = Buffer.from(name); writeFileSync(join(directory, name + '.webm'), bytes);
      hashes[name] = digest(bytes); animations.push({ name, webmSha256: hashes[name] });
    }
    assert.throws(() => verifyOutlineAssetContract(args), /drag capability/, 'media alone cannot enable an unbound drag state');
    profile.drag = { lift: 'drag-lift', hover: 'drag-hover', lower: 'drag-lower' };
    assert.throws(() => verifyOutlineAssetContract(args), /drag asset roots/);
    profile.dragAssetRoots = ['main', 'shuangling'];
    assert.equal(verifyOutlineAssetContract(args).length, 15, 'the full internal drag set is hash-bound');
    for (const dragAssetRoots of [undefined, ['main'], ['shuangling'], ['main', 'shuangling', 'other'], ['shuangling', 'main']]) assert.throws(() => verifyOutlineAssetContract({ ...args, profile: { ...profile, dragAssetRoots } }), /drag asset roots/);
    for (const omitted of DRAG_ANIMATIONS) {
      assert.throws(() => verifyOutlineAssetContract({ ...args, animations: animations.filter(row => row.name !== omitted) }), /identity mismatch: animation names/);
    }
    for (const drag of [undefined, { ...profile.drag, hover: 'idle' }, { ...profile.drag, other: 'waving' }]) {
      assert.throws(() => verifyOutlineAssetContract({ ...args, profile: { ...profile, drag } }), /drag capability/);
    }
    const dragPath = join(directory, 'drag-hover.webm'), originalDrag = readFileSync(dragPath);
    writeFileSync(dragPath, 'unreviewed hover bytes');
    assert.throws(() => verifyOutlineAssetContract(args), /identity mismatch: drag-hover/);
    writeFileSync(dragPath, originalDrag);
    const baselineAnimations = animations.filter(row => !DRAG_ANIMATIONS.includes(row.name));
    const baselineHashes = Object.fromEntries(baselineAnimations.map(row => [row.name, row.webmSha256]));
    assert.throws(() => verifyOutlineAssetContract({ ...args, animations: baselineAnimations, profile: { ...profile, outlineMaskRoi: { ...profile.outlineMaskRoi, webmSha256ByAnimation: baselineHashes } } }), /drag capability/, 'a legacy inventory cannot declare missing drag clips');
  } finally { rmSync(directory, {recursive:true,force:true}); }
});
