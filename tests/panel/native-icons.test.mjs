import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const icons = require('../../vendor/dsh-pet/runtime/electron-helper/shuangling-icons.js');
const helper = new URL('../../vendor/dsh-pet/runtime/electron-helper/', import.meta.url);
const source = file => readFileSync(new URL(file, helper), 'utf8');

class Element {
  constructor(tagName, document) {
    this.tagName = tagName; this.ownerDocument = document; this.children = []; this.dataset = {}; this.attributes = {};
    this.classList = { add: name => { this.attributes.class = [...new Set([...(this.attributes.class || '').split(' ').filter(Boolean), name])].join(' '); } };
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  getAttribute(key) { return this.attributes[key]; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text || this.children.map(child => child.textContent).join(''); }
  append(...values) { for (const child of values) { child.parentElement = this; this.children.push(child); } }
  prepend(child) { child.parentElement = this; this.children.unshift(child); }
  replaceChildren(...values) { this.children = []; this.text = ''; this.append(...values); }
  replaceWith(next) {
    const parent = this.parentElement; const index = parent.children.indexOf(this);
    parent.children[index] = next; next.parentElement = parent;
  }
  querySelector(selector) {
    const match = child => selector === '.shuangling-icon' ? child.attributes.class?.split(' ').includes('shuangling-icon') : selector === '[data-icon-label]' ? Object.hasOwn(child.attributes, 'data-icon-label') : false;
    for (const child of this.children) { if (match(child)) return child; const nested = child.querySelector(selector); if (nested) return nested; }
    return null;
  }
}
const document = { createElement: tag => new Element(tag, document), createElementNS(namespace, tag) { assert.equal(namespace, 'http://www.w3.org/2000/svg'); return new Element(tag, document); } };

test('icons retain the translated text, command identity and button state across language updates', () => {
  const button = document.createElement('button');
  button.id = 'pause'; button.disabled = true; button.dataset.command = 'resume'; button.setAttribute('aria-pressed', 'true');
  const listener = () => {}; button.onclick = listener;
  let sameIcon;
  for (const text of ['恢复联动', '恢復聯動', 'Resume following']) {
    icons.setLabel(button, text, 'play');
    const icon = button.querySelector('.shuangling-icon');
    assert.equal(button.children.length, 2); assert.equal(button.textContent, text);
    assert.equal(button.querySelector('[data-icon-label]').textContent, text);
    assert.equal(button.id, 'pause'); assert.equal(button.dataset.command, 'resume'); assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-pressed'), 'true'); assert.equal(button.onclick, listener);
    if (sameIcon) assert.equal(icon, sameIcon);
    sameIcon = icon;
  }
  icons.setLabel(button, '暂停联动', 'pause');
  assert.notEqual(button.querySelector('.shuangling-icon'), sameIcon);
  assert.equal(button.children.length, 2); assert.equal(button.textContent, '暂停联动');
});

test('all fixed icons are decorative round-ended paths with no arbitrary HTML or external resource', () => {
  for (const name of icons.names) {
    const icon = icons.create(name, document);
    assert.equal(icon.tagName, 'svg'); assert.equal(icon.getAttribute('aria-hidden'), 'true'); assert.equal(icon.getAttribute('focusable'), 'false');
    assert.equal(icon.getAttribute('stroke-width'), '1.6'); assert.equal(icon.getAttribute('stroke-linecap'), 'round');
    assert.equal(icon.getAttribute('fill'), 'none'); assert.equal(icon.children.length, 1); assert.equal(icon.children[0].tagName, 'path');
    assert.match(icon.children[0].getAttribute('d'), /^[A-Za-z\d .,-]+$/);
    assert.ok(!Object.keys(icon.attributes).some(key => /^(?:on|href)/i.test(key)));
  }
  for (const unsafe of ['__proto__', 'constructor', '<svg onload=alert(1)>', 'https://example.invalid']) assert.equal(icons.create(unsafe, document), null);
  assert.notEqual(icons.create('running-left', document).children[0].getAttribute('d'), icons.create('running-right', document).children[0].getAttribute('d'));
});

test('panel and tools use known inline icon names and preserve independent translatable labels', () => {
  for (const file of ['panel.html', 'desk.html']) {
    const html = source(file);
    assert.match(html, /font-src 'self'/); assert.match(html, /href="fonts\/shuangling-fonts\.css"/);
    assert.match(html, /src="shuangling-icons\.js" defer/); assert.match(html, /href="shuangling-icons\.css"/);
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    let count = 0;
    for (const [, attributes, body] of buttons) {
      const name = /\bdata-icon="([^"]+)"/.exec(attributes)?.[1];
      if (!name) continue;
      count++; assert.ok(icons.names.includes(name), `${file}: unknown icon ${name}`);
      assert.doesNotMatch(attributes, /\sdata-i18n=/, `${file}: translating a whole icon button would erase its SVG`);
      assert.doesNotMatch(body, /<span class="action-icon"|[☾✧♧↟⋈⌕]/);
    }
    assert.ok(count >= 25, `${file}: common controls retain icons`);
  }
  for (const name of ['idle', 'running', 'review', 'waiting', 'waving', 'jumping', 'running-left', 'running-right', 'failed', 'reading', 'looking-around', 'stretching-wings']) {
    assert.match(source('panel.html'), new RegExp(`data-animation="${name}"[^>]*data-icon="${name}"`));
  }
  assert.doesNotMatch(source('desk.js'), /entry\.favorite \? '☆ '/);
});
