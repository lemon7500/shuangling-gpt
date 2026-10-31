import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const eventsSource=readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/events.js',import.meta.url),'utf8');
const sharedSource=readFileSync(new URL('../../vendor/dsh-pet/runtime/electron-helper/shared-core.js',import.meta.url),'utf8');
const state=(counter,name='idle',id='historical')=>({...(counter===undefined?{}:{counter}),sections:{},pets:{shuangling:{anim:{counter:counter??1,data:{name,playbackId:id}}}}});
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

// Execute the actual event loop and shared counter/baseline helpers. Only the
// transport and timer queue are replaced, so no native process or wall-clock
// sleep is needed to exercise retries and command delivery.
function fixture(responses){
  const timers=[],delays=[],requests=[],actions=[];
  const sprite={pet:{id:'shuangling'},interaction:null,onMenuAction:value=>actions.push(value)};
  const context=vm.createContext({PetSprite:function(){},sprites:[sprite],window:{__dshPetDebug:{}},loopsStarted:false,
    STATE_URL:'owned-fixture-state',STATE_WAIT_MS:1000,console,
    setTimeout(callback,ms){timers.push({callback,ms});delays.push(ms);return delays.length;}});
  vm.runInContext(sharedSource+'\nvar S=PetShared;',context);
  context.S.fetchState=async(...args)=>{requests.push(args);assert.ok(responses.length,'unexpected extra poll');const value=responses.shift();if(value instanceof Error)throw value;return value;};
  vm.runInContext(eventsSource,context);
  return{timers,delays,requests,actions,
    async start(){context.startLoops();await settle();},
    async next(){assert.equal(timers.length,1,'one scheduled state poll');timers.shift().callback();await settle();},
    async startAgain(){context.startLoops();await settle();}};
}

test('a single confirmed long-poll failure recovers quickly and delivers the unchanged command once',async()=>{
  const f=fixture([state(1),null,state(2,'reading','new-reading'),state(2,'reading','new-reading')]);
  await f.start();assert.equal(f.delays.at(-1),0);assert.equal(f.actions.length,0,'startup baseline never replays history');
  await f.next();assert.equal(f.delays.at(-1),100);assert.equal(f.actions.length,0);
  await f.next();assert.equal(f.delays.at(-1),0);assert.equal(f.actions.length,1);assert.equal(f.actions[0].playbackId,'new-reading');
  assert.equal(f.requests[1][1].since,1);assert.equal(f.requests[2][1].since,1,'failure cannot advance the state baseline');
  await f.next();assert.equal(f.actions.length,1,'unchanged leaf is not replayed');assert.equal(f.requests[3][1].since,2);
});

test('continuous confirmed long-poll failures back off with a one-second ceiling',async()=>{
  const f=fixture([state(1),null,new Error('fixture transport rejection'),null,null,null,null]);
  await f.start();for(let i=0;i<6;i++)await f.next();
  assert.deepEqual(f.delays,[0,100,250,500,1000,1000,1000]);
  assert.equal(f.actions.length,0);assert.equal(f.timers.length,1);
});

test('a successful long-poll response resets the short recovery budget',async()=>{
  const f=fixture([state(1),null,null,state(2,'reading','new-reading'),null,null]);
  await f.start();for(let i=0;i<5;i++)await f.next();
  assert.deepEqual(f.delays,[0,100,250,0,100,250]);assert.equal(f.actions.length,1);
});

test('initial failures retain the one-second interval until support is confirmed',async()=>{
  const f=fixture([null,new Error('fixture unavailable'),state(1),null]);
  await f.start();await f.next();await f.next();await f.next();
  assert.deepEqual(f.delays,[1000,1000,0,100]);
  assert.equal(f.requests[0][1],undefined);assert.equal(f.requests[1][1],undefined);assert.equal(f.requests[2][1],undefined);
  assert.equal(f.requests[3][1].since,1);
});

test('legacy hosts retain one-second polling on successes and failures',async()=>{
  const f=fixture([state(undefined),null,state(undefined)]);
  await f.start();await f.next();await f.next();
  assert.deepEqual(f.delays,[1000,1000,1000]);assert.ok(f.requests.every(request=>request[1]===undefined));
});

test('a host reverting to legacy responses immediately regains the safe interval',async()=>{
  const f=fixture([state(1),state(undefined),null]);
  await f.start();await f.next();await f.next();
  assert.deepEqual(f.delays,[0,1000,1000]);assert.equal(f.requests[2][1],undefined);
});

test('startLoops remains idempotent while a poll or retry is pending',async()=>{
  let resolveFirst;
  const first=new Promise(resolve=>{resolveFirst=resolve;}),f=fixture([first,null]);
  await f.start();await f.startAgain();assert.equal(f.requests.length,1);assert.equal(f.timers.length,0,'in-flight request has no parallel timer');
  resolveFirst(state(1));await settle();assert.equal(f.timers.length,1);
  await f.next();await f.startAgain();assert.equal(f.requests.length,2);assert.equal(f.timers.length,1);assert.deepEqual(f.delays,[0,100]);
});
