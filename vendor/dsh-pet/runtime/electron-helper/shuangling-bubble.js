/* Local display-only note-card helpers. No settings, IPC, media or window sizing. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.ShuanglingBubble = api;
    if (typeof SHUANGLING_PROFILE !== 'undefined' && SHUANGLING_PROFILE) {
      root.document?.documentElement.classList.add('shuangling-profile');
      const fonts = root.document?.fonts;
      if (fonts?.addEventListener) {
        const refresh = () => api.refreshVisible(root.document);
        fonts.addEventListener('loadingdone', refresh);
        root.addEventListener?.('beforeunload', () => fonts.removeEventListener('loadingdone', refresh), { once: true });
      }
    }
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(Math.max(lo, hi), value));
  const finite = value => Number.isFinite(value);
  const owners = new WeakMap();
  function duration(text, requested) {
    if (requested === 0) return 0;
    const value = typeof text === 'string' ? text.trim() : '';
    const words = value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0;
    const other = [...value.replace(/[A-Za-z\s0-9\p{P}]/gu, '')].length;
    const readable = clamp(2600 + words * 270 + other * 80, 4000, 7000);
    return finite(requested) && requested > 0 ? Math.max(requested, readable) : readable;
  }
  function placement({ bounds, box, anchor, body, side = null }) {
    const gap = 9, edge = 7;
    const left = bounds.x + edge, top = bounds.y + edge;
    const right = bounds.x + bounds.w - edge, bottom = bounds.y + bounds.h - edge;
    const above = anchor.y - gap - box.h;
    let kind = 'above', x = anchor.x - box.w / 2, y = above;
    if (side || above < top) {
      const spaces = { left: body.x - gap - left, right: right - body.right - gap };
      const chosen = side || (spaces.right > spaces.left ? 'right' : 'left');
      if (spaces[chosen] >= 100) {
        kind = chosen; x = chosen === 'left' ? body.x - gap - box.w : body.right + gap;
        y = anchor.y - Math.min(18, box.h / 3);
      } else if (body.bottom + gap + box.h <= bottom) {
        kind = 'below'; y = body.bottom + gap;
      }
    }
    x = clamp(x, left, right - box.w); y = clamp(y, top, bottom - box.h);
    const sideWidth = kind === 'left' ? body.x - gap - left : kind === 'right' ? right - body.right - gap : null;
    return { x, y, kind, maxWidth: Math.max(1, Math.min(kind === 'left' || kind === 'right' ? sideWidth : bounds.w - edge * 2, 320)),
      tailX: clamp(anchor.x - x, 12, box.w - 12), tailY: clamp(anchor.y - y, 12, box.h - 12) };
  }
  function set(style, key, value) { if (style[key] !== value) style[key] = value; }
  function position(sprite, force = false) {
    const bubble = sprite?.bubble;
    if (!bubble || !bubble.classList.contains('is-shuangling-note') || !sprite.margin || !sprite.hitRect) return false;
    const fallback = { x: 0, y: 0, w: rootWidth(), h: rootHeight() };
    const bounds = sprite.visibleClampRect?.() || fallback;
    if (![bounds.x, bounds.y, bounds.w, bounds.h, sprite.size].every(finite) || bounds.w < 1 || bounds.h < 1) return false;
    const expanded = bubble.classList.contains('is-expanded');
    const geometryKey = [bounds.x, bounds.y, bounds.w, bounds.h, sprite.size, expanded].join('|');
    if (!force && sprite.shuanglingBubbleGeometry === geometryKey) return false;
    sprite.shuanglingBubbleGeometry = geometryKey;
    const anchor = { x: sprite.margin.l + sprite.size / 2, y: sprite.margin.t + sprite.size * .108 };
    const r = sprite.hitRect;
    const body = { x: sprite.margin.l + r.x, right: sprite.margin.l + r.x + r.w, bottom: sprite.margin.t + r.y + r.h };
    const maximum = Math.max(1, Math.min(expanded ? 320 : 280, bounds.w - 14));
    bubble.classList.remove('is-compact-note');
    set(bubble.style, 'maxWidth', maximum + 'px');
    let box = { w: bubble.offsetWidth, h: bubble.offsetHeight };
    let value = placement({ bounds, box, anchor, body });
    if (value.kind === 'left' || value.kind === 'right') {
      bubble.classList.toggle('is-compact-note', value.maxWidth < 180);
      set(bubble.style, 'maxWidth', Math.min(maximum, value.maxWidth) + 'px');
      box = { w: bubble.offsetWidth, h: bubble.offsetHeight };
      value = placement({ bounds, box, anchor, body, side: value.kind });
    }
    // Adjust only the note's local CSS position; never resize/move the pet window.
    set(bubble.style, 'left', value.x - sprite.margin.l + 'px');
    set(bubble.style, 'top', value.y - sprite.margin.t + 'px');
    set(bubble.style, 'bottom', 'auto'); set(bubble.style, 'transform', 'none');
    bubble.setAttribute('data-shuangling-placement', value.kind);
    bubble.style.setProperty('--shuangling-bubble-tail-x', value.tailX + 'px');
    bubble.style.setProperty('--shuangling-bubble-tail-y', value.tailY + 'px');
    return true;
  }
  function rootWidth() { return typeof window !== 'undefined' ? window.innerWidth : 0; }
  function rootHeight() { return typeof window !== 'undefined' ? window.innerHeight : 0; }
  function decorate(sprite, slot) {
    const bubble = sprite?.bubble; if (!bubble) return;
    owners.set(bubble, sprite);
    const note = slot === 'work' || slot === 'whisper';
    bubble.classList.toggle('is-shuangling-note', note);
    if (!note) {
      // The pre-existing usage/quota bubble keeps its original complete row
      // layout and hit regions after a note has occupied the shared slot.
      for (const key of ['maxWidth', 'left', 'top', 'bottom', 'transform']) set(bubble.style, key, '');
      bubble.removeAttribute('data-shuangling-placement');
      bubble.style.removeProperty('--shuangling-bubble-tail-x');
      bubble.style.removeProperty('--shuangling-bubble-tail-y');
      sprite.shuanglingBubbleGeometry = null;
      bubble.classList.remove('is-compact-note');
      return;
    }
    position(sprite, true);
  }
  function refreshVisible(document) {
    for (const bubble of document?.querySelectorAll?.('.pet-bubble.is-on') || []) {
      const sprite = owners.get(bubble);
      if (!sprite || !bubble.isConnected) continue;
      if (position(sprite, true) && sprite.balanceClickable?.()) sprite.syncInputRegions?.();
    }
  }
  return Object.freeze({ duration, placement, position, decorate, refreshVisible });
});
