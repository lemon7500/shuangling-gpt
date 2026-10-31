// Cadence is measured after a confirmed gesture ends, never from a timeout
// pretending playback completed. Complete idle breathing clips fill rest;
// its final clip may extend past the minimum quiet interval.
export const quietIntervals = Object.freeze({
  working: Object.freeze([7000, 12000]),
  waiting: Object.freeze([60000, 90000]),
  idle: Object.freeze([25000, 45000]),
});

export const ambientIntervals = Object.freeze({
  quiet: Object.freeze([45000, 90000]),
  normal: quietIntervals.idle,
  lively: Object.freeze([12000, 25000]),
});
export const ambientActions = Object.freeze([
  Object.freeze({ name: 'reading', weight: 40, cooldownMs: 180000 }),
  Object.freeze({ name: 'looking-around', weight: 40, cooldownMs: 45000 }),
  Object.freeze({ name: 'stretching-wings', weight: 20, cooldownMs: 120000 }),
]);

const sample = random => {
  const value = Number(random());
  return Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0.5;
};
export const firstAnimation = value => Array.isArray(value) ? value[0] : value;

export function quietDelay(state, random = Math.random, frequency = 'normal') {
  const [low, high] = state === 'idle' ? ambientIntervals[frequency] ?? ambientIntervals.normal : quietIntervals[state] ?? quietIntervals.idle;
  return Math.round(low + (high - low) * sample(random));
}

export function naturalAnimation(state, animations, previous, random = Math.random, { enabled = true, available = ambientActions.map(action => action.name), lastEnded = {}, now = Date.now() } = {}) {
  const idle = firstAnimation(animations.idle);
  if (state === 'idle') {
    if (!enabled) return idle;
    const choices = ambientActions.filter(action => available.includes(action.name) && action.name !== previous &&
      (!Number.isFinite(lastEnded[action.name]) || now - lastEnded[action.name] >= action.cooldownMs));
    const total = choices.reduce((sum, action) => sum + action.weight, 0);
    let point = sample(random) * total;
    for (const action of choices) { point -= action.weight; if (point < 0) return action.name; }
    return idle;
  }
  // Waiting offers space to answer; review is an expression during work,
  // never evidence that a particular file or task has actually been audited.
  const pool = [...new Set(state === 'working'
    ? [firstAnimation(animations.working), 'review']
    : state === 'waiting' ? [firstAnimation(animations.waiting)] : [idle])].filter(name => typeof name === 'string' && name);
  const candidates = pool.filter(name => name !== previous);
  const choices = candidates.length ? candidates : pool;
  return choices[Math.floor(sample(random) * choices.length)] ?? firstAnimation(animations.idle);
}
