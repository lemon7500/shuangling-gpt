import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {PetClient} from '../../src/bridge/pet-client.mjs';
import {PetController} from '../../src/bridge/controller.mjs';

const tick=ms=>new Promise(done=>setTimeout(done,ms));
async function until(check){const end=Date.now()+1800;while(!check()){assert.ok(Date.now()<end,'focus-query-did-not-settle');await tick(2)}}
async function fixture(t,{initial='accepted',onFirstRead=null}={}){
  const calls=[],token='P'.repeat(43);let state=initial,serial=0,started=false,first=true,controller;
  const server=createServer(async(req,res)=>{
    assert.equal(req.headers['x-dsh-pet-token'],token);
    const url=new URL(req.url,'http://localhost'),route=url.pathname.split('/').slice(2).join('/');
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):null;let result;
    if(route==='anim'){
      const id=body.name==='stretching-wings'?'focus':'task-'+ ++serial;
      calls.push({kind:'play',name:body.name,id});
      if(body.name==='running'&&state==='accepted')state='cancelled';
      result={ok:true,playbackId:id};
    }else if(route==='playback/focus'){
      const wait=Number(url.searchParams.get('timeout'));calls.push({kind:'receipt',id:'focus',wait});
      // Mimic the host's ended long-poll: accepted can become genuinely
      // playing during the request. A zero-wait request observes it now.
      if(wait>0){await tick(20);if(state==='accepted'){state='playing';started=true}}
      result={ok:true,status:state};
      if(first){first=false;onFirstRead?.(controller)}
    }else if(route==='interaction')result={ok:true,interaction:null};
    else if(route.startsWith('playback/task-'))result={ok:true,status:'ended'};
    else if(route==='lock/release')result={ok:true};
    else throw Error('unexpected-fixture-route-'+route);
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const client=new PetClient({dshHome:'unused-fixture',readFileImpl:async()=>JSON.stringify({port:server.address().port,token})});
  controller=new PetController({client,sleepImpl:()=>tick(2)});controller.kick=()=>{};
  controller.lockId='existing-owner';controller.renewAt=Infinity;controller.generation=2;controller.status={state:'working',threadId:'fixture',turnId:'new'};
  const operations=[];
  t.after(async()=>{controller.closed=true;controller.generation++;await Promise.allSettled(operations);await controller.release();await new Promise(done=>{server.close(done);server.closeAllConnections()})});
  return{controller,calls,run:(name,options)=>{const p=controller.one(name,controller.generation,options);operations.push(p);return p},setState:value=>{state=value},focusStarted:()=>started};
}

test('an accepted optional boundary uses a real zero-wait PetClient query before preparing new work',async t=>{
  const f=await fixture(t);
  f.controller.activePlayback={playbackId:'focus',name:'stretching-wings',generation:1,requestedAt:Date.now(),optionalCue:true};
  assert.equal(await f.run('running'),true);
  assert.deepEqual(f.calls.filter(c=>c.kind==='receipt'),[{kind:'receipt',id:'focus',wait:0}]);
  assert.equal(f.focusStarted(),false,'the query itself must not start a previously accepted gesture');
  assert.deepEqual(f.calls.filter(c=>c.kind==='play').map(c=>c.name),['running']);
});

test('one pending optional cue also polls without waiting and yields the current generation promptly',async t=>{
  const f=await fixture(t,{onFirstRead:c=>c.update({state:'working',threadId:'fixture',turnId:'arrived-during-query'})});
  f.controller.status={state:'idle',threadId:'fixture',turnId:'before'};
  assert.equal(await f.run('stretching-wings',{optionalCue:true}),false);
  assert.equal(f.controller.activePlayback.optionalCue,true);
  assert.equal(await f.run('running'),true);
  assert.ok(f.calls.filter(c=>c.kind==='receipt').length>=2);
  assert.ok(f.calls.filter(c=>c.kind==='receipt').every(c=>c.wait===0));
  assert.equal(f.focusStarted(),false);
  assert.deepEqual(f.calls.filter(c=>c.kind==='play').map(c=>c.name),['stretching-wings','running']);
});

test('a real playing reply clears optional authority and restores the ordinary ended boundary',async t=>{
  const f=await fixture(t,{initial:'playing'});
  f.controller.activePlayback={playbackId:'focus',name:'stretching-wings',generation:1,requestedAt:Date.now(),optionalCue:true};
  const task=f.run('running');
  await until(()=>f.calls.filter(c=>c.kind==='receipt').length>=2);
  assert.equal(f.controller.activePlayback.optionalCue,undefined);
  assert.deepEqual(f.calls.filter(c=>c.kind==='receipt').slice(0,2).map(c=>c.wait),[0,1000]);
  assert.ok(!f.calls.some(c=>c.kind==='play'),'playing animation cannot be cut at a guessed neutral pose');
  f.setState('ended');assert.equal(await task,true);
  assert.deepEqual(f.calls.filter(c=>c.kind==='play').map(c=>c.name),['running']);
});
