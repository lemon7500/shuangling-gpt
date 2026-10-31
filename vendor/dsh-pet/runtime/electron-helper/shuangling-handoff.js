/* Local artwork handoff: return through original painted frames, never blend characters. */
(function (target) {
  'use strict';
  const MAX_BYTES = 88 * 1024 * 1024;
  const MAX_FRAMES = 66, FPS = 24, MAX_GAP = .13, REVERSE_RATE = 1.25;
  const DRAG_RETURN_MS = 300, DRAG_MAX_RATE = 3;
  const READING_TASK_RETURN_RATE = 1.25;
  const RECT = Object.freeze([368, 104, 539, 592]);
  const FRAME_BYTES = RECT[2] * RECT[3] * 4;
  const policy = (frames, sha256, neutralRanges, terminalRange, fps = FPS) => Object.freeze({
    frames, fps, sha256,
    neutralRanges: Object.freeze(neutralRanges.map(range => Object.freeze(range))),
    terminalRange: Object.freeze(terminalRange),
  });
  function cacheSampling(p) {
    const capacity = Math.min(MAX_FRAMES, Math.floor(MAX_BYTES / FRAME_BYTES));
    if (capacity < 3) return null;
    const lastHalfFrame = Math.floor((p.frames - 1) / 2);
    // Short clips retain every painted frame. Longer clips reserve a slot for
    // the latest genuine paint between sparse anchors, without increasing RAM.
    const stride = lastHalfFrame + 1 <= capacity ? 1 : Math.ceil(lastHalfFrame / (capacity - 2));
    const interval = stride / p.fps;
    return interval <= MAX_GAP ? { stride, interval } : null;
  }
  // Measured native-frame pose exits for the installed, immutable media. These
  // intervals do not claim that different AI clips have identical fine texture.
  const policies = Object.freeze({
    idle: policy(116, '77f1e40eb2f2e39477e03688dff384b74ef260d129a4b5593af974f090e9457d', [[0, 4], [56, 63], [113, 115]], [113, 115]),
    'running-right': policy(241, 'ac57643f2f68bf3272ad49706b709bec0873d3c8968103e2979f292de83a169b', [[0, 0], [240, 240]], [240, 240]),
    'running-left': policy(124, '04f14130a7eab2d5302d2aa7cd9e70b5dba73a3e489e085892777f093000b88f', [[0, 0], [123, 123]], [123, 123]),
    waving: policy(118, '56a677055a593b1e43696c0b7679fc7b23bb27f283e55127e76b4c14c62747e2', [[0, 10], [117, 117]], [117, 117]),
    jumping: policy(107, 'fd3b73102da2078aa04c8a3ad02ae32ea70f07ca48a63a9508cef291ee15fa5e', [[0, 7], [88, 106]], [88, 106]),
    failed: policy(117, '73fc0371b0b4cc7a26c038a8f5e68de20617cbfd63cd7f2a86b49e8b548df83c', [[0, 4], [113, 116]], [113, 116]),
    waiting: policy(116, '0379f73660dbf0081c6955b29e7691ca87ea49452f4cecc91ee8582f09956251', [[0, 3], [107, 115]], [107, 115]),
    running: policy(124, 'e5475972e289c4a91ef77b33eb1ba362a649cd6579bed78c032c26371b9ebd17', [[0, 1], [109, 123]], [109, 123]),
    review: policy(118, 'cd024a61801b4d20e8b215c1beca729066b0b7d4ee351ca0b9058055f58d7070', [[0, 14], [108, 117]], [108, 117]),
    reading: policy(240, '88b5cfffa8393a9327ff705fe45bf8d73cefaa2192e6a72275f21b761292ed40', [[0, 1], [239, 239]], [239, 239]),
    'looking-around': policy(113, 'b15e42aefea143cd7c2821400a178457fe3552e9338de3c19dbcf66788b64ae5', [[0, 1], [107, 112]], [107, 112]),
    'stretching-wings': policy(108, '845d7aca137be3f28bcc8eda786a7e0384ad2b2828fca88ad1f6b330a0507cba', [[0, 11], [94, 107]], [94, 107]),
    'running-classic': policy(124, '650e042d8b317ca4465094af97ed9a33eeb0fa794ecc37d495f9287176bc40a9', [[0, 6], [113, 123]], [113, 123]),
    'review-classic': policy(124, 'b6e5cade85af05bd6881badb52692fa486b02c928c07c420b225f7c0b9ae0643', [[0, 6], [123, 123]], [123, 123]),
    'waiting-classic': policy(124, 'dca0b1829060476bbd16ca455a483f57f759e5b1f10b62edbb77dca3bde15689', [[0, 10], [113, 123]], [113, 123]),
  });

  function create(sprite) {
    const doc = sprite.videoSurface?.ownerDocument || sprite.stage?.ownerDocument || target.document;
    const host = doc?.defaultView || target;
    const requestFrame = (host.requestAnimationFrame || globalThis.requestAnimationFrame).bind(host);
    const cancelFrame = (host.cancelAnimationFrame || globalThis.cancelAnimationFrame).bind(host);
    const now = () => (host.performance || globalThis.performance).now();
    let history = null, pending = null, returning = null, raf = null, disposed = false, epoch = 0;
    // A new decoder generation retires frame identity, not the private canvas
    // workspace. Reusing the same bounded buffers avoids allocating and freeing
    // roughly 74 MiB on every complete breathing loop.
    const spareCanvases = [];
    let settling = false, seekCleanup = null, seekRestore = null;
    const front = () => sprite.front === 0 ? sprite.videoA : sprite.videoB;
    const identity = video => ({ video, source: video.petAnimationSource, generation: video.petPlaybackGeneration });
    const same = saved => !!saved && front() === saved.video &&
      saved.source === saved.video.petAnimationSource && saved.generation === saved.video.petPlaybackGeneration;
    const frameAt = (time, p) => Math.max(0, Math.min(p.frames - 1, Math.round(time * p.fps)));
    const inRanges = (frame, ranges) => ranges.some(([a, b]) => frame >= a && frame <= b);
    const paintedTime = video => Number.isFinite(video.petPaintedMediaTime) ? video.petPaintedMediaTime : NaN;
    function trusted(video) {
      const name = video?.petOutlineAssetName, p = policies[name], base = sprite.assetBase;
      return video === front() && !!p && (!sprite.isShuanglingProfile || sprite.isShuanglingProfile()) &&
        typeof base === 'string' && /^(?:dsh-pet-bridge:\/\/dsh-pet\/|https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/|file:\/\/\/)/i.test(base) &&
        video.petAnimationSource === base + encodeURIComponent(name) + '.webm' &&
        video.videoWidth === 1280 && video.videoHeight === 720 &&
        sprite.videoSurface?.width === 1280 && sprite.videoSurface?.height === 720 ? p : null;
    }
    function retireCanvas(canvas) {
      if (!disposed && spareCanvases.length < MAX_FRAMES) spareCanvases.push(canvas);
      else { canvas.width = 0; canvas.height = 0; }
    }
    function releaseHistory() {
      if (history) for (const item of history.frames) retireCanvas(item.canvas);
      history = null;
    }
    function stopRaf() { if (raf != null) cancelFrame(raf); raf = null; }
    function cleanSeek() { if (seekCleanup) seekCleanup(); seekCleanup = null; seekRestore = null; }
    function resetHistory(video) {
      releaseHistory();
      history = { ...identity(video), frames: [], bytes: 0, continuous: true, previousTime: null };
    }
    function restoreFrost(saved) {
      if (!same(saved)) return;
      const time = saved.mode === 'reverse' ? saved.lastShown : paintedTime(saved.video);
      sprite.frost?.onAnimation?.(saved.video.petOutlineAssetName, {
        duration: saved.video.duration, generation: saved.generation, loop: saved.loop,
      });
      if (Number.isFinite(time)) sprite.frost?.onFrame?.(time, saved.generation);
    }
    function restorePlayback(saved, resume) {
      if (!same(saved)) return;
      const video = saved.video;
      video.loop = saved.loop;
      video.playbackRate = saved.rate;
      if (!resume || (saved.mode !== 'reverse' && !saved.holdPaused)) {
        if (resume && saved.paused && !video.paused) video.pause();
        if (resume) restoreFrost(saved);
        return;
      }
      // A very short, canceled pickup may have shown just one preceding idle
      // cache frame. Its paused decoder still contains the genuine adjacent
      // original frame. Resume that real pose instead of decoding the whole
      // idle GOP backwards; larger returns and task/user-paused clips still
      // require the exact seek below. Never label a cached pose as this time.
      const adjacentNativeIdle = saved.mode === 'reverse' && saved.nativeDragReturn === true &&
        video.petOutlineAssetName === 'idle' && saved.paused === false && !video.seeking && video.readyState >= 2 &&
        Number.isFinite(saved.startTime) && Number.isFinite(saved.pausedDecoderTime) &&
        Math.abs(video.currentTime - saved.pausedDecoderTime) < .001 &&
        saved.startTime >= saved.lastShown && saved.startTime - saved.lastShown <= 1 / saved.policy.fps + .001;
      if (adjacentNativeIdle) saved.lastShown = saved.startTime;
      // A resumed decoder will revisit the genuine earlier frames; retain only
      // the matching prefix, rather than regarding that rewind as a new clip.
      if (history && same(history)) {
        while (history.frames.length && history.frames.at(-1).time > saved.lastShown + .001) {
          const removed = history.frames.pop(); retireCanvas(removed.canvas);
          history.bytes -= FRAME_BYTES;
        }
        history.previousTime = history.frames.at(-1)?.time ?? null;
      }
      const shouldPlay = !saved.paused;
      const token = epoch;
      const restore = () => {
        // A new return can own this same video and generation while an old
        // cancel seek is still queued. Identity alone cannot authorize a
        // forward repaint/play that would fight its cached return frames.
        if (disposed || token !== epoch || !same(saved) || pending || returning) return;
        cleanSeek();
        // Repaint only the frame the decoder has genuinely reached. Do not let
        // an old seek callback replace a newly committed character.
        if (video.readyState >= 2 && !video.seeking) {
          try { sprite.paintVideoFrame(video, saved.lastShown); } catch { /* retain the cached native frame */ }
        }
        restoreFrost(saved);
        if (shouldPlay) {
          sprite.startVideoPaint(video);
          try { Promise.resolve(video.play()).catch(() => {}); } catch { /* retain manual operation */ }
        }
      };
      if (!adjacentNativeIdle && Math.abs(video.currentTime - saved.lastShown) > .001) {
        const seeked = () => { if (token === epoch) restore(); };
        video.addEventListener('seeked', seeked);
        seekCleanup = () => video.removeEventListener('seeked', seeked);
        seekRestore = saved;
        try { video.currentTime = saved.lastShown; } catch { cleanSeek(); restore(); return; }
        if (!video.seeking) restore();
      } else restore();
    }
    function clearReturn(resume) {
      epoch++; stopRaf(); cleanSeek(); settling = false;
      const saved = returning;
      returning = null; pending = null;
      if (saved) restorePlayback(saved, resume);
    }
    function pauseAtExit(saved) {
      if (!same(saved) || saved.mode === 'reverse' || saved.holdPaused) return;
      const time = paintedTime(saved.video);
      if (Number.isFinite(time)) saved.lastShown = time;
      saved.holdPaused = true;
      saved.video.pause(); sprite.stopVideoPaint(); sprite.stopMove({ preservePendingForAnimation: pending?.transaction?.anim });
    }
    function finish() {
      if (settling || !pending || disposed) return;
      settling = true;
      const token = epoch;
      // A frame-paint and onended call are not safe places to swap decoders.
      Promise.resolve().then(() => {
        if (disposed || token !== epoch || !pending) return;
        if (sprite.squashRef != null) {
          settling = false;
          if (raf == null) raf = requestFrame(tick);
          return;
        }
        const request = pending, saved = returning;
        stopRaf(); pending = null; settling = false;
        if (saved) restorePlayback(saved, false);
        try {
          const committed = request.callback(request.transaction);
          // A newer local click can still be decoding when this older return
          // reaches neutral. Keep its resume state until that click commits or
          // is canceled; otherwise a failed successor strands a paused decoder.
          if (committed === false && saved && same(saved) && token === epoch) {
            saved.atExit = true; pauseAtExit(saved);
          }
          else if (returning === saved && token === epoch) returning = null;
        } catch (error) {
          if (returning === saved && token === epoch) clearReturn(true);
          host.console?.warn?.('Local handoff commit failed', error);
        }
      });
    }
    function failReturn(reason, expected) {
      if (disposed || !pending || returning !== expected) return;
      const request = pending;
      clearReturn(true);
      Promise.resolve().then(() => {
        if (disposed) return;
        if (typeof request.transaction?.failHandoff === 'function') request.transaction.failHandoff(reason);
        else host.console?.warn?.('Local handoff stopped; original frame retained:', reason);
      });
    }
    function advanceForwardFrost(saved, time) {
      if (Number.isFinite(time) && time > saved.lastFrostTime) {
        sprite.frost?.onTransition?.((time - saved.lastFrostTime) * 1000);
        saved.lastFrostTime = time;
      }
    }
    function drawCached(item) {
      try {
        const surface = sprite.videoSurface, ctx = surface.getContext('2d');
        if (!ctx) return false;
        ctx.save();
        try {
          // copy clears the old full surface outside this source rectangle too.
          // One native draw, no overlap, alpha interpolation or scaling.
          ctx.globalCompositeOperation = 'copy';
          ctx.drawImage(item.canvas, RECT[0], RECT[1]);
        } finally { ctx.restore(); }
        returning.lastShown = item.time;
        returning.video.petPaintedMediaTime = item.time;
        return true;
      } catch { return false; }
    }
    function accelerateNativeDrag(saved, transaction) {
      // This marker is created only by the sprite's authenticated local drag
      // profile. Ordinary manual/task requests keep their existing timing.
      if (!saved || transaction?.nativeDragReturn !== true || transaction.anim !== 'drag-lift' || transaction.playbackId) return;
      const remaining = saved.mode === 'reverse' ? Math.max(0, saved.lastShown) :
        Math.max(0, saved.policy.terminalRange[0] / saved.policy.fps - paintedTime(saved.video));
      saved.returnRate = Math.min(DRAG_MAX_RATE, Math.max(REVERSE_RATE, remaining * 1000 / DRAG_RETURN_MS));
      if (saved.mode !== 'reverse') saved.video.playbackRate = saved.returnRate;
    }
    function updateReadingTaskReturn(saved, transaction) {
      if (!saved || saved.mode === 'reverse') return;
      const allowed = transaction?.nativeTaskReturn === true && transaction.manualAction === false &&
        typeof transaction.playbackId === 'string' && !!transaction.playbackId &&
        ['idle', 'running', 'review', 'waiting', 'waving', 'jumping', 'failed'].includes(transaction.anim) &&
        transaction.outlineAssetName === transaction.anim &&
        transaction.source === sprite.assetBase + encodeURIComponent(transaction.anim) + '.webm' &&
        same(saved) && saved.video.petOutlineAssetName === 'reading' && trusted(saved.video) === policies.reading;
      if (allowed) {
        saved.video.playbackRate = READING_TASK_RETURN_RATE;
        saved.taskReturnAccelerated = true;
      } else if (saved.taskReturnAccelerated) {
        // A newer manual choice must inherit its ordinary timing, rather than
        // the superseded automatic intent's temporary decoder clock.
        saved.video.playbackRate = saved.rate;
        saved.taskReturnAccelerated = false;
      }
    }
    function tick(timestamp) {
      raf = null;
      if (disposed || !pending) return;
      const saved = returning;
      if (!saved) { finish(); return; }
      if (!same(saved)) { clearReturn(false); releaseHistory(); return; }
      if (saved.atExit) { advanceForwardFrost(saved, paintedTime(saved.video)); finish(); return; }
      if (saved.mode === 'reverse') {
        const deltaMs = Math.max(0, timestamp - saved.lastTick);
        saved.lastTick = timestamp;
        saved.elapsed += deltaMs * (saved.returnRate || REVERSE_RATE) / 1000;
        sprite.frost?.onTransition?.(deltaMs);
        const desired = saved.startTime - saved.elapsed;
        while (saved.index > 0 && history.frames[saved.index - 1].time >= desired - .0001) saved.index--;
        const item = history.frames[saved.index];
        if (item.time !== saved.lastShown && !drawCached(item)) { failReturn('handoff-cache-unavailable', saved); return; }
        if (saved.index === 0) { finish(); return; }
      } else {
        const time = paintedTime(saved.video);
        advanceForwardFrost(saved, time);
        if (Number.isFinite(time) && time > saved.lastProgressTime + .001) {
          saved.lastProgressTime = time; saved.progressAt = timestamp;
        }
        if (Number.isFinite(time) && frameAt(time, saved.policy) >= saved.policy.terminalRange[0]) { finish(); return; }
        if (timestamp - saved.progressAt > 2500) { failReturn('handoff-stalled', saved); return; }
      }
      raf = requestFrame(tick);
    }
    function capture(video, time) {
      if (disposed || !Number.isFinite(time)) return;
      const p = trusted(video);
      if (!p) return;
      if (!history || !same(history)) resetHistory(video);
      if (returning?.mode === 'reverse') return;
      if (pending && returning && returning.mode !== 'reverse') {
        advanceForwardFrost(returning, time);
        if (returning.atExit || frameAt(time, p) >= p.terminalRange[0]) finish();
      }
      if (time < 0 || time > (p.frames - 1) / (2 * p.fps) + .001) return;
      if (history.previousTime != null && time < history.previousTime - .001) resetHistory(video);
      if (history.previousTime != null && Math.abs(time - history.previousTime) < .001) return;
      if (!history.frames.length && time > .001) history.continuous = false;
      if (history.previousTime != null && time - history.previousTime > MAX_GAP + .0001) history.continuous = false;
      history.previousTime = time;
      const sampling = cacheSampling(p);
      if (!history.continuous || !sampling) { history.continuous = false; return; }
      const last = history.frames.at(-1);
      const previousAnchor = last?.anchor === false ? history.frames.at(-2) : last;
      const anchor = !previousAnchor || sampling.stride === 1 || time - previousAnchor.time >= sampling.interval - .0001;
      // Never label an overly sparse retained path continuous, even when the
      // decoder's intervening paints individually arrived within MAX_GAP.
      if (anchor && previousAnchor && time - previousAnchor.time > MAX_GAP + .0001) { history.continuous = false; return; }
      const reusable = last?.anchor === false ? history.frames.pop() : null;
      if (reusable) history.bytes -= FRAME_BYTES;
      if (history.frames.length >= MAX_FRAMES || history.bytes + FRAME_BYTES > MAX_BYTES) {
        if (reusable) retireCanvas(reusable.canvas);
        history.continuous = false; return;
      }
      const canvas = reusable?.canvas || spareCanvases.pop() || doc.createElement('canvas');
      // copy overwrites the entire same-sized ROI, including transparent pixels.
      // Never resize a reused buffer, which would discard its backing store.
      if (canvas.width !== RECT[2]) canvas.width = RECT[2];
      if (canvas.height !== RECT[3]) canvas.height = RECT[3];
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable');
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(sprite.videoSurface, ...RECT, 0, 0, RECT[2], RECT[3]);
      } catch { canvas.width = 0; canvas.height = 0; history.continuous = false; return; }
      history.frames.push({ canvas, time, anchor }); history.bytes += FRAME_BYTES;
    }
    function onCommit(video, generation) {
      clearReturn(false); releaseHistory();
      if (disposed || generation !== video?.petPlaybackGeneration || !trusted(video)) return;
      // The caller has already painted paused, decoded F0 onto videoSurface.
      // A merely requested currentTime=0 while seeking is not a real F0.
      const time = paintedTime(video);
      if (!video.seeking && Number.isFinite(time) && time >= 0 && time < 1 / (2 * FPS)) capture(video, time);
    }
    function request(transaction, callback) {
      if (disposed || typeof callback !== 'function') return false;
      // Retire a pending cancel-resume before taking ownership. Preserve its
      // original play/pause intent, rather than treating its temporary seek
      // pause as a user pause if this newer return is subsequently canceled.
      const restoring = seekRestore && same(seekRestore) ? seekRestore : null;
      if (seekCleanup) { epoch++; cleanSeek(); }
      pending = { transaction, callback };
      if (returning || settling) {
        updateReadingTaskReturn(returning, transaction);
        accelerateNativeDrag(returning, transaction);
        if (returning?.atExit && !settling) finish(); return true;
      }
      const video = front(), p = trusted(video), time = paintedTime(video);
      if (!p || !Number.isFinite(time)) { finish(); return true; }
      const saved = { ...identity(video), policy: p, loop: video.loop, rate: video.playbackRate, paused: restoring ? restoring.paused : video.paused,
        lastShown: time, mode: 'forward', lastFrostTime: time,
        nativeDragReturn: transaction?.nativeDragReturn === true && transaction.anim === 'drag-lift' };
      returning = saved;
      // The controller fills rests with complete breathing clips. Their real
      // ended-to-F0 boundary already has a continuous idle accent clock; do
      // not retire/reset that clock just because its decoder generation changes.
      const continuousIdle = transaction?.anim === 'idle' && video.petOutlineAssetName === 'idle' &&
        video.ended && inRanges(frameAt(time, p), p.neutralRanges);
      if (!continuousIdle) sprite.frost?.beginTransition?.();
      if (inRanges(frameAt(time, p), p.neutralRanges)) {
        saved.atExit = true;
        // The narrow early neutral may leave its pose before CSS recoil ends.
        // Hold this actual painted frame; only the existing recoil continues.
        if (sprite.squashRef != null) pauseAtExit(saved);
        finish(); return true;
      }
      const last = history?.frames.at(-1);
      const canReverse = history && same(history) && history.continuous && history.frames.length > 1 &&
        history.frames[0].time <= .001 && time <= (p.frames - 1) / (2 * p.fps) + .001 &&
        history.frames.every((item, index, frames) => !index || item.time - frames[index - 1].time <= MAX_GAP + .0001) &&
        last && Math.abs(last.time - time) < .001;
      if (canReverse) {
        saved.mode = 'reverse'; saved.index = history.frames.length - 1;
        saved.startTime = time; saved.elapsed = 0; saved.lastTick = now();
        video.pause(); sprite.stopVideoPaint(); sprite.stopMove({ preservePendingForAnimation: transaction?.anim });
        saved.pausedDecoderTime = video.currentTime;
      } else {
        saved.lastFrostTime = time; saved.lastProgressTime = time; saved.progressAt = now();
        video.loop = false;
        if (video.paused && !video.ended) {
          sprite.startVideoPaint(video);
          try { Promise.resolve(video.play()).catch(() => failReturn('handoff-play-rejected', saved)); }
          catch { failReturn('handoff-play-rejected', saved); return true; }
        }
      }
      updateReadingTaskReturn(saved, transaction);
      accelerateNativeDrag(saved, transaction);
      raf = requestFrame(tick);
      return true;
    }
    return Object.freeze({ capture, onCommit, request,
      cancel() { if (!disposed) clearReturn(true); },
      dispose() {
        if (disposed) return;
        clearReturn(false); disposed = true; cleanSeek(); releaseHistory();
        for (const canvas of spareCanvases) { canvas.width = 0; canvas.height = 0; }
        spareCanvases.length = 0;
      },
    });
  }
  const api = Object.freeze({ create, policies, MAX_BYTES });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  target.ShuanglingHandoff = api;
})(typeof window !== 'undefined' ? window : globalThis);
