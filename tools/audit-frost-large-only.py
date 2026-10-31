"""Stream all native frames and remove only detached, unreadable matte points.

No media is rewritten and no frame sequence is exported.  The result is an
exact-hash-bound paint mask for the existing runtime cleanup.  Shape protection
is independent of color/opacity: a white or opaque point is still a point.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess

ROOT = Path(os.environ.get('SHUANGLING_AUDIT_ROOT', Path(__file__).resolve().parents[1])).expanduser().resolve()
OUT = Path(os.environ.get('SHUANGLING_AUDIT_OUTPUT', ROOT / 'qa' / 'media-audit' / 'large-only'))
FFMPEG = os.environ.get('SHUANGLING_FFMPEG') or 'ffmpeg'
FONT = os.environ.get('SHUANGLING_AUDIT_FONT')
np = cv2 = None
Image = ImageDraw = ImageFont = None

MAX_EXTENT = 24
MAX_AREA = 256
FAINT_MAX_EXTENT = 128
FAINT_MAX_AREA = 8192
FAINT_MAX_ALPHA = 64
FAINT_MAX_MEAN_ALPHA = 8
GUARD_PIXELS = 3
THRESHOLD = 0
EXACT_MAX_ALPHA = 8
EXACT_MAX_MEAN_ALPHA = 3


def require_numeric():
    """Optional audit dependencies; importing this module or --help is inert."""
    global np, cv2
    try:
        if np is None:
            import numpy as np
        if cv2 is None:
            import cv2
    except ImportError as error:
        raise RuntimeError('Optional audit dependencies missing; see tools/MEDIA-AUDIT.md') from error


def require_images():
    global Image, ImageDraw, ImageFont
    try:
        if Image is None:
            from PIL import Image, ImageDraw, ImageFont
    except ImportError as error:
        raise RuntimeError('Optional Pillow dependency missing; see tools/MEDIA-AUDIT.md') from error


def staging_dir(value):
    output = Path(value).expanduser()
    if not output.is_absolute():
        output = ROOT / output
    output = output.resolve()
    if ROOT / 'qa' not in output.parents:
        raise RuntimeError('Output must be a staging subdirectory of --root/qa')
    return output


def staging_file(output, name):
    output = staging_dir(output)
    target = output / name
    if target.resolve().parent != output:
        raise RuntimeError('Output file must remain inside its QA staging directory')
    return target


def guard(target=None):
    probe = Path(target if target is not None else OUT).resolve()
    while not probe.exists():
        parent = probe.parent
        if parent == probe:
            raise RuntimeError('No existing audit output filesystem')
        probe = parent
    if shutil.disk_usage(probe).free <= 3 * 1024 ** 3:
        raise RuntimeError('Audit drive free space <= 3GiB; stop without deleting files')


def write_staged(output, name, text):
    output = staging_dir(output)
    target = staging_file(output, name)
    guard(output)
    output.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')


def audit_font(size):
    require_images()
    for candidate in [FONT, 'arial.ttf', 'DejaVuSans.ttf']:
        if candidate:
            try:
                return ImageFont.truetype(str(candidate), size)
            except OSError:
                pass
    return ImageFont.load_default()


def exact_faint_runs(rgba, existing_rects):
    """Clear isolated faint shapes by their pixels, never their whole bbox.

    A curved tail may sit inside the empty portion of a point-cloud bbox.
    Sparse row runs preserve that tail and its full three-pixel buffer.
    Rejected faint fragments become protected, too, until stable.
    """
    require_numeric()
    alpha = rgba[:, :, 3].copy()
    for x, y, w, h in existing_rects:
        alpha[y:y+h, x:x+w] = 0
    count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 0).astype(np.uint8), connectivity=8)
    accepted = np.zeros(count, bool)
    if count > 1:
        main = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        for i in range(1, count):
            if i == main:
                continue
            x, y, w, h, area = map(int, stats[i])
            if w > FAINT_MAX_EXTENT or h > FAINT_MAX_EXTENT or area > FAINT_MAX_AREA:
                continue
            pixels = alpha[y:y+h, x:x+w][labels[y:y+h, x:x+w] == i]
            accepted[i] = pixels.max() <= EXACT_MAX_ALPHA and pixels.mean() <= EXACT_MAX_MEAN_ALPHA
    kernel = np.ones((2 * GUARD_PIXELS + 1, 2 * GUARD_PIXELS + 1), np.uint8)
    while True:
        protected = cv2.dilate(((~accepted[labels]) & (labels > 0)).astype(np.uint8), kernel) > 0
        remaining = accepted.copy()
        for i in np.flatnonzero(accepted):
            x, y, w, h, _ = map(int, stats[i])
            if (protected[y:y+h, x:x+w] & (labels[y:y+h, x:x+w] == i)).any():
                remaining[i] = False
        if np.array_equal(remaining, accepted):
            break
        accepted = remaining
    mask = accepted[labels]
    rects, active = [], {}
    for y, row in enumerate(mask):
        edges = np.flatnonzero(np.diff(np.pad(row.astype(np.int8), (1, 1))))
        next_active = {}
        for x0, x1 in zip(edges[::2], edges[1::2]):
            key = (int(x0), int(x1 - x0))
            if key in active:
                rect = active[key]
                rect[3] += 1
            else:
                rect = [key[0], y, key[1], 1]
                rects.append(rect)
            next_active[key] = rect
        active = next_active
    # Independently prove the compressed rectangles clear exactly and only
    # the selected disconnected positive-alpha pixels.
    cleared = np.zeros(alpha.shape, bool)
    for x, y, w, h in rects:
        cleared[y:y+h, x:x+w] = True
    if not np.array_equal(cleared, mask) or (cleared & protected).any():
        raise RuntimeError('exact faint run compression is unsafe')
    details = []
    for i in np.flatnonzero(accepted):
        x, y, w, h, area = map(int, stats[i])
        pixels = alpha[y:y+h, x:x+w][labels[y:y+h, x:x+w] == i]
        details.append({'bbox': [x, y, w, h], 'area': area,
                        'maxAlpha': int(pixels.max()), 'meanAlpha': round(float(pixels.mean()), 3),
                        'exactRuns': True})
    return rects, details, protected


def inspect(rgba, include_guard=False):
    """Return safe disconnected-point rects and protected-body audit details.

    Include every positive-alpha pixel, not only alpha > 8.  Protect all larger
    foreground components, plus a three-native-pixel buffer.  Also protect any
    small component touching that buffer; ornaments/fingers/hair near the body
    are never cleared.  A proposed rectangle must miss every protected pixel.
    """
    require_numeric()
    alpha = rgba[:, :, 3]
    count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > THRESHOLD).astype(np.uint8), connectivity=8)
    if count <= 1:
        report = {'candidates': 0, 'protectedNearBody': 0, 'components': []}
        if include_guard:
            report['_protected'] = np.zeros(alpha.shape, bool)
        return [], report
    candidate = np.zeros(count, bool)
    for i in range(1, count):
        x, y, w, h, area = stats[i]
        candidate[i] = w <= MAX_EXTENT and h <= MAX_EXTENT and area <= MAX_AREA
        if not candidate[i] and w <= FAINT_MAX_EXTENT and h <= FAINT_MAX_EXTENT and area <= FAINT_MAX_AREA:
            # Larger low-alpha matte clouds are not readable branched flakes.
            # Keep opaque wings/ornaments and actual large snowflake drawings.
            values = alpha[y:y+h, x:x+w][labels[y:y+h, x:x+w] == i]
            candidate[i] = values.max() <= FAINT_MAX_ALPHA and values.mean() <= FAINT_MAX_MEAN_ALPHA
    # Always protect the largest component, even when given an unusual frame.
    candidate[1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])] = False
    protect = (~candidate[labels]) & (labels > 0)
    kernel = np.ones((2 * GUARD_PIXELS + 1, 2 * GUARD_PIXELS + 1), np.uint8)
    protected = cv2.dilate(protect.astype(np.uint8), kernel) > 0
    prelim = np.zeros(count, bool)
    for i in np.flatnonzero(candidate):
        if i == 0:
            continue
        x, y, w, h, _ = map(int, stats[i])
        x0, y0, x1, y1 = max(0, x - 1), max(0, y - 1), min(1280, x + w + 1), min(720, y + h + 1)
        prelim[i] = not protected[y0:y1, x0:x1].any()
    # Rejections become protected as well. Iterate to a fixed point, so even
    # a chain of close fragments cannot cut into a rejected ornament/hair tip.
    accepted = prelim.copy()
    while True:
        protected = cv2.dilate(((~accepted[labels]) & (labels > 0)).astype(np.uint8), kernel) > 0
        remaining = accepted.copy()
        for i in np.flatnonzero(accepted):
            x, y, w, h, _ = map(int, stats[i])
            x0, y0, x1, y1 = max(0, x - 1), max(0, y - 1), min(1280, x + w + 1), min(720, y + h + 1)
            if protected[y0:y1, x0:x1].any():
                remaining[i] = False
        if np.array_equal(remaining, accepted):
            break
        accepted = remaining
    rects, details, near = [], [], 0
    for i in np.flatnonzero(candidate):
        if i == 0:
            continue
        x, y, w, h, area = map(int, stats[i])
        x0, y0, x1, y1 = max(0, x - 1), max(0, y - 1), min(1280, x + w + 1), min(720, y + h + 1)
        close = not accepted[i]
        if close:
            near += 1
            continue
        pixels = rgba[labels == i]
        rect = [x0, y0, x1 - x0, y1 - y0]
        rects.append(rect)
        details.append({'bbox': [x, y, w, h], 'area': area,
                        'maxAlpha': int(pixels[:, 3].max()),
                        'meanAlpha': round(float(pixels[:, 3].mean()), 3),
                        'meanRgb': np.round(pixels[:, :3].mean(axis=0), 1).tolist()})
    exact, exact_details, protected = exact_faint_runs(rgba, rects)
    rects.extend(exact)
    details.extend(exact_details)
    report = {'candidates': len(rects), 'protectedNearBody': near, 'components': details,
              'exactRunRectangles': len(exact), 'exactFaintComponents': len(exact_details)}
    if include_guard:
        report['_protected'] = protected
    return rects, report


def scan_action(row, asset_root, sheet_samples, source_path=None):
    guard()
    require_numeric()
    name = row['name']
    path = Path(source_path) if source_path is not None else asset_root / f'{name}.webm'
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != row['webmSha256']:
        raise RuntimeError(name + ' inventory hash mismatch')
    reader = subprocess.Popen([FFMPEG, '-hide_banner', '-loglevel', 'error', '-c:v', 'libvpx-vp9',
                               '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    frames, stats = [], []
    best, best_score = None, -1
    for frame in range(row['encodedFrames']):
        if frame % 48 == 0:
            guard()
        raw = reader.stdout.read(1280 * 720 * 4)
        if len(raw) != 1280 * 720 * 4:
            raise RuntimeError(f'{name} partial frame {frame}')
        rgba = np.frombuffer(raw, np.uint8).reshape(720, 1280, 4)
        rects, report = inspect(rgba, include_guard=True)
        # Verify the actual union of rectangles against the independently
        # materialized protected foreground/buffer on every decoded frame.
        protected = report.pop('_protected')
        cleared = np.zeros(protected.shape, bool)
        for x, y, w, h in rects:
            cleared[y:y+h, x:x+w] = True
        intersections = int(np.count_nonzero(cleared & protected))
        if intersections:
            raise RuntimeError(f'{name} F{frame}: cleanup touches {intersections} protected pixels')
        report['protectedBodyIntersections'] = intersections
        report['clearedPositiveAlphaPixels'] = int(np.count_nonzero(cleared & (rgba[:, :, 3] > 0)))
        details = report.pop('components')
        report['maxAlpha'] = max((c['maxAlpha'] for c in details), default=0)
        report['maxArea'] = max((c['area'] for c in details), default=0)
        report['largerFaintCount'] = sum(max(c['bbox'][2:]) > MAX_EXTENT for c in details)
        frames.append(rects or None)
        report['frame'] = frame
        stats.append(report)
        # Keep just one representative native frame per action in memory.
        score = sum(c['area'] * c['maxAlpha'] for c in details)
        if score > best_score:
            best, best_score = (frame, rgba.copy(), rects), score
    if reader.stdout.read(1):
        raise RuntimeError(name + ' extra frame')
    reader.stdout.close()
    errors = reader.stderr.read().decode(errors='replace')
    if reader.wait():
        raise RuntimeError(errors)
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise RuntimeError(name + ' media changed during scan')
    # Every accepted rectangle missed all protected pixels plus their buffer.
    sheet_samples.append((name, *best))
    return {'sha256': digest, 'width': 1280, 'height': 720, 'fps': row['fps'],
            'frameCount': row['encodedFrames'], 'rects': frames}, {
                'name': name, 'sha256': digest, 'frames': len(frames),
                'rectangles': sum(len(r or []) for r in frames),
                'affectedFrames': sum(bool(r) for r in frames),
                'protectedBodyIntersections': sum(r['protectedBodyIntersections'] for r in stats), 'perFrame': stats}


def make_sheet(samples, out):
    out = staging_dir(out)
    guard(out)
    font = audit_font(14)
    sheet = Image.new('RGB', (420 * 4, 280 * 5), '#f9f7fc')
    draw = ImageDraw.Draw(sheet)
    for n, (name, frame, rgba, rects) in enumerate(samples):
        # Both original and cleared at a 200px character height. No scale warp.
        after = rgba.copy()
        for x, y, w, h in rects:
            after[y:y+h, x:x+w] = 0
        variants = []
        for pixels in [rgba, after]:
            base = Image.new('RGBA', (1280, 720), '#292532')
            base.alpha_composite(Image.fromarray(pixels))
            # Native body ROI leaves effects and character visible together.
            variants.append(base.convert('RGB').crop((350, 120, 950, 720)).resize((240, 240), Image.Resampling.LANCZOS))
        x, y = (n % 4) * 420, (n // 4) * 280
        # Side-by-side central 200px each, labeled raw / cleared.
        sheet.paste(variants[0].crop((20, 0, 220, 240)), (x, y + 32))
        sheet.paste(variants[1].crop((20, 0, 220, 240)), (x + 210, y + 32))
        draw.text((x + 2, y + 2), f'{name} F{frame}: {len(rects)} points', font=font, fill='#342d40')
        draw.text((x + 2, y + 17), 'raw                            cleared', font=font, fill='#342d40')
    guard(out)
    sheet.save(staging_file(out, 'actions-small-point-removal.png'))


def rescan_merge(plan_path, output_override=None):
    """Reaudit changed candidates, preserve audited rows, emit to QA staging only.

    Plan: {seedData, seedAudit, outputDir, changes:[{name,path,sha256,fps,frameCount}]}.
    Optional inventory points at the current accepted asset inventory.
    The output runtime is never copied to either application's installed files.
    """
    guard()
    plan = json.loads(Path(plan_path).read_text(encoding='utf-8-sig'))
    data = json.loads(Path(plan['seedData']).read_text(encoding='utf-8'))
    previous = json.loads(Path(plan['seedAudit']).read_text(encoding='utf-8'))
    inventory = Path(plan.get('inventory', ROOT / 'reports' / 'windows-assets.json'))
    rows = {row['name']: row for row in json.loads(inventory.read_text(encoding='utf-8'))['animations']}
    if data['schema'] != 'shuangling-gpt/frost-cleanup-v1' or set(data['actions']) != set(rows):
        raise RuntimeError('seed must contain every current animation')
    reports = {row['name']: row for row in previous['actions']}
    if set(reports) != set(rows):
        raise RuntimeError('seed audit must cover every animation')
    changes = plan['changes']
    names = [row['name'] for row in changes]
    if len(set(names)) != len(names) or not set(names).issubset({'running-right', 'drag-lift', 'drag-hover', 'drag-lower'}):
        raise RuntimeError('only unique reviewed right-run/drag candidates may be merged')
    output = staging_dir(output_override or plan.get('outputDir', OUT))
    guard(output)
    # The thirteen unchanged bindings still point to their actual audited
    # source bytes; also require the per-frame measured intersection evidence.
    for name, row in rows.items():
        if name in names:
            continue
        binding, report = data['actions'][name], reports[name]
        digest = hashlib.sha256((ROOT / row['source']).read_bytes()).hexdigest()
        if digest != binding['sha256'] or digest != row['webmSha256']:
            raise RuntimeError(name + ' unchanged source is no longer the audited bytes')
        if len(report['perFrame']) != binding['frameCount'] or any(frame.get('protectedBodyIntersections') != 0 for frame in report['perFrame']):
            raise RuntimeError(name + ' missing real per-frame protected-foreground evidence')
    samples = []
    for change in changes:
        name = change['name']
        row = {'name': name, 'webmSha256': change['sha256'], 'fps': change.get('fps', 24), 'encodedFrames': change['frameCount']}
        binding, report = scan_action(row, None, samples, change['path'])
        data['actions'][name], reports[name] = binding, report
        print(f'{name}: candidate verified across {binding["frameCount"]} native frames', flush=True)
    # Preserve deterministic ordering and prove all rows share the exact
    # audit frame count before generating a paint-time runtime.
    data['actions'] = {name: data['actions'][name] for name in rows}
    summary = {'allProtectedBodyIntersections': sum(row['protectedBodyIntersections'] for row in reports.values()),
               'totalFrames': sum(row['frames'] for row in reports.values()),
               'totalRectangles': sum(row['rectangles'] for row in reports.values()),
               'changedAnimations': names, 'actions': [reports[name] for name in rows]}
    if summary['allProtectedBodyIntersections']:
        raise RuntimeError('unsafe cleanup audit')
    raw = json.dumps(data, separators=(',', ':'))
    runtime = (ROOT / 'tools' / 'frost-cleanup-runtime-template.js').read_text(encoding='utf-8').replace('__FROST_CLEANUP_DATA__', raw)
    if len(runtime.encode('utf-8')) > 1024 * 1024:
        raise RuntimeError('unexpected cleanup runtime size')
    guard()
    output.mkdir(parents=True, exist_ok=True)
    write_staged(output, 'large-only-cleanup-data.json', raw)
    write_staged(output, 'large-only-audit.json', json.dumps(summary, indent=2))
    write_staged(output, 'shuangling-frost-cleanup.js', runtime)
    make_sheet(samples, output)
    print(json.dumps({k: v for k, v in summary.items() if k != 'actions'}), flush=True)
    return output


def main():
    global ROOT, OUT, FFMPEG, FONT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT, help='Source checkout; SHUANGLING_AUDIT_ROOT overrides the default')
    parser.add_argument('--assets', type=Path, help='Asset directory, default: ROOT/windows/assets/shuangling')
    parser.add_argument('--inventory', type=Path, help='Inventory JSON, default: ROOT/reports/windows-assets.json')
    parser.add_argument('--output', type=Path, default=os.environ.get('SHUANGLING_AUDIT_OUTPUT'), help='QA staging directory under ROOT/qa')
    parser.add_argument('--ffmpeg', default=FFMPEG, help='FFmpeg executable; SHUANGLING_FFMPEG or PATH')
    parser.add_argument('--font', default=FONT, help='Optional TrueType font; defaults to a portable fallback')
    parser.add_argument('--only', nargs='*')
    parser.add_argument('--merge-plan', type=Path)
    args = parser.parse_args()
    ROOT = args.root.expanduser().resolve()
    if not ROOT.is_dir():
        parser.error('--root must be an existing source directory')
    output_override = args.output
    OUT = staging_dir(args.output or ROOT / 'qa' / 'media-audit' / 'large-only')
    FFMPEG = shutil.which(str(args.ffmpeg))
    if not FFMPEG:
        parser.error('FFmpeg not found; pass --ffmpeg or set SHUANGLING_FFMPEG')
    FONT = args.font
    args.assets = args.assets or ROOT / 'windows' / 'assets' / 'shuangling'
    args.inventory = args.inventory or ROOT / 'reports' / 'windows-assets.json'
    args.output = OUT
    if args.merge_plan:
        rescan_merge(args.merge_plan, output_override)
        return
    guard()
    args.output.mkdir(parents=True, exist_ok=True)
    rows = json.loads(args.inventory.read_text(encoding='utf-8'))['animations']
    if args.only:
        rows = [r for r in rows if r['name'] in args.only]
    actions, reports, samples = {}, [], []
    for row in rows:
        binding, report = scan_action(row, args.assets, samples)
        actions[row['name']] = binding
        reports.append(report)
        print(f"{row['name']}: {report['frames']} frames, {report['rectangles']} detached points, 0 protected-body intersections", flush=True)
    data = {'schema': 'shuangling-gpt/frost-cleanup-v1', 'thresholds': {
        'alphaComponent': THRESHOLD, 'mainProtectionPixels': GUARD_PIXELS,
        'bboxExtraSafetyPixels': 1, 'maxExtent': MAX_EXTENT, 'maxArea': MAX_AREA,
        'faintMatteMaxExtent': FAINT_MAX_EXTENT, 'faintMatteMaxArea': FAINT_MAX_AREA,
        'faintMatteMaxAlpha': FAINT_MAX_ALPHA, 'faintMatteMaxMeanAlpha': FAINT_MAX_MEAN_ALPHA,
        'exactFaintMaxAlpha': EXACT_MAX_ALPHA, 'exactFaintMaxMeanAlpha': EXACT_MAX_MEAN_ALPHA,
        'exactFaintMask': 'positive-alpha disconnected components, exact row runs, full protected-foreground 3px buffer',
        'colorIndependent': True, 'opacityIndependent': True}, 'actions': actions}
    write_staged(args.output, 'large-only-cleanup-data.json', json.dumps(data, separators=(',', ':')))
    summary = {'allProtectedBodyIntersections': sum(r['protectedBodyIntersections'] for r in reports), 'totalFrames': sum(r['frames'] for r in reports),
               'totalRectangles': sum(r['rectangles'] for r in reports), 'actions': reports}
    write_staged(args.output, 'large-only-audit.json', json.dumps(summary, indent=2))
    make_sheet(samples, args.output)
    print(json.dumps({k: v for k, v in summary.items() if k != 'actions'}), flush=True)


if __name__ == '__main__':
    main()
