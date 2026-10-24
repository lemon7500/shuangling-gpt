// Opt-in native smoke probe, evaluated only by DSH_PET_SMOKE=1. Synthetic DOM
// input exercises the actual Electron renderer, IPC, native window and host.
(async () => {
  const p = sprites[0];
  // Synthetic DOM input cannot hold an OS mouse button. Real forwarded idle
  // mousemove events must not cancel the simulated gesture as a lost-button
  // recovery. Production fallback itself is unchanged and tested separately.
  const originalMouseMove = p.onMouseMove;
  p.onMouseMove = function (e) { if (this.dragState.active && e.buttons === 0) return; return originalMouseMove.call(this, e); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const events = [];
  const note = (kind, extra = {}) => {
    const event = { at: Date.now(), kind, pos: { ...p.pos }, interaction: { ...p.interaction }, ...extra };
    events.push(event);
    return event;
  };
  const originalPlayback = p.reportPlayback;
  p.reportPlayback = function(id, status, reason) {
    note('playback', { playbackId: id, status, reason });
    return originalPlayback.call(this, id, status, reason);
  };
  async function waitFor(predicate, label, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const result = predicate(); if (result) return result; await pause(40); }
    throw new Error('Timed out waiting for ' + label);
  }
  const videoState = () => ({ front: p.front, frozen: p.frozen, playback: p.playback, pending: p.pending && { anim: p.pending.anim, gen: p.pending.gen },
    anim: p.anim, paint: !!p.videoPaint, lockTimerActive: p.lockTimer !== null, videos: [p.videoA, p.videoB].map(v => ({ paused: v.paused, ended: v.ended, time: v.currentTime,
      duration: v.duration, seeking: v.seeking, loop: v.loop, ready: v.readyState, source: v.currentSrc, hasEndedHandler: !!v.onended,
      mediaError: v.error && { code: v.error.code, message: v.error.message } })) });
  const mediaTrace = [];
  const mediaCleanup = [p.videoA, p.videoB].map((video, index) => {
    const originalPause = video.pause;
    const record = (kind, stack) => {
      mediaTrace.push({ at: Date.now(), video: index, kind, time: video.currentTime, paused: video.paused, loop: video.loop,
        playback: p.playback, frozen: p.frozen, pending: p.pending?.anim,
        mediaError: video.error && { code: video.error.code, message: video.error.message }, ...(stack ? { stack } : {}) });
      if (mediaTrace.length > 100) mediaTrace.shift();
    };
    video.pause = function() { record('pause-call', new Error().stack); return originalPause.call(this); };
    const listeners = ['playing','pause','ended','waiting','stalled','error'].map(name => {
      const handler = () => record(name); video.addEventListener(name, handler); return [name, handler];
    });
    return () => { video.pause = originalPause; for (const [name, handler] of listeners) video.removeEventListener(name, handler); };
  });
  async function resumedAfter(event, kind) {
    // Wait for a fresh controller request to actually finish. Action duration is
    // part of the character design, not an interaction-resumption latency limit.
    const started = await waitFor(() => events.find(e => e.kind === 'playback' && e.status === 'playing' && e.at > event.at), kind + ' playing');
    await waitFor(() => events.find(e => e.kind === 'playback' && e.status === 'ended' && e.playbackId === started.playbackId), kind + ' ended');
    note(kind, { playbackId: started.playbackId });
  }
  const originalUp = p.onPointerUp;
  p.onPointerUp = function(e) { note('input-up', { type: e?.type || 'no-event', buttons: e?.buttons, trusted: e?.isTrusted }); return originalUp.call(this, e); };
  let pointer = 300;
  function fire(type, x, y) {
    p.hit.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pointerId: pointer, clientX: p.margin.l + p.hitRect.x + p.hitRect.w / 2,
      clientY: p.margin.t + p.hitRect.y + p.hitRect.h / 2,
      screenX: toScreen(x), screenY: toScreen(y) }));
  }
  function down() { pointer++; fire('pointerdown', 600, 350); }
  async function drag(dx, dy, count = 12, stepMs = 16) {
    const lags = [];
    for (let i = 1; i <= count; i++) {
      fire('pointermove', 600 + dx * i / count, 350 + dy * i / count);
      await pause(stepMs);
      if (!p.dragTarget && p.dragState.active && !p.dragState.dragging) continue;
      if (!p.dragTarget) throw new Error('Gesture unexpectedly ended before release');
      lags.push(Math.hypot(p.dragTarget.x - p.pos.x, p.dragTarget.y - p.pos.y));
    }
    return lags;
  }
  try {
    await pause(800);
    const stageBefore = p.stage.style.transform;
    down(); note('gentle-pointer');
    const lags = await drag(100, 30, 24);
    const stageDuring = p.stage.style.transform;
    await pause(220);
    const gentleBefore = { ...p.pos };
    fire('pointerup', 700, 380);
    const gentle = note('gentle-settled', { before: gentleBefore, stageBefore, stageDuring, stageAfter: p.stage.style.transform,
      meanLag: lags.reduce((a, b) => a + b, 0) / lags.length, maxLag: Math.max(...lags), throwing: !!p.throwState });
    await resumedAfter(gentle, 'gentle-resumed');
    down(); await drag(180, -100, 7); fire('pointerup', 780, 250);
    const throwStart = { ...p.pos };
    note('throw-start', { throwing: !!p.throwState, velocity: p.throwState ? { vx: p.throwState.vx, vy: p.throwState.vy } : null });
    await pause(300);
    note('throw-moved', { distance: Math.hypot(p.pos.x - throwStart.x, p.pos.y - throwStart.y) });
    const deadline = Date.now() + 20000;
    while (p.throwState && Date.now() < deadline) await pause(50);
    const settled = note('throw-settled', { throwing: !!p.throwState });
    await resumedAfter(settled, 'flight-resumed');
    // Turning off throwing must never turn off pointer following.
    const savedPower = p.physics.throwPower;
    p.physics.throwPower = 0;
    const zeroStart = { ...p.pos };
    down(); await drag(-120, -40, 8); fire('pointerup', 480, 310);
    const disabled = note('throw-disabled-drag', { moved: Math.hypot(p.pos.x - zeroStart.x, p.pos.y - zeroStart.y), throwing: !!p.throwState });
    p.physics.throwPower = savedPower;
    await resumedAfter(disabled, 'disabled-resumed');
    p.onContextMenu({ preventDefault() {}, clientX: p.margin.l + p.hitRect.x + p.hitRect.w / 2, clientY: p.margin.t + p.hitRect.y + p.hitRect.h / 2 });
    note('menu-open', { open: p.menuOpen });
    await pause(800);
    p.onMenuAction({ anim: 'waving' });
    note('menu-manual-action');
    await waitFor(() => p.interaction.kind === 'menu' && p.interaction.phase === 'settled', 'manual menu animation');
    const menu = note('menu-finished', { open: p.menuOpen });
    await resumedAfter(menu, 'menu-resumed'); // Outer fixture performs and verifies explicit resume.
    p.onContextMenu({ preventDefault() {}, clientX: p.margin.l + p.hitRect.x + p.hitRect.w / 2, clientY: p.margin.t + p.hitRect.y + p.hitRect.h / 2 });
    await pause(500);
    p.onMenuAction({ action: 'show-usage' });
    const usageDeadline = Date.now() + 5000;
    while (!p.usageOn && Date.now() < usageDeadline) await pause(30);
    const usage = note('usage', { text: p.bubble.textContent, clickable: p.balanceClickable(), visible: p.bubble.classList.contains('is-on') });
    await resumedAfter(usage, 'usage-resumed');
    return { ok: true, input: 'synthetic DOM PointerEvent in a real Electron window', dpr: devicePixelRatio, scale: CONFIG.scale, finalVideoState: videoState(), mediaTrace, events };
  } catch (error) { return { ok: false, error: String(error?.stack || error), diagnostics: videoState(), mediaTrace, events }; }
  finally { p.reportPlayback = originalPlayback; p.onMouseMove = originalMouseMove; p.onPointerUp = originalUp; for (const cleanup of mediaCleanup) cleanup(); }
})();
