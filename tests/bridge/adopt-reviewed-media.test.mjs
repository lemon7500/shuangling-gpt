import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { buildOutputs, parseArguments, unionOutlineRoi, validatePlan, validateProbe, verifyCurrentAnimationRows } from '../../tools/adopt-reviewed-media.mjs';
import { DRAG_ANIMATIONS } from '../../windows/outline-contract.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const currentAssets = JSON.parse(readFileSync(resolve(root, 'reports/windows-assets.json'), 'utf8'));
const currentProfile = require(resolve(root, 'vendor/dsh-pet/runtime/electron-helper/shuangling-motion.js'));
const sha = 'a'.repeat(64);
const action = (name = 'waving') => ({ logicalName: name, path: './reviewed.webm', sha256: sha, fps: 24, frameCount: 124, durationMs: 124 * 1000 / 24, bounds: [400, 160, 850, 680], approved: true });
const plan = actions => ({ schemaVersion: 1, approved: true, actions });
const runPair = () => ['running-left', 'running-right'].map((name, index) => ({
  ...action(name), sha256: (index ? 'd' : 'c').repeat(64), fps: 30, frameCount: 119,
  durationMs: 119 * 1000 / 30, movement: { startFrame: 31 + index, endFrameExclusive: 88 + index },
}));
const rollbackPlan = actions => ({ ...plan(actions), reviewedRunPairRollback: true });
const probe = row => ({
  streams: [{ codec_type: 'video', codec_name: 'vp9', width: 1280, height: 720, r_frame_rate: `${row.fps}/1`, avg_frame_rate: `${row.fps}/1`, nb_read_frames: String(row.frameCount), tags: { alpha_mode: '1' } }],
  format: { duration: String(Math.round(row.durationMs) / 1000) },
  frames: Array.from({ length: row.frameCount }, (_, index) => ({ media_type: 'video', best_effort_timestamp_time: String(Math.round(index * 1000 / row.fps) / 1000) })),
});

test('adoption CLI is dry-run by default and requires an explicit existing-tool path', () => {
  const options = parseArguments(['--plan', 'reviewed.json', '--ffprobe', 'ffprobe.exe']);
  assert.equal(options.apply, false);
  assert.equal(options.plan, resolve('reviewed.json'));
  assert.equal(parseArguments(['--plan', 'p', '--ffprobe', 'f', '--apply']).apply, true);
  assert.throws(() => parseArguments(['--plan', 'p']), /Both --plan and --ffprobe/);
  assert.throws(() => parseArguments(['--plan', 'p', '--ffprobe', 'f', '--download']), /Unknown/);
  assert.throws(() => parseArguments(['--plan', 'p', '--ffprobe', 'f', '--apply', '--apply']), /Duplicate/);
});

test('review declarations reject protected/unknown/duplicate actions and implicit approval', () => {
  for (const name of ['idle', 'running-left', 'jumping', 'failed', '../outside']) assert.throws(() => validatePlan(plan([action(name)]), root), /Forbidden/);
  assert.throws(() => validatePlan(plan([action(), action()]), root), /duplicate/);
  assert.throws(() => validatePlan({ ...plan([action()]), approved: false }, root), /complete plan/);
  assert.throws(() => validatePlan(plan([{ ...action(), approved: false }]), root), /explicit approval/);
  assert.throws(() => validatePlan(plan([{ ...action(), taskId: 'private-id' }]), root), /Unexpected fields/);
});

test('review declarations allow only the three fixed internal drag names', () => {
  const rows = validatePlan(plan(DRAG_ANIMATIONS.map(name => action(name))), root);
  assert.deepEqual(rows.map(row => row.logicalName), DRAG_ANIMATIONS);
  assert.ok(rows.every(row => row.fps === 24 && row.approved));
  for (const name of ['drag', 'drag-drop', 'drag-lift-classic']) assert.throws(() => validatePlan(plan([action(name)]), root), /Forbidden/);
  assert.throws(() => validatePlan(plan([{ ...action('drag-hover'), movement: { startFrame: 1, endFrameExclusive: 40 } }]), root), /Movement is only/);
});

test('replacing installed drag footage requires explicit atomic review and cannot unlock protected actions', () => {
  const actions = DRAG_ANIMATIONS.map(name => action(name));
  const reviewed = { ...plan(actions), reviewedDragReplacement: true };
  assert.equal(validatePlan(reviewed, root).length, 3);
  const output = buildOutputs({ assets: currentAssets, profile: currentProfile, actions, reviewedDragReplacement: true });
  assert.ok(DRAG_ANIMATIONS.every(name => output.assets.animations.find(row => row.name === name).webmSha256 === sha));
  assert.deepEqual(output.profile.movement, currentProfile.movement);
  for (const flag of ['true', 1, null]) {
    assert.throws(() => validatePlan({ ...reviewed, reviewedDragReplacement: flag }, root), /explicit boolean/);
    assert.throws(() => buildOutputs({ assets: currentAssets, profile: currentProfile, actions, reviewedDragReplacement: flag }), /explicit boolean/);
  }
  for (const partial of [actions.slice(1), actions.slice(0, 1), [...actions, actions[0]]]) {
    assert.throws(() => validatePlan({ ...reviewed, actions: partial }, root), /lift, hover and lower/);
    assert.throws(() => buildOutputs({ assets: currentAssets, profile: currentProfile, actions: partial, reviewedDragReplacement: true }), /lift, hover and lower/);
  }
  for (const reviewedDragReplacement of [false, undefined]) {
    assert.throws(() => buildOutputs({ assets: currentAssets, profile: currentProfile, actions, reviewedDragReplacement }), /requires explicit/);
  }
  assert.throws(() => validatePlan({ ...reviewed, reviewedRunPairRollback: true, actions: runPair() }, root), /reviewed separately/);
  for (const name of ['idle', 'running-left', 'jumping']) assert.throws(() => validatePlan({ ...reviewed, actions: [...actions, action(name)] }, root), /Forbidden/);
  assert.deepEqual(buildOutputs({ assets: output.assets, profile: output.profile, actions }).assets, output.assets, 'identical reviewed clips remain idempotent without special approval');
});

test('right-run requires reviewed gait frames and all actions retain native 24fps geometry', () => {
  assert.throws(() => validatePlan(plan([action('running-right')]), root), /Unexpected fields/);
  const row = { ...action('running-right'), movement: { startFrame: 13, endFrameExclusive: 88 } };
  assert.deepEqual(validatePlan(plan([row]), root)[0].movement, row.movement);
  assert.throws(() => validatePlan(plan([{ ...row, movement: { startFrame: 88, endFrameExclusive: 13 } }]), root), /actual gait/);
  assert.throws(() => validatePlan(plan([{ ...action(), fps: 30 }]), root), /24 fps/);
  assert.throws(() => validatePlan(plan([{ ...action(), bounds: [1, 160, 850, 680] }]), root), /outline margin/);
  assert.throws(() => validatePlan(plan([{ ...action(), durationMs: 5000 }]), root), /Duration/);
  assert.throws(() => validatePlan(plan([{ ...action(), firstLastPixelEqual: 'true' }]), root), /actual boolean/);
});

test('optional run stride phases require both measured frame indices inside the actual gait', () => {
  const movement={startFrame:12,accelUntilFrame:24,decelerateFromFrame:84,endFrameExclusive:95};
  const row={...action('running-right'),movement};
  assert.deepEqual(validatePlan(plan([row]),root)[0].movement,movement);
  assert.deepEqual(validatePlan(plan([{...row,movement:{...movement,decelerateFromFrame:24}}]),root)[0].movement,
    {...movement,decelerateFromFrame:24},'a smooth triangular gait may have no cruise plateau');
  for(const change of [
    value=>{delete value.accelUntilFrame},value=>{delete value.decelerateFromFrame},
    value=>{value.accelUntilFrame=12},value=>{value.accelUntilFrame=85},
    value=>{value.decelerateFromFrame=95},value=>{value.accelUntilFrame=24.5},
    value=>{value.decelerateFromFrame=NaN},value=>{value.accelUntilFrame='24'},
  ]){
    const value={...movement};change(value);
    assert.throws(()=>validatePlan(plan([{...row,movement:value}]),root),/stride phases/);
    assert.throws(()=>buildOutputs({assets:currentAssets,profile:currentProfile,actions:[{...row,movement:value}]}),/stride phases/);
  }
  assert.throws(()=>validatePlan(plan([{...row,movement:{...movement,arbitraryCurve:[1,2]}}]),root),/Unexpected fields/);
});

test('adoption compiles reviewed stride phases, retains them on later updates and removes stale phases on a new run review', () => {
  const actions=runPair();actions[0].sha256=currentProfile.outlineMaskRoi.webmSha256ByAnimation['running-left'];
  actions[0].movement={startFrame:12,accelUntilFrame:24,decelerateFromFrame:84,endFrameExclusive:95};
  const output=buildOutputs({assets:currentAssets,profile:currentProfile,actions,reviewedRunPairRollback:true});
  const expected={startMs:400,endMs:95*1000/30,accelUntilMs:800,decelerateFromMs:2800};
  assert.deepEqual(output.profile.movement.byAnimation['running-left'],expected);
  assert.deepEqual(output.profile.movement.byAnimation['running-right'],{startMs:32*1000/30,endMs:89*1000/30},'unreviewed right phases are not invented');
  const later=buildOutputs({assets:output.assets,profile:output.profile,actions:[action('waving')]});
  assert.deepEqual(later.profile.movement,output.profile.movement,'an unrelated action keeps the approved stride');
  const rerun=runPair();rerun[0].sha256=actions[0].sha256;
  const reviewed=buildOutputs({assets:output.assets,profile:output.profile,actions:rerun,reviewedRunPairRollback:true});
  assert.equal(Object.hasOwn(reviewed.profile.movement.byAnimation['running-left'],'accelUntilMs'),false,'a replacement lacking reviewed phases must not inherit stale timing');
});

test('native 30fps rollback requires an explicit true flag and exactly the reviewed run pair', () => {
  const pair = runPair();
  const rows = validatePlan(rollbackPlan(pair), root);
  assert.deepEqual(rows.map(row => row.logicalName), ['running-left', 'running-right']);
  assert.ok(rows.every(row => row.fps === 30 && row.frameCount === 119));
  assert.deepEqual(rows.map(row => row.movement), pair.map(row => row.movement));
  for (const actions of [[pair[0]], [pair[1]], [pair[0], action()], [...pair, action()], [pair[0], pair[0]]]) {
    assert.throws(() => validatePlan(rollbackPlan(actions), root), /exactly both/);
  }
  assert.throws(() => validatePlan(plan(pair), root), /Forbidden/);
  assert.throws(() => validatePlan({ ...rollbackPlan(pair), reviewedRunPairRollback: false }, root), /Forbidden/);
  for (const flag of ['true', 1, null, undefined]) assert.throws(() => validatePlan({ ...rollbackPlan(pair), reviewedRunPairRollback: flag }, root), /explicit boolean/);
  for (const name of ['running-right', 'waving', 'drag-hover']) assert.throws(() => validatePlan(plan([{ ...action(name), fps: 30, durationMs: 124 * 1000 / 30 }]), root), /24 fps/);
  assert.throws(() => validatePlan(rollbackPlan([{ ...pair[0], fps: 60 }, pair[1]]), root), /24 fps/);
  assert.throws(() => validatePlan(rollbackPlan([{ ...pair[0], durationMs: 119 * 1000 / 24 }, pair[1]]), root), /Duration/);
  assert.throws(() => validatePlan(rollbackPlan([{ ...pair[0], movement: { startFrame: 88, endFrameExclusive: 31 } }, pair[1]]), root), /actual gait/);
});

test('native 30fps probe checks declared stream rate and every PTS without accepting non-run 30fps', () => {
  for (const row of runPair()) {
    validateProbe(probe(row), row, { reviewedRunPairRollback: true });
    assert.throws(() => validateProbe(probe(row), row), /Unsupported reviewed frame rate/);
    const wrongRate = probe(row); wrongRate.streams[0].avg_frame_rate = '24/1';
    assert.throws(() => validateProbe(wrongRate, row, { reviewedRunPairRollback: true }), /stream rate differs/);
    const wrongPts = probe(row); wrongPts.frames[1].best_effort_timestamp_time = '0.042';
    assert.throws(() => validateProbe(wrongPts, row, { reviewedRunPairRollback: true }), /presentation timestamps/);
  }
  const waving = { ...action(), fps: 30, durationMs: 124 * 1000 / 30 };
  assert.throws(() => validateProbe(probe(waving), waving, { reviewedRunPairRollback: true }), /Unsupported reviewed frame rate/);
});

test('ffprobe check rejects wrong geometry, missing alpha, audio, timing gaps and wrong counts', () => {
  const row = action();
  validateProbe(probe(row), row);
  for (const change of [
    info => { info.streams[0].width = 720; },
    info => { delete info.streams[0].tags.alpha_mode; },
    info => { info.streams.push({ codec_type: 'audio' }); },
    info => { info.streams[0].avg_frame_rate = '30/1'; },
    info => { info.frames[20].best_effort_timestamp_time = info.frames[19].best_effort_timestamp_time; },
    info => { info.frames.pop(); },
    info => { info.format.duration = '4.9'; },
  ]) { const info = probe(row); change(info); assert.throws(() => validateProbe(info, row)); }
});

test('VP9 alpha tag names are case insensitive while absent, zero or contradictory values are rejected', () => {
  const row = action();
  for (const tags of [{ alpha_mode: '1' }, { ALPHA_MODE: '1' }, { Alpha_Mode: '1' }, { alpha_mode: '1', ALPHA_MODE: '1' }]) {
    const info = probe(row); info.streams[0].tags = tags;
    validateProbe(info, row);
  }
  for (const tags of [{}, { ALPHA_MODE: '0' }, { Alpha_Mode: 'true' }, { alpha_mode: '1', ALPHA_MODE: '0' }]) {
    const info = probe(row); info.streams[0].tags = tags;
    assert.throws(() => validateProbe(info, row), /Expected transparent VP9/);
  }
});

test('outline union only expands original ROI and keeps a full 16px new margin', () => {
  const original = [368, 104, 538, 592];
  assert.deepEqual(unionOutlineRoi(original, [{ bounds: [300, 200, 940, 650] }]), [284, 104, 672, 592]);
  assert.deepEqual(unionOutlineRoi(original, [{ bounds: [500, 200, 800, 650] }]), original);
  assert.throws(() => unionOutlineRoi(original, [{ bounds: [2, 200, 800, 650] }]), /outside/);
});

test('current report comparison tolerates only missing canonical source fields', () => {
  const assetRows = [
    { name: 'running-classic', fps: 24, webmSha256: sha, alphaBounds: [400, 160, 850, 680] },
    { name: 'waiting-classic', fps: 24, webmSha256: sha, manualOnly: true },
  ];
  const manifestRows = assetRows.map(row => ({ ...row, source: `windows/assets/shuangling/${row.name}.webm` }));
  const before = JSON.stringify(assetRows);
  verifyCurrentAnimationRows(assetRows, manifestRows);
  verifyCurrentAnimationRows(manifestRows, assetRows);
  verifyCurrentAnimationRows(assetRows, assetRows);
  assert.equal(JSON.stringify(assetRows), before, 'compatibility comparison does not edit current reports');
  for (const change of [
    rows => { rows[0].source = 'C:/Users/private/other.webm'; },
    rows => { rows[0].source = 'windows/assets/shuangling/idle.webm'; },
    rows => { rows[0].source = undefined; },
    rows => { rows[0].fps = 30; },
    rows => { rows[0].webmSha256 = 'b'.repeat(64); },
    rows => { rows[0].alphaBounds[2]++; },
    rows => { rows[0].unreviewed = true; },
    rows => { rows.pop(); },
    rows => { rows.reverse(); },
  ]) {
    const rows = structuredClone(manifestRows); change(rows);
    assert.throws(() => verifyCurrentAnimationRows(assetRows, rows), /animation rows disagree/);
  }
  const wrongBoth = manifestRows.map(row => ({ ...row, source: `other/${row.name}.webm` }));
  assert.throws(() => verifyCurrentAnimationRows(wrongBoth, wrongBoth), /animation rows disagree/, 'matching incorrect sources must still fail');
});

test('public output preserves baseline hashes, left movement and outline without leaking review inputs', () => {
  const assets = structuredClone(currentAssets), profile = structuredClone(currentProfile);
  const originalVersion = currentAssets.releaseVersion;
  // Simulate private input fields in a prior row: only public runtime fields survive.
  assets.animations.find(row => row.name === 'jumping').taskId = 'never-publish-me';
  assets.animations.find(row => row.name === 'jumping').source = 'C:/Users/private/secret.mp4';
  const right = { ...action('running-right'), movement: { startFrame: 20, endFrameExclusive: 90 }, firstLastPixelEqual: false };
  const added = { ...action('reading'), sha256: 'b'.repeat(64) };
  const output = buildOutputs({ assets, profile, actions: [right, added] });
  assert.equal(output.assets.fps, 24);
  assert.equal(output.assets.releaseVersion, '1.9.0');
  assert.equal(output.profile.outlineCssPx, .45);
  for (const name of ['idle', 'running-left', 'jumping', 'failed']) {
    assert.equal(output.profile.outlineMaskRoi.webmSha256ByAnimation[name], currentProfile.outlineMaskRoi.webmSha256ByAnimation[name]);
    assert.equal(output.assets.animations.find(row => row.name === name).webmSha256, currentAssets.animations.find(row => row.name === name).webmSha256);
  }
  assert.deepEqual(output.profile.movement.byAnimation['running-left'], currentProfile.movement.byAnimation['running-left']);
  for (const classic of currentAssets.animations.filter(row => row.manualOnly === true)) {
    const retained = output.assets.animations.find(row => row.name === classic.name);
    assert.equal(retained.webmSha256, classic.webmSha256, 'future action adoption retains existing manual takes');
    assert.equal(retained.manualOnly, true);
    assert.equal(retained.logicalAction, classic.logicalAction);
  }
  assert.deepEqual(output.profile.movement.byAnimation['running-right'], { startMs: 20 * 1000 / 24, endMs: 90 * 1000 / 24 });
  assert.equal(output.assets.animations.find(row => row.name === 'running-right').firstLastPixelEqual, false);
  assert.equal(Object.hasOwn(output.assets.animations.find(row => row.name === 'reading'), 'firstLastPixelEqual'), false);
  assert.equal(output.manifest.animations.find(row => row.name === 'reading').source, 'windows/assets/shuangling/reading.webm');
  for (const forbidden of ['never-publish-me', 'C:/Users/private', 'reviewed.webm', 'taskId']) assert.equal(output.manifestText.includes(forbidden), false);
  assert.equal(output.manifestSha256, createHash('sha256').update(output.manifestText).digest('hex'));
  assert.equal(output.profile.outlineMaskRoi.sourceManifestSha256, output.manifestSha256);
  assert.deepEqual(output.manifest.animations, output.assets.animations);
  for (const row of output.assets.animations) assert.equal(row.source, `windows/assets/shuangling/${row.name}.webm`);
  assert.equal(Object.hasOwn(output.assets, 'allDecodedNeutralEndpointsEqual'), false);
  assert.equal(currentAssets.releaseVersion, originalVersion);
});

test('building the same approved plan again is deterministic and does not shrink an expanded ROI', () => {
  const actions = [{ ...action('review'), firstLastPixelEqual: false }];
  const first = buildOutputs({ assets: currentAssets, profile: currentProfile, actions });
  const second = buildOutputs({ assets: first.assets, profile: first.profile, actions });
  assert.equal(second.manifestText, first.manifestText);
  assert.equal(second.assetsText, first.assetsText);
  assert.equal(second.profileText, first.profileText);
});

test('reviewed run-pair output compiles per-clip 30fps timings while preserving every other action and movement', () => {
  const profile = structuredClone(currentProfile);
  profile.movement.byAnimation.example = { startMs: 123, endMs: 456 };
  const actions = runPair();
  const output = buildOutputs({ assets: currentAssets, profile, actions, reviewedRunPairRollback: true });
  assert.equal(output.manifest.method, 'reviewed-source-native-mixed');
  assert.deepEqual(output.assets.animations, output.manifest.animations);
  for (const action of actions) {
    const row = output.assets.animations.find(row => row.name === action.logicalName);
    assert.equal(row.fps, 30); assert.equal(row.sourceFrames, 119); assert.equal(row.encodedFrames, 119);
    assert.equal(row.durationMs, 119 * 1000 / 30); assert.equal(row.frameIntervalMs, 1000 / 30);
    assert.equal(output.assets.frameRatesByAnimation[action.logicalName], 30);
    assert.equal(output.profile.outlineMaskRoi.webmSha256ByAnimation[action.logicalName], action.sha256);
    assert.deepEqual(output.profile.movement.byAnimation[action.logicalName], { startMs: action.movement.startFrame * 1000 / 30, endMs: action.movement.endFrameExclusive * 1000 / 30 });
  }
  for (const row of currentAssets.animations.filter(row => !['running-left', 'running-right'].includes(row.name))) {
    assert.deepEqual(output.assets.animations.find(value => value.name === row.name), row, row.name + ' keeps its complete public metadata');
    assert.equal(output.assets.frameRatesByAnimation[row.name], 24);
  }
  assert.deepEqual(output.profile.movement.byAnimation.example, profile.movement.byAnimation.example);
  assert.deepEqual(output.profile.drag, currentProfile.drag);
  assert.deepEqual(output.profile.dragAssetRoots, currentProfile.dragAssetRoots);
  const js = { module: { exports: {} } };
  vm.runInNewContext(output.profileText, js);
  assert.equal(js.module.exports.movement.byAnimation['running-left'].startMs, 31 * 1000 / 30);
  assert.equal(js.module.exports.movement.byAnimation['running-right'].endMs, 89 * 1000 / 30);
  assert.throws(() => buildOutputs({ assets: currentAssets, profile, actions }), /Forbidden/);
  assert.throws(() => buildOutputs({ assets: currentAssets, profile, actions: [actions[1]], reviewedRunPairRollback: true }), /exactly both/);
  assert.throws(() => buildOutputs({ assets: currentAssets, profile, actions: [{ ...action('waving'), fps: 30 }] }), /24 fps/);
  const badIdle = structuredClone(profile); badIdle.outlineMaskRoi.webmSha256ByAnimation.idle = 'e'.repeat(64);
  // Changing the row as well cannot turn idle into an approved run-pair target.
  const assetsWithBadIdle = structuredClone(currentAssets); assetsWithBadIdle.animations.find(row => row.name === 'idle').webmSha256 = 'e'.repeat(64);
  assert.throws(() => buildOutputs({ assets: assetsWithBadIdle, profile: badIdle, actions, reviewedRunPairRollback: true }), /Frozen media identity changed: idle/);
});

test('a later ordinary 24fps adoption retains the exact reviewed 30fps run pair and movement metadata', () => {
  const reviewedHashes = [
    '286d6eebf828bc102986987a7a30e6d5275cd62077d24ba741f23231a35c2b78',
    '8e597ff48672cce183c6e4766753ccef342595823987042c9d0c1eb9997ce871',
  ];
  const actions = runPair().map((row, index) => ({ ...row, sha256: reviewedHashes[index], movement: { startFrame: 31, endFrameExclusive: 88 } }));
  const first = buildOutputs({ assets: currentAssets, profile: currentProfile, actions, reviewedRunPairRollback: true });
  const waving = { ...action('waving'), sha256: 'f'.repeat(64), firstLastPixelEqual: true };
  const ordinaryActions = validatePlan(plan([waving]), root);
  const second = buildOutputs({ assets: first.assets, profile: first.profile, actions: ordinaryActions });
  assert.equal(second.manifest.method, 'reviewed-source-native-mixed');
  assert.equal(second.assets.animations.length, first.assets.animations.length);
  assert.deepEqual(second.assets.animations, second.manifest.animations);
  assert.equal(second.assets.frameRatesByAnimation.waving, 24);
  assert.equal(second.assets.animations.find(row => row.name === 'waving').webmSha256, waving.sha256);
  for (const name of ['running-left', 'running-right']) {
    assert.deepEqual(second.assets.animations.find(row => row.name === name), first.assets.animations.find(row => row.name === name), name + ' keeps its complete native row');
    assert.equal(second.assets.frameRatesByAnimation[name], 30);
    assert.deepEqual(second.profile.movement.byAnimation[name], { startMs: 31 * 1000 / 30, endMs: 88 * 1000 / 30 });
  }
  for (const row of first.assets.animations.filter(row => row.name !== 'waving')) {
    assert.deepEqual(second.assets.animations.find(value => value.name === row.name), row, row.name + ' is unaffected by the ordinary update');
  }
  assert.deepEqual(second.profile.movement, first.profile.movement);
  assert.deepEqual(second.profile.drag, first.profile.drag);
  assert.deepEqual(second.profile.dragAssetRoots, first.profile.dragAssetRoots);
  assert.equal(second.profile.outlineMaskRoi.webmSha256ByAnimation.idle, currentProfile.outlineMaskRoi.webmSha256ByAnimation.idle);
  const replay = buildOutputs({ assets: second.assets, profile: second.profile, actions: ordinaryActions });
  assert.equal(replay.manifestText, second.manifestText);
  assert.equal(replay.profileText, second.profileText);
  assert.throws(() => buildOutputs({ assets: first.assets, profile: first.profile, actions }), /Forbidden/);
  const unknownLeft = structuredClone(first.assets);
  unknownLeft.animations.find(row => row.name === 'running-left').webmSha256 = '0'.repeat(64);
  assert.throws(() => buildOutputs({ assets: unknownLeft, profile: first.profile, actions: ordinaryActions }), /Frozen media identity changed: running-left/);
});

test('a reviewed native24 v170 rollback and subsequent ordinary adoption preserve the complete run pair', () => {
  const reviewedHashes = [
    '05c9f62c07483cddc27a79dd8f126f7c9ef626fee6e1f40a9f29dfbc7ca0477d',
    '731481c6a69c2646ca81d6390baa6ddc813fe341347cbf9fb0c6f4a46d08ae8d',
  ];
  const pair = ['running-left', 'running-right'].map((name, index) => ({
    ...action(name), sha256: reviewedHashes[index], firstLastPixelEqual: true,
    movement: { startFrame: 20, endFrameExclusive: 92 },
  }));
  const actions = validatePlan(rollbackPlan(pair), root);
  for (const row of actions) validateProbe(probe(row), row, { reviewedRunPairRollback: true });
  assert.throws(() => validatePlan(plan(pair), root), /Forbidden/, 'the exact reviewed left hash does not allow ordinary left replacement');
  const first = buildOutputs({ assets: currentAssets, profile: currentProfile, actions, reviewedRunPairRollback: true });
  assert.equal(first.manifest.method, 'reviewed-source-native24');
  for (const row of currentAssets.animations.filter(row => !['running-left', 'running-right'].includes(row.name))) {
    assert.deepEqual(first.assets.animations.find(value => value.name === row.name), row, row.name + ' is untouched by rollback');
  }

  const ordinaryActions = validatePlan(plan([{ ...action('review'), sha256: 'f'.repeat(64) }]), root);
  const second = buildOutputs({ assets: first.assets, profile: first.profile, actions: ordinaryActions });
  assert.equal(second.manifest.method, 'reviewed-source-native24');
  assert.deepEqual(second.manifest.animations, second.assets.animations);
  assert.deepEqual(second.assets.frameRatesByAnimation, first.assets.frameRatesByAnimation);
  assert.equal(second.assets.animations.length, currentAssets.animations.length);
  assert.equal(second.assets.animations.find(row => row.name === 'review').webmSha256, 'f'.repeat(64));
  for (const row of first.assets.animations.filter(row => row.name !== 'review')) {
    assert.deepEqual(second.assets.animations.find(value => value.name === row.name), row, row.name + ' survives later ordinary adoption');
  }
  for (const [index, name] of ['running-left', 'running-right'].entries()) {
    const row = second.assets.animations.find(row => row.name === name);
    assert.equal(row.webmSha256, reviewedHashes[index]);
    assert.equal(row.fps, 24);
    assert.equal(row.encodedFrames, 124);
    assert.equal(row.durationMs, 124 * 1000 / 24);
    assert.deepEqual(second.profile.movement.byAnimation[name], { startMs: 20 * 1000 / 24, endMs: 92 * 1000 / 24 });
  }
  assert.deepEqual(second.profile.movement, first.profile.movement);
  assert.deepEqual(second.profile.drag, currentProfile.drag);
  assert.deepEqual(second.profile.dragAssetRoots, currentProfile.dragAssetRoots);
  assert.equal(second.profile.outlineMaskRoi.webmSha256ByAnimation.idle, currentProfile.outlineMaskRoi.webmSha256ByAnimation.idle);
  const compiled = { module: { exports: {} } };
  vm.runInNewContext(second.profileText, compiled);
  assert.equal(compiled.module.exports.movement.byAnimation['running-left'].startMs, 20 * 1000 / 24);
  assert.equal(compiled.module.exports.movement.byAnimation['running-right'].endMs, 92 * 1000 / 24);
  const replay = buildOutputs({ assets: second.assets, profile: second.profile, actions: ordinaryActions });
  assert.equal(replay.manifestText, second.manifestText);
  assert.equal(replay.profileText, second.profileText);
  const unknownLeft = structuredClone(first.assets);
  unknownLeft.animations.find(row => row.name === 'running-left').webmSha256 = '0'.repeat(64);
  assert.throws(() => buildOutputs({ assets: unknownLeft, profile: first.profile, actions: ordinaryActions }), /Frozen media identity changed: running-left/);
});

test('drag adoption emits complete native-frame metadata and the exact internal capability binding', () => {
  const actions = DRAG_ANIMATIONS.map((name, index) => ({ ...action(name), sha256: String(index + 1).repeat(64), firstLastPixelEqual: index === 1 }));
  const output = buildOutputs({ assets: currentAssets, profile: currentProfile, actions, reviewedDragReplacement: true });
  assert.deepEqual(output.profile.drag, { lift: 'drag-lift', hover: 'drag-hover', lower: 'drag-lower' });
  assert.deepEqual(output.profile.dragAssetRoots, ['main', 'shuangling']);
  for (const row of actions) {
    const metadata = output.assets.animations.find(value => value.name === row.logicalName);
    assert.equal(metadata.fps, 24);
    assert.equal(metadata.sourceFrames, row.frameCount);
    assert.equal(metadata.encodedFrames, row.frameCount);
    assert.equal(metadata.webmSha256, row.sha256);
    assert.deepEqual(metadata.alphaBounds, row.bounds);
    assert.equal(output.assets.frameRatesByAnimation[row.logicalName], 24);
    assert.equal(output.profile.outlineMaskRoi.webmSha256ByAnimation[row.logicalName], row.sha256);
    assert.deepEqual(output.manifest.animations.find(value => value.name === row.logicalName), metadata);
  }
  for (const name of ['idle', 'running-left']) assert.equal(output.profile.outlineMaskRoi.webmSha256ByAnimation[name], currentProfile.outlineMaskRoi.webmSha256ByAnimation[name]);
  const reapplied = buildOutputs({ assets: output.assets, profile: output.profile, actions });
  assert.equal(reapplied.profileText, output.profileText);
  assert.equal(reapplied.manifestText, output.manifestText);
});

test('partial drag or unknown media cannot be silently dropped from adoption outputs', () => {
  const baseline = structuredClone(currentAssets);
  baseline.animations = baseline.animations.filter(row => !DRAG_ANIMATIONS.includes(row.name));
  const profile = structuredClone(currentProfile);
  profile.drag = { lift: 'drag-lift', hover: 'drag-hover', lower: 'drag-lower' };
  const legacy = buildOutputs({ assets: baseline, profile, actions: [action()] });
  assert.equal(Object.hasOwn(legacy.profile, 'drag'), false, 'a baseline inventory publishes no drag capability');
  assert.equal(Object.hasOwn(legacy.profile, 'dragAssetRoots'), false, 'a baseline inventory publishes no drag root aliases');
  for (const names of [DRAG_ANIMATIONS.slice(0, 1), DRAG_ANIMATIONS.slice(1)]) {
    assert.throws(() => buildOutputs({ assets: baseline, profile, actions: names.map(name => action(name)) }), /Incomplete drag media/);
  }
  assert.throws(() => buildOutputs({ assets: { ...baseline, animations: [...baseline.animations, { name: 'unreviewed' }] }, profile, actions: [action()] }), /existing animation inventory/);
  assert.throws(() => buildOutputs({ assets: baseline, profile, actions: [action('drag-drop')] }), /Forbidden/);
  for (const name of ['idle', 'running-left']) assert.throws(() => buildOutputs({ assets: baseline, profile, actions: [action(name)] }), /Forbidden/);
});
