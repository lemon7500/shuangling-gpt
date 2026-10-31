// Manual clicks may revisit the classic takes. Task/HTTP playback stays exact.
(function (target) {
  'use strict';
  const groups = Object.freeze({
    running: Object.freeze(['running', 'running-classic']),
    review: Object.freeze(['review', 'review-classic']),
    waiting: Object.freeze(['waiting', 'waiting-classic']),
  });
  function choose(leaf, random, history) {
    if (!leaf || typeof leaf !== 'object' || leaf.playbackId || leaf.manualVariantSelected === true ||
        !Object.prototype.hasOwnProperty.call(groups, leaf.anim)) return leaf;
    const value = random();
    // Invalid injected entropy fails to the current take rather than any path.
    let index = Number.isFinite(value) && value >= .5 && value < 1 ? 1 : 0;
    const previous = history?.get(leaf.anim);
    // Selection is only a prepared intention. Only a real committed playback
    // can make the next selection take the alternate version.
    if (previous?.count >= 2 && groups[leaf.anim][index] === previous.name) index = 1 - index;
    return { ...leaf, anim: groups[leaf.anim][index], manualVariantSelected: true };
  }
  function select(leaf, random = Math.random) { return choose(leaf, random, null); }
  function logicalName(name) {
    for (const [logical, choices] of Object.entries(groups)) if (choices.includes(name)) return logical;
    return name;
  }
  function createSelector() {
    const history = new Map();
    let lastGeneration = -1;
    return Object.freeze({
      select(leaf, random = Math.random) { return choose(leaf, random, history); },
      record(name, generation) {
        if (typeof name !== 'string') return false;
        const logical = logicalName(name);
        if (!Object.prototype.hasOwnProperty.call(groups, logical)) return false;
        const choices = groups[logical];
        if (!choices.includes(name) || !Number.isSafeInteger(generation) || generation < 0 || generation <= lastGeneration) return false;
        lastGeneration = generation;
        const previous = history.get(logical);
        history.set(logical, { name, count: previous?.name === name ? Math.min(2, previous.count + 1) : 1 });
        return true;
      },
    });
  }
  const api = Object.freeze({ groups, select, logicalName, createSelector });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else target.ShuanglingManualVariants = api;
})(globalThis);
