import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const helper = new URL('../../vendor/dsh-pet/runtime/electron-helper/', import.meta.url);
const source = file => readFileSync(new URL(file, helper), 'utf8');
const bubble = require('../../vendor/dsh-pet/runtime/electron-helper/shuangling-bubble.js');

test('brief notes are readable, long English gets time, and explicit zero/long durations retain their contract', () => {
  assert.equal(bubble.duration('这一步完成了。', 2400), 4000);
  assert.equal(bubble.duration('這一輪結束了，慢慢看看結果。', 2400), 4000);
  const long = 'This step is complete. Take your time to look through the result before deciding what comes next.';
  assert.ok(bubble.duration(long, 2400) > bubble.duration('All done.', 2400));
  assert.ok(bubble.duration(long, 2400) <= 7000);
  assert.equal(bubble.duration(long, 0), 0);
  assert.equal(bubble.duration(long, 12000), 12000);
});

test('note placement respects available work area and can move beside the head at the top edge', () => {
  const bounds = { x: 0, y: 0, w: 500, h: 380 };
  const body = { x: 190, right: 310, bottom: 330 };
  const box = { w: 170, h: 84 };
  const above = bubble.placement({ bounds, body, box, anchor: { x: 250, y: 130 } });
  assert.equal(above.kind, 'above');
  assert.ok(above.y + box.h < 130);
  const top = bubble.placement({ bounds, body, box, anchor: { x: 250, y: 18 } });
  assert.ok(['left', 'right'].includes(top.kind));
  assert.ok(top.x + box.w < body.x || top.x > body.right);
  for (const value of [above, top]) {
    assert.ok(value.x >= bounds.x && value.y >= bounds.y);
    assert.ok(value.x + box.w <= bounds.x + bounds.w);
    assert.ok(value.y + box.h <= bounds.y + bounds.h);
  }
});

test('placement remains within cropped viewport intersections at each desktop corner', () => {
  for (const bounds of [{ x: 0, y: 0, w: 240, h: 250 }, { x: 100, y: 0, w: 300, h: 290 }, { x: 0, y: 120, w: 360, h: 230 }]) {
    for (const anchor of [{ x: bounds.x + 20, y: bounds.y + 20 }, { x: bounds.x + bounds.w - 20, y: bounds.y + bounds.h - 20 }]) {
      const box = { w: Math.min(160, bounds.w - 14), h: 80 };
      const value = bubble.placement({ bounds, box, anchor, body: { x: anchor.x - 40, right: anchor.x + 40, bottom: anchor.y + 90 } });
      assert.ok(value.x >= bounds.x && value.y >= bounds.y);
      assert.ok(value.x + box.w <= bounds.x + bounds.w);
      assert.ok(value.y + box.h <= bounds.y + bounds.h);
    }
  }
});

test('upstream profiles never receive Shuangling classes or changed whisper duration', () => {
  for (const profile of [false, true]) {
    const classes = [];
    const context = vm.createContext({ SHUANGLING_PROFILE: profile, window: { document: { documentElement: { classList: { add: name => classes.push(name) } } } } });
    vm.runInContext(source('shuangling-bubble.js'), context);
    assert.deepEqual(classes, profile ? ['shuangling-profile'] : []);
    const timers = [];
    const eventContext = vm.createContext({ SHUANGLING_PROFILE: profile, ShuanglingBubble: bubble, PetSprite: function () {},
      window: { clearTimeout() {}, setTimeout(fn, delay) { timers.push(delay); } },
      BUBBLE_DURATION_MS: 10000, S: { whisperBubbleView: value => [{ role: 'row', text: value.text }] }, console: { log() {} } });
    vm.runInContext(source('events.js'), eventContext);
    const sprite = { pet: { id: 'fixture' }, renderBubble() {} };
    eventContext.PetSprite.prototype.showWhisper.call(sprite, '这一步完成了。', '', '', 2400, false);
    assert.equal(timers.at(-1), profile ? 4000 : 2400);
    const count = timers.length;
    eventContext.PetSprite.prototype.showWhisper.call(sprite, 'hidden', '', '', 0, false);
    assert.equal(timers.length, count);
  }
});

test('local positioning keeps pet geometry intact and skips layout reads until its visible intersection changes', () => {
  let reads = 0, bounds = { x: 0, y: 0, w: 420, h: 360 };
  const style = { setProperty(name, value) { this[name] = value; } };
  const attributes = {};
  const element = { style, classList: { contains: name => name === 'is-shuangling-note', remove() {}, toggle() {} }, setAttribute(name, value) { attributes[name] = value; },
    get offsetWidth() { reads++; return Math.min(220, Number.parseFloat(style.maxWidth)); },
    get offsetHeight() { reads++; return 70; } };
  const sprite = { size: 300, margin: { l: 60, t: 100 }, hitRect: { x: 110, y: 40, w: 90, h: 150 },
    pos: { x: 400, y: 200 }, bubble: element, visibleClampRect: () => bounds };
  const geometry = JSON.stringify([sprite.size, sprite.margin, sprite.hitRect, sprite.pos]);
  assert.equal(bubble.position(sprite), true);
  assert.ok(reads > 0); const initialReads = reads;
  assert.equal(bubble.position(sprite), false); assert.equal(reads, initialReads);
  bounds = { x: 0, y: 90, w: 420, h: 270 };
  assert.equal(bubble.position(sprite), true); assert.ok(reads > initialReads);
  assert.ok(['left', 'right', 'below', 'above'].includes(attributes['data-shuangling-placement']));
  assert.equal(JSON.stringify([sprite.size, sprite.margin, sprite.hitRect, sprite.pos]), geometry);
});

test('font swap remeasures only connected visible notes and removes its one listener on unload', () => {
  const events = new Map(); let unload, reads = 0;
  const classes = new Set(['is-on']);
  const style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
  const element = { style, isConnected: true, classList: { contains: name => classes.has(name), remove: name => classes.delete(name), toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
    setAttribute() {}, removeAttribute() {}, get offsetWidth() { reads++; return 220; }, get offsetHeight() { reads++; return 60; } };
  const document = { documentElement: { classList: { add() {} } }, fonts: { addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name, fn) { assert.equal(events.get(name), fn); events.delete(name); } }, querySelectorAll: () => [element] };
  const context = vm.createContext({ SHUANGLING_PROFILE: true, window: { document, addEventListener(name, fn, options) { assert.equal(name, 'beforeunload'); assert.equal(options.once, true); unload = fn; } } });
  vm.runInContext(source('shuangling-bubble.js'), context);
  const api = context.window.ShuanglingBubble;
  const sprite = { size: 300, margin: { l: 150, t: 150 }, hitRect: { x: 100, y: 40, w: 100, h: 150 }, bubble: element, visibleClampRect: () => ({ x: 0, y: 0, w: 600, h: 500 }) };
  api.decorate(sprite, 'whisper'); reads = 0;
  assert.equal(events.size, 1); events.get('loadingdone')(); assert.ok(reads > 0);
  element.isConnected = false; reads = 0; events.get('loadingdone')(); assert.equal(reads, 0);
  unload(); assert.equal(events.size, 0);
  element.isConnected = true; api.decorate(sprite, 'balance'); reads = 0;
  assert.equal(api.position(sprite), false); assert.equal(reads, 0);
  assert.equal(style.maxWidth, ''); assert.equal(style.left, ''); assert.equal(style.top, ''); assert.equal(style.bottom, ''); assert.equal(style.transform, '');
  assert.equal(classes.has('is-shuangling-note'), false);
});

test('card integration leaves media/window dimensions and pointer registration to existing code', () => {
  const html = source('index.html');
  assert.ok(html.indexOf('shuangling-bubble.css') > html.indexOf('</style>'));
  assert.ok(html.indexOf('src="./constants.js"') < html.indexOf('src="./shuangling-bubble.js"'));
  assert.ok(html.indexOf('src="./shuangling-bubble.js"') < html.indexOf('src="./sprite.js"'));
  assert.match(html, /fonts\/shuangling-fonts\.css/);
  assert.ok(!/setBounds|fetch\(|petBridge|writeFile|localStorage/.test(source('shuangling-bubble.js')));
});
