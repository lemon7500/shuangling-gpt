import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/shuangling-handoff.js', import.meta.url), 'utf8');
const spriteSource = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
const base = 'dsh-pet-bridge://dsh-pet/dsh-pet-7340/thumb/main/';
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function synthetic30RunSource() {
  let replaced = 0;
  const synthetic = source.replace(/^(\s*'running-(?:left|right)': )policy\([^\r\n]*$/gm, (_, prefix) => {
    replaced++;
    return `${prefix}policy(119, '${'0'.repeat(64)}', [[0, 0], [118, 118]], [118, 118], 30),`;
  });
  assert.equal(replaced, 2, 'the isolated 30fps fixture overrides exactly the two run policies');
  return synthetic;
}
function syntheticLongRightSource() {
  const expression = /^(\s*'running-right': )policy\([^\r\n]*$/m;
  assert.match(source, expression);
  return source.replace(expression, (_, prefix) => `${prefix}policy(241, '${'0'.repeat(64)}', [[0, 0], [240, 240]], [240, 240]),`);
}
function longRunStride(f) {
  const canvas = f.canvases[0];
  const capacity = Math.min(66, Math.floor(f.api.MAX_BYTES / (canvas.width * canvas.height * 4)));
  return Math.ceil(120 / (capacity - 2));
}
function fixture(name = 'running', policySource = source) {
  let now = 0, sequence = 0;
  const raf = new Map(), canvases = [], displayed = [], seeks = [];
  const window = { performance: { now: () => now }, console,
    requestAnimationFrame(callback) { const id = ++sequence; raf.set(id, callback); return id; },
    cancelAnimationFrame(id) { raf.delete(id); },
  };
  const doc = { defaultView: window, createElement(type) {
    assert.equal(type, 'canvas');
    const canvas = { width: 0, height: 0, ownerDocument: doc, frame: null };
    const ctx = { globalCompositeOperation: 'source-over', save() {}, restore() {},
      drawImage(input, ...coords) { assert.equal(this.globalCompositeOperation, 'copy'); canvas.frame = input.frame; canvas.coords = coords; },
    };
    canvas.getContext = () => ctx; canvases.push(canvas); return canvas;
  } };
  function video(asset, generation) {
    return { videoWidth: 1280, videoHeight: 720, readyState: 4, paused: false, seeking: false,
      ended: false, loop: true, playbackRate: 1, petPlaybackGeneration: generation,
      petOutlineAssetName: asset, petAnimationSource: base + asset + '.webm', petPaintedMediaTime: 0,
      _time: 0, listeners: new Map(), pauseCalls: 0, playCalls: 0,
      get currentTime() { return this._time; },
      set currentTime(value) { seeks.push(value); this._time = value; this.seeking = true; },
      pause() { this.paused = true; this.pauseCalls++; },
      play() { this.paused = false; this.playCalls++; return Promise.resolve(); },
      addEventListener(event, callback) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(callback); },
      removeEventListener(event, callback) { this.listeners.get(event)?.delete(callback); },
      finishSeek() { this.seeking = false; for (const callback of [...(this.listeners.get('seeked') || [])]) callback(); },
    };
  }
  const surface = { width: 1280, height: 720, frame: 0, ownerDocument: doc };
  const surfaceCtx = { globalCompositeOperation: 'source-over', save() {}, restore() {},
    drawImage(input, ...coords) { assert.equal(this.globalCompositeOperation, 'copy'); surface.frame = input.frame; displayed.push({ frame: input.frame, coords }); },
  };
  surface.getContext = () => surfaceCtx;
  const sprite = { front: 0, videoA: video(name, 7), videoB: video('waiting', 6), videoSurface: surface,
    assetBase: base, squashRef: null, stopPaints: 0, startPaints: 0, movesStopped: 0,
    frost: { begins: 0, deltas: [], animations: [], frames: [],
      beginTransition() { this.begins++; }, onTransition(delta) { this.deltas.push(delta); },
      onAnimation(name, info) { this.animations.push({ name, info }); }, onFrame(time, generation) { this.frames.push({ time, generation }); },
    },
    isShuanglingProfile: () => true,
    stopVideoPaint() { this.stopPaints++; }, startVideoPaint() { this.startPaints++; },
    stopMove() { this.movesStopped++; },
    paintVideoFrame(video, time) {
      surface.frame = time * (window.ShuanglingHandoff.policies[video.petOutlineAssetName]?.fps || 24);
      video.petPaintedMediaTime = time;
    },
  };
  vm.runInNewContext(policySource, { window, globalThis: window, Promise, console });
  const api = window.ShuanglingHandoff, handoff = api.create(sprite);
  handoff.onCommit(sprite.videoA, 7);
  return { sprite, api, handoff, raf, canvases, displayed, seeks, surface,
    paint(frame, target = sprite.videoA) {
      const fps = api.policies[target.petOutlineAssetName]?.fps || 24;
      target.petPaintedMediaTime = target._time = frame / fps; surface.frame = frame;
      handoff.capture(target, frame / fps);
    },
    tick(delta = 16) { now += delta; const callbacks = [...raf.values()]; raf.clear(); for (const callback of callbacks) callback(now); },
    async run(ms) { const steps = Math.ceil(ms / 10); for (let i = 0; i < steps; i++) { this.tick(10); await settle(); } },
  };
}

test('cache consists of native, synchronous outlined ROI copies and no other decoder', () => {
  const f = fixture(); f.paint(1); f.paint(2);
  assert.equal(f.canvases.length, 3);
  assert.deepEqual(f.canvases.map(c => [c.width, c.height]), [[539, 592], [539, 592], [539, 592]]);
  assert.deepEqual(f.canvases.map(c => c.frame), [0, 1, 2]);
  assert.deepEqual(f.canvases[0].coords, [368, 104, 539, 592, 0, 0, 539, 592]);
  f.paint(3, f.sprite.videoB); assert.equal(f.canvases.length, 3);
  f.surface.frame = 999; assert.equal(f.canvases[1].frame, 1, 'a captured canvas cannot alias the visible surface');
});

test('repeated idle, reading and wing commits reuse a bounded cache without retaining stale painted frames', async () => {
  const f = fixture('idle');
  let generation = 7;
  const paint = (name, frame) => {
    const video = f.sprite.videoA;
    video.petPaintedMediaTime = video._time = frame / 24;
    f.surface.frame = `${generation}:${name}:${frame}`;
    f.handoff.capture(video, frame / 24);
  };
  for (let cycle = 0; cycle < 3; cycle++) for (const name of ['idle', 'reading', 'stretching-wings']) {
    const video = f.sprite.videoA;
    video.petOutlineAssetName = name; video.petAnimationSource = base + name + '.webm';
    video.petPlaybackGeneration = ++generation; video.petPaintedMediaTime = video._time = 0;
    f.surface.frame = `${generation}:${name}:0`;
    f.handoff.onCommit(video, generation);
    for (let frame = 1; frame <= 24; frame++) paint(name, frame);
    let committed = null;
    f.handoff.request(name, () => { committed = f.surface.frame; return true; });
    await f.run(820);
    assert.equal(committed, `${generation}:${name}:0`, 'pooled storage may not replay a previous asset or generation');
    f.handoff.cancel(); video.finishSeek();
    for (let frame = 1; frame < f.api.policies[name].frames; frame++) paint(name, frame);
    assert.ok(f.canvases.length <= 66, 'repeated clips must not allocate a new full cache per generation');
    assert.ok(f.canvases.reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0) <= f.api.MAX_BYTES);
  }
  const resources = [...f.canvases]; f.handoff.dispose();
  assert.ok(resources.every(canvas => canvas.width === 0 && canvas.height === 0));
  const allocated = f.canvases.length;
  f.handoff.capture(f.sprite.videoA, 0); assert.equal(f.canvases.length, allocated);
  assert.equal(f.raf.size, 0);
});

test('a failed pooled context is discarded and the next generation can rebuild an honest return', async () => {
  for (const fault of ['null-context', 'copy-error']) {
    const f = fixture('idle'); for (let frame = 1; frame <= 24; frame++) f.paint(frame);
    const broken = f.canvases.at(-1);
    broken.getContext = fault === 'null-context' ? () => null : () => ({ drawImage() { throw Error('owned-copy-failure'); } });
    const video = f.sprite.videoA;
    video.petPlaybackGeneration = 8; video.petPaintedMediaTime = video._time = 0; f.surface.frame = 'failed-F0';
    f.handoff.onCommit(video, 8);
    assert.equal(broken.width, 0); assert.equal(broken.height, 0);
    for (let frame = 1; frame <= 12; frame++) f.paint(frame);
    f.handoff.request(fault, () => assert.fail('failed capture cannot invent a usable reverse path'));
    await settle(); assert.equal(video.paused, false); assert.equal(f.sprite.stopPaints, 0);
    f.handoff.cancel();
    video.petPlaybackGeneration = 9; video.petPaintedMediaTime = video._time = 0; f.surface.frame = 'new-generation-F0';
    f.handoff.onCommit(video, 9);
    for (let frame = 1; frame <= 12; frame++) f.paint(frame);
    let committed;
    f.handoff.request('recovered', () => { committed = f.surface.frame; return true; });
    await f.run(420);
    assert.equal(committed, 'new-generation-F0');
    assert.equal(broken.width, 0, 'a failed slot must not return to the spare pool');
    assert.ok(f.canvases.reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0) <= f.api.MAX_BYTES);
    f.handoff.dispose(); assert.ok(f.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  }
});

test('a real same-generation loop retires old frame identity and reuses its buffers', async () => {
  const f = fixture('idle'); for (let frame = 1; frame <= 57; frame++) f.paint(frame);
  const allocated = f.canvases.length;
  const video = f.sprite.videoA;
  video.petPaintedMediaTime = video._time = 0; f.surface.frame = 'looped-F0';
  f.handoff.capture(video, 0);
  for (let frame = 1; frame <= 24; frame++) f.paint(frame);
  let committed;
  f.handoff.request('after-loop', () => { committed = f.surface.frame; return true; });
  await f.run(820);
  assert.equal(committed, 'looped-F0');
  assert.equal(f.canvases.length, allocated, 'looping within one decoder generation must not allocate a second workspace');
  f.handoff.dispose(); assert.ok(f.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test('real stopMove preserves only the incoming authored run plan across idle reverse and neutral recoil', () => {
  for (const name of ['running-left', 'running-right']) for (const recoil of [false, true]) {
    const f = fixture('idle');
    const context = vm.createContext({ SHUANGLING_PROFILE: true, VIEW: { w: 1920, h: 1080 }, cancelAnimationFrame(id) { f.raf.delete(id); } });
    vm.runInContext(spriteSource + ';this.stop=PetSprite.prototype.stopMove', context);
    Object.assign(f.sprite, { stopMove: context.stop, moveRef: null, moveToken: 0, stopPosFollow() {} });
    const plan = { name, startRatio: .5, targetRatio: .65 };
    f.sprite.pendingMove = plan;
    if (recoil) f.sprite.squashRef = 1;
    else for (let frame = 1; frame <= 24; frame++) f.paint(frame);
    f.handoff.request({ anim: name }, () => {});
    assert.equal(f.sprite.pendingMove, plan, name + ' incoming plan must survive outgoing pose recovery');
    f.sprite.stopMove();
    assert.equal(f.sprite.pendingMove, null, 'an ordinary stop still cancels the new plan');
    f.sprite.pendingMove = plan;
    f.sprite.stopMove({ preservePendingForAnimation: 'review' });
    assert.equal(f.sprite.pendingMove, null, 'a different or non-run successor cannot retain a stale plan');
    f.handoff.dispose();
  }
});

test('first-half handoff reverses only real painted frames at 1.25 speed and commits asynchronously', async () => {
  const f = fixture(); for (let i = 1; i <= 24; i++) f.paint(i);
  const callbacks = []; f.handoff.request({ id: 1 }, value => callbacks.push(value.id));
  assert.equal(f.sprite.videoA.paused, true); assert.equal(f.sprite.stopPaints, 1); assert.equal(f.sprite.movesStopped, 1);
  await f.run(760); assert.deepEqual(callbacks, []);
  await f.run(50); assert.deepEqual(callbacks, [1]);
  assert.equal(f.displayed.at(-1).frame, 0);
  assert.ok(f.displayed.every((item, i, all) => !i || item.frame < all[i - 1].frame));
  assert.ok(f.displayed.every(item => item.coords[0] === 368 && item.coords[1] === 104 && item.coords.length === 2));
  assert.deepEqual(f.seeks, [], 'the real media is never tail-seeked for a transition');
  assert.equal(f.sprite.frost.begins, 1); assert.ok(f.sprite.frost.deltas.every(delta => delta >= 0));
});

test('trusted native drag returns over real cached task frames with a hard three-times rate cap', async () => {
  const f = fixture(); for (let i = 1; i <= 60; i++) f.paint(i);
  const commits = [];
  f.handoff.request({ anim: 'drag-lift', nativeDragReturn: true }, () => commits.push(f.surface.frame));
  assert.equal(f.sprite.videoA.paused, true);
  await f.run(800); assert.deepEqual(commits, [], 'a 2.5s native path cannot be forced into a 300ms cut');
  await f.run(60); assert.deepEqual(commits, [0]);
  assert.ok(f.displayed.every(({ frame }) => Number.isInteger(frame) && frame >= 0 && frame < 60));
  assert.ok(f.displayed.every((item, i, values) => i === 0 || item.frame < values[i - 1].frame));
  assert.deepEqual(f.seeks, [], 'the fast path still draws genuine cached frames without seeking to a tail');
});

test('native drag forward recovery uses the genuine decoder terminal and restores its original clock', async () => {
  const f = fixture('waiting'); f.paint(60); const commits = [];
  f.handoff.request({ anim: 'drag-lift', nativeDragReturn: true }, () => commits.push(f.surface.frame));
  assert.equal(f.sprite.videoA.playbackRate, 3); assert.equal(f.sprite.videoA.loop, false);
  f.paint(106); await settle(); assert.deepEqual(commits, []);
  f.paint(107); assert.deepEqual(commits, []); await settle(); assert.deepEqual(commits, [107]);
  assert.equal(f.sprite.videoA.playbackRate, 1); assert.equal(f.sprite.videoA.loop, true);
  assert.deepEqual(f.seeks, []);
  const canceled = fixture('waiting'); canceled.paint(60);
  canceled.handoff.request({ anim: 'drag-lift', nativeDragReturn: true }, () => assert.fail('cancelled'));
  canceled.handoff.cancel(); assert.equal(canceled.sprite.videoA.playbackRate, 1); assert.equal(canceled.sprite.videoA.loop, true);
});

test('ordinary manual requests and third-party playback cannot enable the native drag speedup', async () => {
  for (const transaction of [{ anim: 'waving', nativeDragReturn: true }, { anim: 'drag-lift', nativeDragReturn: true, playbackId: 'external' }]) {
    const f = fixture(); for (let i = 1; i <= 24; i++) f.paint(i);
    const commits = []; f.handoff.request(transaction, () => commits.push(f.surface.frame));
    await f.run(760); assert.deepEqual(commits, []);
    await f.run(60); assert.deepEqual(commits, [0], 'normal native-frame return keeps the established 1.25 times timing');
  }
});

test('superseding a local request retains the return path but only latest callback can commit', async () => {
  const f = fixture(); for (let i = 1; i <= 24; i++) f.paint(i);
  const callbacks = []; f.handoff.request('first', value => callbacks.push(value));
  await f.run(400); const afterHalf = f.displayed.at(-1).frame;
  f.handoff.request('second', value => callbacks.push(value));
  assert.equal(f.sprite.stopPaints, 1); assert.equal(f.sprite.frost.begins, 1);
  await f.run(420); assert.deepEqual(callbacks, ['second']);
  assert.ok(afterHalf > f.displayed.at(-1).frame);
});

test('a superseded callback holds its real neutral frame until a delayed successor is ready', async () => {
  const f = fixture(); for (let i = 1; i <= 24; i++) f.paint(i);
  const callbacks = [];
  f.handoff.request('old', () => { callbacks.push('stale'); return false; });
  await f.run(820); assert.equal(f.sprite.videoA.paused, true); assert.equal(f.surface.frame, 0);
  f.handoff.request('new', () => {
    callbacks.push('new'); f.sprite.front = 1; f.surface.frame = 0;
    f.handoff.onCommit(f.sprite.videoB, 6); return true;
  });
  assert.deepEqual(callbacks, ['stale']); await settle();
  assert.deepEqual(callbacks, ['stale', 'new']); assert.equal(f.sprite.stopPaints, 1);
  assert.equal(f.raf.size, 0);
});

test('delayed successor failure or drag cancel after neutral hold can resume the original decoder', async () => {
  for (const reason of ['failed-successor', 'drag']) {
    const f = fixture(); for (let i = 1; i <= 24; i++) f.paint(i);
    f.handoff.request(reason, () => false); await f.run(820);
    assert.equal(f.surface.frame, 0); assert.equal(f.sprite.videoA.paused, true);
    f.handoff.cancel(); assert.equal(f.sprite.videoA.currentTime, 0);
    f.sprite.videoA.finishSeek(); await settle();
    assert.equal(f.sprite.videoA.paused, false); assert.equal(f.sprite.startPaints, 1);
    assert.equal(f.sprite.frost.frames.at(-1).time, 0);
  }
});

test('a looping forward exit stays on its actual neutral while its successor is still decoding', async () => {
  const f = fixture('waiting'); f.paint(60);
  f.handoff.request('old', () => false); f.paint(107); await settle();
  assert.equal(f.sprite.videoA.paused, true); assert.equal(f.sprite.stopPaints, 1);
  await f.run(2000); assert.equal(f.surface.frame, 107);
  let observed;
  f.handoff.request('new', () => { observed = f.surface.frame; return true; });
  await settle(); assert.equal(observed, 107);
});

test('neutral exits defer commit out of the paint stack and supersede before the microtask', async () => {
  const f = fixture('review'); const results = [];
  f.handoff.request(1, value => results.push(value)); f.handoff.request(2, value => results.push(value));
  assert.deepEqual(results, []); await settle(); assert.deepEqual(results, [2]);
  assert.equal(f.sprite.stopPaints, 0);
});

test('cancel in the neutral microtask gap restores the existing frost without running a stale commit', async () => {
  const f = fixture('review'); f.paint(2);
  f.handoff.request(1, () => assert.fail('cancelled before the commit microtask'));
  assert.equal(f.sprite.frost.begins, 1); f.handoff.cancel(); await settle();
  assert.equal(f.sprite.frost.animations.at(-1).name, 'review');
  assert.deepEqual(f.sprite.frost.frames.at(-1), { time: 2 / 24, generation: 7 });
  assert.equal(f.sprite.videoA.paused, false);
});

test('a missing beginning, a >130ms paint gap, or latter half uses real forward terminal frames', async () => {
  for (const kind of ['gap', 'missing', 'late']) {
    const f = fixture('waiting'), results = [];
    if (kind === 'gap') { f.paint(1); f.paint(5); f.paint(24); }
    if (kind === 'missing') { f.sprite.videoA.petPlaybackGeneration++; f.paint(24); }
    if (kind === 'late') { for (let i = 1; i <= 60; i++) f.paint(i); }
    const time = f.sprite.videoA.currentTime;
    f.handoff.request(kind, value => results.push(value)); await settle();
    assert.deepEqual(results, []); assert.equal(f.sprite.stopPaints, 0); assert.equal(f.sprite.videoA.loop, false);
    assert.equal(f.sprite.videoA.playbackRate, 1); assert.equal(f.sprite.videoA.currentTime, time);
    f.paint(106); await settle(); assert.deepEqual(results, []);
    f.paint(107); assert.deepEqual(results, [], 'capture cannot synchronously replace the current renderer');
    await settle(); assert.deepEqual(results, [kind]); assert.equal(f.sprite.videoA.loop, true);
    assert.deepEqual(f.seeks, []);
  }
});

test('installed 24fps run directions require their own last neutral frame after the complete recovery', async () => {
  for (const [name, frames] of [['running-left', 124], ['running-right', 241]]) {
    const f = fixture(name), commits = []; f.paint(70);
    f.handoff.request(name, () => { commits.push(f.surface.frame); return true; });
    assert.equal(f.sprite.videoA.loop, false); assert.equal(f.sprite.stopPaints, 0);
    assert.equal(f.api.policies[name].fps, 24); assert.equal(f.api.policies[name].frames, frames);
    f.paint(frames - 2); await settle(); assert.deepEqual(commits, []);
    f.paint(frames - 1); assert.deepEqual(commits, []); await settle(); assert.deepEqual(commits, [frames - 1]);
    assert.deepEqual([...f.api.policies[name].terminalRange], [frames - 1, frames - 1]);
    assert.equal(f.sprite.videoA.loop, true); assert.deepEqual(f.seeks, []);
    const initial = fixture(name), early = [];
    initial.handoff.request(name, () => early.push(name)); await settle(); assert.deepEqual(early, [name]);
  }
});

test('installed 24fps and isolated synthetic 30fps runs reverse real first-half copies at native timing', async () => {
  for (const policySource of [source, synthetic30RunSource()]) {
    for (const name of ['running-left', 'running-right']) {
      const f = fixture(name, policySource), commits = [], fps = f.api.policies[name].fps;
      for (let frame = 1; frame <= fps; frame++) f.paint(frame);
      assert.equal(f.sprite.videoA.currentTime, 1);
      const cachedBeforeLatest = f.canvases.map(canvas => canvas.frame).filter(frame => frame < fps).reverse();
      f.handoff.request(name, () => { commits.push(f.surface.frame); return true; });
      assert.equal(f.sprite.videoA.paused, true); assert.equal(f.sprite.movesStopped, 1);
      await f.run(760); assert.deepEqual(commits, []);
      await f.run(60); assert.deepEqual(commits, [0]);
      assert.deepEqual(f.displayed.map(item => item.frame), cachedBeforeLatest);
      assert.deepEqual(f.seeks, [], 'the exit displays painted native copies without decoder tail seeks');
    }
  }
});

test('isolated synthetic 30fps runs still use true F118 terminal recovery', async () => {
  for (const name of ['running-left', 'running-right']) {
    const f = fixture(name, synthetic30RunSource()), commits = []; f.paint(70);
    f.handoff.request(name, () => { commits.push(f.surface.frame); return true; });
    assert.equal(f.api.policies[name].fps, 30); assert.equal(f.api.policies[name].frames, 119);
    f.paint(117); await settle(); assert.deepEqual(commits, []);
    f.paint(118); assert.deepEqual(commits, []); await settle(); assert.deepEqual(commits, [118]);
    assert.deepEqual(f.seeks, []);
  }
});

test('isolated synthetic 30fps runs keep the existing outlined ROI cache frame and byte budgets', async () => {
  for (const name of ['running-left', 'running-right']) {
    const f = fixture(name, synthetic30RunSource());
    for (let frame = 1; frame < 119; frame++) f.paint(frame);
    assert.equal(f.canvases.length, 60, 'the first half contains F0 through F59 at 30fps');
    assert.equal(f.api.MAX_BYTES, 88 * 1024 * 1024);
    assert.ok(f.canvases.length <= 66);
    assert.ok(f.canvases.length * 539 * 592 * 4 <= f.api.MAX_BYTES);
    assert.ok(f.canvases.every(canvas => canvas.width === 539 && canvas.height === 592));
    const copies = [...f.canvases]; f.handoff.dispose();
    assert.ok(copies.every(canvas => canvas.width === 0 && canvas.height === 0));
    assert.equal(f.raf.size, 0);
  }
});

test('a 241-frame right run retains real first-half anchors within the unchanged cache budget', async () => {
  const f = fixture('running-right', syntheticLongRightSource());
  for (let frame = 1; frame <= 120; frame++) {
    f.paint(frame);
    assert.ok(f.canvases.length <= 66);
    assert.ok(f.canvases.reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0) <= f.api.MAX_BYTES);
  }
  assert.equal(f.api.MAX_BYTES, 88 * 1024 * 1024);
  assert.equal(f.sprite.videoA.playbackRate, 1, 'normal animation still plays at its native rate');
  assert.equal(f.sprite.videoA.paused, false);
  const stride = longRunStride(f), anchors = Array.from({ length: Math.floor(120 / stride) + 1 }, (_, index) => index * stride);
  if (anchors.at(-1) !== 120) anchors.push(120);
  assert.deepEqual(f.canvases.map(canvas => canvas.frame), anchors);
  const commits = [];
  f.handoff.request('next', () => commits.push(f.surface.frame));
  assert.equal(f.sprite.videoA.paused, true); assert.equal(f.sprite.movesStopped, 1);
  f.tick(10); assert.equal(f.surface.frame, 120, 'return starts from the actual latest paint');
  await f.run(3970); assert.deepEqual(commits, []);
  await f.run(30); assert.deepEqual(commits, [0]);
  assert.deepEqual(f.displayed.map(item => item.frame), anchors.slice(0, -1).reverse());
  assert.ok(f.displayed.every((item, index, values) => !index || (values[index - 1].frame - item.frame) / 24 <= .13));
  assert.deepEqual(f.seeks, []);
  const copies = [...f.canvases]; f.handoff.dispose();
  assert.ok(copies.every(canvas => canvas.width === 0 && canvas.height === 0)); assert.equal(f.raf.size, 0);
});

test('a sparse long-run cache always keeps the latest odd painted frame and its real time', async () => {
  const f = fixture('running-right', syntheticLongRightSource());
  for (let frame = 1; frame <= 119; frame++) f.paint(frame);
  assert.equal(f.canvases.at(-1).frame, 119);
  f.handoff.request('next', () => assert.fail('cancelled'));
  assert.equal(f.sprite.videoA.paused, true);
  f.tick(20); assert.equal(f.surface.frame, 119, 'never jump to an older anchor at the start of recovery');
  const previous = Math.floor(118 / longRunStride(f)) * longRunStride(f);
  await f.run((119 - previous) * 1000 / 24 / 1.25);
  assert.equal(f.surface.frame, previous);
  assert.equal(f.sprite.videoA.petPaintedMediaTime, previous / 24);
  await f.run(330);
  const visible = f.surface.frame / 24;
  f.handoff.cancel(); assert.equal(f.sprite.videoA.currentTime, visible);
  assert.equal(f.sprite.videoA.paused, true);
  f.sprite.videoA.finishSeek(); await settle();
  assert.equal(f.sprite.videoA.paused, false); assert.equal(f.sprite.videoA.petPaintedMediaTime, visible);
  assert.equal(f.sprite.frost.frames.at(-1).time, visible);
});

test('a long-run cache with stale latest paint or an unsafe retained gap honestly uses native forward recovery', async () => {
  for (const kind of ['stale', 'paint-gap', 'anchor-gap']) {
    const f = fixture('running-right', syntheticLongRightSource()), commits = [];
    if (kind === 'stale') {
      for (let frame = 1; frame <= 118; frame++) f.paint(frame);
      f.surface.frame = 119; f.sprite.videoA.petPaintedMediaTime = f.sprite.videoA._time = 119 / 24;
    } else if (kind === 'paint-gap') { f.paint(1); f.paint(5); }
    else { f.paint(1); f.paint(4); }
    const visible = f.surface.frame;
    f.handoff.request(kind, () => commits.push(f.surface.frame));
    assert.equal(f.sprite.stopPaints, 0); assert.equal(f.sprite.videoA.paused, false);
    assert.equal(f.sprite.videoA.loop, false); assert.equal(f.surface.frame, visible);
    f.paint(239); await settle(); assert.deepEqual(commits, []);
    f.paint(240); assert.deepEqual(commits, []); await settle(); assert.deepEqual(commits, [240]);
    assert.equal(f.sprite.videoA.playbackRate, 1); assert.deepEqual(f.seeks, []);
  }
});

test('a 241-frame run never mistakes old F123 recovery for its actual F240 terminal pose', async () => {
  const f = fixture('running-right', syntheticLongRightSource()), commits = [];
  f.paint(121);
  f.handoff.request('next', () => commits.push(f.surface.frame));
  for (const frame of [123, 180, 239]) { f.paint(frame); await settle(); assert.deepEqual(commits, []); }
  f.paint(240); assert.deepEqual(commits, []); await settle(); assert.deepEqual(commits, [240]);
  const ended = fixture('running-right', syntheticLongRightSource());
  ended.paint(240); ended.sprite.videoA.ended = true;
  let terminal; ended.handoff.request('next', () => { terminal = ended.surface.frame; });
  await settle(); assert.equal(terminal, 240); assert.equal(ended.sprite.stopPaints, 0);
});

test('waving and classic review finish the remaining wrist recovery before a forward commit', async () => {
  for (const [name, last] of [['waving', 117], ['review-classic', 123]]) {
    const f = fixture(name), commits = []; f.paint(70);
    f.handoff.request(name, () => { commits.push(f.surface.frame); return true; });
    f.paint(last - 1); await settle(); assert.deepEqual(commits, []);
    f.paint(last); assert.deepEqual(commits, []); await settle(); assert.deepEqual(commits, [last]);
    assert.deepEqual([...f.api.policies[name].terminalRange], [last, last]);
  }
});

test('cancel synchronizes the decoder to the last displayed reverse frame before resuming', async () => {
  const f = fixture(); for (let i = 1; i <= 24; i++) f.paint(i);
  const results = []; f.handoff.request(1, value => results.push(value)); await f.run(330);
  const visible = f.displayed.at(-1).frame / 24;
  f.handoff.cancel(); assert.equal(f.sprite.videoA.currentTime, visible);
  assert.equal(f.sprite.videoA.paused, true, 'resume waits for the actual seek to finish');
  f.sprite.videoA.finishSeek(); await settle();
  assert.equal(f.sprite.videoA.paused, false); assert.equal(f.sprite.videoA.petPaintedMediaTime, visible);
  assert.equal(f.sprite.videoA.loop, true); assert.equal(f.sprite.startPaints, 1);
  assert.equal(f.sprite.frost.animations.at(-1).name, 'running');
  assert.deepEqual(f.sprite.frost.frames.at(-1), { time: visible, generation: 7 });
  await f.run(1000); assert.deepEqual(results, []);
});
test('a one-frame idle return cancellation resumes the genuine paused decoder pose without a long seek', async () => {
  for (const loop of [false, true]) {
    const f = fixture('idle'); for (let frame = 1; frame <= 18; frame++) f.paint(frame);
    f.sprite.videoA.loop = loop;
    f.handoff.request({ anim: 'drag-lift', nativeDragReturn: true }, () => assert.fail('short lift cancelled'));
    await f.run(20); assert.equal(f.surface.frame, 17);
    f.handoff.cancel(); await settle();
    assert.deepEqual(f.seeks, []); assert.equal(f.surface.frame, 18, 'only the adjacent genuine paused native frame is restored');
    assert.equal(f.sprite.videoA.currentTime, 18 / 24); assert.equal(f.sprite.videoA.petPaintedMediaTime, 18 / 24);
    assert.equal(f.sprite.videoA.paused, false); assert.equal(f.sprite.startPaints, 1);
    assert.equal(f.sprite.videoA.loop, loop); assert.equal(f.sprite.videoA.playbackRate, 1);
  }
});
test('the adjacent-idle fast cancellation never applies to task clips, a paused user, or multi-frame reverse', async () => {
  for (const variant of ['task', 'paused', 'multiple']) {
    const f = fixture(variant === 'task' ? 'running' : 'idle'); for (let frame = 1; frame <= 18; frame++) f.paint(frame);
    if (variant === 'paused') f.sprite.videoA.paused = true;
    f.handoff.request({ anim: 'drag-lift', nativeDragReturn: true }, () => assert.fail('cancelled'));
    await f.run(variant === 'multiple' ? 80 : 20); const visible = f.surface.frame;
    f.handoff.cancel(); assert.equal(f.sprite.videoA.currentTime, visible / 24);
    assert.equal(f.surface.frame, visible); assert.equal(f.sprite.videoA.seeking, true);
  }
});

test('a new native return cancels an old restore seek before it can repaint or restart the same decoder', async () => {
  const f = fixture('idle'); for (let frame = 1; frame <= 24; frame++) f.paint(frame);
  f.handoff.request({ anim: 'drag-lift', nativeDragReturn: true }, () => assert.fail('cancelled lift'));
  await f.run(60); f.handoff.cancel();
  assert.equal(f.sprite.videoA.seeking, true); assert.equal(f.sprite.videoA.paused, true);
  const staleSeek = [...f.sprite.videoA.listeners.get('seeked')][0]; assert.equal(typeof staleSeek, 'function');
  f.handoff.request({ anim: 'idle' }, () => true); await f.run(50);
  const latest = f.surface.frame, starts = f.sprite.startPaints, plays = f.sprite.videoA.playCalls;
  f.sprite.videoA.finishSeek(); staleSeek(); await settle();
  assert.equal(f.sprite.startPaints, starts, 'the retired seek may not restart forward decoder paints');
  assert.equal(f.sprite.videoA.playCalls, plays); assert.equal(f.surface.frame, latest);
  assert.equal(f.sprite.videoA.paused, true, 'the current cached return exclusively owns the surface');
  await f.run(1000); assert.equal(f.surface.frame, 0);
});

test('a queued old seek cannot remove the newer return cancellation restore listener', async () => {
  for (const paused of [false, true]) {
    const f = fixture('idle'); for (let frame = 1; frame <= 24; frame++) f.paint(frame);
    f.sprite.videoA.paused = paused;
    f.handoff.request({ anim: 'drag-lift', nativeDragReturn: true }, () => assert.fail('cancelled lift'));
    await f.run(60); f.handoff.cancel(); const staleSeek = [...f.sprite.videoA.listeners.get('seeked')][0];
    f.handoff.request({ anim: 'idle' }, () => assert.fail('second return cancelled')); await f.run(60);
    f.handoff.cancel(); const expected = f.surface.frame, starts = f.sprite.startPaints;
    assert.equal(f.sprite.videoA.listeners.get('seeked').size, 1);
    staleSeek(); assert.equal(f.sprite.videoA.listeners.get('seeked').size, 1, 'stale cleanup must not cancel its successor');
    f.sprite.videoA.finishSeek(); await settle();
    assert.equal(f.sprite.startPaints, starts + (paused ? 0 : 1)); assert.equal(f.sprite.videoA.paused, paused);
    assert.equal(f.surface.frame, expected); assert.equal(f.sprite.videoA.currentTime, expected / 24);
  }
});

test('forward frost fade advances once per actually painted media interval and cancel restores it', async () => {
  const f = fixture('waiting'); f.paint(60);
  f.handoff.request(1, () => assert.fail('cancelled'));
  f.paint(61); f.tick(10); f.paint(61); f.tick(10);
  assert.equal(f.sprite.frost.deltas.length, 1);
  assert.ok(Math.abs(f.sprite.frost.deltas[0] - 1000 / 24) < .001);
  f.handoff.cancel(); await settle();
  assert.equal(f.sprite.frost.animations.at(-1).name, 'waiting');
  assert.equal(f.sprite.frost.frames.at(-1).time, 61 / 24);
});

test('forward play rejection and a stalled decoder report failure while retaining the frame', async () => {
  for (const failure of ['play', 'stall']) {
    const f = fixture('waiting'); f.paint(60); const failures = [];
    const transaction = { failHandoff(reason) { failures.push(reason); } };
    if (failure === 'play') { f.sprite.videoA.paused = true; f.sprite.videoA.play = () => Promise.reject(new Error('blocked')); }
    f.handoff.request(transaction, () => assert.fail('a broken old decoder must not force an arbitrary-pose cut'));
    if (failure === 'stall') await f.run(2600); else await settle();
    await settle();
    assert.deepEqual(failures, [failure === 'play' ? 'handoff-play-rejected' : 'handoff-stalled']);
    assert.equal(f.surface.frame, 60); assert.equal(f.sprite.videoA.loop, true); assert.equal(f.raf.size, 0);
  }
});

test('a near-zero first observed timestamp is not a substitute for true decoded F0', async () => {
  const f = fixture('running'); f.sprite.videoA.petPlaybackGeneration++;
  f.surface.frame = .24; f.sprite.videoA.petPaintedMediaTime = f.sprite.videoA._time = .01;
  f.handoff.capture(f.sprite.videoA, .01);
  for (let i = 1; i <= 12; i++) f.paint(i);
  f.handoff.request(1, () => assert.fail('not terminal'));
  await settle(); assert.equal(f.sprite.stopPaints, 0); assert.equal(f.sprite.videoA.loop, false);
  f.handoff.cancel();
});

test('canceled seek and return RAF cannot repaint a newly committed generation', async () => {
  const f = fixture(); for (let i = 1; i <= 24; i++) f.paint(i);
  f.handoff.request(1, () => assert.fail('old commit')); await f.run(330); f.handoff.cancel();
  f.sprite.front = 1; f.surface.frame = 0; f.sprite.videoB.petPaintedMediaTime = 0;
  f.handoff.onCommit(f.sprite.videoB, 6); const starts = f.sprite.startPaints;
  f.sprite.videoA.finishSeek(); await f.run(1000);
  assert.equal(f.sprite.startPaints, starts); assert.equal(f.surface.frame, 0);
});

test('return completion and immediate neutral wait for natural squash recoil', async () => {
  for (const reverse of [false, true]) {
    const f = fixture(), results = [];
    if (reverse) for (let i = 1; i <= 12; i++) f.paint(i);
    f.sprite.squashRef = 50; f.handoff.request(1, value => results.push(value));
    await f.run(600); assert.deepEqual(results, []);
    f.sprite.squashRef = null; f.tick(); assert.deepEqual(results, []);
    await settle(); assert.deepEqual(results, [1]);
  }
});

test('a narrow neutral is held during CSS recoil instead of advancing into a mid-action cut', async () => {
  const f = fixture('running'); f.paint(1); f.sprite.squashRef = 50;
  const commits = []; f.handoff.request(1, () => { commits.push(f.surface.frame); return true; });
  assert.equal(f.sprite.videoA.paused, true); assert.equal(f.sprite.stopPaints, 1);
  await f.run(400); assert.deepEqual(commits, []); assert.equal(f.surface.frame, 1);
  f.sprite.squashRef = null; f.tick(); await settle(); assert.deepEqual(commits, [1]);
});

test('canceling neutral recoil hold restores both originally-playing and originally-paused decoders', async () => {
  for (const paused of [false, true]) {
    const f = fixture('running'); f.paint(1); f.sprite.videoA.paused = paused; f.sprite.squashRef = 50;
    f.handoff.request(1, () => assert.fail('cancelled')); f.handoff.cancel(); await settle();
    assert.equal(f.sprite.videoA.paused, paused); assert.equal(f.sprite.videoA.currentTime, 1 / 24);
    assert.equal(f.sprite.startPaints, paused ? 0 : 1);
  }
});

test('trusted source, dimensions and generation are enforced, bounded workspace reuses on commit and releases on dispose', async () => {
  const f = fixture();
  for (let i = 1; i <= 120; i++) f.paint(i);
  assert.ok(f.canvases.length <= 66); assert.ok(f.canvases.length * 539 * 592 * 4 <= f.api.MAX_BYTES);
  const old = [...f.canvases]; f.sprite.videoA.petPlaybackGeneration++;
  f.sprite.videoA.petPaintedMediaTime = 0; f.sprite.videoA._time = 0;
  f.handoff.onCommit(f.sprite.videoA, 8);
  assert.equal(f.canvases.length, old.length, 'a new identity reuses the bounded workspace instead of reallocating it');
  assert.ok(old.every(canvas => canvas.width === 539 && canvas.height === 592));
  f.handoff.dispose(); assert.ok(f.canvases.every(canvas => canvas.width === 0)); assert.equal(f.raf.size, 0);
  assert.equal(f.handoff.request(null, () => assert.fail('disposed')), false);
  for (const mutation of [
    v => { v.petAnimationSource = 'https://example.com/running.webm'; },
    v => { v.videoWidth = 640; },
    v => { v.petOutlineAssetName = 'unknown'; },
  ]) {
    const g = fixture(), count = g.canvases.length; mutation(g.sprite.videoA); g.paint(10);
    assert.equal(g.canvases.length, count); const results = [];
    g.handoff.request(1, value => results.push(value)); await settle(); assert.deepEqual(results, [1]);
    assert.equal(g.sprite.stopPaints, 0);
  }
});

test('native policy table describes exactly the fifteen immutable installed clips', () => {
  const f = fixture(); assert.equal(Object.keys(f.api.policies).length, 15);
  for (const p of Object.values(f.api.policies)) {
    assert.match(p.sha256, /^[a-f0-9]{64}$/);
    assert.equal(p.fps, 24);
    assert.ok(p.terminalRange[0] < p.frames && p.terminalRange[1] === p.frames - 1);
  }
});

test('reading waits for its actual stowed neutral instead of cutting away from the open book', async () => {
  const f = fixture('reading'), commits = [];
  assert.equal(f.api.policies.reading.frames, 240);
  // A return in the second half continues the authored close/stow motion.
  f.paint(150);
  f.handoff.request({ anim: 'running' }, () => commits.push(f.surface.frame));
  for (const frame of [170, 190, 206, 221, 238]) {
    f.paint(frame); f.tick(); await settle();
    assert.deepEqual(commits, [], 'a partly stowed reading pose is not a neutral exit');
  }
  f.paint(239); f.tick(); await settle();
  assert.deepEqual(commits, [239]);
  f.handoff.dispose();
});

test('policy hashes match all installed media and cache ROI matches the measured outline contract', () => {
  const f = fixture();
  for (const [name, p] of Object.entries(f.api.policies)) {
    const data = readFileSync(new URL(`../../windows/assets/shuangling/${name}.webm`, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), p.sha256, name);
  }
  const motionSource = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/shuangling-motion.js', import.meta.url), 'utf8');
  const motion = vm.runInNewContext(motionSource + '\nShuanglingMotion;', {});
  assert.deepEqual([...motion.outlineMaskRoi.sourceRect], f.canvases[0].coords.slice(0, 4));
});
