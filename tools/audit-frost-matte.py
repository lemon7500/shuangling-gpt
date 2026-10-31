"""Read-only RGBA audit of disconnected small, translucent cool-colored matte debris."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess

ROOT=Path(os.environ.get('SHUANGLING_AUDIT_ROOT',Path(__file__).resolve().parents[1])).expanduser().resolve()
OUT=Path(os.environ.get('SHUANGLING_AUDIT_OUTPUT',ROOT/'qa'/'media-audit'/'matte'))
ASSETS=ROOT/'windows'/'assets'/'shuangling'
INVENTORY=ROOT/'reports'/'windows-assets.json'
FFMPEG=os.environ.get('SHUANGLING_FFMPEG') or 'ffmpeg'
FONT=os.environ.get('SHUANGLING_AUDIT_FONT')
np=Image=ImageDraw=ImageFont=ImageFilter=None


def require_dependencies():
    global np,Image,ImageDraw,ImageFont,ImageFilter
    try:
        if np is None:
            import numpy as np
        if Image is None:
            from PIL import Image,ImageDraw,ImageFont,ImageFilter
    except ImportError as error:
        raise RuntimeError('Optional audit dependencies missing; see tools/MEDIA-AUDIT.md') from error


def staging_dir(value):
    output=Path(value).expanduser()
    if not output.is_absolute():output=ROOT/output
    output=output.resolve()
    if ROOT/'qa' not in output.parents:
        raise RuntimeError('Output must be a staging subdirectory of --root/qa')
    return output


def staging_file(output,name):
    output=staging_dir(output)
    target=output/name
    if target.resolve().parent!=output:
        raise RuntimeError('Output file must remain inside its QA staging directory')
    return target


def disk_guard(target=None):
    probe=Path(target if target is not None else OUT).resolve()
    while not probe.exists():
        parent=probe.parent
        if parent==probe:raise RuntimeError('No existing audit output filesystem')
        probe=parent
    if shutil.disk_usage(probe).free<=3*1024**3:
        raise RuntimeError('Audit drive free space <= 3GiB; stop without deleting files')


def write_staged(name,text):
    output=staging_dir(OUT)
    target=staging_file(output,name)
    disk_guard(output)
    output.mkdir(exist_ok=True,parents=True)
    target.write_text(text,encoding='utf-8')


def audit_font(size):
    require_dependencies()
    for candidate in [FONT,'arial.ttf','DejaVuSans.ttf']:
        if candidate:
            try:return ImageFont.truetype(str(candidate),size)
            except OSError:pass
    return ImageFont.load_default()

def components(mask):
    """8-connected components, encoded as horizontal runs; no third-party CV dependency."""
    require_dependencies()
    runs=[];parent=[];previous=[]
    def find(i):
        while parent[i]!=i:
            parent[i]=parent[parent[i]];i=parent[i]
        return i
    for y,row in enumerate(mask):
        boundaries=np.flatnonzero(np.diff(np.pad(row.astype(np.int8),(1,1))))
        current=[];p=0
        for x0,x1 in zip(boundaries[::2],boundaries[1::2]):
            i=len(parent);parent.append(i);runs.append((y,int(x0),int(x1)));current.append(i)
            while p<len(previous) and runs[previous[p]][2]<x0:p+=1
            q=p
            while q<len(previous) and runs[previous[q]][1]<=x1:
                a=find(i);b=find(previous[q])
                if a!=b:parent[b]=a
                q+=1
        previous=current
    groups={}
    for i,run in enumerate(runs):groups.setdefault(find(i),[]).append(run)
    return list(groups.values())

def inspect(rgba,include_runs=False):
    require_dependencies()
    alpha=rgba[:,:,3];groups=components(alpha>8)
    if not groups:return [],[]
    main=max(groups,key=lambda group:sum(x1-x0 for y,x0,x1 in group))
    mainmask=np.zeros(alpha.shape,np.uint8)
    for y,x0,x1 in main:mainmask[y,x0:x1]=255
    protected=np.asarray(Image.fromarray(mainmask).filter(ImageFilter.MaxFilter(7)))>0
    result=[];rects=[]
    for group in groups:
        if group is main:continue
        area=sum(x1-x0 for y,x0,x1 in group)
        x0=min(r[1] for r in group);x1=max(r[2] for r in group);y0=group[0][0];y1=group[-1][0]+1
        pixels=np.concatenate([rgba[y,a:b] for y,a,b in group])
        mean=pixels.mean(axis=0);maximum=int(pixels[:,3].max())
        weight=pixels[:,3].astype(float)
        color=np.average(pixels[:,:3],axis=0,weights=weight)
        close=bool(protected[max(0,y0-1):min(alpha.shape[0],y1+1),max(0,x0-1):min(alpha.shape[1],x1+1)].any())
        cool=bool(color[2]>color[0]*1.06 and color[2]>color[1]*1.06)
        candidate=not close and x1-x0<=24 and y1-y0<=24 and area<=256 and maximum<=180 and mean[3]<=96 and cool
        row={'bbox':[x0,y0,x1-x0,y1-y0],'area':int(area),'maxAlpha':maximum,
            'meanAlpha':round(float(mean[3]),2),'weightedRgb':[round(float(v),1) for v in color],
            'nearProtectedBody':close,'coolBluePurple':cool,'candidate':bool(candidate)}
        if include_runs:row['_runs']=group
        result.append(row)
        if candidate:rects.append([max(0,x0-1),max(0,y0-1),min(alpha.shape[1],x1+1)-max(0,x0-1),min(alpha.shape[0],y1+1)-max(0,y0-1)])
    return result,rects

def scan_action(row,asset_root=None,ffmpeg=None,output=None):
    require_dependencies()
    name=row['name'];path=Path(asset_root or ASSETS)/f'{name}.webm'
    disk_guard(output);digest=hashlib.sha256(path.read_bytes()).hexdigest()
    if digest!=row['webmSha256']:raise RuntimeError(f'{name} inventory hash mismatch')
    reader=decode(path,ffmpeg=ffmpeg);frames=[];removed=0;frame_stats=[]
    for n in range(row['encodedFrames']):
        if n%48==0:disk_guard(output)
        raw=reader.stdout.read(1280*720*4)
        if len(raw)!=1280*720*4:raise RuntimeError(f'{name} F{n} partial raw frame')
        rgba=np.frombuffer(raw,np.uint8).reshape(720,1280,4)
        details,proposed=inspect(rgba,include_runs=True)
        alpha=rgba[:,:,3]
        # Protect every non-candidate foreground component, including detached
        # hair ornaments; the largest component is not the sole protected body.
        protected=(alpha>8).astype(np.uint8)*255
        for entry in details:
            if not entry['candidate']:continue
            for y,x0,x1 in entry['_runs']:protected[y,x0:x1]=0
        protected=np.asarray(Image.fromarray(protected).filter(ImageFilter.MaxFilter(7)))>0
        rects=[];accepted=[]
        for entry,rect in zip([d for d in details if d['candidate']],proposed):
            x,y,w,h=rect
            if protected[y:y+h,x:x+w].any():continue
            rects.append(rect);accepted.append(entry)
        frames.append(rects or None);removed+=len(rects)
        frame_stats.append({'frame':n,'rectCount':len(rects),'maxAlpha':max([d['maxAlpha'] for d in accepted],default=0),
            'maxMeanAlpha':max([d['meanAlpha'] for d in accepted],default=0),
            'maxArea':max([d['area'] for d in accepted],default=0)})
    if reader.stdout.read(1):raise RuntimeError(f'{name} unexpected extra frame')
    reader.stdout.close();errors=reader.stderr.read().decode(errors='replace')
    if reader.wait():raise RuntimeError(errors)
    if hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise RuntimeError(f'{name} media changed during scan')
    binding={'sha256':digest,'width':1280,'height':720,'fps':row['fps'],'frameCount':row['encodedFrames'],'rects':frames}
    return name,binding,{'name':name,'sha256':digest,'frames':len(frames),'rectangles':removed,
        'affectedFrames':sum(bool(r) for r in frames),'perFrame':frame_stats}

def full_scan():
    from concurrent.futures import ProcessPoolExecutor, as_completed
    disk_guard();OUT.mkdir(exist_ok=True,parents=True)
    rows=json.loads(INVENTORY.read_text(encoding='utf-8'))['animations']
    bindings={};stats=[]
    with ProcessPoolExecutor(max_workers=3) as pool:
        # Windows workers import a fresh module, so explicitly pass CLI values.
        jobs=[pool.submit(scan_action,row,ASSETS,FFMPEG,OUT) for row in rows]
        for task in as_completed(jobs):
            name,binding,report=task.result();bindings[name]=binding;stats.append(report)
            print(f'{name}: {report["frames"]} frames / {report["rectangles"]} safe rectangles',flush=True)
    data={'schema':'shuangling-gpt/frost-cleanup-v1','thresholds':{'alphaComponent':8,'mainProtectionPixels':3,
        'bboxExtraSafetyPixels':1,'maxExtent':24,'maxArea':256,'maxAlpha':180,'maxMeanAlpha':96,'coolColorRatio':1.06},
        'actions':{name:bindings[name] for name in sorted(bindings)}}
    write_staged('all-frame-cleanup-data.json',json.dumps(data,separators=(',',':')))
    report={'schema':data['schema'],'allRectanglesProtectedBodyIntersection':0,
        'totalFrames':sum(s['frames'] for s in stats),'totalRectangles':sum(s['rectangles'] for s in stats),
        'actions':sorted(stats,key=lambda s:s['name'])}
    write_staged('all-frame-cleanup-audit.json',json.dumps(report,indent=2))
    print(json.dumps({'frames':report['totalFrames'],'rectangles':report['totalRectangles'],
        'dataBytes':(OUT/'all-frame-cleanup-data.json').stat().st_size}),flush=True)
    emit_runtime()

def emit_runtime():
    disk_guard()
    raw=(OUT/'all-frame-cleanup-data.json').read_text(encoding='utf-8')
    data=json.loads(raw)
    if data['schema']!='shuangling-gpt/frost-cleanup-v1':raise RuntimeError('unknown cleanup data')
    template=(ROOT/'tools'/'frost-cleanup-runtime-template.js').read_text(encoding='utf-8')
    runtime=template.replace('__FROST_CLEANUP_DATA__',raw)
    if len(runtime.encode('utf-8'))>1024*1024:raise RuntimeError('unexpected cleanup data size')
    write_staged('shuangling-frost-cleanup.js',runtime)
    print(json.dumps({'runtimeBytes':len(runtime.encode('utf-8')),'stagedOnly':True,
        'runtimeFile':str(staging_dir(OUT)/'shuangling-frost-cleanup.js')}),flush=True)

def decode(path,indices=None,ffmpeg=None):
    args=[str(ffmpeg or FFMPEG),'-hide_banner','-loglevel','error','-c:v','libvpx-vp9','-i',str(path)]
    if indices is not None:args+=['-vf','select='+ '+'.join(f'eq(n\\,{i})' for i in indices),'-fps_mode','passthrough']
    args+=['-f','rawvideo','-pix_fmt','rgba','pipe:1']
    return subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)

def sampled():
    disk_guard();OUT.mkdir(exist_ok=True,parents=True)
    require_dependencies()
    rows=json.loads(INVENTORY.read_text(encoding='utf-8'))['animations']
    report={'threshold':{'alphaComponent':8,'mainProtectionPixels':3,'bboxExtraSafetyPixels':1,'maxExtent':24,'maxArea':256,'maxAlpha':180,'maxMeanAlpha':96,'coolColorRatio':1.06},'actions':[]}
    tiles=[];font=audit_font(13)
    for row in rows:
        disk_guard();name=row['name'];path=ASSETS/f'{name}.webm'
        count=row['encodedFrames'];indices=sorted(set(round((count-1)*t) for t in [0,.25,.5,.75,1]))
        reader=decode(path,indices);frames=[];action={'name':name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'samples':[]}
        for n in indices:
            raw=reader.stdout.read(1280*720*4)
            if len(raw)!=1280*720*4:raise RuntimeError(f'{name} short frame')
            rgba=np.frombuffer(raw,np.uint8).reshape(720,1280,4)
            details,rects=inspect(rgba);frames.append((n,rgba,details,rects))
            action['samples'].append({'frame':n,'components':details,'candidateCount':len(rects)})
        reader.stdout.close();errors=reader.stderr.read().decode(errors='replace')
        if reader.wait():raise RuntimeError(errors)
        # Show one native 280x280 crop around the most obvious disconnected point.
        n,rgba,details,rects=max(frames,key=lambda f:len(f[3]))
        candidates=[d for d in details if d['candidate']]
        if candidates:
            chosen=max(candidates,key=lambda c:c['maxAlpha']*c['area'])
            x,y,w,h=chosen['bbox'];cx=x+w//2;cy=y+h//2
        else:cx,cy=640,400
        left=max(0,min(1280-280,cx-140));top=max(0,min(720-280,cy-140))
        base=Image.new('RGBA',(1280,720),'#262431');base.alpha_composite(Image.fromarray(rgba))
        tile=base.convert('RGB').crop((left,top,left+280,top+280));d=ImageDraw.Draw(tile)
        for x,y,w,h in rects:d.rectangle((x-left-2,y-top-2,x+w-left+2,y+h-top+2),outline='#ffcc56',width=1)
        tiles.append((name,n,len(rects),tile));report['actions'].append(action)
        print(f'{name}: sampled {len(indices)}; candidates {sum(s["candidateCount"] for s in action["samples"])}',flush=True)
    sheet=Image.new('RGB',(280*6,310*3),'#f9f7fc')
    for i,(name,n,count,tile) in enumerate(tiles):
        x=(i%6)*280;y=(i//6)*310;sheet.paste(tile,(x,y+30));ImageDraw.Draw(sheet).text((x+3,y+3),f'{name} F{n} / {count} candidates',font=font,fill='#342d40')
    disk_guard()
    sheet.save(staging_file(OUT,'actions-matte-points-audit.png'))
    write_staged('sample-audit.json',json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'actions':len(rows),'sampleFrames':sum(len(a['samples']) for a in report['actions']),
        'candidates':sum(s['candidateCount'] for a in report['actions'] for s in a['samples'])}),flush=True)

def main():
    global ROOT,OUT,ASSETS,INVENTORY,FFMPEG,FONT
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=ROOT,help='Source checkout; SHUANGLING_AUDIT_ROOT overrides the default')
    parser.add_argument('--assets',type=Path,help='Asset directory, default: ROOT/windows/assets/shuangling')
    parser.add_argument('--inventory',type=Path,help='Inventory JSON, default: ROOT/reports/windows-assets.json')
    parser.add_argument('--output',type=Path,default=os.environ.get('SHUANGLING_AUDIT_OUTPUT'),help='QA staging directory under ROOT/qa')
    parser.add_argument('--ffmpeg',default=FFMPEG,help='FFmpeg executable; SHUANGLING_FFMPEG or PATH')
    parser.add_argument('--font',default=FONT,help='Optional TrueType font; defaults to a portable fallback')
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--full',action='store_true',help='Audit all native frames and emit a staging runtime')
    mode.add_argument('--emit',action='store_true',help='Emit a staging runtime from existing audit JSON; never installs it')
    args=parser.parse_args()
    ROOT=args.root.expanduser().resolve()
    if not ROOT.is_dir():parser.error('--root must be an existing source directory')
    OUT=staging_dir(args.output or ROOT/'qa'/'media-audit'/'matte')
    ASSETS=args.assets or ROOT/'windows'/'assets'/'shuangling'
    INVENTORY=args.inventory or ROOT/'reports'/'windows-assets.json'
    FONT=args.font
    if not args.emit:
        FFMPEG=shutil.which(str(args.ffmpeg))
        if not FFMPEG:parser.error('FFmpeg not found; pass --ffmpeg or set SHUANGLING_FFMPEG')
    disk_guard()
    full_scan() if args.full else emit_runtime() if args.emit else sampled()


if __name__=='__main__':
    main()
