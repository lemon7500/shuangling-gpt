// The renderer ROI is valid only for the exact locally scanned release media.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

export const CORE_ANIMATIONS = Object.freeze(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']);
export const AMBIENT_ANIMATIONS = Object.freeze(['reading', 'looking-around', 'stretching-wings']);
export const MANUAL_VARIANTS = Object.freeze(['running-classic', 'review-classic', 'waiting-classic']);
// Internal lift/hold/lower clips are an atomic capability, never menu actions.
export const DRAG_ANIMATIONS = Object.freeze(['drag-lift', 'drag-hover', 'drag-lower']);
export const DRAG_ASSET_ROOTS = Object.freeze(['main', 'shuangling']);
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export function verifyOutlineAssetContract({profile, manifestPath, assetDirectory, animations}) {
  const names = Array.isArray(animations) ? animations.map(row => row?.name) : [];
  const accepted = [...CORE_ANIMATIONS, ...AMBIENT_ANIMATIONS, ...MANUAL_VARIANTS, ...DRAG_ANIMATIONS];
  const dragCount = DRAG_ANIMATIONS.filter(name => names.includes(name)).length;
  if (names.length < CORE_ANIMATIONS.length || names.length > accepted.length ||
      new Set(names).size !== names.length || CORE_ANIMATIONS.some(name => !names.includes(name)) ||
      names.some(name => !accepted.includes(name)) || (dragCount !== 0 && dragCount !== DRAG_ANIMATIONS.length)) throw Error('Outline media identity mismatch: animation names');
  const drag = profile?.drag;
  if (dragCount ? !drag || Object.keys(drag).length !== 3 || drag.lift !== 'drag-lift' || drag.hover !== 'drag-hover' || drag.lower !== 'drag-lower' : drag !== undefined) {
    throw Error('Outline media contract mismatch: drag capability');
  }
  if (dragCount ? JSON.stringify(profile.dragAssetRoots) !== JSON.stringify(DRAG_ASSET_ROOTS) : profile?.dragAssetRoots !== undefined) {
    throw Error('Outline media contract mismatch: drag asset roots');
  }
  const roi = profile?.outlineMaskRoi;
  const [x,y,width,height] = roi?.sourceRect ?? [];
  const safeGeometry = Array.isArray(roi?.sourceRect) && roi.sourceRect.length === 4 &&
    [x,y,width,height].every(Number.isInteger) && x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x + width <= 1280 && y + height <= 720 && Number.isInteger(roi?.paddingNativePx) &&
    roi.paddingNativePx >= 2 && roi.paddingNativePx * 2 < Math.min(width,height);
  if (!roi || roi.assetRoot !== 'shuangling' || JSON.stringify(roi.canvas) !== '[1280,720]' ||
      !safeGeometry ||
      profile.outlineCssPx !== .45 || hash(manifestPath) !== roi.sourceManifestSha256 ||
      Object.keys(roi.webmSha256ByAnimation ?? {}).length !== names.length ||
      !Array.isArray(animations) || Object.keys(roi.webmSha256ByAnimation).some(name => !names.includes(name))) throw Error('Outline media contract mismatch');
  return names.map(name => {
    const rows = animations.filter(row => row.name === name);
    const expected = roi.webmSha256ByAnimation[name];
    const actual = hash(join(assetDirectory, name + '.webm'));
    if (!/^[a-f0-9]{64}$/.test(expected ?? '') || rows.length !== 1 || rows[0].webmSha256 !== expected || actual !== expected) {
      throw Error('Outline media identity mismatch: ' + name);
    }
    return {name, sha256: actual};
  });
}
