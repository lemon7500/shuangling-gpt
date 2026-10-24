import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PHYSICS, dockDrop, dragFollowStep, estimateReleaseVelocity, throwSpace, throwStepRegion } from './physics.ts';

test('native drag is fast, monotonic, finite and independent of throw enablement', () => {
  let x = 0, v = 0, previous = 0;
  for (let i = 0; i < 6; i++) {
    ({ x, v } = dragFollowStep(x, v, 100, 1 / 60));
    assert.ok(Number.isFinite(x) && Number.isFinite(v) && x >= previous && x <= 100);
    previous = x;
  }
  assert.ok(x > 99, `100ms target response should exceed99%, got ${x}`);
  assert.equal(estimateReleaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 50, x: 100, y: 0 }], 50, { ...DEFAULT_PHYSICS, throwPower: 0 }), null);
});

test('exact follower is frame-rate invariant at60Hz and144Hz', () => {
  const sample = (hz: number) => {
    let x = 0, v = 0;
    for (let i = 0; i < hz; i++) ({ x, v } = dragFollowStep(x, v, 100, 1 / hz));
    return { x, v };
  };
  const a = sample(60), b = sample(144);
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.v - b.v) < 1e-9);
});

test('steady pointer motion has under30px lag at1000px/s', () => {
  let x = 0, v = 0;
  for (let i = 1; i <= 60; i++) ({ x, v } = dragFollowStep(x, v, 1000 * i / 60, 1 / 60));
  assert.ok(1000 - x < 30, `lag=${1000 - x}`);
});

test('quick two-move flick produces inertia, pause or cancelled/lost input does not invent velocity', () => {
  const trail = [{ t: 0, x: 0, y: 0 }, { t: 40, x: 80, y: -20 }, { t: 60, x: 120, y: -30 }];
  const velocity = estimateReleaseVelocity(trail, 60);
  assert.ok(velocity && velocity.vx > 1000 && velocity.vy < 0);
  assert.equal(estimateReleaseVelocity(trail, 250), null);
  assert.equal(estimateReleaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 100, x: 5, y: 1 }], 100), null);
});

test('DPI-normalized pointer trails produce identical throw velocity', () => {
  const sample = (scale: number) => [0, 40, 80].map(t => ({ t, x: (t * 2 * scale) / scale, y: (-t * scale) / scale }));
  assert.deepEqual(estimateReleaseVelocity(sample(1), 80), estimateReleaseVelocity(sample(1.5), 80));
  assert.deepEqual(estimateReleaseVelocity(sample(1), 80), estimateReleaseVelocity(sample(2), 80));
});

test('gentle drop docks near body boundary but preserves deliberate mid-air placement', () => {
  const space = throwSpace({ areas: [{ x: 0, y: 0, width: 1920, height: 1080 }], size: 640, sideAllow: 220 });
  assert.deepEqual(dockDrop(space, 400, 400), { x: 400, y: 400 });
  assert.deepEqual(dockDrop(space, -215, 715), { x: -220, y: 720 });
  assert.deepEqual(dockDrop(space, 2000, 2000), { x: 1500, y: 720 });
});

test('negative-origin and irregular screen bounds never dock in a monitor gap', () => {
  const space = throwSpace({ areas: [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 0, y: -900, width: 1440, height: 900 }], size: 640, sideAllow: 220 });
  assert.deepEqual(dockDrop(space, -2135, 715), { x: -2140, y: 720 });
  const docked = dockDrop(space, -50, 800);
  assert.ok(docked.x <= -420 || docked.y <= -360);
});

test('restored upstream physics bounces and eventually rests at floor', () => {
  const space = throwSpace({ areas: [{ x: 0, y: 0, width: 1920, height: 1080 }], size: 640, sideAllow: 220 });
  let state = { x: 600, y: 200, vx: 800, vy: -600 };
  let bounced = false, resting = false;
  for (let i = 0; i < 3600; i++) {
    const next = throwStepRegion(state, 1 / 120, space, DEFAULT_PHYSICS, 0);
    state = next; bounced ||= next.bounced;
    if (next.atRest) { resting = true; break; }
    assert.ok(Number.isFinite(next.x) && Number.isFinite(next.y));
  }
  assert.ok(bounced && resting);
  assert.equal(state.y, 720);
});
