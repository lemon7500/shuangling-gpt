'use strict';

/** Work-area coordinates match Electron's forced-scale desktop coordinates. */
function panelBounds(anchor, workArea, scale = 1) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const gap = Math.round(12 * s);
  const inset = Math.round(8 * s);
  const width = Math.min(Math.round(352 * s), Math.max(1, workArea.width - inset * 2));
  const height = Math.min(Math.round(520 * s), Math.max(1, workArea.height - inset * 2));
  const left = workArea.x + inset;
  const top = workArea.y + inset;
  const right = workArea.x + workArea.width - inset;
  const bottom = workArea.y + workArea.height - inset;
  let x;
  if (anchor.x + anchor.width + gap + width <= right) x = anchor.x + anchor.width + gap;
  else if (anchor.x - gap - width >= left) x = anchor.x - gap - width;
  else x = anchor.x + anchor.width / 2 - width / 2;
  let y = anchor.y + anchor.height / 2 - height / 2;
  if (anchor.x - gap - width < left && anchor.x + anchor.width + gap + width > right) {
    if (anchor.y + anchor.height + gap + height <= bottom) y = anchor.y + anchor.height + gap;
    else if (anchor.y - gap - height >= top) y = anchor.y - gap - height;
  }
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
  return { x: clamp(x, left, right - width), y: clamp(y, top, bottom - height), width, height };
}

module.exports = { panelBounds };
