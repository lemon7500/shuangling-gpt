// The renderer ROI is valid only for the exact locally scanned release media.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const names = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'];
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export function verifyOutlineAssetContract({profile, manifestPath, assetDirectory, animations}) {
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
      !Array.isArray(animations) || animations.length !== names.length) throw Error('Outline media contract mismatch');
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
