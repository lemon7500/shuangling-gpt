import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const sandbox=vm.createContext({});
vm.runInContext(readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/sprite.js',import.meta.url),'utf8'),sandbox);
const proto=vm.runInContext('PetSprite.prototype',sandbox);
function fixture(){const calls=[];const sprite=Object.assign(Object.create(proto),{dragState:{active:false,dragging:false},throwRef:null,throwState:null,displayedAnim:'idle',pending:null,dragVisual:{active:()=>false},frost:{setSuppressed:value=>calls.push(value)}});return{sprite,calls}}
test('released native drag remains free of frost until the controller settles',()=>{
 const f=fixture();for(const phase of ['pickup','hover','return-hover','lower','regrab']){
  f.sprite.dragVisual.active=()=>true;f.sprite.displayedAnim='idle';f.sprite.syncFrostVisibility();
  assert.equal(f.calls.at(-1),true,phase+' must not reveal old idle accents');
 }
 f.sprite.dragVisual.active=()=>false;f.sprite.syncFrostVisibility();assert.equal(f.calls.at(-1),false);
});
test('released visible or pending drag footage cannot show frost even without an active controller',()=>{
 const f=fixture();f.sprite.dragVisual=null;
 for(const name of ['drag-lift','drag-hover','drag-lower']){
  f.sprite.displayedAnim=name;f.sprite.pending=null;f.sprite.syncFrostVisibility();assert.equal(f.calls.at(-1),true);
  f.sprite.displayedAnim='idle';f.sprite.pending={anim:name};f.sprite.syncFrostVisibility();assert.equal(f.calls.at(-1),true);
 }
 f.sprite.pending={anim:'waiting'};f.sprite.syncFrostVisibility();assert.equal(f.calls.at(-1),false);
});
test('physical pickup and held motion may retain full snowflakes over idle, lift and hover',()=>{
 const f=fixture();f.sprite.dragVisual.active=()=>true;
 for(const field of ['active','dragging']){
  f.sprite.dragState[field]=true;
  for(const name of ['idle','drag-lift','drag-hover']){
   f.sprite.displayedAnim=name;
   for(const pending of [null,{anim:'drag-lift'},{anim:'drag-hover'}]){
    f.sprite.pending=pending;f.sprite.syncFrostVisibility();assert.equal(f.calls.at(-1),false,field+' '+name+' retains complete snowflakes');
   }
  }
  f.sprite.dragState[field]=false;
 }
});

test('thrown flight always suppresses frost even while a new physical grab is beginning',()=>{
 const f=fixture();f.sprite.dragState.active=true;f.sprite.dragVisual.active=()=>true;
 for(const name of ['idle','drag-lift','drag-hover'])for(const field of ['throwRef','throwState']){
  f.sprite.displayedAnim=name;f.sprite[field]=field==='throwRef'?0:{};
  f.sprite.syncFrostVisibility();assert.equal(f.calls.at(-1),true);f.sprite[field]=null;
 }
 f.sprite.syncFrostVisibility();assert.equal(f.calls.at(-1),false);
});

test('visible or pending lowering suppresses frost before, during and after a regrab',()=>{
 const f=fixture();
 for(const active of [false,true])for(const controlling of [false,true]){
  f.sprite.dragState.active=active;f.sprite.dragVisual.active=()=>controlling;
  f.sprite.displayedAnim='drag-lower';f.sprite.pending=null;f.sprite.syncFrostVisibility();assert.equal(f.calls.at(-1),true);
  f.sprite.displayedAnim='idle';f.sprite.pending={anim:'drag-lower'};f.sprite.syncFrostVisibility();assert.equal(f.calls.at(-1),true);
 }
});

test('ordinary idle and task actions retain their normal frost when no drag or throw owns them',()=>{
 const f=fixture();
 for(const name of ['idle','running','review','waiting','running-classic','review-classic','waiting-classic']){
  f.sprite.displayedAnim=name;f.sprite.pending={anim:name};f.sprite.syncFrostVisibility();assert.equal(f.calls.at(-1),false);
 }
});
