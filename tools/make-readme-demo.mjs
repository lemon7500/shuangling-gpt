// A documentation preview assembled from the deployed WebM clips; no new art.
// Requires FFmpeg with libvpx-vp9 and palettegen/paletteuse. Set FFMPEG if it is
// not on PATH. The running desktop pet and original media are never changed.
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const ffmpeg=process.env.FFMPEG || 'ffmpeg';
const sources=['idle','waving','running'];
const directory=join(root,'docs','media');
await mkdir(directory,{recursive:true});
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
// Separate previews preserve each existing loop without inventing transitions
// between the idle source and the other actions' different neutral texture.
const outputNames=['shuangling-demo.gif','shuangling-wave.gif','shuangling-thinking.gif'];
const outputs=[];
for(let index=0;index<sources.length;index++) {
  const name=sources[index],file=outputNames[index],output=join(directory,file);
  const source=join(root,'windows','assets','shuangling',name+'.webm');
  const sourceHash=await hash(source);
  const filter='[0:v]crop=538:592:368:104,scale=320:352:flags=lanczos,setsar=1,format=rgba,setpts=PTS-STARTPTS[p];'+
    'color=c=0xEDE8F5:s=368x400:r=24[bg];'+
    '[bg][p]overlay=24:24:shortest=1:format=auto,format=rgb24,split[pixels][palette];'+
    '[palette]palettegen=max_colors=128:stats_mode=diff[colors];'+
    '[pixels][colors]paletteuse=dither=bayer:bayer_scale=4[out]';
  const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-c:v','libvpx-vp9','-i',source,'-filter_complex',filter,'-map','[out]','-an','-loop','0',output],
    {windowsHide:true,stdio:['ignore','inherit','inherit'],timeout:180000});
  if(result.error||result.status!==0)throw Error('readme-demo-encoding-failed');
  if(await hash(source)!==sourceHash)throw Error('source-media-changed');
  outputs.push({file:`docs/media/${file}`,source:`windows/assets/shuangling/${name}.webm`,sourceSha256:sourceHash,bytes:(await stat(output)).size,sha256:await hash(output)});
}
const report={format:'gif',size:[368,400],sourceFps:24,speed:'original',loop:true,
  processing:'Separate complete existing loops, common safe crop, proportional downscale, lavender alpha composition, per-clip GIF palette. No generated poses, interpolation, speed changes or cross-fades.',
  animationGenerationRequests:0,originalMediaModified:false,totalBytes:outputs.reduce((sum,item)=>sum+item.bytes,0),outputs};
await writeFile(join(directory,'animation-preview.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
