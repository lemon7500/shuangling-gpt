import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deliverFocusNotice} from '../../src/desk/focus-notices.mjs';
import {createDeskService} from '../../src/desk/service.mjs';

const notice={id:'d38a6f84-c8d6-422b-a073-81871ec3a19b',phase:'focus',completedAt:1800000000000,durationMinutes:10};
function fixture() {
  const calls=[],consumed=[];
  const controller={generation:7,lockId:'existing-lease',status:{state:'idle'},interaction:null,
    client:{appearance:async()=>({display:'desktop'})},
    companionNotice:async(...args)=>{calls.push(args);return true;}};
  const options={controller,desk:{consumeNotice:async id=>{consumed.push(id);return{consumed:true};}},getLanguage:async()=> 'en'};
  return{controller,options,calls,consumed};
}

test('focus and break notices use three translations and fixed idle/visibility capability without changing ownership',async()=>{
  const expected={focus:{'zh-CN':'这段专注结束了。要歇一会儿吗？','zh-TW':'這段專注結束了。要歇一會兒嗎？',en:'This focus session has ended. Would you like a break?'},
    break:{'zh-CN':'这段休息结束了。下一步由你决定。','zh-TW':'這段休息結束了。下一步由你決定。',en:'This break has ended. You can decide what comes next.'}};
  for(const phase of ['focus','break'])for(const language of ['zh-CN','zh-TW','en']){
    const f=fixture();f.options.getLanguage=async()=>language;
    assert.equal(await deliverFocusNotice({...notice,phase},f.options),true);
    assert.deepEqual(f.calls,[[expected[phase][language],'stretching-wings',{idleOnly:true,requireVisible:true,cuePolicy:'focus'}]]);
    assert.deepEqual(f.consumed,[notice.id]);assert.equal(f.controller.lockId,'existing-lease');assert.equal(f.controller.generation,7);
  }
});

test('busy, waiting, unknown, paused, manual and native interaction completions are consumed without reading preferences or queuing',async()=>{
  const overrides=[...['working','waiting','unknown','complete','interrupted'].map(state=>({status:{state}})),
    {paused:true},{preempted:true},{closed:true},{surfaceReloading:true},{lockId:null},
    ...['pointer','dragging','throwing','blocked'].map(phase=>({interaction:{phase}}))];
  for(const values of overrides){
    const f=fixture();Object.assign(f.controller,values);
    f.options.getLanguage=async()=>assert.fail('an ineligible completion must not wait for later preference I/O');
    f.controller.client.appearance=async()=>assert.fail('an ineligible completion must not issue requests');
    assert.equal(await deliverFocusNotice(notice,f.options),false);
    assert.deepEqual(f.calls,[]);assert.deepEqual(f.consumed,[notice.id]);
  }
});

test('hidden, missing and unreadable surfaces suppress a completion before language lookup',async()=>{
  for(const display of ['none','hidden','web',undefined]){
    const f=fixture();f.controller.client.appearance=async()=>({display});
    f.options.getLanguage=async()=>assert.fail('hidden completions are dropped now');
    assert.equal(await deliverFocusNotice(notice,f.options),false);assert.deepEqual(f.calls,[]);assert.deepEqual(f.consumed,[notice.id]);
  }
  const f=fixture();f.controller.client.appearance=async()=>{throw Error('fixture-disconnected');};
  assert.equal(await deliverFocusNotice(notice,f.options),false);assert.deepEqual(f.calls,[]);assert.deepEqual(f.consumed,[notice.id]);
});

test('a state, generation, lease or user-priority change during either asynchronous read drops the notice',async()=>{
  const changes=[c=>{c.status.state='working';},c=>{c.status.state='waiting';},c=>{c.paused=true;},c=>{c.preempted=true;},
    c=>{c.closed=true;},c=>{c.surfaceReloading=true;},c=>{c.lockId='new-lease';},c=>{c.generation+=2;},c=>{c.interaction={phase:'dragging'};}];
  for(const stage of ['appearance','language'])for(const change of changes){
    const f=fixture();
    if(stage==='appearance')f.controller.client.appearance=async()=>{change(f.controller);return{display:'desktop'};};
    else f.options.getLanguage=async()=>{change(f.controller);return'en';};
    assert.equal(await deliverFocusNotice(notice,f.options),false,stage);
    assert.deepEqual(f.calls,[]);assert.deepEqual(f.consumed,[notice.id]);
  }
});

test('initially busy completion cannot reappear when the controller becomes idle immediately afterwards',async()=>{
  const f=fixture();f.controller.status.state='working';
  const pending=deliverFocusNotice(notice,f.options);f.controller.status.state='idle';
  assert.equal(await pending,false);assert.deepEqual(f.calls,[]);assert.deepEqual(f.consumed,[notice.id]);
});

test('notification failure still consumes completion and never changes the saved timer outcome',async()=>{
  const f=fixture();f.controller.companionNotice=async()=>{throw Error('fixture-send-failure');};
  assert.equal(await deliverFocusNotice(notice,f.options),false);assert.deepEqual(f.consumed,[notice.id]);
});

for(const condition of ['idle','working','hidden','manual','paused','dragging','throwing']){
  test(`real focus completion is consumed once during ${condition} and is not replayed on idle/restart`,async t=>{
    const f=fixture(),dataDir=await mkdtemp(join(tmpdir(),'shuangling-focus-delivery-'));
    let at=1800000000000,desk;const pending=[];
    if(condition==='working')f.controller.status.state='working';
    if(condition==='hidden')f.controller.client.appearance=async()=>({display:'none'});
    if(condition==='manual')f.controller.preempted=true;
    if(condition==='paused')f.controller.paused=true;
    if(['dragging','throwing'].includes(condition))f.controller.interaction={phase:condition};
    const boot=()=>createDeskService({dataDir,now:()=>at,autoTick:false,detectSleep:false,onNotice:n=>{
      const delivery=deliverFocusNotice(n,{...f.options,desk});pending.push(delivery);return delivery;
    }});
    desk=await boot();t.after(()=>desk.close());
    await desk.command({type:'focus.configure',focusMinutes:10,breakMinutes:1});
    await desk.command({type:'focus.start',phase:'focus'});
    at+=10*60000;await desk.tick();await new Promise(done=>setImmediate(done));await Promise.all(pending);
    assert.equal((await desk.snapshot()).focus.status,'completed');
    assert.equal((await desk.snapshot()).focus.phase,'focus','no automatic break');
    assert.equal(f.calls.length,condition==='idle'?1:0);assert.equal(pending.length,1);
    const store=JSON.parse(await readFile(join(dataDir,'desk.json'),'utf8'));
    assert.deepEqual(store.notices,[],'suppressed completions are not retained for later delivery');
    f.controller.status.state='idle';f.controller.preempted=false;f.controller.paused=false;f.controller.interaction=null;
    f.controller.client.appearance=async()=>({display:'desktop'});at+=60000;
    await desk.tick();await new Promise(done=>setImmediate(done));assert.equal(pending.length,1);
    await desk.close();desk=await boot();await desk.tick();await new Promise(done=>setImmediate(done));
    assert.equal(pending.length,1);assert.equal(f.calls.length,condition==='idle'?1:0);
    assert.equal((await desk.snapshot()).focus.status,'completed');
  });
}
