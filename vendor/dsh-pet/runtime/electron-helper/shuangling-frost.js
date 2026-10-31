/* Per-clip frost accents, driven only by frames actually painted by the player. */
(function (target) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SHAPE = 'six-branch-snowflake';
  const CRYSTAL = 'M12 2V22M3.34 7L20.66 17M3.34 17L20.66 7' +
    'M8.8 5.2L12 8.4L15.2 5.2M8.8 18.8L12 15.6L15.2 18.8' +
    'M4.51 11.37L8.88 10.2L7.71 5.83M16.29 18.17L15.12 13.8L19.49 12.63' +
    'M7.71 18.17L8.88 13.8L4.51 12.63M19.49 11.37L15.12 10.2L16.29 5.83';

  const profile = (points, startMs = 420, lifeMs = 2900, drift = [0, -10], staggerMs = 320) =>
    Object.freeze({ points: Object.freeze(points.map(([x, y]) => Object.freeze([50 + (x - 50) * .8, y]))), startMs, lifeMs, drift: Object.freeze(drift), staggerMs });
  // Existing measured side limits also contain the accepted reading silhouette.
  // Runs emit only during stepping; their entrance and recovery have no frost.
  // The interval covers every frame that can actually show an accent.
  // A fixed interval avoids wobbling the accents as the silhouette changes.
  const horizontalBounds = Object.freeze({ left: 353 / 1280, right: 915.5 / 1280 });
  const RETIRE_MS = 240;
  // Pickup and held motion use the same complete snowflakes as quiet company.
  // Lowering after physical release remains completely free of frost.
  const calmFrost = profile([[30, 48], [69, 65], [32, 79]], 500, 5200, [0, -12], 1450);
  const ambientClock = name => ['idle', 'drag-lift', 'drag-hover'].includes(name);
  const noFrost = profile([]);
  // Positions flank the opaque silhouette. A run's trail stays behind its
  // direction of travel; each first cue follows that clip's measured step.
  const profiles = Object.freeze({
    idle: calmFrost,
    running: profile([[31, 51], [69, 65], [30, 78]], 460, 3000, [0, -9]),
    review: profile([[70, 52], [72, 74], [30, 72]], 600, 2900, [2, -8]),
    reading: profile([[30, 55], [70, 73], [31, 80]], 900, 6000, [0, -9], 1300),
    waiting: profile([[30, 60], [69, 58], [71, 78]], 450, 2800, [0, -8]),
    waving: profile([[31, 40], [69, 64], [30, 77]], 520, 3000, [2, -10]),
    jumping: profile([[31, 80], [69, 81], [50, 92]], 680, 2300, [0, -9], 250),
    failed: profile([[31, 65], [69, 77]], 420, 3000, [0, -7], 450),
    'running-left': profile([[71, 74], [75, 85]], 900, 2350, [6, -5], 400),
    'running-right': profile([[29, 74], [25, 85]], 2750, 2350, [-6, -5], 400),
    'looking-around': profile([[70, 41], [73, 63], [30, 76]], 580, 2800, [2, -8]),
    'stretching-wings': profile([[28, 61], [72, 61], [31, 82]], 580, 2700, [0, -11]),
    'running-classic': profile([[30, 56], [69, 67], [31, 81]], 460, 3000, [0, -9]),
    'review-classic': profile([[70, 51], [72, 76], [30, 75]], 600, 3000, [2, -8]),
    'waiting-classic': profile([[30, 59], [70, 63], [31, 80]], 450, 3000, [0, -8]),
    'drag-lift': calmFrost,
    'drag-hover': calmFrost,
    'drag-lower': noFrost,
  });

  function create(stage) {
    const doc = stage.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = 'pet-frost';
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('data-frost-shape', SHAPE);
    // A stable decorative sibling; CSS keeps the complete side/low branches
    // above wing edges. Profiles never place an accent over the face.
    stage.prepend(layer);
    let state = null, disposed = false, suppressed = false, awaitingFrame = false, transitioning = false;
    let current = null, retiring = [];
    function visibility() { layer.hidden = disposed || !state || suppressed || doc.hidden || awaitingFrame; }
    function release(group) {
      if (!group) return;
      for (const { animation } of group.particles) animation.cancel();
      group.item.remove();
    }
    function clear() {
      release(current); current = null;
      for (const group of retiring) release(group);
      retiring = [];
    }
    function retire() {
      if (!current) return;
      // Freeze only the outgoing snowflakes, then fade their whole group with
      // the incoming painted frames. Character images are never blended.
      if (current.particles.some(({ animation, life }) => animation.currentTime > 0 && animation.currentTime < life)) {
        current.fadeMs = 0;
        retiring.push(current);
      } else release(current);
      current = null;
    }
    function fadeRetiring(deltaMs) {
      retiring = retiring.filter(group => {
        group.fadeMs += deltaMs;
        group.item.style.opacity = String(Math.max(0, 1 - group.fadeMs / RETIRE_MS));
        if (group.fadeMs < RETIRE_MS) return true;
        release(group); return false;
      });
    }
    function prepare(spec, duration) {
      const group = doc.createElement('div');
      group.className = 'pet-frost-group';
      group.style.opacity = '1';
      layer.appendChild(group);
      current = { item: group, particles: [] };
      for (const [index, point] of spec.points.entries()) {
        const item = doc.createElement('div');
        item.className = 'pet-frost-crystal';
        const [dx, dy] = spec.drift;
        // Radius includes worst-case rotation and a conservative 3 CSS px halo.
        // Reserve the full horizontal drift before clamping the starting center;
        // no visible crystal is cut off by a clip-path or moved frame by frame.
        item.style.left = 'clamp(calc(' + (horizontalBounds.left * 100) + '% + var(--frost-radius) + ' + Math.max(0, -dx) + 'px), ' + point[0] + '%, calc(' + (horizontalBounds.right * 100) + '% - var(--frost-radius) - ' + Math.max(0, dx) + 'px))';
        item.style.top = 'clamp(calc(var(--frost-radius) + ' + Math.max(0, -dy) + 'px), ' + point[1] + '%, calc(100% - var(--frost-radius) - ' + Math.max(0, dy) + 'px))';
        const svg = doc.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('focusable', 'false');
        // Every accent is the complete branched snowflake at full size.
        // No dot/circle center, satellite speck, blur, or scale-in particle.
        svg.setAttribute('data-frost-shape', SHAPE);
        for (const part of ['edge', 'core']) {
          const path = doc.createElementNS(NS, 'path');
          path.setAttribute('d', CRYSTAL); path.setAttribute('class', 'pet-frost-' + part);
          svg.appendChild(path);
        }
        item.appendChild(svg); group.appendChild(item);
        const transform = fraction => 'translate(-50%, -50%) translate(' + (dx * fraction) + 'px,' + (dy * fraction) + 'px) rotate(' + (-8 + fraction * 20) + 'deg)';
        // Finite actions fade out before their neutral last frame. Calm poses
        // use one phase across decoder loops instead of resetting a fade.
        const delay = spec.startMs + index * spec.staggerMs;
        const life = ambientClock(state.name) || !duration ? spec.lifeMs : Math.min(spec.lifeMs, Math.max(400, duration * 1000 - delay - 160));
        const animation = item.animate([
          { opacity: 0, transform: transform(0), offset: 0 },
          { opacity: .94, transform: transform(.26), offset: .26 },
          { opacity: .86, transform: transform(.7), offset: .7 },
          { opacity: 0, transform: transform(1), offset: 1 },
        ], { duration: life, easing: 'ease-in-out', fill: 'both' });
        animation.pause(); animation.currentTime = 0;
        current.particles.push({ item, animation, delay, life });
      }
    }
    function render() {
      if (!state) return;
      const phase = ambientClock(state.name) ? state.elapsedMs % 24000 : state.lastTime * 1000;
      for (const { animation, delay, life } of current?.particles || []) animation.currentTime = Math.max(0, Math.min(life, phase - delay));
      visibility();
    }
    function onAnimation(name, { duration = 0, generation = null, loop = false } = {}) {
      if (disposed) return;
      if (!Object.prototype.hasOwnProperty.call(profiles, name) || profiles[name].points.length === 0) {
        // A lowering commit clears both current accents and any outgoing fade.
        // A delayed old decoder callback cannot resurrect them without state.
        stop(); return;
      }
      if (!transitioning && state && state.name === name && state.generation === generation) return;
      const continuousAmbient = !transitioning && current &&
        ((state?.name === name && ambientClock(name)) || (state?.name === 'drag-lift' && name === 'drag-hover'));
      const elapsedMs = continuousAmbient ? state.elapsedMs : 0;
      if (!continuousAmbient) retire();
      transitioning = false;
      state = { name, generation, loop: loop === true, duration: Number.isFinite(duration) && duration > 0 ? duration : 0, lastTime: 0, elapsedMs };
      layer.setAttribute('data-frost-action', name);
      if (!continuousAmbient) prepare(profiles[name], state.duration);
      render();
    }
    function beginTransition() {
      if (disposed || !state || transitioning) return;
      transitioning = true;
      retire();
      visibility();
    }
    function onTransition(deltaMs) {
      if (disposed || !state || !transitioning || !Number.isFinite(deltaMs) || deltaMs < 0) return;
      fadeRetiring(deltaMs);
      awaitingFrame = false;
      visibility();
    }
    function onFrame(time, generation) {
      if (disposed || !state || transitioning || !Number.isFinite(time) || time < 0) return;
      if (generation !== undefined && generation !== state.generation) return;
      // This method receives painted media time, never a wall-clock timeout.
      // Seeking a new decoder is handled by its commit generation above.
      let delta = time - state.lastTime;
      if (delta < 0) {
        const boundary = Math.min(.6, state.duration * .2);
        // While hidden, a looping decoder may cross its boundary without
        // callbacks. Rebase on the first fresh paint instead of waiting for
        // the old timestamp or inventing how many hidden cycles elapsed.
        if (awaitingFrame) delta = 0;
        // A decoder callback can arrive slightly out of order. Only an explicit
        // loop's real tail-to-head boundary advances a cycle; a seek does not.
        else {
          if (!state.loop || !state.duration || state.lastTime < state.duration - boundary || time > boundary) return;
          delta = Math.max(0, state.duration - state.lastTime + time);
        }
      }
      state.elapsedMs += delta * 1000;
      state.lastTime = time;
      fadeRetiring(delta * 1000);
      awaitingFrame = false;
      render();
    }
    function setSuppressed(value) { if (!disposed) { suppressed = value === true; visibility(); } }
    function stop() { state = null; awaitingFrame = false; transitioning = false; clear(); visibility(); }
    function onVisibilityChange() {
      // Never briefly expose the old bright phase when a backgrounded page
      // returns. Its next accepted paint updates the clock before showing it.
      if (!doc.hidden) awaitingFrame = true;
      visibility();
    }
    doc.addEventListener('visibilitychange', onVisibilityChange);
    visibility();
    return {
      onAnimation, onFrame, beginTransition, onTransition, setSuppressed, stop,
      dispose() { disposed = true; stop(); doc.removeEventListener('visibilitychange', onVisibilityChange); layer.remove(); },
    };
  }
  const api = Object.freeze({ create, profiles, horizontalBounds, shape: SHAPE });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  target.ShuanglingFrost = api;
})(typeof window !== 'undefined' ? window : globalThis);
