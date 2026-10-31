/**
 * Isolated, real-time native animation audit. Never points at a live data dir.
 * Usage: node tools/verify-companion-native.mjs <source-and-media-root> [--runtime-root <root>] [--idle-soak-minutes 30] [--plan]
 * Pure self-check: node tools/verify-companion-native.mjs --self-check
 * Requires Windows and the supplied root's bundled runtime/dependencies.
 * All audit files are retained; the user decides when to remove them.
 */
import assert from 'node:assert/strict';
import { copyFile, cp, link, mkdir, readFile, readdir, lstat, statfs, symlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const companionNames = Object.freeze(['reading', 'looking-around', 'stretching-wings']);
const publicNames = Object.freeze(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review', ...companionNames]);
const internalNames = Object.freeze(['running-classic', 'review-classic', 'waiting-classic', 'drag-lift', 'drag-hover', 'drag-lower']);
const json = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
const delay = ms => new Promise(done => setTimeout(done, ms));
const alive = pid => { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rounded = number => Number.isFinite(number) ? Math.round(number * 1000) / 1000 : null;
const within = (root, file) => { const rel = relative(root, file); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
export function assertAuditDiskHeadroom(freeBytes) {
  assert.ok(Number.isSafeInteger(freeBytes) && freeBytes > 3 * 1024 ** 3 + 16 * 1024 ** 2, 'disk-safety-stop');
  return freeBytes;
}
async function diskHeadroom(path) {
  const disk = await statfs(parse(path).root);
  return assertAuditDiskHeadroom(disk.bavail * disk.bsize);
}
async function until(operation, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await operation(); if (value) return value; await delay(100); }
  throw Error(label + '-timeout');
}
async function request(base, route, token, body, header = 'x-shuangling-token') {
  const response = await fetch(new URL(route, base), { method: body === undefined ? 'GET' : 'POST', headers: { [header]: token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(4000) });
  assert.ok(response.ok, `isolated-api-${response.status}`); return response.json();
}

export function validateAssets(value) {
  assert.ok(value && Array.isArray(value.animations) && value.animations.length > 0 && value.animations.length <= 32, 'invalid-assets-manifest');
  assert.ok(typeof value.motionManifest === 'string' && /^[A-Za-z0-9_./-]+$/.test(value.motionManifest) && !value.motionManifest.split('/').includes('..'), 'invalid-motion-reference');
  assert.match(basename(value.motionManifest), /^windows-action-frames(?:-[A-Za-z0-9_-]+)?\.json$/, 'invalid-motion-manifest-name');
  assert.equal(new Set(value.animations.map(row => row.name)).size, value.animations.length, 'duplicate-animation-name');
  for (const row of value.animations) {
    assert.match(row.name, /^[A-Za-z0-9_-]{1,64}$/, 'invalid-animation-name');
    assert.match(row.webmSha256, /^[a-f0-9]{64}$/, 'missing-media-hash');
    assert.ok(Number.isFinite(row.durationMs) && row.durationMs > 0 && row.durationMs <= 120000, 'invalid-media-duration');
    assert.ok(Number.isFinite(row.fps) && row.fps > 0 && row.fps <= 120, 'invalid-media-fps');
  }
  return value;
}

/** The public playback API deliberately excludes manual takes and drag phases. */
export function selectPublicActions(animations) {
  assert.ok(Array.isArray(animations), 'animation-list-required');
  const known = [...publicNames, ...internalNames];
  assert.equal(new Set(animations.map(row => row.name)).size, animations.length, 'duplicate-animation-name');
  for (const row of animations) assert.ok(known.includes(row.name), 'unclassified-audit-animation-' + row.name);
  const internal = animations.filter(row => internalNames.includes(row.name));
  for (const row of internal.filter(row => row.name.endsWith('-classic'))) {
    assert.equal(row.manualOnly, true, 'manual-variant-must-be-explicit-' + row.name);
  }
  return {
    playable: animations.filter(row => publicNames.includes(row.name)),
    internal: internal.map(row => ({ name: row.name, publicPlayback: false,
      reason: row.name.startsWith('drag-') ? 'Internal drag phase; covered by drag interaction tests.' : 'Manual alternative; covered by manual variant selection tests.' })),
  };
}

/** Executed inside the actual native page; observation never seeks or changes speed. */
export function installRendererProbe() {
  const p = typeof sprites !== 'undefined' ? sprites[0] : null;
  if (!p) return { ready: false };
  if (window.__companionNativeAudit) return window.__companionNativeAudit.snapshot();
  const records = new Map(), errors = [], diagnostics = [];
  let canvasReadable = true;
  const limit = values => values.slice(-16);
  const point = video => ({ t: Number.isFinite(video?.petPaintedMediaTime) ? video.petPaintedMediaTime : 0, x: p.pos.x, y: p.pos.y });
  const current = () => { const row = records.get(p.playback); return row && row.status === 'playing' ? row : null; };
  const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 108;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  function pixelHash(surface) {
    context.globalCompositeOperation = 'copy'; context.drawImage(surface, 0, 0, 192, 108);
    const pixels = context.getImageData(0, 0, 192, 108).data;
    let result = 2166136261;
    for (let index = 0; index < pixels.length; index++) result = Math.imul(result ^ pixels[index], 16777619);
    return (result >>> 0).toString(16);
  }
  function sample(row, video) {
    if (!row || !video) return;
    row.rateMin = Math.min(row.rateMin, video.playbackRate); row.rateMax = Math.max(row.rateMax, video.playbackRate);
    if (video.error) errors.push('media-error-' + video.error.code);
    const value = point(video);
    if (!row.positions.length || performance.now() - row.lastPositionAt >= 60) { row.positions.push(value); row.lastPositionAt = performance.now(); if (row.positions.length > 256) row.positions.splice(1, 1); }
    row.lastPosition = value;
  }
  const originalPaint = p.paintVideoFrame;
  p.paintVideoFrame = function (video, mediaTime, ...paintArguments) {
    const result = originalPaint.call(this, video, mediaTime, ...paintArguments), row = current();
    if (row && video === (p.front === 0 ? p.videoA : p.videoB)) {
      row.paints++; const time = video.petPaintedMediaTime;
      if (Number.isFinite(time)) { row.mediaMin = Math.min(row.mediaMin, time); row.mediaMax = Math.max(row.mediaMax, time); }
      const cleanupBinding = { sha256: typeof ShuanglingMotion !== 'undefined' ? ShuanglingMotion.outlineMaskRoi?.webmSha256ByAnimation?.[video.petOutlineAssetName] : null, width: video.videoWidth, height: video.videoHeight, fps: 24, frameCount: Math.round(video.duration * 24) };
      const cleanupDefined = typeof ShuanglingFrostCleanup !== 'undefined';
      const cleanupRects = cleanupDefined ? ShuanglingFrostCleanup.rectsForFrame(video.petOutlineAssetName, Number.isFinite(mediaTime) ? mediaTime : video.currentTime, cleanupBinding).length : 0;
      row.cleanup = { defined: cleanupDefined, trustedSource: !!p.outlineMaskSourceRect(video, 0), binding: cleanupBinding, name: video.petOutlineAssetName, maxRectangles: Math.max(row.cleanup?.maxRectangles || 0, cleanupRects), framesWithRectangles: (row.cleanup?.framesWithRectangles || 0) + Number(cleanupRects > 0), gate: { profile: p.isShuanglingProfile(), assetRoot: p.assetRoot, canonicalRoot: typeof ShuanglingMotion !== 'undefined' ? ShuanglingMotion.outlineMaskRoi?.assetRoot : null, capturedBase: !!p.videoOutlineAssetBase, baseUnchanged: p.assetBase === p.videoOutlineAssetBase, sourceMatches: video.petAnimationSource === p.videoOutlineAssetBase + encodeURIComponent(video.petOutlineAssetName) + '.webm', source: video.petAnimationSource, expectedSource: p.videoOutlineAssetBase + encodeURIComponent(video.petOutlineAssetName) + '.webm' } };
      if (canvasReadable) try { if (row.hashes.size < 64) row.hashes.add(pixelHash(p.videoSurface)); } catch (error) {
        if (error?.name === 'SecurityError') { canvasReadable = false; diagnostics.push('canvas-read-blocked-by-media-origin; native-main-capture-required'); }
        else errors.push('canvas-read-' + (error?.name || 'unknown'));
      }
      sample(row, video);
    }
    return result;
  };
  const originalBounds = p.sendBounds;
  p.sendBounds = function (x, y) {
    const row = current(), video = this.front === 0 ? this.videoA : this.videoB;
    if (row) {
      const t = video.petPaintedGeneration === video.petPlaybackGeneration ? video.petPaintedMediaTime || 0 : 0;
      row.boundsCalls++;
      if (row.timing && t <= row.timing.startMs / 1000 + 0.0001) row.earlyDelta = Math.max(row.earlyDelta, Math.hypot(x - row.startPos.x, y - row.startPos.y));
      if (row.timing && t >= row.timing.endMs / 1000 - 0.0001) { if (!row.stopPos) row.stopPos = { x, y }; row.lateDelta = Math.max(row.lateDelta, Math.hypot(x - row.stopPos.x, y - row.stopPos.y)); }
    }
    return originalBounds.call(this, x, y);
  };
  const originalReceipt = p.reportPlayback;
  p.reportPlayback = function (id, status, reason) {
    const video = this.front === 0 ? this.videoA : this.videoB;
    if (status === 'playing') {
      const timing = typeof ShuanglingMotion !== 'undefined' && ['running-right', 'running-left'].includes(this.displayedAnim) ? ShuanglingMotion.movement?.byAnimation?.[this.displayedAnim] || ShuanglingMotion.movement : null;
      records.set(id, { name: this.displayedAnim, status, startedAt: performance.now(), endedAt: null, duration: video.duration, rateMin: video.playbackRate, rateMax: video.playbackRate, rvfc: 0, paints: 0, hashes: new Set(), mediaMin: Infinity, mediaMax: 0, rvfcMin: Infinity, rvfcMax: 0, startPos: { ...this.pos }, positions: [], lastPositionAt: -Infinity, boundsCalls: 0, earlyDelta: 0, lateDelta: 0, timing: timing ? { startMs: timing.startMs, endMs: timing.endMs } : null, stopPos: null });
    }
    const row = records.get(id);
    if (row) { sample(row, video); row.status = status; if (['ended', 'failed', 'cancelled'].includes(status)) { row.endedAt = performance.now(); row.reason = reason || null; row.endedMediaTime = video.currentTime; } }
    return originalReceipt.call(this, id, status, reason);
  };
  for (const video of [p.videoA, p.videoB]) {
    video.addEventListener('error', () => errors.push('video-element-error-' + (video.error?.code || 0)));
    if (typeof video.requestVideoFrameCallback === 'function') {
      const observe = (_now, metadata) => {
        const row = current();
        if (row && video === (p.front === 0 ? p.videoA : p.videoB)) { row.rvfc++; row.rvfcMin = Math.min(row.rvfcMin, metadata.mediaTime); row.rvfcMax = Math.max(row.rvfcMax, metadata.mediaTime); sample(row, video); }
        video.requestVideoFrameCallback(observe);
      };
      video.requestVideoFrameCallback(observe);
    }
  }
  window.__companionNativeAudit = {
    snapshot() {
      const video = p.front === 0 ? p.videoA : p.videoB;
      const categoryNames = (p.animations.categories || []).flatMap(category => category.actions || []).map(action => typeof action === 'string' ? action : action?.name || action?.anim).filter(Boolean);
      return { ready: true, configOk: window.__dshPetDebug?.configOk === true, spriteCount: window.__dshPetDebug?.spriteCount, errors: limit([...errors, ...(window.__dshPetDebug?.errors || []).map(() => 'renderer-debug-error')]), diagnostics: limit(diagnostics), canvasReadable, rvfcSupported: [p.videoA, p.videoB].every(v => typeof v.requestVideoFrameCallback === 'function'), categories: [...new Set(categoryNames)], pos: { ...p.pos }, current: { name: p.displayedAnim, playback: p.playback, paintedTime: video?.petPaintedMediaTime || 0 }, records: Object.fromEntries([...records].map(([id, row]) => [id, { ...row, hashes: undefined, distinctPaintHashes: row.hashes.size, mediaMin: Number.isFinite(row.mediaMin) ? row.mediaMin : null, rvfcMin: Number.isFinite(row.rvfcMin) ? row.rvfcMin : null }])) };
    },
  };
  return window.__companionNativeAudit.snapshot();
}

function mainInstrumentation() {
  return `\n// Audit-skeleton-only observer; never distributed with the product.\n(() => {
 const auditFs=require('node:fs');const auditPath=require('node:path');const auditCrypto=require('node:crypto');const issues=[];let busy=false;let captured=0;let lastCapture='';const nativePositions=new Map();const nativePixels=new Map();
 app.on('web-contents-created',(_event,contents)=>{contents.on('console-message',event=>{if(event.level==='error'||event.level===3)issues.push('console-error');});contents.on('render-process-gone',(_event,details)=>issues.push('renderer-gone:'+details.reason));});
 process.on('uncaughtExceptionMonitor',error=>issues.push('main-exception:'+error.name));
 setInterval(async()=>{if(busy)return;busy=true;try{
  const win=[...windows.values()].find(w=>!w.isDestroyed());if(!win)return;
  const probe=await win.webContents.executeJavaScript('('+${JSON.stringify(installRendererProbe.toString())}+')()');
  const b=win.getBounds();const id=probe.current?.playback;
  if(id&&probe.records?.[id]?.status==='playing'){let list=nativePositions.get(id);if(!list){list=[];nativePositions.set(id,list);}list.push({t:probe.current.paintedTime,x:b.x,y:b.y});if(list.length>160)list.splice(1,1);}
  if(id&&probe.records?.[id]?.status==='playing'){let pixels=nativePixels.get(id);if(!pixels){pixels={hashes:new Set(),captures:0,lastAt:0};nativePixels.set(id,pixels);}if(Date.now()-pixels.lastAt>=200){pixels.lastAt=Date.now();const rendered=await win.webContents.capturePage();if(rendered.isEmpty())issues.push('native-pixel-capture-empty');else{const digest=auditCrypto.createHash('sha256').update(rendered.toBitmap()).digest('hex');pixels.captures++;if(pixels.hashes.size<64)pixels.hashes.add(digest);}}}
  for(const [playbackId,row]of Object.entries(probe.records||{})){const pixels=nativePixels.get(playbackId);row.rendererCanvasDistinctHashes=row.distinctPaintHashes;row.distinctPaintHashes=pixels?.hashes.size||0;row.nativePixelCaptures=pixels?.captures||0;row.pixelSource='main-webContents.capturePage.toBitmap';}
  let command={};try{command=JSON.parse(auditFs.readFileSync(process.env.NATIVE_ANIMATION_COMMAND,'utf8'));}catch{}
  if(command.captureId&&command.captureId!==lastCapture&&captured<2&&['native-01.png','native-02.png'].includes(command.file)){lastCapture=command.captureId;const image=await win.webContents.capturePage();auditFs.writeFileSync(auditPath.join(process.env.NATIVE_ANIMATION_OUTPUT,command.file),image.toPNG());captured++;}
  auditFs.writeFileSync(process.env.NATIVE_ANIMATION_PROBE,JSON.stringify({...probe,nativePid:process.pid,opacity:win.getOpacity(),focusable:win.isFocusable(),nativeBounds:{x:b.x,y:b.y,width:b.width,height:b.height},issues:issues.slice(-16),captured,nativePositions:Object.fromEntries(nativePositions)}));
 }catch(error){issues.push('probe:'+error.name);}finally{busy=false;}},100).unref();
})();\n`;
}

export function summarizeAnimation(row, stats) {
  const mediaAdvance = stats.mediaMax - (stats.mediaMin ?? stats.mediaMax);
  const elapsed = (stats.endedAt - stats.startedAt) / 1000;
  const duration = row.durationMs / 1000;
  const checks = { ended: stats.status === 'ended', multiplePresentedFrames: stats.rvfc >= 3 && stats.paints >= 3 && stats.distinctPaintHashes >= 2 && mediaAdvance > Math.min(0.1, duration / 2), normalSpeed: stats.rateMin === 1 && stats.rateMax === 1, duration: Math.abs(stats.duration - duration) <= Math.max(0.15, 2 / row.fps), realTime: elapsed >= duration * 0.8 && elapsed <= duration * 1.5 + 1 };
  return { name: row.name, ok: Object.values(checks).every(Boolean), receipt: stats.status, frames: { callbacks: stats.rvfc, paints: stats.paints, distinctHashes: stats.distinctPaintHashes, expectedFps: row.fps, presentedFps: rounded(stats.rvfc / elapsed), paintedFps: rounded(stats.paints / elapsed) }, media: [rounded(stats.mediaMin), rounded(stats.mediaMax), rounded(stats.endedMediaTime)], elapsedSeconds: rounded(elapsed), rate: [stats.rateMin, stats.rateMax], checks };
}

function samplePoints(points, count = 10) {
  if (!points?.length) return [];
  return Array.from(new Set(Array.from({ length: Math.min(count, points.length) }, (_, index) => Math.round(index * (points.length - 1) / Math.max(1, Math.min(count, points.length) - 1))))).map(index => [rounded(points[index].t), rounded(points[index].x), rounded(points[index].y)]);
}
function summarizeMovement(stats, nativePoints, settledBefore, settledAfter) {
  const timing = stats.timing;
  if (!timing) return { ok: false, reason: 'authored-timing-unavailable' };
  const start = timing.startMs / 1000, end = timing.endMs / 1000;
  const early = (nativePoints || []).filter(point => point.t <= start);
  const late = (nativePoints || []).filter(point => point.t > end + 0.12);
  const distance = values => values.length ? Math.max(...values.map(point => Math.hypot(point.x - values[0].x, point.y - values[0].y))) : null;
  const nativeTravel = distance(nativePoints || []), earlyTravel = distance(early), lateTravel = distance(late);
  const settledDelta = Math.hypot(settledAfter.x - settledBefore.x, settledAfter.y - settledBefore.y);
  const checks = { noEarlyRendererMove: stats.earlyDelta <= 1, noLateRendererMove: stats.lateDelta <= 1, nativeTravelObserved: nativeTravel > 2, nativeStartHeld: early.length >= 2 && earlyTravel <= 1, nativeTailHeld: late.length >= 2 && lateTravel <= 1, stoppedAfterEnded: settledDelta <= 1 };
  return { ok: Object.values(checks).every(Boolean), clock: 'painted-video-media-time', timingMs: [timing.startMs, timing.endMs], boundsCalls: stats.boundsCalls, maxEarlyRendererDelta: rounded(stats.earlyDelta), maxLateRendererDelta: rounded(stats.lateDelta), nativeTravel: rounded(nativeTravel), earlyNativeDelta: rounded(earlyTravel), lateNativeDelta: rounded(lateTravel), settledDelta: rounded(settledDelta), rendererSamples: samplePoints(stats.positions), nativeSamples: samplePoints(nativePoints), checks };
}

async function footprint(directory) {
  let regularBytes = 0, hardlinkedBytes = 0, junctions = 0;
  async function scan(path) { for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name), stat = await lstat(file); if (stat.isSymbolicLink()) { junctions++; continue; } if (stat.isDirectory()) await scan(file); else if (stat.isFile()) { if (stat.nlink > 1) hardlinkedBytes += stat.size; else regularBytes += stat.size; } } }
  await scan(directory); return { regularFileBytes: regularBytes, hardlinkedLogicalBytes: hardlinkedBytes, junctions, runtimeCopies: 0, mediaCopies: 0, retained: true, measurement: 'File lengths; hardlinks and junction targets excluded from regularFileBytes, not allocated clusters.' };
}

/** Summarize real native receipts without retaining a per-frame soak report. */
export function summarizeIdleSoak(records, { expectedMs, elapsedMs, frequency = 'normal', available = companionNames } = {}) {
  const intervals = { quiet: [45000, 90000], normal: [25000, 45000], lively: [12000, 25000] };
  const cooldowns = { reading: 180000, 'looking-around': 45000, 'stretching-wings': 120000 };
  const rows = Object.values(records).sort((a, b) => a.startedAt - b.startedAt);
  const gestures = rows.filter(row => row.name !== 'idle'), failures = [];
  const endedByName = {}, counts = {}, gaps = [];
  let prior = null, priorEnd = null;
  for (const row of rows) {
    counts[row.name] = (counts[row.name] || 0) + 1;
    if (row.status !== 'ended') failures.push('non-ended-' + row.name);
    if (row.rateMin !== 1 || row.rateMax !== 1) failures.push('changed-speed-' + row.name);
    if (row.paints < 3 || row.distinctPaintHashes < 2 || row.mediaMax - row.mediaMin <= 0.1) failures.push('static-or-unpainted-' + row.name);
    if (!['idle', ...available].includes(row.name)) failures.push('unavailable-' + row.name);
    if (row.name === 'idle') { if (priorEnd === null) priorEnd = row.endedAt; continue; }
    if (row.name === prior) failures.push('consecutive-gesture-' + row.name);
    if (Number.isFinite(endedByName[row.name]) && row.startedAt - endedByName[row.name] < cooldowns[row.name] - 300) failures.push('cooldown-' + row.name);
    if (Number.isFinite(priorEnd)) { const gap = row.startedAt - priorEnd; gaps.push(gap); if (gap < intervals[frequency][0] - 600) failures.push('quiet-gap-' + row.name); }
    prior = row.name; priorEnd = row.endedAt; endedByName[row.name] = row.endedAt;
  }
  const distinctGestures = new Set(gestures.map(row => row.name)).size;
  const checks = { realElapsed: elapsedMs >= expectedMs, realEnded: rows.length > 0 && rows.every(row => row.status === 'ended'), autonomousActivity: gestures.length > 0, ...(expectedMs >= 180000 ? { varied: distinctGestures >= 2 } : {}), ...(expectedMs >= 1800000 ? { everyCompanionObserved: available.every(name => counts[name] > 0) } : {}), availableOnly: rows.every(row => ['idle', ...available].includes(row.name)), noRuleViolations: failures.length === 0 };
  return { ok: Object.values(checks).every(Boolean), clock: 'real-wall-clock', expectedMs, observedElapsedMs: elapsedMs, frequency, checks, diversity: { assessed: expectedMs >= 180000, observedDistinct: distinctGestures, reason: expectedMs >= 180000 ? 'Long observation requires at least two distinct gestures.' : 'Short handoff probe cannot require multiple gestures across long cooldowns.' }, playbackCount: rows.length, gestureCount: gestures.length, counts, gestureSequenceEdges: { first: gestures.slice(0, 4).map(row => row.name), last: gestures.slice(-4).map(row => row.name) }, quietGapMs: { min: gaps.length ? rounded(Math.min(...gaps)) : null, max: gaps.length ? rounded(Math.max(...gaps)) : null }, violations: [...new Set(failures)].slice(0, 12) };
}

export function inspectIdleHandoff(status, native, baseline) {
  const control = status?.control || {};
  const playbackId = control.lastPlayback?.playbackId;
  const row = native?.records?.[playbackId];
  const firstNativeIdle = typeof playbackId === 'string' && !baseline.has(playbackId) && row?.name === 'idle' && row.status === 'playing' && row.paints >= 1 && row.rvfc >= 1 && row.rateMin === 1 && row.rateMax === 1;
  const diagnostic = { state: status?.status?.state ?? null, paused: control.paused ?? null, preempted: control.preempted ?? null, issue: control.issue ?? null, phase: control.schedule?.phase ?? null, lastPlayback: control.lastPlayback ? { name: control.lastPlayback.name, status: control.lastPlayback.status } : null, firstNativeIdle: Boolean(firstNativeIdle) };
  return { ready: diagnostic.state === 'idle' && diagnostic.paused === false && diagnostic.preempted === false && !diagnostic.issue && !control.surfaceReloading && firstNativeIdle, diagnostic };
}

function idleBoundaryInstrumentation() {
  return `\n// Isolated audit only: stop after the original one() verifies a real ended receipt.\nimport { existsSync as __idleAuditExists } from 'node:fs';\nconst __idleAuditOne = PetController.prototype.one;\nPetController.prototype.one = async function (...args) {\n const ended = await __idleAuditOne.apply(this, args);\n if (ended && this.status.state === 'idle' && process.env.NATIVE_IDLE_SOAK_STOP && __idleAuditExists(process.env.NATIVE_IDLE_SOAK_STOP)) this.setPaused(true);\n return ended;\n};\n`;
}

async function observeIdleSoak({ settings, probeFile, stopFile, minutes, assets }) {
  const token = settings.hash.slice(1), durationMs = minutes * 60000;
  const state = await request(settings.origin, '/api/state', token);
  assert.equal(state.status?.state, 'idle', 'soak-requires-confirmed-fixture-idle');
  const baseline = new Set(Object.keys((await json(probeFile))?.records || {}));
  await request(settings.origin, '/api/preferences', token, { ambientEnabled: true, ambientFrequency: 'normal' });
  const handoffStartedAt = Date.now(), handoffSamples = [];
  const rememberHandoff = result => { handoffSamples.push({ atMs: Date.now() - handoffStartedAt, ...result.diagnostic }); if (handoffSamples.length > 12) handoffSamples.splice(8, 1); return result; };
  rememberHandoff(inspectIdleHandoff(state, await json(probeFile), baseline));
  await request(settings.origin, '/api/settings', token, { paused: false });
  await until(async () => {
    const [status, native] = await Promise.all([request(settings.origin, '/api/state', token), until(() => json(probeFile), 2000, 'handoff-probe')]);
    const result = rememberHandoff(inspectIdleHandoff(status, native, baseline));
    return result.ready ? result : null;
  }, 20000, 'idle-control-handoff');
  const startedAt = Date.now();
  let samples = 0, badState = false, rendererIssues = false, minimumFreeBytes = Infinity;
  const anomalies = [];
  const longestClip = Math.max(...assets.animations.map(row => row.durationMs));
  try {
    while (Date.now() - startedAt < durationMs) {
      minimumFreeBytes = Math.min(minimumFreeBytes, await diskHeadroom(probeFile));
      const [status, native] = await Promise.all([request(settings.origin, '/api/state', token), until(() => json(probeFile), 2000, 'soak-probe')]);
      samples++;
      if (status.status?.state !== 'idle' || status.control?.paused !== false || status.control?.preempted || status.control?.issue) { badState = true; if (anomalies.length < 8) anomalies.push({ atMs: Date.now() - startedAt, ...inspectIdleHandoff(status, native, baseline).diagnostic }); }
      if (!native?.ready || native.issues?.length || native.errors?.length || native.opacity !== 0 || native.focusable !== false) rendererIssues = true;
      await delay(Math.min(2000, Math.max(1, durationMs - (Date.now() - startedAt))));
    }
    // Releasing the lease midway would unfreeze the renderer into idle and may
    // cancel a clip. This flag is consumed only after original one() sees ended.
    await writeFile(stopFile, 'Stop at the next verified native ended boundary.\n');
    await until(async () => { const value = await request(settings.origin, '/api/state', token); return value.control?.paused === true ? value : null; }, longestClip + 10000, 'soak-ended-boundary');
  } finally { await request(settings.origin, '/api/settings', token, { paused: true }); }
  const elapsedMs = Date.now() - startedAt;
  const final = await until(async () => {
    const native = await json(probeFile);
    const rows = Object.fromEntries(Object.entries(native?.records || {}).filter(([id]) => !baseline.has(id)));
    return Object.values(rows).every(row => row.status === 'ended') ? { native, rows } : null;
  }, longestClip + 10000, 'soak-tail-ended');
  const summary = summarizeIdleSoak(final.rows, { expectedMs: durationMs, elapsedMs, available: companionNames.filter(name => assets.animations.some(row => row.name === name)) });
  summary.samples = samples; summary.fixtureStatusStayedIdle = !badState; summary.noRendererIssues = !rendererIssues && !final.native.issues.length && !final.native.errors.length;
  summary.storage = { minimumFreeBytes, stopAtFreeBytes: 3 * 1024 ** 3 + 16 * 1024 ** 2, checkedEveryMs: 2000, automaticDeletion: false };
  summary.handoff = { ready: true, observedMs: startedAt - handoffStartedAt, samples: handoffSamples, policy: 'Measured observation begins only after idle/unpaused/no issue or preemption and a new native idle playing/paint receipt.' };
  summary.stateAnomalies = anomalies;
  summary.ok &&= summary.fixtureStatusStayedIdle && summary.noRendererIssues;
  summary.source = 'Production bridge watcher/controller with an isolated active-session boundary and an empty synthetic Codex home; no live logs.';
  summary.stopPolicy = 'A fixture-only wrapper pauses after original PetController.one verifies a real ended receipt; no cancelled record is removed.';
  return summary;
}

export async function auditNative(target, { plan = false, runtimeRoot = target, idleSoakMinutes = 0 } = {}) {
  assert.ok(Number.isInteger(idleSoakMinutes) && idleSoakMinutes >= 0 && idleSoakMinutes <= 120, 'idle-soak-minutes-must-be-0-to-120');
  const source = resolve(target), runtime = resolve(runtimeRoot), assetsFile = join(source, 'reports/windows-assets.json');
  const assetsBytes = await readFile(assetsFile), assets = validateAssets(JSON.parse(assetsBytes));
  const motion = resolve(source, assets.motionManifest); assert.ok(within(source, motion), 'motion-outside-target');
  const motionBytes = await readFile(motion); if (assets.motionManifestSha256) assert.equal(hash(motionBytes), assets.motionManifestSha256, 'motion-manifest-hash-mismatch');
  const mediaFiles = assets.animations.map(row => ({ ...row, file: join(source, 'windows/assets/shuangling', row.name + '.webm') }));
  for (const row of mediaFiles) assert.equal(hash(await readFile(row.file)), row.webmSha256, `asset-hash-mismatch-${row.name}`);
  const proposed = { target: basename(source), sourceMediaRoot: source, runtimeSourceRoot: runtime, manifestSha256: hash(assetsBytes), motionManifest: assets.motionManifest, motionManifestSha256: hash(motionBytes), animations: assets.animations.map(row => ({ name: row.name, durationMs: row.durationMs })), companionAssetsPresent: companionNames.every(name => assets.animations.some(row => row.name === name)), idleSoakMinutes, copies: { runtime: 0, media: 0 }, passive: true };
  if (plan) return { ok: true, planOnly: true, ...proposed };
  await diskHeadroom(source);
  assert.equal(process.platform, 'win32', 'windows-required');
  assert.equal(parse(source).root.toLowerCase(), parse(projectRoot).root.toLowerCase(), 'hardlink-volume-mismatch');
  const output = join(projectRoot, 'reports/native-animation-audit', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  const work = join(output, 'isolated'), skeleton = join(work, 'source'), data = join(work, 'data'), home = join(work, 'fake-codex-home');
  const probeFile = join(work, 'probe.json'), commandFile = join(work, 'command.json'), stopFile = join(work, 'idle-stop-after-ended');
  const report = { ...proposed, startedAt: new Date().toISOString(), realSettingsWrites: 0, productCodeChanges: 0, reportDirectory: output, actions: [], checks: {} };
  let manager, identity, native, helperPid, renewal, lockId, client, renewError = false;
  async function stopOwned() {
    if (identity && manager && identity.pid === manager.pid && alive(identity.pid)) await request(`http://127.0.0.1:${identity.managerPort}`, '/stop', identity.token, {}).catch(() => {});
    if (manager?.pid) await until(() => !alive(manager.pid), 12000, 'manager-exit').catch(() => {});
  }
  try {
    await mkdir(skeleton, { recursive: true }); await mkdir(data, { recursive: true }); await mkdir(home, { recursive: true });
    // A missing sessions directory correctly means unreadable/unknown in the
    // product watcher. An existing empty owned directory is explicit no-work.
    await mkdir(join(home, 'sessions'), { recursive: true });
    await writeFile(join(home, 'config.toml'), '# Isolated native audit. No plugins, account credentials or conversations.\n');
    await writeFile(join(data, 'plugin-config.json'), JSON.stringify({ autoLaunch: false, language: 'zh-CN', ambientEnabled: false }));
    if (idleSoakMinutes > 0) {
      // Only this owned fixture receives an explicit synthetic app-session boundary.
      const sessionTicks = ((BigInt(Date.now() - 1000) + 62135596800000n) * 10000n).toString();
      await writeFile(join(data, 'lifecycle-session.json'), JSON.stringify({ active: true, epochProcesses: [`${process.pid}:${sessionTicks}`] }));
    }
    for (const directory of ['src', 'vendor/dsh-pet/runtime/electron-helper']) await cp(join(source, directory), join(skeleton, directory), { recursive: true });
    if (idleSoakMinutes > 0) {
      const { CodexWorkWatcher } = await import(pathToFileURL(join(skeleton, 'src/bridge/codex-work.mjs')));
      const { currentCodexSessionStartedAt } = await import(pathToFileURL(join(skeleton, 'src/bridge/index.mjs')));
      const session = await json(join(data, 'lifecycle-session.json'));
      const watcher = new CodexWorkWatcher({ codexHome: home, sessionStartedAt: currentCodexSessionStartedAt(session) });
      try {
        await watcher.tick();
        const value = watcher.snapshot();
        report.checks.idleFixturePreflight = { state: value.state, reason: value.reason, discoveryReason: value.discoveryReason, boundaryReason: value.boundaryReason, emptyOwnedSessionsDirectory: true };
        assert.equal(value.state, 'idle', 'soak-fixture-preflight-not-idle');
      } finally { await watcher.close(); }
    }
    const files = ['package.json', 'windows/start.mjs', 'windows/outline-contract.mjs', 'windows/default-config.json', 'windows/runtime-config.json', 'windows/hd-geometry.json', 'windows/animation-timing.json', 'vendor/dsh-pet/lib/standalone.js', 'vendor/dsh-pet/package.json', 'vendor/dsh-pet/assets/config.jsonc', 'vendor/dsh-pet/assets/logo.png', 'reports/windows-assets.json', assets.motionManifest];
    for (const file of new Set(files)) { const to = join(skeleton, file); assert.ok(within(skeleton, to), 'copy-outside-skeleton'); await mkdir(dirname(to), { recursive: true }); await copyFile(join(source, file), to); }
    await symlink(join(runtime, 'windows/runtime'), join(skeleton, 'windows/runtime'), 'junction');
    await symlink(join(runtime, 'vendor/dsh-pet/node_modules'), join(skeleton, 'vendor/dsh-pet/node_modules'), 'junction');
    report.runtimeExecutableHashes = { node: hash(await readFile(join(runtime, 'windows/runtime/node/node.exe'))), electron: hash(await readFile(join(runtime, 'windows/runtime/electron/electron.exe'))) };
    for (const folder of ['windows/assets/shuangling']) await mkdir(join(skeleton, folder), { recursive: true });
    await mkdir(join(data, 'dsh-home/dsh-pet/main-animation/webm'), { recursive: true });
    for (const row of mediaFiles) { await link(row.file, join(skeleton, 'windows/assets/shuangling', row.name + '.webm')); await link(row.file, join(data, 'dsh-home/dsh-pet/main-animation/webm', row.name + '.webm')); }
    const launcher = join(skeleton, 'windows/start.mjs'), launcherSource = await readFile(launcher, 'utf8');
    assert.equal(launcherSource.split("DSH_PET_CADENCE_TEST: '0'").length, 2, 'passive-launch-marker-changed');
    await writeFile(launcher, launcherSource.replace("DSH_PET_CADENCE_TEST: '0'", "DSH_PET_CADENCE_TEST: '1'"));
    const helperMain = join(skeleton, 'vendor/dsh-pet/runtime/electron-helper/main.js');
    report.helperSourceSha256 = hash(await readFile(helperMain));
    report.spriteSourceSha256 = hash(await readFile(join(skeleton, 'vendor/dsh-pet/runtime/electron-helper/sprite.js')));
    await writeFile(helperMain, await readFile(helperMain, 'utf8') + mainInstrumentation());
    if (idleSoakMinutes > 0) {
      const controllerFile = join(skeleton, 'src/bridge/controller.mjs'), controllerSource = await readFile(controllerFile, 'utf8');
      report.controllerSourceSha256 = hash(controllerSource);
      await writeFile(controllerFile, controllerSource + idleBoundaryInstrumentation());
      report.fixtureOnlyControllerPatch = 'Stop-file check after original one() returns a verified ended; no cadence or playback-speed change.';
    }
    const env = { ...process.env, CODEX_HOME: home, DSH_HOME: join(data, 'dsh-home'), SHUANGLING_DATA_DIR: data, SHUANGLING_NO_OPEN: '1', SHUANGLING_SILENT_ERRORS: '1', SHUANGLING_CODEX_EXE: join(home, 'missing-account-client.exe'), NATIVE_ANIMATION_PROBE: probeFile, NATIVE_ANIMATION_COMMAND: commandFile, NATIVE_ANIMATION_OUTPUT: output, NATIVE_IDLE_SOAK_STOP: stopFile };
    for (const key of ['CODEX_THREAD_ID', 'ELECTRON_RUN_AS_NODE', 'SHUANGLING_LIFECYCLE_INTENT', 'DSH_PET_SMOKE', 'DSH_PET_INTERACTION_TEST']) delete env[key];
    manager = spawn(join(skeleton, 'windows/runtime/node/node.exe'), [launcher, 'start'], { cwd: skeleton, env, windowsHide: true, stdio: 'ignore' }); manager.unref();
    let spawnError; manager.once('error', error => { spawnError = error.code || 'spawn-failed'; });
    identity = await until(async () => { if (spawnError) throw Error(spawnError); const value = await json(join(data, 'desktop-runtime.json')); return value?.pid === manager.pid && value?.settingsUrl ? value : null; }, 25000, 'manager-start');
    native = await until(() => json(join(data, 'dsh-home/dsh-pet/standalone-runtime.json')), 20000, 'native-runtime');
    const settings = new URL(identity.settingsUrl); assert.equal(settings.hostname, '127.0.0.1'); assert.equal(settings.protocol, 'http:');
    await request(settings.origin, '/api/settings', settings.hash.slice(1), { paused: true });
    const ready = await until(async () => { const value = await json(probeFile); return value?.ready && value.configOk && value.spriteCount === 1 ? value : null; }, 25000, 'native-renderer');
    helperPid = ready.nativePid;
    assert.equal(ready.opacity, 0, 'passive-opacity'); assert.equal(ready.focusable, false, 'passive-focus'); assert.deepEqual(ready.issues, []); assert.deepEqual(ready.errors, []); assert.equal(ready.rvfcSupported, true, 'rvfc-required');
    report.checks.rendererLoaded = true; report.checks.passiveWindow = true;
    const state = await request(settings.origin, '/api/state', settings.hash.slice(1));
    report.checks.companionActions = Object.fromEntries(companionNames.map(name => [name, { manifest: assets.animations.some(row => row.name === name), category: ready.categories.includes(name), manager: state.availableAnimations?.includes(name) === true }]));
    const { PetClient } = await import(pathToFileURL(join(skeleton, 'src/bridge/pet-client.mjs')));
    client = new PetClient({ dshHome: join(data, 'dsh-home') });
    const lock = await until(() => client.lock(undefined, 30000).catch(() => null), 6000, 'native-lock'); lockId = lock.lockId; assert.ok(lockId, 'lock-id-required');
    renewal = setInterval(() => { void client.lock(lockId, 30000).catch(() => { renewError = true; }); }, 5000); renewal.unref();
    const baselineReceiptIds = new Set(Object.keys((await json(probeFile))?.records || {}));
    let timerStartedAt = null, timerExpectedEndsAt = null;
    try {
      await request(settings.origin, '/api/desk', settings.hash.slice(1), { type: 'focus.configure', focusMinutes: 25, breakMinutes: 1 });
      const timerState = await request(settings.origin, '/api/desk', settings.hash.slice(1), { type: 'focus.start', phase: 'break' });
      timerStartedAt = Date.now();
      timerExpectedEndsAt = timerState.focus.endsAt;
      assert.equal(timerState.focus.status, 'running'); assert.equal(timerState.focus.phase, 'break');
      report.checks.realMinuteTimer = { started: true, durationMinutes: 1, clock: 'real-wall-clock', bridgePaused: state.control?.paused === true };
    } catch { report.checks.realMinuteTimer = { ok: false, reason: 'desk-timer-unavailable' }; }
    let screenshots = 0;
    const requestedPlaybackIds = new Set();
    const publicInventory = selectPublicActions(assets.animations);
    report.internalMediaCoverage = publicInventory.internal;
    for (const row of publicInventory.playable) {
      if (['running-right', 'running-left'].includes(row.name)) { await client.position(row.name === 'running-right' ? 0.3 : 0.7, 0.65, lockId); await delay(400); }
      const started = await client.play(row.name, lockId); assert.ok(started.playbackId, 'playback-id-required'); requestedPlaybackIds.add(started.playbackId);
      let terminal, terminalFailure, shotRequested = false;
      const waitEnded = until(async () => { const value = await client.playback(started.playbackId); if (['failed', 'cancelled'].includes(value.status)) throw Error('playback-' + row.name + '-' + value.status); return value.status === 'ended' ? value : null; }, row.durationMs + 16000, 'ended-' + row.name).then(value => { terminal = value; }, error => { terminalFailure = error; });
      while (!terminal && !terminalFailure) {
        const current = await json(probeFile), stats = current?.records?.[started.playbackId];
        const wantsShot = row.name === 'running-right' || row.name === 'reading' || (!assets.animations.some(value => value.name === 'reading') && row.name === 'waving');
        if (screenshots < 2 && wantsShot && !shotRequested && stats?.mediaMax >= row.durationMs / 1000 * 0.45) { shotRequested = true; screenshots++; await writeFile(commandFile, JSON.stringify({ captureId: randomUUID(), file: `native-0${screenshots}.png` })); }
        await delay(100);
      }
      await waitEnded; if (terminalFailure) throw terminalFailure;
      const ended = await until(async () => { const value = await json(probeFile); return value?.records?.[started.playbackId]?.status === 'ended' ? value : null; }, 4000, 'ended-probe');
        const stats = ended.records[started.playbackId], result = summarizeAnimation(row, stats);
        result.cleanup = stats.cleanup || null;
        result.checks.trustedNativeCleanup = result.cleanup?.defined === true && result.cleanup?.trustedSource === true;
        result.ok &&= result.checks.trustedNativeCleanup;
      if (row.name === 'running-right') { const before = ended.nativeBounds; await delay(400); const after = await json(probeFile); result.movement = summarizeMovement(stats, ended.nativePositions?.[started.playbackId] || [], before, after.nativeBounds); result.ok &&= result.movement.ok; }
      report.actions.push(result);
      assert.deepEqual(ended.issues, [], 'native-main-issues'); assert.deepEqual(ended.errors, [], 'native-renderer-issues');
      assert.ok(!renewError, 'lock-renewal-failed');
    }
    if (timerStartedAt !== null) {
      try {
        const completed = await until(async () => { const value = await request(settings.origin, '/api/desk', settings.hash.slice(1)); return value.focus?.status === 'completed' ? value : null; }, Math.max(2500, 68000 - (Date.now() - timerStartedAt)), 'real-minute-timer');
        const observedElapsedMs = Date.now() - timerStartedAt;
        assert.equal(completed.focus.phase, 'break'); assert.ok(completed.focus.completionId, 'completion-id-required');
        await delay(2100);
        const stable = await request(settings.origin, '/api/desk', settings.hash.slice(1)), privateDesk = await json(join(data, 'desk.json'));
        const afterTimerState = await request(settings.origin, '/api/state', settings.hash.slice(1));
        const afterTimerProbe = await json(probeFile);
        const pendingNotices = Array.isArray(privateDesk?.notices) ? privateDesk.notices : [];
        const unrequested = Object.keys(afterTimerProbe?.records || {}).filter(id => !baselineReceiptIds.has(id) && !requestedPlaybackIds.has(id));
        const checks = { completed: completed.focus.status === 'completed', phaseStillBreak: stable.focus.phase === 'break', noNextSession: stable.focus.status === 'completed', completionIdStable: stable.focus.completionId === completed.focus.completionId && stable.focus.completedAt === completed.focus.completedAt, noDuplicateNotice: pendingNotices.length <= 1 && pendingNotices.every(notice => notice.id === completed.focus.completionId), noQueuedAutoPlayback: unrequested.length === 0, bridgeStillPaused: afterTimerState.control?.paused === true, fullRealMinute: observedElapsedMs >= 59000 && Number.isFinite(timerExpectedEndsAt) && completed.focus.completedAt >= timerExpectedEndsAt - 100 && completed.focus.completedAt <= timerExpectedEndsAt + 5000 };
        report.checks.realMinuteTimer = { ok: Object.values(checks).every(Boolean), durationMinutes: 1, observedElapsedMs, stableAfterMs: 2100, completionId: completed.focus.completionId, pendingNoticeCount: pendingNotices.length, unrequestedPlaybackCount: unrequested.length, checks };
      } catch (error) { report.checks.realMinuteTimer = { ok: false, reason: String(error.message).split('\n')[0].slice(0, 80) }; }
    }
    await client.release(lockId); lockId = null; clearInterval(renewal); renewal = null;
    if (idleSoakMinutes > 0) report.checks.idleSoak = await observeIdleSoak({ settings, probeFile, stopFile, minutes: idleSoakMinutes, assets });
    const last = await json(probeFile);
    report.checks.noRendererErrors = last.issues.length === 0 && last.errors.length === 0;
    report.pixelValidation = { source: 'main-webContents.capturePage.toBitmap', storage: 'In-memory hashes, sampled every 200ms during actual native playback. At most two explicitly requested PNGs are saved.', rendererCanvasReadable: last.canvasReadable, diagnostics: last.diagnostics || [], reason: 'Custom-scheme media can taint the renderer canvas; main-process capture verifies composited pixels without weakening webSecurity.' };
    report.screenshots = Array.from({ length: last.captured }, (_, index) => `native-0${index + 1}.png`);
    report.checks.sourceMediaUnchanged = true;
    for (const row of mediaFiles) if (hash(await readFile(row.file)) !== row.webmSha256) report.checks.sourceMediaUnchanged = false;
    report.checks.allPublicActionsEnded = report.actions.length === publicInventory.playable.length && report.actions.every(row => row.receipt === 'ended');
    report.checks.newActionsAvailable = Object.values(report.checks.companionActions).every(row => row.category === row.manifest && row.manager === row.manifest);
    report.companionAvailabilityPolicy = 'Every accepted companion clip must be offered by renderer and manager. Every unaccepted companion clip must be absent in both; absence is not a playback pass.';
    report.ok = report.actions.every(row => row.ok) && report.checks.noRendererErrors && report.checks.allPublicActionsEnded && report.checks.newActionsAvailable && report.checks.sourceMediaUnchanged && report.checks.realMinuteTimer?.ok === true && (idleSoakMinutes === 0 || report.checks.idleSoak?.ok === true);
    report.limitations = ['The passive window uses the desktop compositor at zero opacity; this does not exercise real mouse input.', 'Movement samples verify start/tail holds and post-ended stability; they do not replace visual gait or fine deceleration review.', 'Presented canvas hashes prove changing decoded content, not anatomical quality of artwork.'];
  } catch (error) { report.ok = false; report.failure = String(error.message).split('\n')[0].replace(/https?:\/\/\S+/g, '[url]').slice(0, 160); }
  finally {
    if (renewal) clearInterval(renewal);
    if (lockId && client) await client.release(lockId).catch(() => {});
    await stopOwned();
    if (native?.pid) await until(() => !alive(native.pid), 10000, 'host-exit').catch(() => {});
    if (helperPid) await until(() => !alive(helperPid), 10000, 'helper-exit').catch(() => {});
    report.checks.fullExit = !alive(manager?.pid) && !alive(native?.pid) && !alive(helperPid);
    report.ok = report.ok === true && report.checks.fullExit;
    report.finishedAt = new Date().toISOString(); report.footprint = await footprint(output).catch(() => ({ retained: true, measurement: 'unavailable' }));
    report.retention = 'All unique audit files are retained. No automatic deletion; remove this reportDirectory manually when no longer needed. Junction targets are external runtime/dependency directories.';
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

function selfCheck() {
  const row = { name: 'reading', durationMs: 4000, fps: 24, webmSha256: 'a'.repeat(64) };
  validateAssets({ motionManifest: 'reports/windows-action-frames-v190.json', animations: [row] });
  assert.throws(() => validateAssets({ motionManifest: '../private.json', animations: [row] }));
  assert.throws(() => validateAssets({ motionManifest: 'reports/windows-action-frames-v190.json', animations: [{ ...row, name: '../escape' }] }));
  const stats = { status: 'ended', rvfc: 80, paints: 80, distinctPaintHashes: 20, mediaMin: 0.04, mediaMax: 4, endedMediaTime: 4, startedAt: 0, endedAt: 4000, duration: 4, rateMin: 1, rateMax: 1 };
  assert.equal(summarizeAnimation(row, stats).ok, true);
  assert.equal(summarizeAnimation(row, { ...stats, distinctPaintHashes: 1 }).ok, false);
  assert.equal(summarizeAnimation(row, { ...stats, rateMax: 2 }).ok, false);
  assert.equal(summarizeAnimation(row, { ...stats, status: 'cancelled' }).ok, false);
  const points = [{ t: 0, x: 100, y: 100 }, { t: 0.4, x: 100, y: 100 }, { t: 1.2, x: 125, y: 100 }, { t: 2.7, x: 150, y: 100 }, { t: 2.9, x: 150, y: 100 }];
  const motion = { timing: { startMs: 500, endMs: 2500 }, earlyDelta: 0, lateDelta: 0, positions: points, boundsCalls: 80 };
  assert.equal(summarizeMovement(motion, points, { x: 150, y: 100 }, { x: 150, y: 100 }).ok, true);
  assert.equal(summarizeMovement({ ...motion, earlyDelta: 3 }, points, { x: 150, y: 100 }, { x: 150, y: 100 }).ok, false);
  new Function(mainInstrumentation());
  assert.equal(typeof new Function('return (' + installRendererProbe.toString() + ')')(), 'function');
  assert.ok(idleBoundaryInstrumentation().includes('await __idleAuditOne.apply(this, args)'));
  assert.ok(idleBoundaryInstrumentation().indexOf('if (ended &&') > idleBoundaryInstrumentation().indexOf('await __idleAuditOne.apply(this, args)'));
  assert.deepEqual(parseArguments(['candidate', '--runtime-root', 'installed', '--idle-soak-minutes', '30', '--plan']), { target: 'candidate', runtimeRoot: 'installed', idleSoakMinutes: 30, plan: true });
  assert.throws(() => parseArguments(['candidate', '--idle-soak-minutes', '-1'])); assert.throws(() => parseArguments(['candidate', '--idle-soak-minutes', '0.5']));
  const sampleRow = (name, start, end) => ({ ...stats, name, startedAt: start, endedAt: end });
  const soakRows = { a: sampleRow('idle', 0, 4000), b: sampleRow('reading', 30000, 34000), c: sampleRow('looking-around', 60000, 64000) };
  assert.equal(summarizeIdleSoak(soakRows, { expectedMs: 60000, elapsedMs: 60000 }).ok, true);
  assert.equal(summarizeIdleSoak({ ...soakRows, d: sampleRow('reading', 100000, 104000) }, { expectedMs: 60000, elapsedMs: 60000 }).ok, false);
  assert.equal(summarizeIdleSoak({ ...soakRows, d: sampleRow('looking-around', 110000, 114000) }, { expectedMs: 60000, elapsedMs: 60000 }).ok, false);
  const handoffStatus = { status: { state: 'idle' }, control: { paused: false, preempted: false, issue: null, lastPlayback: { playbackId: 'new-idle', name: 'idle', status: 'playing' } } };
  const handoffProbe = { records: { 'new-idle': { name: 'idle', status: 'playing', paints: 2, rvfc: 2, rateMin: 1, rateMax: 1 } } };
  assert.equal(inspectIdleHandoff(handoffStatus, handoffProbe, new Set()).ready, true);
  assert.equal(inspectIdleHandoff({ ...handoffStatus, control: { ...handoffStatus.control, issue: 'locked' } }, handoffProbe, new Set()).ready, false);
  assert.equal(inspectIdleHandoff(handoffStatus, handoffProbe, new Set(['new-idle'])).ready, false);
  assert.equal(inspectIdleHandoff(handoffStatus, { records: {} }, new Set()).ready, false);
  assert.throws(() => parseArguments(['candidate', '--runtime-root'])); assert.throws(() => parseArguments(['candidate', '--unknown']));
  return { ok: true, selfCheckOnly: true, processLaunches: 0, filesystemWrites: 0, checks: ['dynamic-manifest-path', 'unsafe-path-rejection', 'normal-speed', 'static-image-rejection', 'real-ended-required', 'movement-start-tail-holds', 'borrowed-runtime-arguments', 'idle-soak-arguments', 'idle-soak-real-receipts-cooldowns-and-nonrepetition', 'idle-handoff-requires-clean-control-and-new-painted-receipt', 'injected-main-syntax', 'renderer-probe-syntax'] };
}

export function parseArguments(args) {
  let target, runtimeRoot, idleSoakMinutes = 0, soakSpecified = false, plan = false;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--plan') plan = true;
    else if (value === '--runtime-root') { assert.ok(!runtimeRoot && args[index + 1] && !args[index + 1].startsWith('--'), 'runtime-root-requires-one-path'); runtimeRoot = args[++index]; }
    else if (value === '--idle-soak-minutes') { const minutes = args[++index]; assert.ok(!soakSpecified && /^(?:0|[1-9][0-9]{0,2})$/.test(minutes || '') && Number(minutes) <= 120, 'idle-soak-minutes-must-be-0-to-120'); idleSoakMinutes = Number(minutes); soakSpecified = true; }
    else { assert.ok(!value.startsWith('--') && !target, 'supply-one-target-and-supported-options'); target = value; }
  }
  assert.ok(target, 'source-and-media-root-required');
  return { target, runtimeRoot: runtimeRoot || target, idleSoakMinutes, plan };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--self-check')) console.log(JSON.stringify(selfCheck(), null, 2));
    else if (args.includes('--help')) console.log('node tools/verify-companion-native.mjs <source-and-media-root> [--runtime-root <root>] [--idle-soak-minutes 30] [--plan]\n--runtime-root borrows only windows/runtime and vendor/dsh-pet/node_modules via junctions; it defaults to the source/media root.\n--idle-soak-minutes (0-120, default 0) adds real-wall-clock isolated idle observation after normal action/timer audits. A synthetic active-session boundary is used; live logs are never read.\n--plan validates manifests/media without writes or launches. --self-check tests the verifier without I/O.\nNormal audits retain an isolated source/data fixture, hardlinked media, runtime junctions, one report and at most two screenshots.');
    else { const { target, ...options } = parseArguments(args); const result = await auditNative(target, options); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1; }
  } catch (error) { console.error(String(error.message).split('\n')[0].slice(0, 180)); process.exitCode = 1; }
}
