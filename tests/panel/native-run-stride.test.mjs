import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js',import.meta.url),'utf8');
const left={startMs:500,accelUntilMs:1000,decelerateFromMs:3500,endMs:95/24*1000};
function fixture(timing=left,{authoredMove=true,dir=-1}={}) {
  let seq=0;const frames=new Map(),points=[];
  const context=vm.createContext({SHUANGLING_PROFILE:true,VIEW:{w:1920,h:1080},AREAS:[],
    ShuanglingMotion:{movement:{byAnimation:{'running-left':timing}}},
    S:{PET_REF_WIDTH:420,planMove(){return {startRatio:.5,startYRatio:.8,targetRatio:.5+dir*.15,dir,totalRatio:.15}}},
    requestAnimationFrame(f){const id=++seq;frames.set(id,f);return id},cancelAnimationFrame(id){frames.delete(id)},
    window:{__dshPetDebug:{}},console});
  vm.runInContext(source+';this.proto=PetSprite.prototype',context);
  const el={duration:124/24,currentTime:0,petPlaybackGeneration:1,petPaintedGeneration:1,petPaintedMediaTime:0};
  const p=Object.assign(Object.create(context.proto),{
    videoA:el,videoB:{},front:0,moveRef:null,moveToken:0,pendingMove:null,pending:null,throwRef:null,
    dragState:{active:false,dragging:false},displayedAnim:'running-left',halfW:169.5,halfH:95.34,
    size:420,sideAllow:80,currentCenterX:()=>960,currentCenterY:()=>864,
    _facing:'left',setFacing(){},switchTo(){},
    animations:{moves:{default:{minDist:160,maxDist:160,leadSec:0,tailSec:1},actions:[{name:'running-left'}]}},
    sendBounds(x,y){points.push({x,y});this.pos={x,y}}});
  const makePlan=()=>({name:'running-left',startRatio:.5,startYRatio:.8,targetRatio:.5+dir*.15,dir,totalRatio:.15,
    leadSec:timing.startMs/1000,endSec:timing.endMs/1000,accelUntilSec:timing.accelUntilMs/1000,
    decelerateFromSec:timing.decelerateFromMs/1000,tailSec:1,authoredMove});
  const begin=()=>{p.pendingMove=makePlan();p.startMoveDrive(el)};
  const paint=frame=>{el.petPaintedMediaTime=frame/24;el.currentTime=frame/24;const q=[...frames.values()];frames.clear();for(const f of q)f();return points.at(-1)?.x??960-169.5};
  return {p,el,points,frames,begin,paint};
}
const distance=(x)=>((960-169.5)-x)/(1920*.15);

test('left movement carries reviewed first-step, cruise and braking timing, without changing stored distances',()=>{
  const {p}=fixture();assert.equal(p.tryMove('running-left',null,true),'running-left');
  assert.equal(p.pendingMove.leadSec,.5);assert.equal(p.pendingMove.accelUntilSec,1);
  assert.equal(p.pendingMove.decelerateFromSec,3.5);assert.equal(p.pendingMove.endSec,95/24);
  assert.equal(p.pendingMove.totalRatio,.15);assert.equal(p.pendingMove.dir,-1);
});

test('painted left gait accelerates after F12, cruises evenly F24–84 and brakes before F95',()=>{
  const f=fixture();f.begin();const x=[];for(let n=0;n<=95;n++)x.push(f.paint(n));
  for(let n=0;n<=12;n++)assert.equal(x[n],x[0],'neutral turn must remain in place');
  const v=n=>x[n-1]-x[n];
  assert.ok(v(14)>0&&v(14)<v(18)&&v(18)<v(23),'launch speed should increase through the first steps');
  for(let n=26;n<=83;n++)assert.ok(Math.abs(v(n)-v(25))<1e-9,'steady gait must not keep accelerating');
  assert.ok(v(85)>v(88)&&v(88)>v(92)&&v(92)>v(95),'last-step speed must approach zero');
  assert.equal(x[95],(.5-.15)*1920-169.5);
  assert.equal(f.p.moveRef,null);
  const landed=x[95];assert.equal(f.paint(110),landed,'return to front stays in place');
});

test('stride envelope preserves direction, monotonic travel and both phase joins',()=>{
  for(const dir of [-1,1]){
    const f=fixture(left,{dir});f.begin();let previous=f.paint(12);
    for(let n=49;n<=380;n++){
      const x=f.paint(n/4);assert.ok((x-previous)*dir>=-1e-10);previous=x;
    }
    assert.equal(previous,(.5+dir*.15)*1920-169.5);
  }
  const f=fixture();f.begin();const position=n=>distance(f.paint(n));
  for(const join of [24,84]){
    const before=position(join-.001),at=position(join),after=position(join+.001);
    assert.ok(Math.abs((at-before)-(after-at))<1e-8,'velocity is continuous at a stride phase join');
  }
});

test('missing, non-finite or out-of-order phases retain the existing distance smoothstep',()=>{
  for(const bad of [{},{accelUntilMs:NaN,decelerateFromMs:3500},{accelUntilMs:400,decelerateFromMs:3500},
    {accelUntilMs:3700,decelerateFromMs:3500},{accelUntilMs:1000,decelerateFromMs:4000}]){
    const f=fixture({startMs:500,endMs:95/24*1000,...bad});f.begin();
    const time=40/24,u=(time-.5)/(95/24-.5);
    assert.ok(Math.abs(distance(f.paint(40))-u*u*(3-2*u))<1e-12);
  }
});

test('legacy clips keep linear distance and authored motion follows real paint, not decoder time',()=>{
  const legacy=fixture(left,{authoredMove:false});legacy.begin();const duration=Math.round((124/24-1)*1000)/1000;
  assert.ok(Math.abs(distance(legacy.paint(40))-(40/24-.5)/(duration-.5))<1e-12);
  const actual=fixture();actual.begin();actual.el.currentTime=3;
  actual.el.petPaintedMediaTime=.5;let callbacks=[...actual.frames.values()];actual.frames.clear();for(const fn of callbacks)fn();
  assert.equal(actual.points.length,0,'a decoded-but-unpainted step must not move the window');
  actual.paint(30);const moved=actual.points.at(-1).x;
  actual.el.petPaintedGeneration=2;callbacks=[...actual.frames.values()];actual.frames.clear();for(const fn of callbacks)fn();
  assert.equal(actual.points.at(-1).x,moved,'stale painted generations must not move backwards');
});
