/**
 * Adopt explicitly reviewed, already encoded media. No generation or transcoding.
 * Defaults to a read-only dry run. An approved plan and --apply are both required
 * to write. Existing backups are verified and never overwritten or removed.
 *
 * node tools/adopt-reviewed-media.mjs --plan <local.json> --ffprobe <existing.exe>
 * Add --apply only after reviewing the dry-run result. Input bounds are reviewed
 * alpha bounds [left, top, rightExclusive, bottomExclusive], not a crop request.
 */
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { verifyOutlineAssetContract, CORE_ANIMATIONS, AMBIENT_ANIMATIONS, MANUAL_VARIANTS, DRAG_ANIMATIONS, DRAG_ASSET_ROOTS } from '../windows/outline-contract.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const PROFILE = 'vendor/dsh-pet/runtime/electron-helper/shuangling-motion.js';
const ASSETS = 'reports/windows-assets.json';
const MANIFEST = 'reports/windows-action-frames-v190.json';
const MEDIA = 'windows/assets/shuangling';
const BACKUP = 'qa/companion-desk-v190/media-before';
const REPLACE = Object.freeze(['running', 'review', 'waiting', 'running-right', 'waving']);
const RUN_PAIR = Object.freeze(['running-left', 'running-right']);
const ADD = Object.freeze([...AMBIENT_ANIMATIONS, ...DRAG_ANIMATIONS]);
const SHA = /^[a-f0-9]{64}$/;
const FLOOR = 3 * 1024 ** 3;
const RESERVE = 1024 * 1024;
const FPS = 24;
const FIXED = Object.freeze({
  idle: '77f1e40eb2f2e39477e03688dff384b74ef260d129a4b5593af974f090e9457d',
  'running-left': '66352d3fd1f876dc6f30a5a63b7277ce61455251d23a5b70ad4066a7768a99ec',
});
// New permanent entries require an independently reviewed media hash.
const REVIEWED_LEFT_SHA256 = Object.freeze([
  FIXED['running-left'],
  // Reviewed v130 source F5..F123, unchanged decoded pixels at native 30 fps.
  '286d6eebf828bc102986987a7a30e6d5275cd62077d24ba741f23231a35c2b78',
  // Reviewed v170 AI left run, original 124 frames at native 24 fps.
  '05c9f62c07483cddc27a79dd8f126f7c9ef626fee6e1f40a9f29dfbc7ca0477d',
  // Reviewed source-native local alpha tail cleanup, 124 frames at 24 fps.
  '04f14130a7eab2d5302d2aa7cd9e70b5dba73a3e489e085892777f093000b88f',
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(readFileSync(file));
const json = value => JSON.stringify(value, null, 2) + '\n';
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const assert = (condition, message) => { if (!condition) throw Error(message); };
const slash = value => value.split(sep).join('/');
const inside = (root, file) => { const value = relative(root, file); return value !== '' && !value.startsWith('..' + sep) && value !== '..' && !isAbsolute(value); };
const close = (left, right, tolerance) => Number.isFinite(left) && Math.abs(left - right) <= tolerance;

function onlyKeys(value, allowed, label) {
  assert(plain(value) && Object.keys(value).every(key => allowed.includes(key)), 'Unexpected fields: ' + label);
}

function validateRunPairScope(actions, reviewedRunPairRollback) {
  assert(typeof reviewedRunPairRollback === 'boolean', 'reviewedRunPairRollback must be an explicit boolean.');
  if (reviewedRunPairRollback) assert(Array.isArray(actions) && actions.length === RUN_PAIR.length &&
    RUN_PAIR.every(name => actions.some(action => action.logicalName === name)), 'Reviewed run-pair rollback requires exactly both running-left and running-right.');
}

function validateDragScope(actions, reviewedDragReplacement, reviewedRunPairRollback) {
  assert(typeof reviewedDragReplacement === 'boolean', 'reviewedDragReplacement must be an explicit boolean.');
  if (!reviewedDragReplacement) return;
  assert(!reviewedRunPairRollback, 'Drag replacement and run-pair rollback must be reviewed separately.');
  assert(Array.isArray(actions) && DRAG_ANIMATIONS.every(name => actions.filter(action => action.logicalName === name).length === 1),
    'Reviewed drag replacement requires exactly one lift, hover and lower together.');
}

function acceptedFrameRate(action, reviewedRunPairRollback) {
  return action.fps === FPS || (reviewedRunPairRollback === true && RUN_PAIR.includes(action.logicalName) && action.fps === 30);
}

function validateRunMovement(movement, frameCount, name) {
  onlyKeys(movement, ['startFrame', 'endFrameExclusive', 'accelUntilFrame', 'decelerateFromFrame'], name + ' movement');
  assert(Number.isInteger(movement.startFrame) && Number.isInteger(movement.endFrameExclusive) && movement.startFrame >= 0 &&
    movement.startFrame < movement.endFrameExclusive && movement.endFrameExclusive <= frameCount, 'Run movement must identify the reviewed actual gait frames.');
  if (Object.hasOwn(movement, 'accelUntilFrame') || Object.hasOwn(movement, 'decelerateFromFrame')) {
    assert(Number.isInteger(movement.accelUntilFrame) && Number.isInteger(movement.decelerateFromFrame) &&
      movement.startFrame < movement.accelUntilFrame && movement.accelUntilFrame <= movement.decelerateFromFrame &&
      movement.decelerateFromFrame < movement.endFrameExclusive, 'Run stride phases require both reviewed frame integers ordered start < acceleration <= braking < end.');
  }
}

/** Validate review declarations without touching media or the filesystem. */
export function validatePlan(plan, planDirectory) {
  onlyKeys(plan, ['schemaVersion', 'approved', 'actions', 'reviewedRunPairRollback', 'reviewedDragReplacement'], 'plan');
  assert(plan.schemaVersion === 1 && plan.approved === true, 'The complete plan must be approved (schemaVersion: 1).');
  assert(Array.isArray(plan.actions) && plan.actions.length >= 1 && plan.actions.length <= REPLACE.length + ADD.length, 'Invalid action count.');
  const reviewedRunPairRollback = Object.hasOwn(plan, 'reviewedRunPairRollback') ? plan.reviewedRunPairRollback : false;
  validateRunPairScope(plan.actions, reviewedRunPairRollback);
  const reviewedDragReplacement = Object.hasOwn(plan, 'reviewedDragReplacement') ? plan.reviewedDragReplacement : false;
  validateDragScope(plan.actions, reviewedDragReplacement, reviewedRunPairRollback);
  const replacements = reviewedRunPairRollback ? RUN_PAIR : REPLACE;
  const names = new Set();
  return plan.actions.map(value => {
    onlyKeys(value, ['logicalName', 'path', 'sha256', 'fps', 'frameCount', 'durationMs', 'bounds', 'approved', 'firstLastPixelEqual', 'movement'], 'action');
    const name = value.logicalName;
    assert([...replacements, ...ADD].includes(name) && !names.has(name), 'Forbidden or duplicate action: ' + name);
    names.add(name);
    assert(value.approved === true && SHA.test(value.sha256 ?? ''), 'Each action needs explicit approval and SHA-256: ' + name);
    assert(typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096 && !value.path.includes('\0'), 'Invalid input path: ' + name);
    assert(acceptedFrameRate(value, reviewedRunPairRollback) && Number.isInteger(value.frameCount) && value.frameCount >= 2 && value.frameCount <= value.fps * 120, 'Only 24 fps media, or an explicitly reviewed native 30 fps run pair, is supported: ' + name);
    assert(close(value.durationMs, value.frameCount * 1000 / value.fps, 1), 'Duration must equal frameCount / declared fps: ' + name);
    const bounds = value.bounds;
    assert(Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isInteger) &&
      bounds[0] >= 0 && bounds[1] >= 0 && bounds[2] <= 1280 && bounds[3] <= 720 && bounds[0] < bounds[2] && bounds[1] < bounds[3], 'Invalid exclusive alpha bounds: ' + name);
    // A reviewed character must fit its outline padding without clipping the canvas.
    assert(bounds[0] >= 16 && bounds[1] >= 16 && bounds[2] <= 1264 && bounds[3] <= 704, 'Reviewed alpha bounds leave insufficient 16 px outline margin: ' + name);
    if ('firstLastPixelEqual' in value) assert(typeof value.firstLastPixelEqual === 'boolean', 'Endpoint comparison must be an actual boolean: ' + name);
    if (RUN_PAIR.includes(name)) {
      validateRunMovement(value.movement, value.frameCount, name);
    } else assert(!('movement' in value), 'Movement is only accepted for running-left or running-right.');
    return { ...value, path: resolve(planDirectory, value.path), bounds: [...bounds], ...(value.movement ? { movement: { ...value.movement } } : {}) };
  });
}

export function unionOutlineRoi(original, actions) {
  assert(Array.isArray(original) && original.length === 4 && original.every(Number.isInteger), 'Invalid existing outline ROI.');
  const [x, y, width, height] = original;
  let left = x, top = y, right = x + width, bottom = y + height;
  for (const action of actions) {
    left = Math.min(left, action.bounds[0] - 16);
    top = Math.min(top, action.bounds[1] - 16);
    right = Math.max(right, action.bounds[2] + 16);
    bottom = Math.max(bottom, action.bounds[3] + 16);
  }
  assert(left >= 0 && top >= 0 && right <= 1280 && bottom <= 720, 'Outline union extends outside the canvas.');
  return [left, top, right - left, bottom - top];
}

export function validateProbe(info, action, { reviewedRunPairRollback = false } = {}) {
  assert(acceptedFrameRate(action, reviewedRunPairRollback), 'Unsupported reviewed frame rate: ' + action.logicalName);
  const streams = info.streams ?? [];
  const videos = streams.filter(row => row.codec_type === 'video');
  assert(videos.length === 1 && streams.length === 1, 'Expected one video stream and no audio/extra streams: ' + action.logicalName);
  const video = videos[0];
  const fraction = value => { const parts = String(value).split('/').map(Number); return parts.length === 2 && parts[1] !== 0 ? parts[0] / parts[1] : NaN; };
  const alphaTags = Object.entries(video.tags ?? {}).filter(([key]) => key.toLowerCase() === 'alpha_mode').map(([, value]) => value);
  assert(video.codec_name === 'vp9' && video.width === 1280 && video.height === 720 && alphaTags.length > 0 && alphaTags.every(value => String(value) === '1'), 'Expected transparent VP9 WebM at 1280 × 720: ' + action.logicalName);
  assert(fraction(video.r_frame_rate) === action.fps && fraction(video.avg_frame_rate) === action.fps, 'Actual stream rate differs from reviewed fps: ' + action.logicalName);
  const frames = (info.frames ?? []).filter(row => row.media_type === 'video');
  assert(Number(video.nb_read_frames) === action.frameCount && frames.length === action.frameCount, 'Actual frame count differs from review: ' + action.logicalName);
  assert(close(Number(info.format?.duration) * 1000, action.durationMs, 1.1), 'Actual media duration differs from review: ' + action.logicalName);
  assert(frames.every((frame, index) => close(Number(frame.best_effort_timestamp_time), index / action.fps, .0011)), 'Non-continuous or non-native fps presentation timestamps: ' + action.logicalName);
}

function probeMedia(ffprobe, action, options) {
  const info = JSON.parse(execFileSync(ffprobe, [
    '-v', 'error', '-threads', '1', '-count_frames', '-show_frames',
    '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames:stream_tags=alpha_mode:format=duration:frame=media_type,best_effort_timestamp_time',
    '-of', 'json', action.path,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 ** 2, timeout: 60000, windowsHide: true }));
  validateProbe(info, action, options);
}

function loadProfile(root) {
  const file = join(root, PROFILE);
  delete require.cache[require.resolve(file)];
  return structuredClone(require(file));
}

function renderProfile(profile) {
  return '// Public runtime metadata binding; reviewed v1.9 media and preserved baseline assets.\n' +
    "(function(target){'use strict';const freeze=o=>{Object.values(o).forEach(v=>{if(v&&typeof v==='object')freeze(v)});return Object.freeze(o)};const profile=freeze(" +
    JSON.stringify(profile, null, 2) + ");if(typeof module==='object'&&module.exports)module.exports=profile;else target.ShuanglingMotion=profile;})(globalThis);\n";
}

function safeRelative(root, value) {
  assert(typeof value === 'string' && /^[A-Za-z0-9_./-]+$/.test(value) && !value.split('/').includes('..') && !isAbsolute(value), 'Unsafe runtime report reference.');
  const file = resolve(root, value);
  assert(inside(root, file), 'Report reference leaves the repository.');
  return file;
}

function checkFrozen(profile, allowedLeftSha256) {
  const identities = profile.outlineMaskRoi?.webmSha256ByAnimation;
  assert(identities?.idle === FIXED.idle, 'Frozen media identity changed: idle');
  assert(REVIEWED_LEFT_SHA256.includes(identities?.['running-left']) || (SHA.test(allowedLeftSha256 ?? '') && identities?.['running-left'] === allowedLeftSha256), 'Frozen media identity changed: running-left');
  assert(profile.outlineCssPx === .45 && profile.outlineMaskRoi?.paddingNativePx === 16, 'The existing 0.45 px / 16 native px outline must be preserved.');
}

function runtimeRow(action) {
  return {
    name: action.logicalName, sourceFrames: action.frameCount, encodedFrames: action.frameCount,
    fps: action.fps, durationMs: action.frameCount * 1000 / action.fps, frameIntervalMs: 1000 / action.fps,
    webmSha256: action.sha256, alphaBounds: [...action.bounds],
    ...(typeof action.firstLastPixelEqual === 'boolean' ? { firstLastPixelEqual: action.firstLastPixelEqual } : {}),
    source: `${MEDIA}/${action.logicalName}.webm`, reviewApproved: true,
  };
}

/** Older reports omitted only the canonical source field on some manual takes. */
export function verifyCurrentAnimationRows(assetRows, manifestRows) {
  const message = 'Current report animation rows disagree.';
  const normalized = rows => {
    assert(Array.isArray(rows), message);
    return rows.map(row => {
      assert(plain(row) && typeof row.name === 'string', message);
      const source = `${MEDIA}/${row.name}.webm`;
      assert(!Object.hasOwn(row, 'source') || row.source === source, message);
      return { ...row, source };
    });
  };
  assert(isDeepStrictEqual(normalized(assetRows), normalized(manifestRows)), message);
}

/** Build only public, allowlisted metadata. Never serialize input paths/plan IDs. */
export function buildOutputs({ assets, profile, actions, reviewedRunPairRollback = false, reviewedDragReplacement = false }) {
  validateRunPairScope(actions, reviewedRunPairRollback);
  validateDragScope(actions, reviewedDragReplacement, reviewedRunPairRollback);
  for (const action of actions.filter(action => DRAG_ANIMATIONS.includes(action.logicalName))) {
    const existing = assets.animations?.find(row => row.name === action.logicalName);
    assert(!existing || existing.webmSha256 === action.sha256 || reviewedDragReplacement,
      'Changing installed drag media requires explicit reviewedDragReplacement and all three drag clips.');
  }
  const next = structuredClone(assets);
  const accepted = [...CORE_ANIMATIONS, ...AMBIENT_ANIMATIONS, ...MANUAL_VARIANTS, ...DRAG_ANIMATIONS];
  const names = assets.animations?.map(row => row?.name);
  assert(Array.isArray(names) && new Set(names).size === names.length && names.every(name => accepted.includes(name)) && CORE_ANIMATIONS.every(name => names.includes(name)), 'Invalid existing animation inventory.');
  const replacements = reviewedRunPairRollback ? RUN_PAIR : REPLACE;
  assert(actions.every(action => [...replacements, ...ADD].includes(action.logicalName)) && new Set(actions.map(action => action.logicalName)).size === actions.length, 'Forbidden or duplicate reviewed action.');
  assert(actions.every(action => acceptedFrameRate(action, reviewedRunPairRollback)), 'Only 24 fps media, or an explicitly reviewed native 30 fps run pair, is supported.');
  const publicFields = ['name', 'sourceFrames', 'encodedFrames', 'fps', 'durationMs', 'frameIntervalMs', 'webmSha256', 'firstLastPixelEqual', 'loopMode', 'blankFrames', 'clippedFrames', 'alphaBounds', 'reviewApproved', 'manualOnly', 'logicalAction'];
  const rows = new Map(assets.animations.map(row => [row.name, {
    ...Object.fromEntries(publicFields.filter(key => Object.hasOwn(row, key)).map(key => [key, structuredClone(row[key])])),
    source: `${MEDIA}/${row.name}.webm`,
  }]));
  for (const action of actions) rows.set(action.logicalName, runtimeRow(action));
  const dragCount = DRAG_ANIMATIONS.filter(name => rows.has(name)).length;
  assert(dragCount === 0 || dragCount === DRAG_ANIMATIONS.length, 'Incomplete drag media: lift, hover and lower must be adopted together.');
  const animations = accepted.filter(name => rows.has(name)).map(name => rows.get(name));
  const frameRatesByAnimation = Object.fromEntries(animations.map(row => [row.name, row.fps]));
  assert(Object.entries(frameRatesByAnimation).every(([name, rate]) => rate === FPS || (RUN_PAIR.includes(name) && rate === 30)), 'Only the reviewed run pair may retain native 30 fps; other media must remain 24 fps.');
  const mixedNativeRates = Object.values(frameRatesByAnimation).some(rate => rate !== FPS);
  const manifest = {
    schema: 'shuangling-public-runtime-media-v1', releaseVersion: '1.9.0',
    method: mixedNativeRates ? 'reviewed-source-native-mixed' : 'reviewed-source-native24', canvas: [1280, 720], fps: FPS,
    outline: { mode: 'runtime-alpha-silhouette', color: '#000000', widthCssPx: .45 },
    frameRatesByAnimation, animations,
    publicationNote: 'Reviewed encoded source media on a common canvas; endpoint equality is reported only where measured. Existing idle, jumping and failed media are preserved; each clip retains its declared native frame rate.',
  };
  const manifestText = json(manifest);
  const manifestSha256 = hash(manifestText);
  Object.assign(next, { fps: FPS, releaseVersion: '1.9.0', motionManifest: MANIFEST, motionManifestSha256: manifestSha256, frameRatesByAnimation, animations });
  // A shared pose does not imply that differently generated texture pixels match.
  delete next.allDecodedNeutralEndpointsEqual;
  delete next.decodedNeutralFrameSha256;
  next.motionMode = manifest.method;
  const nextProfile = structuredClone(profile);
  if (dragCount) {
    nextProfile.drag = { lift: 'drag-lift', hover: 'drag-hover', lower: 'drag-lower' };
    nextProfile.dragAssetRoots = [...DRAG_ASSET_ROOTS];
  } else {
    delete nextProfile.drag;
    delete nextProfile.dragAssetRoots;
  }
  Object.assign(nextProfile.outlineMaskRoi, {
    sourceRect: unionOutlineRoi(profile.outlineMaskRoi.sourceRect, actions),
    sourceManifestSha256: manifestSha256,
    webmSha256ByAnimation: Object.fromEntries(animations.map(row => [row.name, row.webmSha256])),
  });
  for (const run of actions.filter(action => RUN_PAIR.includes(action.logicalName))) {
    validateRunMovement(run.movement, run.frameCount, run.logicalName);
    nextProfile.movement ??= {};
    nextProfile.movement.byAnimation ??= {};
    nextProfile.movement.byAnimation[run.logicalName] = {
      startMs: run.movement.startFrame * 1000 / run.fps,
      endMs: run.movement.endFrameExclusive * 1000 / run.fps,
      ...(Object.hasOwn(run.movement, 'accelUntilFrame') ? {
        accelUntilMs: run.movement.accelUntilFrame * 1000 / run.fps,
        decelerateFromMs: run.movement.decelerateFromFrame * 1000 / run.fps,
      } : {}),
    };
  }
  checkFrozen(nextProfile, reviewedRunPairRollback ? actions.find(action => action.logicalName === 'running-left').sha256 : undefined);
  return { manifest, manifestText, manifestSha256, assets: next, assetsText: json(next), profile: nextProfile, profileText: renderProfile(nextProfile) };
}

function diskAvailable(root) {
  assert(process.platform === 'win32' && /^D:[\\/]/i.test(root), 'Adoption is restricted to the Windows D: workspace.');
  const stats = statfsSync('D:\\', { bigint: true });
  return stats.bavail * stats.bsize;
}

function checkSpace(root, estimatedBytes) {
  const available = diskAvailable(root);
  const required = BigInt(FLOOR) + BigInt(estimatedBytes);
  assert(available > required, `Insufficient D: free space. Need more than 3 GiB plus ${estimatedBytes} bytes of expected outputs; available ${available}. Nothing is deleted automatically.`);
  return Number(available);
}

function regular(file, label) {
  assert(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Expected a regular local file: ' + label);
}

function noLinkedParents(root, file) {
  let current = dirname(file);
  while (inside(root, current)) {
    if (existsSync(current)) assert(!lstatSync(current).isSymbolicLink(), 'Refusing a linked output directory: ' + current);
    current = dirname(current);
  }
}

function atomicWrite(root, file, bytes) {
  noLinkedParents(root, file);
  checkSpace(root, Buffer.byteLength(bytes) + RESERVE);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = file + '.adopt-' + randomUUID() + '.tmp';
  // On failure the small temporary file is retained for inspection, never deleted.
  writeFileSync(temporary, bytes, { flag: 'wx' });
  renameSync(temporary, file);
}

function backupIndex(root) {
  const directory = join(root, BACKUP);
  noLinkedParents(root, join(directory, 'index.json'));
  const indexFile = join(directory, 'index.json');
  if (!existsSync(indexFile)) return { schemaVersion: 1, files: {}, absentPaths: [] };
  regular(indexFile, 'backup index');
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  onlyKeys(index, ['schemaVersion', 'files', 'absentPaths'], 'backup index');
  assert(index.schemaVersion === 1 && plain(index.files) && Array.isArray(index.absentPaths) && new Set(index.absentPaths).size === index.absentPaths.length, 'Invalid backup index.');
  for (const name of index.absentPaths) { safeRelative(directory, name); assert(!Object.hasOwn(index.files, name), 'Conflicting original backup state.'); }
  for (const [name, record] of Object.entries(index.files)) {
    const file = safeRelative(directory, name);
    noLinkedParents(root, file);
    onlyKeys(record, ['sha256', 'size'], 'backup record');
    assert(SHA.test(record.sha256 ?? '') && Number.isSafeInteger(record.size) && record.size >= 0, 'Invalid backup record.');
    regular(file, 'original backup');
    assert(statSync(file).size === record.size && fileHash(file) === record.sha256, 'Original backup no longer matches its index: ' + name);
  }
  return index;
}

function backupFiles(root, inventory, index, absentPaths) {
  const directory = join(root, BACKUP);
  for (const name of absentPaths) if (!index.absentPaths.includes(name) && !Object.hasOwn(index.files, name)) index.absentPaths.push(name);
  // Record originally absent outputs before adoption, so a second run never
  // mislabels newly adopted media as an original backup.
  atomicWrite(root, join(directory, 'index.json'), json(index));
  for (const row of inventory) {
    if (index.files[row.name] || index.absentPaths.includes(row.name)) continue;
    const target = safeRelative(directory, row.name);
    noLinkedParents(root, target);
    checkSpace(root, row.size + RESERVE);
    mkdirSync(dirname(target), { recursive: true });
    assert(fileHash(row.file) === row.sha256, 'Source changed before backup: ' + row.name);
    if (existsSync(target)) {
      regular(target, 'partial original backup');
      assert(statSync(target).size === row.size && fileHash(target) === row.sha256, 'Existing original backup cannot be overwritten: ' + row.name);
    } else copyFileSync(row.file, target, constants.COPYFILE_EXCL);
    assert(fileHash(target) === row.sha256, 'Backup verification failed: ' + row.name);
    index.files[row.name] = { sha256: row.sha256, size: row.size };
    atomicWrite(root, join(directory, 'index.json'), json(index));
  }
}

export function parseArguments(argv) {
  const options = { apply: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply') { assert(!options.apply, 'Duplicate --apply.'); options.apply = true; }
    else if (arg === '--help') options.help = true;
    else if (arg === '--plan' || arg === '--ffprobe') {
      const key = arg.slice(2);
      assert(!options[key] && typeof argv[index + 1] === 'string' && !argv[index + 1].startsWith('--'), 'Missing or duplicate ' + arg);
      options[key] = resolve(argv[++index]);
    } else throw Error('Unknown argument: ' + arg);
  }
  if (!options.help) assert(options.plan && options.ffprobe, 'Both --plan and --ffprobe are required. No executable is downloaded or auto-discovered.');
  return options;
}

export function adoptReviewedMedia(options, root = ROOT) {
  root = realpathSync(root);
  regular(options.plan, 'approved local plan');
  assert(statSync(options.plan).size <= 128 * 1024, 'The local review plan exceeds 128 KiB.');
  regular(options.ffprobe, 'existing ffprobe executable');
  const plan = JSON.parse(readFileSync(options.plan, 'utf8'));
  const actions = validatePlan(plan, dirname(options.plan));
  const reviewedRunPairRollback = plan.reviewedRunPairRollback === true;
  const reviewedDragReplacement = plan.reviewedDragReplacement === true;
  const allowedLeftSha256 = reviewedRunPairRollback ? actions.find(action => action.logicalName === 'running-left').sha256 : undefined;
  const availableBefore = checkSpace(root, RESERVE);
  const assetsFile = join(root, ASSETS);
  regular(assetsFile, 'assets metadata');
  const assets = JSON.parse(readFileSync(assetsFile, 'utf8'));
  const oldManifestFile = safeRelative(root, assets.motionManifest);
  regular(oldManifestFile, 'current motion manifest');
  regular(join(root, PROFILE), 'current outline profile');
  const profile = loadProfile(root);
  for (const file of [assetsFile, join(root, PROFILE), join(root, MANIFEST), join(root, BACKUP, 'index.json'), ...actions.map(row => join(root, MEDIA, row.logicalName + '.webm'))]) noLinkedParents(root, file);
  checkFrozen(profile, allowedLeftSha256);
  verifyOutlineAssetContract({ profile, manifestPath: oldManifestFile, assetDirectory: join(root, MEDIA), animations: assets.animations });
  assert(assets.motionManifestSha256 === fileHash(oldManifestFile), 'Assets metadata and current motion manifest disagree.');
  const oldManifest = JSON.parse(readFileSync(oldManifestFile, 'utf8'));
  verifyCurrentAnimationRows(assets.animations, oldManifest.animations);
  for (const action of actions) {
    regular(action.path, action.logicalName);
    assert(statSync(action.path).size <= 256 * 1024 ** 2, 'Reviewed source exceeds the 256 MiB per-action safety bound: ' + action.logicalName);
    assert(action.path.toLowerCase().endsWith('.webm') && fileHash(action.path) === action.sha256, 'Reviewed source hash or WebM extension mismatch: ' + action.logicalName);
    assert(realpathSync(action.path) !== realpathSync(join(root, MEDIA)) && !inside(join(root, MEDIA), realpathSync(action.path)), 'Review sources must be staged outside runtime media.');
    if (REPLACE.includes(action.logicalName) || (reviewedRunPairRollback && RUN_PAIR.includes(action.logicalName))) assert(assets.animations.some(row => row.name === action.logicalName), 'Replacement target is missing.');
    else {
      const existing = assets.animations.find(row => row.name === action.logicalName);
      assert(!existing || existing.webmSha256 === action.sha256 || (reviewedDragReplacement && DRAG_ANIMATIONS.includes(action.logicalName)), 'Optional actions may only be added (or re-applied with the same reviewed hash); drag replacement requires an explicit atomic review: ' + action.logicalName);
    }
    probeMedia(options.ffprobe, action, { reviewedRunPairRollback });
  }
  const outputs = buildOutputs({ assets, profile, actions, reviewedRunPairRollback, reviewedDragReplacement });
  const backups = backupIndex(root);
  const names = new Set([ASSETS, slash(relative(root, oldManifestFile)), PROFILE]);
  if (existsSync(join(root, MANIFEST))) names.add(MANIFEST);
  for (const action of actions) if (existsSync(join(root, MEDIA, action.logicalName + '.webm'))) names.add(`${MEDIA}/${action.logicalName}.webm`);
  const inventory = [...names].map(name => {
    const file = safeRelative(root, name); regular(file, name);
    return { name, file, size: statSync(file).size, sha256: fileHash(file) };
  });
  const absentPaths = [MANIFEST, ...actions.map(row => `${MEDIA}/${row.logicalName}.webm`)].filter(name => !existsSync(join(root, name)));
  const backupBytes = inventory.filter(row => !backups.files[row.name] && !backups.absentPaths.includes(row.name)).reduce((sum, row) => sum + row.size, 0);
  const mediaBytes = actions.filter(row => !existsSync(join(root, MEDIA, row.logicalName + '.webm')) || fileHash(join(root, MEDIA, row.logicalName + '.webm')) !== row.sha256).reduce((sum, row) => sum + statSync(row.path).size, 0);
  // Conservatively includes all candidate copies, backups and metadata, plus a 1 MiB margin.
  const estimatedOutputBytes = backupBytes + mediaBytes + Buffer.byteLength(outputs.manifestText) + Buffer.byteLength(outputs.assetsText) + Buffer.byteLength(outputs.profileText) + RESERVE;
  checkSpace(root, estimatedOutputBytes);
  const summary = {
    mode: options.apply ? 'apply' : 'dry-run', actions: actions.map(row => ({ name: row.logicalName, sha256: row.sha256, frames: row.frameCount, fps: row.fps })),
    freeBytesBefore: availableBefore, estimatedOutputBytes, backupBytes,
    outlineSourceRect: outputs.profile.outlineMaskRoi.sourceRect,
    rightMovement: outputs.profile.movement?.byAnimation?.['running-right'],
    manifest: MANIFEST, manifestSha256: outputs.manifestSha256,
    preserved: reviewedRunPairRollback ? assets.animations.map(row => row.name).filter(name => !RUN_PAIR.includes(name)) : ['idle', 'running-left', 'jumping', 'failed'],
    ...(reviewedRunPairRollback ? { reviewedRunPairRollback: true } : {}),
    ...(reviewedDragReplacement ? { reviewedDragReplacement: true } : {}),
    note: 'Review approval and declared alpha bounds are trusted review inputs; no visual acceptance, generation, transcoding, settings edits or deletion is performed.',
  };
  if (!options.apply) return summary;

  // All read/metadata checks above finish before the first write or backup.
  backupFiles(root, inventory, backups, absentPaths);
  for (const row of inventory) assert(fileHash(row.file) === row.sha256, 'Runtime inputs changed during backup; adoption stopped: ' + row.name);
  for (const action of actions) {
    const target = join(root, MEDIA, action.logicalName + '.webm');
    noLinkedParents(root, target);
    if (existsSync(target) && fileHash(target) === action.sha256) continue;
    assert(fileHash(action.path) === action.sha256, 'Reviewed source changed before adoption: ' + action.logicalName);
    checkSpace(root, statSync(action.path).size + RESERVE);
    const temporary = target + '.adopt-' + randomUUID() + '.tmp';
    copyFileSync(action.path, temporary, constants.COPYFILE_EXCL);
    assert(fileHash(temporary) === action.sha256, 'Copied source failed verification: ' + action.logicalName);
    renameSync(temporary, target);
  }
  atomicWrite(root, join(root, MANIFEST), outputs.manifestText);
  atomicWrite(root, assetsFile, outputs.assetsText);
  atomicWrite(root, join(root, PROFILE), outputs.profileText);
  const finalAssets = JSON.parse(readFileSync(assetsFile, 'utf8'));
  const finalProfile = loadProfile(root);
  checkFrozen(finalProfile, allowedLeftSha256);
  verifyOutlineAssetContract({ profile: finalProfile, manifestPath: join(root, MANIFEST), assetDirectory: join(root, MEDIA), animations: finalAssets.animations });
  assert(fileHash(join(root, MANIFEST)) === outputs.manifestSha256 && finalAssets.motionManifestSha256 === outputs.manifestSha256, 'Final manifest verification failed.');
  // Original backup checks are repeated after adoption. No rollback/delete is implicit.
  backupIndex(root);
  return { ...summary, verified: true, backup: BACKUP };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log('Usage: node tools/adopt-reviewed-media.mjs --plan <approved-local.json> --ffprobe <existing-ffprobe.exe> [--apply]\nDefault: read-only dry-run. Requires reviewed 1280x720 alpha VP9 WebM, continuous native timestamps, D: > 3 GiB plus outputs. Only an explicit reviewedRunPairRollback:true plan containing exactly both runs may replace the frozen left run and use native 30 fps; other new media remains 24 fps. Changing installed drag footage requires reviewedDragReplacement:true with all three drag clips reviewed together. No downloads, generation, settings edits, cleanup or automatic rollback.');
    else console.log(json(adoptReviewedMedia(options)));
  } catch (error) {
    console.error('Media adoption stopped: ' + error.message + '\nNo files are deleted. Existing backups and any partial outputs remain for inspection; do not launch until the final contract verifies.');
    process.exitCode = 1;
  }
}
