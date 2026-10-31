/* Native pickup + forward held cycle; exact inverse pickup/landing frames. */
(function (target) {
  'use strict';
  const FPS = 24, EXIT_RATE = 1.25, HOVER_RETURN_RATE = 2, LIFT_LAST = 31, LOWER_LAST = 32, HOVER_LAST = 37;
  const NATIVE_SHA256 = Object.freeze({
    lift: '96c6f1202f7b7416d53ba9f268fa805117d68d2985a9725bd0bcd29ebf204cab',
    hover: '8b06861df760f0ff75a4efb13d1f1b4e11afd837c23795c5d1f1eb2e169afbcf',
    lower: '80806540fe1c05da5df17265e93568d10373f89e972eab858564fcf2d289ade8',
  });
  function create(sprite, profile) {
    const clips = profile?.drag, roi = profile?.outlineMaskRoi;
    const names = ['lift', 'hover', 'lower'];
    if (!sprite.isShuanglingProfile() || JSON.stringify(profile?.dragAssetRoots) !== '["main","shuangling"]' || !profile.dragAssetRoots.includes(sprite.assetRoot) ||
        !names.every(key => clips?.[key] === `drag-${key}` && roi?.webmSha256ByAnimation?.[clips[key]] === NATIVE_SHA256[key])) return null;
    let session = null, resumeCleanup = null, resumeSequence = 0;
    const front = () => sprite.front === 0 ? sprite.videoA : sprite.videoB;
    const current = s => session === s && sprite.interaction?.id === s.id;
    const timeOf = video => Number.isFinite(video?.petPaintedMediaTime) ? video.petPaintedMediaTime : video?.currentTime || 0;
    const frameOf = (video, last) => Math.max(0, Math.min(last, Math.round(timeOf(video) * FPS)));
    function stopResume() { resumeSequence++; if (resumeCleanup) resumeCleanup(); resumeCleanup = null; }
    function cancel() {
      const s = session; session = null; stopResume();
      if (s && names.some(key => sprite.pending?.anim === clips[key])) sprite.cancelPendingVideo('user-interaction');
    }
    function play(s, phase, startFrame = 0) {
      if (!current(s)) return;
      stopResume();
      s.phase = phase; s.startFrame = startFrame; s.committed = false;
      // Physical dragging owns input immediately. Only the first lift uses a
      // bounded-rate native return from the old task; internal cuts already
      // share an exact source pose and never use a common-neutral gate.
      sprite.switchTo(clips[phase], phase !== 'hover');
    }
    function finish(s, preserveIdle = false) {
      if (!current(s)) return;
      stopResume(); session = null;
      sprite.updateInteraction('settled', { kind: 'drag', resumable: true });
      if (!sprite.frozen && !sprite.resumeWorkStatusAnim() && sprite.animations.idle.length &&
          !(preserveIdle && sprite.animations.idle.includes(sprite.displayedAnim))) sprite.playOnce(sprite.animations.idle[0]);
    }
    function resumePainted(s, video) {
      stopResume();
      const generation = video.petPlaybackGeneration, time = timeOf(video), phase = s.phase, token = resumeSequence;
      const continuouslyPlaying = video.paused === false && video.seeking !== true;
      const owned = () => token === resumeSequence && current(s) && s.phase === phase &&
        front() === video && video.petPlaybackGeneration === generation;
      const resume = () => {
        if (resumeCleanup === cleanup) resumeCleanup = null;
        cleanup();
        if (!owned()) return;
        // Keep an owned running callback: cancel/re-register can discard a
        // native frame already queued for presentation during a quick catch.
        if (!continuouslyPlaying || sprite.videoPaint?.video !== video) sprite.startVideoPaint(video);
        try { void Promise.resolve(video.play()).catch(() => { if (owned()) fail(s); }); }
        catch { if (owned()) fail(s); }
      };
      const cleanup = () => video.removeEventListener?.('seeked', resume);
      // Decoder preparation can pause a partial lift/lower. Resume only the
      // actually painted pose, guarded against release/regrab races.
      // A running decoder normally leads its last painted frame. Regrabbing
      // it must keep that clock: seeking backwards races an already queued
      // rVFC and briefly displays a newer frame followed by the old seek pose.
      // Paused partial poses still need exact native-frame restoration.
      if ((video.paused || video.seeking) && Math.abs((video.currentTime || 0) - time) > .001) {
        video.addEventListener?.('seeked', resume);
        resumeCleanup = cleanup;
        try { video.currentTime = time; } catch { fail(s); return; }
        if (video.seeking) return;
      }
      resume();
    }
    function lower(s) {
      if (!current(s) || s.flight || sprite.dragState.active) return;
      // A very short throw can land before the first prepared lift paints.
      // Its stale task-return gate must never start a pickup after landing.
      if (s.phase === 'lift' && !s.committed && !names.some(key => sprite.displayedAnim === clips[key])) {
        cancel(); session = s; s.phase = 'fallback'; finish(s, true); return;
      }
      sprite.updateInteraction('blocked', { kind: 'drag', resumable: true });
      if (s.phase === 'fallback') { finish(s); return; }
      if (s.phase === 'return-hover') return;
      const video = front(), visible = sprite.displayedAnim;
      // Measured RGBA identity: lower F1..32 == lift F31..0. A short
      // pickup therefore starts lowering at exactly its currently visible pose.
      if (visible === clips.lift) {
        const frame = frameOf(video, LIFT_LAST);
        // Keep the exact frame used by the inverse lookup on screen while the
        // inactive decoder seeks it. Continuing to rise here caused a later
        // cut back to the release pose even though both source frames match.
        video.pause(); sprite.stopVideoPaint();
        play(s, 'lower', LOWER_LAST - frame); return;
      }
      if (visible === clips.lower) {
        if (sprite.pending) sprite.cancelPendingVideo('user-interaction');
        s.phase = 'lower'; s.committed = true; video.playbackRate = EXIT_RATE;
        if (video.ended) finish(s);
        else if (video.paused) resumePainted(s, video);
        return;
      }
      if (visible !== clips.hover) return;
      if (sprite.pending) sprite.cancelPendingVideo('user-interaction');
      // Chromium may wrap its decoder clock before the next rVFC paints F0.
      // That completed cycle already reached the closure: freeze the last
      // painted tail and prepare matching lower F0, rather than disabling
      // loop at the newly wrapped clock and accidentally playing a full cycle.
      const wrapped = video.loop === true && s.committed && s.generation === video.petPlaybackGeneration &&
        frameOf(video, HOVER_LAST) >= HOVER_LAST - 1 && Number.isFinite(video.currentTime) &&
        video.currentTime >= 0 && video.currentTime < 2 / FPS && timeOf(video) - video.currentTime > (HOVER_LAST + 1) / FPS / 2;
      if (frameOf(video, Number.MAX_SAFE_INTEGER) === 0 || wrapped) {
        video.pause(); sprite.stopVideoPaint(); play(s, 'lower'); return;
      }
      // Keep moving forward from the current pose. Only the remainder of this
      // cycle is used; a release never rewinds cached frames or adds a cycle.
      s.phase = 'return-hover'; video.loop = false; video.playbackRate = HOVER_RETURN_RATE;
      sprite.once = sprite.displayedOnce = true;
      const generation = video.petPlaybackGeneration;
      video.onended = () => {
        if (current(s) && front() === video && video.petPlaybackGeneration === generation && sprite.displayedAnim === clips.hover) sprite.handleEnded();
      };
      if (video.ended) play(s, 'lower');
      else if (video.paused) resumePainted(s, video);
    }
    function fail(s) {
      if (!current(s)) return;
      stopResume(); s.phase = 'fallback';
      if (!sprite.dragState.active && !s.flight) finish(s);
      else if (sprite.animations.idle.length) sprite.switchTo(sprite.animations.idle[0], false);
    }
    return {
      active: () => !!session,
      cancel,
      // Kept for the renderer hook; held playback no longer caches/reverses
      // decoded canvases or allocates one canvas for every native frame.
      capture() {},
      ownsPlayback(name) {
        const s = session;
        return !!s && current(s) && s.committed &&
          (clips[s.phase] === name || (s.phase === 'return-hover' && name === clips.hover));
      },
      playback(name) {
        const s = session;
        const startFrame = s?.startFrame || 0;
        return s && current(s) && clips[s.phase] === name ? {
          startFrame,
          // WebM uses millisecond PTS. Seeking exactly n/24 can land just
          // before that frame's rounded PTS; choose its interior, never the
          // preceding pose. True F0 remains at zero for the native contract.
          startTime: startFrame > 0 ? (startFrame + .25) / FPS : 0,
          rate: s.phase === 'hover' ? 1 : EXIT_RATE,
          entry: s.phase === 'lift' && s.entry === true,
        } : null;
      },
      preloadName() {
        const s = session;
        if (!s || !current(s)) return null;
        if (s.phase === 'lift') return clips.hover;
        if (s.phase === 'hover' || s.phase === 'return-hover') return clips.lower;
        return sprite.animations.idle[0];
      },
      beforeSwitch(name) {
        if (session && !names.some(key => clips[key] === name) && !(session.phase === 'fallback' && name === sprite.animations.idle[0])) cancel();
      },
      start() {
        cancel(true);
        const s = session = { id: sprite.interaction.id, phase: 'lift', startFrame: 0, committed: false, released: false, flight: false, entry: false };
        const video = front(), previous = sprite.displayedAnim;
        if ([clips.lift, clips.hover, clips.lower].includes(previous) && video?.readyState >= 2) {
          if (previous === clips.lower) {
            const frame = frameOf(video, LOWER_LAST);
            video.pause(); sprite.stopVideoPaint();
            play(s, frame === 0 ? 'hover' : 'lift', frame === 0 ? 0 : LOWER_LAST - frame);
          } else {
            s.committed = true; s.generation = video.petPlaybackGeneration; s.phase = previous === clips.hover ? 'hover' : 'lift';
            if (video.ended) play(s, 'hover');
            else {
              if (previous === clips.hover) { video.loop = true; video.onended = null; sprite.once = sprite.displayedOnce = false; }
              video.playbackRate = previous === clips.hover ? 1 : EXIT_RATE;
              resumePainted(s, video);
            }
          }
          return true;
        }
        s.entry = true; play(s, 'lift'); return true;
      },
      committed(name) {
        const s = session;
        if (s && current(s) && clips[s.phase] === name) {
          s.committed = true; s.generation = front()?.petPlaybackGeneration;
          if (s.released && !s.flight && name !== clips.lower) lower(s);
        }
      },
      ended(name) {
        const s = session;
        if (!s || !current(s)) return false;
        if (name === clips.lower && s.phase === 'lower') finish(s);
        else if (name === clips.lift && s.phase === 'lift') {
          if (s.released && !s.flight) play(s, 'lower', 1);
          else play(s, 'hover');
        } else if (name === clips.hover && s.phase === 'return-hover' && s.released && !s.flight) play(s, 'lower');
        else return false;
        return true;
      },
      release(flight = false) {
        const s = session;
        if (!s || !current(s)) return false;
        s.released = true; s.flight = flight;
        if (!flight) lower(s);
        if (current(s) && !sprite.pending) sprite.preloadIdleFrame?.();
        return true;
      },
      landed() {
        const s = session;
        if (!s || !current(s)) return false;
        s.released = true; s.flight = false; lower(s); return true;
      },
      failed(name) {
        const s = session;
        if (!s || !current(s) || !names.some(key => clips[key] === name)) return false;
        fail(s); return true;
      },
    };
  }
  const api = Object.freeze({ create });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else target.ShuanglingDrag = api;
})(globalThis);
