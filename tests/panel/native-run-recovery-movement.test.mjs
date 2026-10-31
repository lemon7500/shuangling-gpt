import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js',import.meta.url),'utf8');
const base='file:///reviewed/';
function fixture(name='running-right', policyCapability=true) {
  const frames=new Map(),offers=[];let seq=0;
  const [count,start,end,mid,dir]=name==='running-left'?[124,20,95,70,-1]:[241,64,188,140,1];
  const context=vm.createContext({SHUANGLING_PROFILE:true,VIEW:{w:1920,h:1080},
    requestAnimationFrame(f){const id=++seq;frames.set(id,f);return id},cancelAnimationFrame(id){frames.delete(id)},
    window:{setTimeout(){return 1},clearTimeout(){},__dshPetDebug:{}},
    S:{ANIMATION_EXT:'.webm',isNoMirrorAnimation(){return false}},console});
  if(policyCapability)context.ShuanglingHandoff={policies:{idle:{}}};
  vm.runInContext(source+';this.proto=PetSprite.prototype',context);
  const decoder=(anim)=>({style:{},classList:{add(){},remove(){}},readyState:4,seeking:false,error:null,
    videoWidth:1280,videoHeight:720,
    paused:false,ended:false,loop:false,currentTime:0,duration:count/24,petPlaybackGeneration:1,petPaintedGeneration:1,petPaintedMediaTime:0,
    petAnimationSource:base+anim+'.webm',petPreloadedSource:base+anim+'.webm',pause(){this.paused=true},play(){this.paused=false;return Promise.resolve()},
    addEventListener(){},removeEventListener(){},load(){}});
  const el=decoder(name),p=Object.assign(Object.create(context.proto),{
    assetBase:base,front:0,videoA:el,videoB:decoder('idle'),videoSurface:{style:{}},gen:1,
    pending:null,idlePreload:null,moveRef:null,moveToken:0,pendingSquash:false,squashRef:null,
    displayedAnim:name,displayedOnce:true,playback:null,dragState:{active:false,dragging:false},throwRef:null,
    halfW:169.5,halfH:95.34,pos:{x:790.5,y:768.66},points:[],
    pendingMove:{name,startRatio:.5,startYRatio:.8,targetRatio:.5+dir*.15,dir,totalRatio:.15,leadSec:start/24,endSec:end/24,authoredMove:true},
    animations:{moves:{actions:[]},categories:[],idle:['idle']},
    stopPosFollow(){},sendBounds(x,y){this.pos={x,y};this.points.push(x)},
    closeMenu(){},stopThrow(){},clearManualAction(){},paintVideoFrame(){},startVideoPaint(){},preloadIdleFrame(){},
    handoff:{request(tx,commit){offers.push({tx,commit})},cancel(){},onCommit(){},capture(){}},
  });
  p.startMoveDrive(el);
  const frame=n=>{el.petPaintedMediaTime=n/24;const q=[...frames.values()];frames.clear();for(const f of q)f()};
  for(let n=0;n<=mid;n++)frame(n);
  return {p,el,frame,offers,frames,count,end,mid,dir,nativePaint:context.proto.paintVideoFrame};
}

test('manual non-run preparation preserves the genuine outgoing gait movement until its safe commit',()=>{
  for(const name of ['running-left','running-right']){
  const f=fixture(name),before=f.p.pos.x;
  f.p.onMenuAction({anim:'idle'});
  assert.equal(f.p.pending.preserveRunMovement,true);
  assert.equal(f.p.displayedAnim,name);
  f.frame(f.mid+1);assert.ok((f.p.pos.x-before)*f.dir>0,'preparation must not freeze a still-running forward recovery');
  for(let n=f.mid+2;n<=f.end;n++)f.frame(n);
  assert.equal(f.p.pos.x,(.5+f.dir*.15)*1920-169.5,'the real gait reaches its eased landing before recovery finishes');
  const landed=f.p.pos.x;for(let n=f.end+1;n<f.count;n++)f.frame(n);
  assert.equal(f.p.pos.x,landed,'turning back to front must not keep moving the window');
  f.offers[0].commit();
  assert.equal(f.p.displayedAnim,'idle');assert.equal(f.p.moveRef,null);assert.equal(f.frames.size,0);
  }
});

test('automatic local smooth recovery preserves movement, while arbitrary media and drag entry stop immediately',()=>{
  const f=fixture(),before=f.p.pos.x;f.p.switchTo('idle',true);
  assert.equal(f.p.pending.preserveRunMovement,true);f.frame(141);assert.ok(f.p.pos.x>before);
  const unavailable=fixture('running-right',false);unavailable.p.switchTo('idle',true);
  assert.equal(unavailable.p.moveRef,null,'a missing local pose-gate capability keeps its immediate upstream semantics');
  for(const [next,url,manual] of [['idle','https://example.invalid/custom.webm',true],['drag-lift',undefined,true],['running-left',undefined,true]]){
    const g=fixture();g.p.switchTo(next,true,null,url,manual);assert.equal(g.p.moveRef,null,next);
    assert.equal(g.p.pending?.preserveRunMovement,false,next);
  }
});

test('reverse recovery, drag, or stale generations still stop retained outgoing movement immediately',()=>{
  for(const reason of ['reverse','drag','generation']){
    const f=fixture();f.p.switchTo('idle',true,null,undefined,true);const atClick=f.p.pos.x;
    if(reason==='reverse')f.p.stopMove();
    else if(reason==='drag')f.p.dragState.active=true;
    else f.el.petPlaybackGeneration++;
    for(let n=141;n<=188;n++)f.frame(n);
    assert.equal(f.p.pos.x,atClick,reason);assert.equal(f.p.moveRef,null,reason);
  }
});

test('real outgoing paint retains its decoder generation while a newer successor is being prepared',()=>{
  const f=fixture();f.p.switchTo('idle',true,null,undefined,true);
  assert.equal(f.p.gen,2);assert.equal(f.el.petPlaybackGeneration,1);
  f.p.videoSurface={width:1280,height:720,getContext(){return {drawImage(){}}}};
  const atClick=f.p.pos.x;
  f.nativePaint.call(f.p,f.el,141/24);
  assert.equal(f.el.petPaintedGeneration,1,'preparing gen2 must not relabel a real gen1 frame');
  f.frame(141);assert.ok(f.p.pos.x>atClick);
  f.nativePaint.call(f.p,f.p.videoB,0,2);
  assert.equal(f.p.videoB.petPaintedGeneration,2,'paused incoming F0 explicitly belongs to its pending generation');
});
