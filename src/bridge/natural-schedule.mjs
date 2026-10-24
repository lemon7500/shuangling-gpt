// Cadence is measured after a confirmed gesture ends, never from a timeout
// pretending playback completed. Complete idle breathing clips fill rest;
// its final clip may extend past the minimum quiet interval.
export const quietIntervals = Object.freeze({
  working: Object.freeze([7000, 12000]),
  waiting: Object.freeze([8000, 14000]),
  idle: Object.freeze([10000, 18000]),
});

const sample = random => {
  const value = Number(random());
  return Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0.5;
};
export const firstAnimation = value => Array.isArray(value) ? value[0] : value;

export function quietDelay(state, random = Math.random) {
  const [low, high] = quietIntervals[state] ?? quietIntervals.idle;
  return Math.round(low + (high - low) * sample(random));
}

export function naturalAnimation(state, animations, previous, random = Math.random) {
  // These are calm stationary poses. Walking, jumping, failure and completion
  // animations never enter the automatic companion pool.
  const pool = [...new Set(state === 'working'
    ? [firstAnimation(animations.working), 'review']
    : state === 'waiting'
      ? [firstAnimation(animations.waiting), 'review']
      : ['review', 'waiting'])].filter(name => typeof name === 'string' && name);
  const candidates = pool.filter(name => name !== previous);
  const choices = candidates.length ? candidates : pool;
  return choices[Math.floor(sample(random) * choices.length)] ?? firstAnimation(animations.idle);
}
