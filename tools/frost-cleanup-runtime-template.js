/* Hash-bound, offline-measured matte cleanup. No decoding or image readback in paint. */
(function (target) {
  'use strict';
  const data = __FROST_CLEANUP_DATA__;
  const empty = Object.freeze([]);
  const bindings = {};
  for (const [name, row] of Object.entries(data.actions)) {
    for (const rects of row.rects) {
      if (!rects) continue;
      for (const rect of rects) Object.freeze(rect);
      Object.freeze(rects);
    }
    Object.freeze(row.rects);
    bindings[name] = Object.freeze({ sha256: row.sha256, width: row.width, height: row.height,
      fps: row.fps, frameCount: row.frameCount });
  }
  Object.freeze(bindings);

  function rectsForFrame(name, time, binding) {
    if (!Object.prototype.hasOwnProperty.call(bindings, name) || !binding ||
        !Number.isFinite(time) || time < 0) return empty;
    const known = bindings[name];
    for (const key of ['sha256', 'width', 'height', 'fps', 'frameCount']) {
      if (binding[key] !== known[key]) return empty;
    }
    // WebM timestamps can be rounded to milliseconds. The closest native
    // frame is stable at 24 fps without introducing a new playback clock.
    const frame = Math.round(time * known.fps);
    if (frame < 0 || frame >= known.frameCount) return empty;
    return data.actions[name].rects[frame] || empty;
  }

  function apply(context, name, time, binding) {
    if (!context || typeof context.clearRect !== 'function' || !context.canvas ||
        context.canvas.width !== binding?.width || context.canvas.height !== binding?.height) return 0;
    const rects = rectsForFrame(name, time, binding);
    for (const rect of rects) context.clearRect(...rect);
    return rects.length;
  }

  const api = Object.freeze({ schema: data.schema, bindings, rectsForFrame, apply });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  target.ShuanglingFrostCleanup = api;
})(typeof window !== 'undefined' ? window : globalThis);
