import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(native=true){
 const callbacks=new Map(),paints=[];let seq=0;
 const sandbox=vm.createContext({window:{requestAnimationFrame:fn=>{callbacks.set(++seq,fn);return seq},cancelAnimationFrame:id=>callbacks.delete(id)}});
 vm.runInContext(readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js',import.meta.url),'utf8'),sandbox);
 const proto=vm.runInContext('PetSprite.prototype',sandbox);
 const video={readyState:4,currentTime:1.542,petPaintedMediaTime:1.542,cancelVideoFrameCallback:id=>callbacks.delete(id)};
 if(native)video.requestVideoFrameCallback=fn=>{callbacks.set(++seq,fn);return seq};
 const sprite=Object.assign(Object.create(proto),{videoPaint:null,paintVideoFrame:(v,t)=>paints.push({v,t})});
 sprite.startVideoPaint(video);
 const tick=metadata=>{const[id,fn]=callbacks.entries().next().value;callbacks.delete(id);fn(100,metadata)};
 return{sprite,video,paints,callbacks,tick};
}
test('a genuinely decoded loop F0 paints even while Chromium transiently reports HAVE_METADATA',()=>{
 const f=fixture();f.video.readyState=1;f.video.currentTime=.005;
 f.tick({mediaTime:0,presentedFrames:39});
 assert.equal(f.paints.length,1,'the decoder supplied F0 must not be discarded until F1');
 assert.equal(f.paints[0].t,0);assert.equal(f.sprite.videoPaint.time,0);assert.equal(f.callbacks.size,1);
 f.video.readyState=4;f.tick({mediaTime:.042,presentedFrames:40});assert.equal(f.paints[1].t,.042);
});
test('fallback animation-frame clock still waits for a drawable decoder',()=>{
 const f=fixture(false);f.video.readyState=1;f.video.currentTime=0;f.tick();assert.equal(f.paints.length,0);
 f.video.readyState=2;f.tick();assert.equal(f.paints.length,1);assert.equal(f.paints[0].t,0);
});
test('duplicate native timestamps and cancelled old callbacks cannot repaint a newer owner',()=>{
 const f=fixture();f.tick({mediaTime:1.542});assert.equal(f.paints.length,0);
 const old=f.callbacks.values().next().value;f.sprite.stopVideoPaint();old(100,{mediaTime:0});
 assert.equal(f.paints.length,0);assert.equal(f.callbacks.size,0);
});
