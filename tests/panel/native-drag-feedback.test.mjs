import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const helper = new URL('../../vendor/dsh-pet/runtime/electron-helper/', import.meta.url);
const sharedSource = readFileSync(new URL('shared-core.js', helper), 'utf8');
const spriteSource = readFileSync(new URL('sprite.js', helper), 'utf8');

function fixture(shuangling = true, flight = { vx: 500, vy: 250 }) {
  class Element {
    constructor() { this.children = []; this.style = {}; this.dataset = {}; }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  }
  const document = { createElement: () => new Element(), head: new Element(), body: new Element() };
  const callbacks = [], popups = [], suppression = []; let bursts = 0, inputs = 0;
  const context = vm.createContext({ document, console: { log() {} }, SHUANGLING_PROFILE: shuangling,
    window: { matchMedia: () => ({ matches: false }) }, performance: { now: () => 1000 },
    requestAnimationFrame: fn => { callbacks.push(fn); return callbacks.length; }, toLocal: value => value });
  vm.runInContext(sharedSource, context);
  context.S = context.PetShared;
  const actualBurst = context.S.spawnScoreBurst;
  context.S.spawnScoreBurst = (...args) => { bursts++; return actualBurst(...args); };
  context.S.mountScorePopup = value => popups.push(value);
  vm.runInContext(spriteSource + '\nthis.P=PetSprite.prototype;', context);
  const sprite = Object.assign(Object.create(context.P), {
    pet: { id: 'feedback-fixture', size: 339 }, size: 339, pos: { x: 80, y: 90 },
    dragState: { active: false, dragging: false }, throwRef: null, throwState: flight,
    displayedAnim: 'idle', pending: null, dragVisual: null,
    hit: { classList: { add() {} }, setPointerCapture() {} },
    frost: { setSuppressed: value => suppression.push(value) },
    beginInteraction() {}, yieldUserControl() {}, stopThrow() { this.throwRef = null; this.throwState = null; },
    stopDragFollow() {}, stopMove() {}, setTip() {}, syncInputBusy() { inputs++; },
  });
  const press = (button = 0) => sprite.onPointerDown({ button, screenX: 180, screenY: 190, clientX: 140, clientY: 150, pointerId: 1 });
  const dots = () => document.body.children.flatMap(root => root.children).filter(el => el.className === 'dsh-pet-score-particle').length;
  return { sprite, press, document, popups, suppression, dots, bursts: () => bursts, inputs: () => inputs, callbacks };
}

test('a fast Shuangling catch creates no round particles while retaining one real score feedback', () => {
  const f = fixture(); f.press();
  assert.equal(f.bursts(), 0); assert.equal(f.dots(), 0); assert.equal(f.popups.length, 1);
  assert.equal(f.sprite.pressScoreFired, true); assert.equal(f.sprite.dragState.active, true);
  assert.ok(f.popups[0].score > 0); assert.equal(f.popups[0].speed, Math.hypot(500, 250));
  assert.equal(f.popups[0].size, 339); assert.equal(f.inputs(), 1);
  f.sprite.dragState.active = false; f.sprite.onClick();
  assert.equal(f.popups.length, 1, 'click after the scored press must not duplicate feedback');
  assert.equal(f.sprite.pressScoreFired, false); assert.equal(f.bursts(), 0);
});

test('the upstream pet retains its score burst and popup', () => {
  const f = fixture(false); f.press();
  assert.equal(f.bursts(), 1); assert.equal(f.dots(), 20); assert.equal(f.popups.length, 1);
  assert.equal(f.sprite.pressScoreFired, true); assert.equal(f.callbacks.length, 1);
});

test('stationary and slow-flight presses never invent score feedback for either pet profile', () => {
  for (const profile of [false, true]) for (const flight of [null, { vx: 120, vy: 70 }]) {
    const f = fixture(profile, flight); f.press();
    assert.equal(f.bursts(), 0); assert.equal(f.dots(), 0); assert.equal(f.popups.length, 0);
    assert.equal(f.sprite.pressScoreFired, false);
  }
});

test('a Shuangling pickup never briefly hides the complete calm snowflakes', () => {
  for (const name of ['idle', 'drag-lift', 'drag-hover']) {
    const f = fixture(true, null); f.sprite.displayedAnim = name; f.press();
    assert.deepEqual(f.suppression, [false], name + ' must be evaluated once after physical ownership is recorded');
  }
});

test('disabling Shuangling round particles leaves unrelated pet feedback untouched', () => {
  const f = fixture(), other = f.document.createElement('div');
  other.className = 'dsh-pet-score-burst'; other.dataset.petId = 'another-pet';
  f.document.body.appendChild(other); f.press();
  assert.ok(f.document.body.children.includes(other)); assert.equal(other.dataset.petId, 'another-pet');
  assert.equal(f.bursts(), 0); assert.equal(f.popups.length, 1);
});

test('a right-button press creates no score, input ownership or decoration change', () => {
  const f = fixture(); f.press(2);
  assert.equal(f.bursts(), 0); assert.equal(f.popups.length, 0); assert.equal(f.inputs(), 0);
  assert.deepEqual(f.suppression, []); assert.equal(f.sprite.dragState.active, false);
});
