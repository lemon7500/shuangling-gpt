import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/shuangling-frost.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/shuangling-frost.css', import.meta.url), 'utf8');
const frostSizeMatch = style.match(/--frost-size:\s*clamp\(([\d.]+)px,\s*calc\(var\(--pet-size,\s*[\d.]+px\)\s*\*\s*([\d.]+)\),\s*([\d.]+)px\)/);
assert.ok(frostSizeMatch, 'measure the actual CSS snowflake size for its silhouette bounds');
const [, frostMinimum, frostRatio, frostMaximum] = frostSizeMatch.map(Number);
const frostSize = width => Math.max(frostMinimum, Math.min(frostMaximum, width * frostRatio));
const spriteSource = readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
const assets = JSON.parse(readFileSync(new URL('../../reports/windows-assets.json', import.meta.url), 'utf8')).animations;
const durations = Object.fromEntries(assets.map(row => [row.name, row.durationMs / 1000]));
const cueSample = name => name === 'running-right' ? movement[name].startMs / 1000 + 1 : Math.min(2, durations[name] / 2);
const motionContext = vm.createContext({});
vm.runInContext(readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/shuangling-motion.js', import.meta.url), 'utf8'), motionContext);
const movement = motionContext.ShuanglingMotion.movement.byAnimation;
const bodyBounds = JSON.parse(readFileSync(new URL('../../reports/windows-frost-bounds-v190.json', import.meta.url), 'utf8'));

function fixture() {
  const events = new Map(), animations = [];
  const win = {
    setTimeout: () => assert.fail('effects must use painted media time, not a timer'),
    requestAnimationFrame: () => assert.fail('effects must not create a second rendering clock'),
    performance: { now: () => assert.fail('wall-clock time must not advance effects') },
  };
  class Element {
    constructor(tag) {
      this.tag = tag; this.ownerDocument = doc; this.style = {};
      Object.defineProperties(this.style, {
        setProperty: { value(key, value) { this[key] = value; } },
        getPropertyValue: { value(key) { return this[key] ?? ''; } },
      });
      this.attributes = {}; this.children = []; this.animations = []; this.hidden = false;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    prepend(child) { child.parent = this; this.children.unshift(child); }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    getAnimations() { return this.animations.filter(animation => !animation.cancelled); }
    animate(frames, options) {
      const animation = {
        cancelled: false, paused: false, currentTime: null, frames, options, owner: this,
        pause() { this.paused = true; },
        cancel() { this.cancelled = true; },
      };
      this.animations.push(animation); animations.push(animation);
      return animation;
    }
  }
  const doc = {
    hidden: false, defaultView: win,
    createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag),
    addEventListener(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); },
  };
  const stage = new Element('stage'), character = new Element('canvas');
  stage.appendChild(character);
  stage.style.width = '339px'; stage.style.height = '190.6875px';
  const context = vm.createContext({ window: win });
  vm.runInContext(source, context);
  const api = win.ShuanglingFrost, frost = api.create(stage), layer = stage.children[0];
  function visibility(hidden) { doc.hidden = hidden; for (const callback of [...events.get('visibilitychange') || []]) callback(); }
  function opacity(animation) {
    if (animation.cancelled || animation.currentTime === null) return 0;
    const progress = Math.max(0, Math.min(1, animation.currentTime / animation.options.duration));
    for (let index = 1; index < animation.frames.length; index++) {
      const right = animation.frames[index], left = animation.frames[index - 1];
      if (progress <= right.offset) return left.opacity + (right.opacity - left.opacity) * (progress - left.offset) / (right.offset - left.offset);
    }
    return animation.frames.at(-1).opacity;
  }
  function effectiveOpacity(animation) {
    let multiplier = 1, node = animation.owner;
    while (node && node !== stage) {
      if (node.hidden || node.style.display === 'none') return 0;
      if (node !== animation.owner && node.style.opacity !== undefined && node.style.opacity !== '') multiplier *= Number(node.style.opacity);
      node = node.parent;
    }
    return node === stage ? opacity(animation) * multiplier : 0;
  }
  function visibleCount() {
    if (layer.hidden || !layer.parent) return 0;
    return animations.filter(animation => effectiveOpacity(animation) > .05).length;
  }
  function begin(name, generation = 1, loop = false) { frost.onAnimation(name, { duration: durations[name], generation, loop }); }
  function resolvedLeft(item, width = 339) {
    const parsed = item.style.left.match(/^clamp\(calc\(([\d.]+)% \+ var\(--frost-radius\) \+ ([\d.]+)px\), ([\d.]+)%, calc\(([\d.]+)% - var\(--frost-radius\) - ([\d.]+)px\)\)$/);
    assert.ok(parsed, 'expected a bounded CSS center: ' + item.style.left);
    const [, lowerPercent, leftDrift, preferredPercent, upperPercent, rightDrift] = parsed.map(Number);
    const glyph = frostSize(width), radius = glyph * .61 + 3;
    return Math.max(lowerPercent * width / 100 + radius + leftDrift,
      Math.min(preferredPercent * width / 100, upperPercent * width / 100 - radius - rightDrift));
  }
  return { frost, api, stage, character, layer, animations, events, visibility, visibleCount, begin,
    resolvedLeft,
    effectiveOpacity, totalOpacity: () => animations.reduce((sum, animation) => sum + effectiveOpacity(animation), 0),
    crystals: () => { const all = []; const visit = node => { if (node.className === 'pet-frost-crystal') all.push(node); for (const child of node.children) visit(child); }; visit(layer); return all; },
    active: () => animations.filter(animation => !animation.cancelled),
    times: () => animations.filter(animation => !animation.cancelled).map(animation => animation.currentTime),
  };
}

test('each accepted media entry has an explicit visible or intentionally silent profile', () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.api.profiles).sort(), assets.map(row => row.name).sort());
  assert.ok(Object.isFrozen(f.api.profiles));
  for (const name of Object.keys(f.api.profiles)) {
    f.begin(name); f.frost.onFrame(cueSample(name));
    if (f.api.profiles[name].points.length) assert.ok(f.visibleCount() > 0, name + ' must visibly render during its short clip');
    else {
      assert.equal(name, 'drag-lower', 'only lowering after physical release is intentionally silent');
      assert.equal(f.visibleCount(), 0); assert.equal(f.active().length, 0);
    }
    assert.ok(f.active().every(animation => animation.paused), name + ' must not have an autonomous animation clock');
  }
});

test('every native accent is a large complete six-branch snowflake, with no dots or blurred satellites', () => {
  const f = fixture();
  assert.equal(f.api.shape, 'six-branch-snowflake');
  assert.equal(f.layer.attributes['data-frost-shape'], f.api.shape);
  assert.deepEqual([frostMinimum, frostRatio, frostMaximum], [24, .068, 36], 'restore the exact previous snowflake scale');
  assert.match(style, /\.pet-frost\s*\{[^}]*z-index:\s*3\s*;/, 'a moving wing edge must not turn a complete snowflake into a tiny exposed tip');
  assert.doesNotMatch(style, /filter\s*:|box-shadow\s*:|border-radius\s*:/);
  for (const name of Object.keys(f.api.profiles)) {
    f.begin(name, 7); f.frost.onFrame(cueSample(name), 7);
    for (const item of f.crystals()) {
      assert.equal(item.children.length, 1);
      const svg = item.children[0];
      assert.equal(svg.tag, 'svg');
      assert.equal(svg.attributes['data-frost-shape'], f.api.shape);
      assert.deepEqual(svg.children.map(child => child.tag), ['path', 'path']);
      assert.equal(svg.children[0].attributes.d, svg.children[1].attributes.d);
      assert.ok((svg.children[0].attributes.d.match(/M/g) || []).length >= 9, 'long arms and lateral branchlets form the whole snowflake');
    }
  }
  for (const animation of f.animations) {
    assert.ok(animation.frames.every(frame => !/scale|blur/.test(frame.transform)), 'fades cannot shrink a snowflake into a point');
  }
});

test('foreground flakes remain at the sides or below the face at normal sizes and move low in tiny windows', () => {
  for (const width of [339, 562, 1200]) {
    const f = fixture(), height = width * 9 / 16;
    const placementRadius = frostSize(width) * .61 + 3, glyphRadius = frostSize(width) * .5;
    // Generous face rectangle in the common native camera; hair/wing overlap
    // is acceptable, while the eyes and mouth always remain unobstructed.
    const face = [530, 240, 755, 430].map(value => value * width / 1280);
    for (const [name, spec] of Object.entries(f.api.profiles)) {
      f.begin(name, 17);
      for (const [index, item] of f.crystals().slice(-spec.points.length).entries()) {
        const x = f.resolvedLeft(item, width), [dx, dy] = spec.drift;
        const y = Math.max(placementRadius + Math.max(0, -dy), Math.min(spec.points[index][1] * height / 100, height - placementRadius - Math.max(0, dy)));
        const rect = [x + Math.min(0, dx) - glyphRadius, y + Math.min(0, dy) - glyphRadius,
          x + Math.max(0, dx) + glyphRadius, y + Math.max(0, dy) + glyphRadius];
        assert.ok(rect[2] < face[0] || rect[0] > face[2] || rect[3] < face[1] || rect[1] > face[3], name + ' must not cover face at ' + width);
      }
    }
  }
  assert.match(style, /@media\s*\(max-width:\s*280px\)[\s\S]*?top:\s*calc\(100% - var\(--frost-radius\)\)\s*!important/);
  assert.match(style, /@media\s*\(max-width:\s*280px\)[\s\S]*?transform:\s*translate\(-50%, -50%\)\s*!important/);
});

test('switching from ten seconds of idle gives every finite action its own immediate timeline', () => {
  const profiles = fixture().api.profiles;
  for (const row of assets.filter(row => !['idle', 'drag-lift', 'drag-hover'].includes(row.name) && profiles[row.name].points.length)) {
    const f = fixture(); f.begin('idle'); f.frost.onFrame(10);
    f.begin(row.name, 2);
    assert.equal(f.visibleCount(), 0, row.name + ' begins with a neutral fade');
    f.frost.onFrame(cueSample(row.name));
    assert.ok(f.visibleCount() > 0, row.name + ' must not inherit an idle cooldown');
    f.frost.onFrame(row.durationMs / 1000);
    assert.equal(f.visibleCount(), 0, row.name + ' must fade out by its neutral endpoint');
  }
});

test('all accent progress freezes when no new painted frame arrives', () => {
  const f = fixture(); f.begin('review'); f.frost.onFrame(2);
  const times = f.times(), count = f.animations.length;
  f.frost.onFrame(2); f.frost.onFrame(2);
  assert.deepEqual(f.times(), times); assert.equal(f.animations.length, count);
  assert.ok(f.active().every(animation => animation.paused));
});

test('repeated commits of the same generation do not reset or duplicate its accents', () => {
  for (const name of ['idle', 'review', 'review-classic', 'running-right']) {
    const f = fixture(); f.begin(name, 7); f.frost.onFrame(cueSample(name));
    const times = f.times(), count = f.animations.length;
    for (let i = 0; i < 20; i++) f.begin(name, 7);
    assert.deepEqual(f.times(), times); assert.equal(f.animations.length, count);
    assert.ok(f.visibleCount() > 0);
  }
});

test('new idle decoder generations continue one phase without resetting their fade', () => {
  const f = fixture(); f.begin('idle', 1); f.frost.onFrame(2);
  const first = f.times(), count = f.animations.length;
  f.begin('idle', 2);
  assert.deepEqual(f.times(), first); assert.equal(f.animations.length, count);
  f.frost.onFrame(.5);
  const continuous = fixture(); continuous.begin('idle'); continuous.frost.onFrame(2.5);
  assert.deepEqual(f.times(), continuous.times());
  f.frost.onFrame(durations.idle);
  const endpoint = f.times(); f.begin('idle', 3);
  assert.deepEqual(f.times(), endpoint); assert.equal(f.animations.length, count);
});

test('a new finite generation preserves visible outgoing accents and releases them after its painted fade', () => {
  for (const name of ['waiting', 'running-classic', 'jumping']) {
    const f = fixture(); f.begin(name, 1); f.frost.onFrame(2);
    const old = [...f.active()], alpha = f.totalOpacity(), times = old.map(animation => animation.currentTime);
    f.begin(name, 2);
    assert.ok(old.every(animation => !animation.cancelled), 'visible accents must not disappear at commit');
    assert.ok(Math.abs(f.totalOpacity() - alpha) < 1e-9);
    f.frost.onFrame(.12, 2);
    assert.ok(f.totalOpacity() > 0 && f.totalOpacity() < alpha);
    assert.deepEqual(old.map(animation => animation.currentTime), times, 'outgoing pose stays fixed while only group opacity fades');
    f.frost.onFrame(.25, 2);
    assert.ok(old.every(animation => animation.cancelled));
    f.frost.onFrame(2);
    assert.ok(f.visibleCount() > 0); assert.equal(f.active().length, old.length);
  }
});

test('left and right trails appear only after their measured first step and remain behind travel', () => {
  const f = fixture();
  for (const [name, side] of [['running-left', 'right'], ['running-right', 'left']]) {
    f.begin(name); f.frost.onFrame(movement[name].startMs / 1000);
    assert.equal(f.visibleCount(), 0, name + ' must not emit before actual stepping');
    f.frost.onFrame(cueSample(name)); assert.ok(f.visibleCount() > 0);
    assert.ok(f.crystals().every(item => side === 'right' ? f.resolvedLeft(item) > 339 / 2 : f.resolvedLeft(item) < 339 / 2));
  }
  assert.notDeepEqual(f.api.profiles['running-left'].points, f.api.profiles['running-right'].points);
  assert.notDeepEqual(f.api.profiles.jumping.points, f.api.profiles.failed.points);
});

test('all accepted profiles reserve their full drift, rotated crystal and halo inside the measured safe interval', () => {
  for (const width of [160, 339, 565, 1200]) {
    const f = fixture(), radius = frostSize(width) * .61 + 3;
    for (const name of assets.map(row => row.name)) {
      f.begin(name); f.frost.onFrame(cueSample(name));
      const crystals = f.crystals().slice(-f.api.profiles[name].points.length);
      for (const item of crystals) {
        const center = f.resolvedLeft(item, width), dx = f.api.profiles[name].drift[0];
        assert.ok(center + Math.min(0, dx) - radius >= f.api.horizontalBounds.left * width - 1e-8, name + ' left halo at ' + width);
        assert.ok(center + Math.max(0, dx) + radius <= f.api.horizontalBounds.right * width + 1e-8, name + ' right halo at ' + width);
      }
    }
  }
});

test('the safety interval remains bound to every accepted media file and its frame inventory', () => {
  const f = fixture();
  assert.equal(bodyBounds.schema, 'shuangling-gpt/frost-body-bounds-v190/v1');
  assert.deepEqual(bodyBounds.sourceCanvas, [1280, 720]);
  assert.equal(bodyBounds.alphaThreshold, 16); assert.equal(bodyBounds.alphaComparison, '>');
  assert.deepEqual(bodyBounds.media.map(row => row.action).sort(), assets.map(row => row.name).sort());
  for (const row of bodyBounds.media) {
    const accepted = assets.find(entry => entry.name === row.action);
    assert.equal(row.file, 'windows/assets/shuangling/' + row.action + '.webm');
    assert.equal(row.sha256, accepted.webmSha256, row.action + ' body measurement must be refreshed after adoption');
    assert.equal(row.sha256, createHash('sha256').update(readFileSync(new URL('../../' + row.file, import.meta.url))).digest('hex'));
    assert.equal(row.frameCount, accepted.encodedFrames);
    assert.ok(row.minBodyWidthNative > 0 && row.maxBodyWidthNative >= row.minBodyWidthNative);
  }
  assert.equal(bodyBounds.totalFrameCount, bodyBounds.media.reduce((sum, row) => sum + row.frameCount, 0));
  const native = [Math.max(...bodyBounds.media.map(row => row.halfWidthAllowedNative[0])), Math.min(...bodyBounds.media.map(row => row.halfWidthAllowedNative[1]))];
  assert.deepEqual(native, bodyBounds.globalHalfWidthAllowedNative);
  assert.equal(bodyBounds.globalHorizontalBounds.left, native[0] / bodyBounds.sourceCanvas[0]);
  assert.equal(bodyBounds.globalHorizontalBounds.right, native[1] / bodyBounds.sourceCanvas[0]);
  assert.equal(f.api.horizontalBounds.left, bodyBounds.globalHorizontalBounds.left);
  assert.equal(f.api.horizontalBounds.right, bodyBounds.globalHorizontalBounds.right);
});

test('runs and reading keep every visible snowflake within the measured silhouette limits', () => {
  for (const name of ['running-left', 'running-right', 'reading']) {
    const row = assets.find(entry => entry.name === name);
    const measured = bodyBounds.media.find(entry => entry.action === name);
    assert.equal(row.fps, 24);
    assert.equal(measured.perFrameBounds.length, row.encodedFrames);
    const expected = measured.effectFrameRanges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
    for (const width of [160, 339, 565, 1200]) {
      const f = fixture(), visible = [], radius = frostSize(width) * .61 + 3;
      f.begin(name, 99);
      for (let frame = 0; frame < row.encodedFrames; frame++) {
        f.frost.onFrame(frame / row.fps, 99);
        // The measurement includes every positive-alpha cue, including the
        // faint first/last fade frame below visibleCount's 5% UX threshold.
        if (!f.active().some(animation => f.effectiveOpacity(animation) > 1e-9)) continue;
        visible.push(frame);
        const [left, , right] = measured.perFrameBounds[frame], bodyWidth = right - left;
        for (const item of f.crystals().slice(-f.api.profiles[name].points.length)) {
          const center = f.resolvedLeft(item, width), dx = f.api.profiles[name].drift[0];
          assert.ok(center + Math.min(0, dx) - radius >= (left - .5 * bodyWidth) / 1280 * width - 1e-8, name + ' left at ' + frame);
          assert.ok(center + Math.max(0, dx) + radius <= (right + .5 * bodyWidth) / 1280 * width + 1e-8, name + ' right at ' + frame);
        }
      }
      assert.deepEqual(visible, expected, name + ' measured effect ranges must cover every and only visible cue frame');
      const recoveryTime = name === 'reading' ? (row.encodedFrames - 1) / row.fps : movement[name].endMs / 1000;
      assert.ok(visible.at(-1) / row.fps < recoveryTime);
    }
  }
});

test('drag and throw suppression preserve their clock and can recover the existing clip without a new commit', () => {
  const f = fixture(); f.begin('waiting'); f.frost.onFrame(2);
  const count = f.animations.length, times = f.times();
  f.frost.setSuppressed(true); assert.equal(f.visibleCount(), 0);
  assert.deepEqual(f.times(), times);
  f.frost.onFrame(2.25); assert.equal(f.visibleCount(), 0);
  const hiddenTimes = f.times();
  f.frost.setSuppressed(false);
  assert.deepEqual(f.times(), hiddenTimes); assert.equal(f.animations.length, count);
  assert.ok(f.visibleCount() > 0, 'pointer cancellation may restore the current clip immediately');
});

test('visibility only hides the existing accents, then restores the current painted phase', () => {
  const f = fixture(); f.begin('review', 7); f.frost.onFrame(2, 7);
  f.visibility(true); assert.equal(f.visibleCount(), 0);
  const times = f.times(); f.frost.onFrame(2.4, 7);
  f.visibility(false);
  assert.equal(f.visibleCount(), 0, 'visibility alone must not reveal a stale painted phase');
  f.frost.onFrame(2.5, 6); assert.equal(f.visibleCount(), 0, 'an obsolete decoder cannot reveal the layer');
  f.frost.onFrame(2.5, 7);
  assert.ok(f.visibleCount() > 0); assert.notDeepEqual(f.times(), times);
  const count = f.animations.length;
  f.visibility(true); f.visibility(false);
  assert.equal(f.visibleCount(), 0);
  f.frost.onFrame(2.6, 7); assert.ok(f.visibleCount() > 0);
  assert.equal(f.animations.length, count);
});

test('restoring after the video progressed past a cue cannot flash its formerly bright phase', () => {
  const f = fixture(); f.begin('review', 1); f.frost.onFrame(2, 1);
  assert.ok(f.visibleCount() > 0);
  f.visibility(true); f.visibility(false);
  assert.equal(f.visibleCount(), 0);
  f.frost.onFrame(4.8, 1);
  assert.equal(f.visibleCount(), 0, 'the first fresh frame already has a fully faded cue');
});

test('a fresh frame after hidden loop playback can rebase a wrapped clock without waiting to catch up', () => {
  for (const name of ['idle', 'waiting', 'review-classic']) {
    const f = fixture(); f.begin(name, 7, true); f.frost.onFrame(3, 7);
    f.visibility(true); f.visibility(false);
    f.frost.onFrame(1, 6); assert.equal(f.visibleCount(), 0, 'a stale generation still cannot restore visibility');
    f.frost.onFrame(1, 7);
    assert.ok(f.visibleCount() > 0, name + ' must recover on the first current frame even if hidden playback wrapped to mid-clip');
    f.frost.onFrame(1.1, 7); assert.ok(f.visibleCount() > 0);
  }
});

test('small regressions and non-loop seeks never masquerade as a whole video loop', () => {
  for (const loop of [false, true]) {
    const f = fixture(); f.begin('review', 1, loop); f.frost.onFrame(2, 1);
    const times = f.times();
    for (const time of [1.99, .1]) { f.frost.onFrame(time, 1); assert.deepEqual(f.times(), times); }
    f.frost.onFrame(2.1, 1);
    const straight = fixture(); straight.begin('review', 1, loop); straight.frost.onFrame(2.1, 1);
    assert.deepEqual(f.times(), straight.times());
  }
});

test('a true same-generation loop replays every frosted finite action while a non-loop rewind does not', () => {
  const profiles = fixture().api.profiles;
  for (const row of assets.filter(row => !['idle', 'drag-lift', 'drag-hover'].includes(row.name) && profiles[row.name].points.length)) {
    const f = fixture(); f.begin(row.name, 1, true); f.frost.onFrame(cueSample(row.name), 1);
    assert.ok(f.visibleCount() > 0, row.name);
    f.frost.onFrame(durations[row.name] - .01, 1); assert.equal(f.visibleCount(), 0);
    f.frost.onFrame(.02, 1); assert.equal(f.visibleCount(), 0, 'a new loop begins at its neutral cue');
    f.frost.onFrame(cueSample(row.name), 1); assert.ok(f.visibleCount() > 0, row.name + ' must have a second visible cue');
    const finite = fixture(); finite.begin(row.name, 1, false); finite.frost.onFrame(durations[row.name] - .01, 1);
    const last = finite.times(); finite.frost.onFrame(.02, 1); assert.deepEqual(finite.times(), last);
  }
});

test('pickup and held motion use the same three full-size branched snowflakes as idle', () => {
  const f = fixture();
  for (const name of ['drag-lift', 'drag-hover']) {
    assert.equal(f.api.profiles[name], f.api.profiles.idle, name + ' must share the exact calm pattern and placement');
    f.begin(name, 7, true); f.frost.onFrame(.9, 7);
    assert.equal(f.active().length, 3); assert.ok(f.visibleCount() > 0);
    assert.ok(f.crystals().every(item => item.children[0].attributes['data-frost-shape'] === 'six-branch-snowflake'));
  }
});

test('pickup to held motion keeps its current snowflakes and cumulative painted phase across decoder generations', () => {
  const f = fixture(); f.begin('drag-lift', 7); f.frost.onFrame(.9, 7);
  const group = f.layer.children[0], count = f.animations.length, times = f.times(), alpha = f.totalOpacity();
  assert.ok(alpha > 0);
  f.begin('drag-hover', 8, true);
  assert.equal(f.layer.children[0], group); assert.equal(f.animations.length, count);
  assert.deepEqual(f.times(), times); assert.equal(f.totalOpacity(), alpha);
  f.frost.onFrame(0, 8); assert.deepEqual(f.times(), times);
  f.frost.onFrame(1.1, 7); assert.deepEqual(f.times(), times, 'obsolete pickup callbacks cannot alter held snowflakes');
  f.frost.onFrame(.5, 8);
  const expected = fixture(); expected.begin('idle'); expected.frost.onFrame(1.4);
  assert.deepEqual(f.times(), expected.times());
});

test('held snowflakes follow cumulative painted time over many loops and pause without another rendering clock', () => {
  const f = fixture(), row = assets.find(value => value.name === 'drag-hover');
  f.begin('drag-lift', 1); f.frost.onFrame(.9, 1); f.begin('drag-hover', 2, true);
  const group = f.layer.children[0], count = f.animations.length;
  for (let cycle = 0; cycle < 8; cycle++) {
    for (let frame = 0; frame < row.encodedFrames; frame++) {
      const time = frame / row.fps;
      f.frost.onFrame(time, 2);
      const expected = fixture(); expected.begin('idle');
      expected.frost.onFrame(.9 + cycle * row.encodedFrames / row.fps + time);
      const actualTimes = f.times(), expectedTimes = expected.times();
      assert.equal(actualTimes.length, 3);
      actualTimes.forEach((value, index) => assert.ok(Math.abs(value - expectedTimes[index]) < 1e-8, 'held decoder loops must not restart or truncate the snowflake phase'));
      assert.equal(f.layer.children[0], group); assert.equal(f.animations.length, count);
    }
  }
  const paused = f.times(), pausedAlpha = f.totalOpacity();
  for (let repeat = 0; repeat < 20; repeat++) f.frost.onFrame((row.encodedFrames - 1) / row.fps, 2);
  f.frost.onFrame(.3, 1);
  assert.deepEqual(f.times(), paused); assert.equal(f.totalOpacity(), pausedAlpha);
  assert.ok(f.active().every(animation => animation.paused));
});

test('lowering clears current and retiring accents and never emits in any native frame or loop', () => {
  for (const name of ['drag-lower']) {
    const f = fixture(), spec = f.api.profiles[name], row = assets.find(value => value.name === name);
    assert.equal(spec.points.length, 0);
    f.begin('idle', 1); f.frost.onFrame(2, 1);
    f.begin('review', 2); f.frost.onFrame(.1, 2);
    assert.ok(f.active().length > 0, 'exercise both current and outgoing groups');
    const previous = [...f.active()];
    f.begin(name, 9, true);
    assert.equal(f.visibleCount(), 0); assert.equal(f.active().length, 0);
    assert.equal(f.layer.children.length, 0); assert.equal(f.layer.hidden, true);
    assert.ok(previous.every(animation => animation.cancelled));
    const count = f.animations.length;
    for (let loop = 0; loop < 3; loop++) {
      for (let frame = 0; frame <= row.encodedFrames; frame++) {
        f.frost.onFrame(frame / row.fps, 9);
        assert.equal(f.visibleCount(), 0);
        assert.equal(f.active().length, 0);
      }
    }
    f.frost.onFrame(2, 1); f.frost.onFrame(2, 2); // Obsolete painted callbacks.
    f.frost.beginTransition(); f.frost.onTransition(500);
    f.frost.setSuppressed(true); f.frost.setSuppressed(false);
    f.visibility(true); f.visibility(false); f.frost.onFrame(1, 9);
    assert.equal(f.visibleCount(), 0); assert.equal(f.layer.children.length, 0);
    assert.equal(f.animations.length, count, 'drag must allocate no SVG animations');
    f.begin('idle', 10); f.frost.onFrame(2, 10);
    assert.ok(f.visibleCount() > 0, 'normal companion accents resume after dragging has settled');
  }
});

test('idle-to-action transitions fade continuously on every new painted frame with no independent timer', () => {
  for (const name of ['running', 'review', 'waiting', 'running-classic', 'review-classic', 'waiting-classic', 'running-left', 'running-right']) {
    const f = fixture(); f.begin('idle', 1); f.frost.onFrame(durations.idle, 1);
    const old = [...f.active()], alpha = f.totalOpacity();
    assert.ok(alpha > .2, 'idle is still visibly frosted at its real neutral endpoint');
    f.begin(name, 2);
    assert.ok(Math.abs(f.totalOpacity() - alpha) < 1e-9, name + ' cannot clear the bright outgoing accents at commit');
    let previous = alpha;
    for (let frame = 1; frame <= 6; frame++) {
      f.frost.onFrame(frame / 24, 2);
      const next = f.totalOpacity();
      assert.ok(next <= previous + 1e-9, name + ' fade should be monotonic before the new cue');
      if (frame < 5) assert.ok(next > 0, name + ' cannot snap off in a single frame');
      previous = next;
    }
    assert.ok(old.every(animation => animation.cancelled));
    assert.equal(f.totalOpacity(), 0);
    f.frost.onFrame(cueSample(name), 2); assert.ok(f.visibleCount() > 0);
  }
});

test('a body recovery begins one frost retirement without clearing or restarting its visible fade', () => {
  const f = fixture(); f.begin('review', 7); f.frost.onFrame(2, 7);
  const old = [...f.active()], times = f.times(), count = f.animations.length, alpha = f.totalOpacity();
  assert.ok(alpha > .2);
  f.frost.beginTransition();
  assert.ok(Math.abs(f.totalOpacity() - alpha) < 1e-9, 'the recovery boundary cannot remove visible crystals');
  assert.deepEqual(f.times(), times); assert.equal(f.animations.length, count);
  f.frost.onTransition(100);
  const faded = f.totalOpacity();
  assert.ok(faded > 0 && faded < alpha);
  f.frost.beginTransition();
  assert.ok(Math.abs(f.totalOpacity() - faded) < 1e-9, 'repeated recovery requests cannot brighten the retired group');
  f.frost.onTransition(100);
  assert.ok(f.totalOpacity() > 0 && f.totalOpacity() < faded);
  f.frost.onTransition(40);
  assert.equal(f.totalOpacity(), 0);
  assert.ok(old.every(animation => animation.cancelled));
  assert.equal(f.layer.children.length, 0);
});

test('body recovery RAF deltas fade a fixed outgoing phase monotonically over 240 milliseconds', () => {
  for (const name of ['idle', 'review-classic', 'waiting', 'running-left', 'running-right']) {
    const f = fixture(); f.begin(name, 1); f.frost.onFrame(cueSample(name), 1);
    const old = [...f.active()], times = f.times(), alpha = f.totalOpacity();
    assert.ok(alpha > 0, name);
    f.frost.beginTransition();
    let previous = alpha;
    for (let frame = 1; frame <= 6; frame++) {
      f.frost.onTransition(1000 / 24);
      const next = f.totalOpacity();
      assert.ok(next <= previous + 1e-9, name + ' must never blink brighter while the body returns');
      if (frame < 5) assert.ok(next > 0, name + ' needs a multi-frame fade, not an abrupt clear');
      if (frame < 6) assert.deepEqual(old.map(animation => animation.currentTime), times);
      previous = next;
    }
    assert.equal(f.totalOpacity(), 0); assert.ok(old.every(animation => animation.cancelled));
  }
});

test('old decoder callbacks cannot advance or resurrect accents during an explicit body recovery', () => {
  const f = fixture(); f.begin('review', 7); f.frost.onFrame(2, 7);
  f.frost.beginTransition(); f.frost.onTransition(60);
  const times = f.times(), alpha = f.totalOpacity();
  for (const time of [2.1, .1, 4.8]) f.frost.onFrame(time, 7);
  f.frost.onFrame(3, 6);
  assert.deepEqual(f.times(), times);
  assert.ok(Math.abs(f.totalOpacity() - alpha) < 1e-9, 'only the body recovery RAF owns the outgoing fade clock');
  f.frost.onTransition(180); assert.equal(f.totalOpacity(), 0);
  f.frost.onFrame(2, 7); assert.equal(f.totalOpacity(), 0);
});

test('returning into idle after body recovery creates a fresh group instead of reusing an empty continuous-idle group', () => {
  const f = fixture(); f.begin('idle', 1); f.frost.onFrame(2, 1);
  const old = [...f.active()], count = f.animations.length;
  f.frost.beginTransition(); f.frost.onTransition(240);
  assert.ok(old.every(animation => animation.cancelled));
  f.begin('idle', 2);
  assert.equal(f.active().length, f.api.profiles.idle.points.length);
  assert.equal(f.animations.length, count + f.api.profiles.idle.points.length);
  assert.equal(f.visibleCount(), 0, 'a new common-neutral body starts a fresh sparse frost cue');
  f.frost.onFrame(2, 2); assert.ok(f.visibleCount() > 0);
  const times = f.times(), alpha = f.totalOpacity();
  f.frost.onTransition(1000);
  assert.deepEqual(f.times(), times); assert.ok(Math.abs(f.totalOpacity() - alpha) < 1e-9);
});

test('invalid body recovery deltas do not corrupt the retired frost group', () => {
  const f = fixture(); f.begin('waiting-classic', 1); f.frost.onFrame(2, 1);
  f.frost.beginTransition(); f.frost.onTransition(60);
  const times = f.times(), alpha = f.totalOpacity();
  for (const delta of [NaN, Infinity, -10, undefined]) f.frost.onTransition(delta);
  assert.deepEqual(f.times(), times); assert.ok(Math.abs(f.totalOpacity() - alpha) < 1e-9);
  f.frost.onTransition(180); assert.equal(f.totalOpacity(), 0);
});

test('stopping or disposing a body recovery releases its particles and cannot be revived by late RAF deltas', () => {
  for (const finish of [f => f.frost.stop(), f => f.frost.dispose()]) {
    const f = fixture(); f.begin('running', 1); f.frost.onFrame(2, 1);
    f.frost.beginTransition(); f.frost.onTransition(60);
    finish(f);
    assert.equal(f.active().length, 0); assert.equal(f.visibleCount(), 0);
    f.frost.beginTransition(); f.frost.onTransition(300); f.frost.onFrame(2, 1);
    assert.equal(f.active().length, 0); assert.equal(f.visibleCount(), 0);
  }
});

test('rapid replacements preserve the already faded opacity and bound outgoing resource lifetime', () => {
  const f = fixture(); f.begin('idle', 1); f.frost.onFrame(2, 1);
  const first = [...f.active()];
  f.begin('review', 2); f.frost.onFrame(.1, 2);
  const faded = f.totalOpacity(); assert.ok(faded > 0);
  f.begin('waiting', 3);
  assert.ok(Math.abs(f.totalOpacity() - faded) < 1e-9, 'another commit cannot jump old particles back to full opacity');
  f.frost.onFrame(.05, 3);
  assert.ok(f.totalOpacity() <= faded && f.totalOpacity() > 0);
  f.begin('running-classic', 4);
  const second = f.totalOpacity(); f.frost.onFrame(.25, 4);
  assert.equal(f.totalOpacity(), 0); assert.ok(first.every(animation => animation.cancelled));
  assert.ok(second <= faded);
  f.frost.onFrame(2, 4); assert.ok(f.visibleCount() > 0);
  assert.equal(f.active().length, f.api.profiles['running-classic'].points.length);
});

test('stop, unsupported actions and disposal cannot be revived by late frame or visibility callbacks', () => {
  for (const cancel of [f => f.frost.stop(), f => f.begin('unsupported-action')]) {
    const f = fixture(); f.begin('idle'); f.frost.onFrame(2);
    cancel(f); f.frost.onFrame(3); f.visibility(true); f.visibility(false);
    assert.equal(f.visibleCount(), 0); assert.equal(f.active().length, 0); assert.equal(f.layer.children.length, 0);
  }
  const f = fixture(); f.begin('idle'); f.frost.onFrame(2); f.frost.dispose();
  f.begin('review', 2); f.frost.onFrame(2); f.frost.setSuppressed(false); f.visibility(true); f.visibility(false);
  assert.equal(f.visibleCount(), 0); assert.equal(f.active().length, 0);
  assert.equal(f.events.get('visibilitychange').size, 0); assert.deepEqual(f.stage.children, [f.character]);
});

test('invalid media timestamps leave the last valid phase unchanged', () => {
  const f = fixture(); f.begin('review'); f.frost.onFrame(2);
  const times = f.times();
  for (const time of [NaN, Infinity, -1, undefined]) f.frost.onFrame(time);
  assert.deepEqual(f.times(), times);
});

test('late frames from an obsolete playback generation cannot advance the new effect', () => {
  const f = fixture(); f.begin('review', 7); f.frost.onFrame(2, 7);
  f.begin('waiting', 8); f.frost.onFrame(1, 8);
  const times = f.times();
  f.frost.onFrame(4, 7);
  assert.deepEqual(f.times(), times);
  f.frost.onFrame(2, 8); assert.notDeepEqual(f.times(), times);
});

function spritePrototype(globals = {}) {
  const context = vm.createContext({ window: { __dshPetDebug: {} }, SHUANGLING_PROFILE: true, ...globals });
  vm.runInContext(spriteSource + '\nthis.P=PetSprite.prototype;', context);
  return context.P;
}

test('real paint hooks use the front decoder generation while a newer decoder is only being prepared', () => {
  const f = fixture(); f.begin('review', 7);
  const p = Object.create(spritePrototype());
  const drawing = { drawImage() {} };
  Object.assign(p, {
    front: 0, gen: 8, frost: f.frost,
    videoA: { videoWidth: 1280, videoHeight: 720, currentTime: 1, petPlaybackGeneration: 7 },
    videoB: { videoWidth: 1280, videoHeight: 720, currentTime: 3, petPlaybackGeneration: 8 },
    videoSurface: { width: 1280, height: 720, getContext: () => drawing },
    videoOutlineCssPx: 0, dragState: { active: false, dragging: false }, throwRef: null, throwState: null,
  });
  p.paintVideoFrame(p.videoA, 1);
  assert.ok(f.visibleCount() > 0, 'preparing generation eight must not freeze the still-visible generation seven');
  const times = f.times();
  p.paintVideoFrame(p.videoB, 3);
  assert.deepEqual(f.times(), times, 'a hidden decoder cannot advance the visible clip accents');
  p.front = 1; f.begin('waiting', 8); p.paintVideoFrame(p.videoB, 2);
  assert.ok(f.visibleCount() > 0);
  const next = f.times(); p.paintVideoFrame(p.videoA, 4);
  assert.deepEqual(f.times(), next, 'the previous decoder cannot move the new effect');
});

test('a cancelled pointer release restores the same effect after release without requiring another video commit', async () => {
  const f = fixture(); f.begin('waiting', 1); f.frost.onFrame(2, 1); f.frost.setSuppressed(true);
  const count = f.animations.length, p = Object.create(spritePrototype());
  let inputUpdates = 0;
  Object.assign(p, {
    frost: f.frost, dragState: { active: true, dragging: false }, throwRef: null, throwState: null,
    hit: { classList: { remove() {} } }, stage: { style: {} }, bottomPad: 0,
    stopDragFollow() {}, syncInputBusy() { inputUpdates++; }, updateInteraction() {},
  });
  p.onPointerUp({ type: 'pointercancel' });
  await Promise.resolve();
  assert.equal(inputUpdates, 1); assert.equal(p.dragState.active, false);
  assert.equal(f.animations.length, count); assert.ok(f.visibleCount() > 0);
});

test('an external throw hides accents immediately even when the current video is frozen and cannot paint', () => {
  const f = fixture(); f.begin('waiting', 1); f.frost.onFrame(2, 1);
  assert.ok(f.visibleCount() > 0);
  const p = Object.create(spritePrototype({ performance: { now: () => 0 }, requestAnimationFrame: () => 1 }));
  Object.assign(p, {
    frost: f.frost, frozen: true, confineToScreen: false, throwToken: 0,
    clearManualAction() {}, stopDragFollow() {}, stopMove() {},
  });
  p.startThrow(10, 20, 50, -20);
  assert.equal(f.visibleCount(), 0); assert.equal(p.throwRef, 1);
  assert.deepEqual({ ...p.throwState }, { x: 10, y: 20, vx: 50, vy: -20 });
});

test('decorative siblings keep stable geometry and never handle input', () => {
  const f = fixture(); f.begin('review-classic'); f.frost.onFrame(2);
  assert.equal(f.stage.children[0], f.layer); assert.equal(f.stage.children[1], f.character);
  assert.equal(f.layer.attributes['aria-hidden'], 'true');
  assert.deepEqual(f.stage.style, { width: '339px', height: '190.6875px' });
  assert.deepEqual([...f.events.keys()], ['visibilitychange']);
  assert.ok(f.crystals().every(particle => particle.children[0].attributes.focusable === 'false'));
  assert.equal(f.character.children.length, 0);
});
