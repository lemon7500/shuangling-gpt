import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PetClient} from '../../src/bridge/pet-client.mjs';
import {PetController} from '../../src/bridge/controller.mjs';
import {createDeskService} from '../../src/desk/service.mjs';
import {deliverFocusNotice} from '../../src/desk/focus-notices.mjs';

for (const condition of ['idle','working','waiting','hidden','manual','paused','dragging','throwing','reading','wing-cooldown','takeover-at-ack']) {
  test(`completed focus uses the authenticated host safely during ${condition}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'shuangling-focus-host-'));
    const home = join(directory, 'host'), token = 'F'.repeat(43), requests = [], deliveries = [];
    let at = 1800000000000, desk, controller;
    let display = condition === 'hidden' ? 'none' : 'desktop';
    const host = createServer(async (request, response) => {
      assert.equal(request.headers['x-dsh-pet-token'], token);
      const url = new URL(request.url, 'http://localhost');
      const route = url.pathname.split('/').slice(2).join('/');
      let bytes = ''; for await (const chunk of request) bytes += chunk;
      const body = bytes ? JSON.parse(bytes) : null;
      requests.push({route,method:request.method,body});
      let result;
      if (route === 'config' && request.method === 'GET') result = {main:{pets:[{id:'shuangling',display}]}};
      else if (route === 'interaction' && request.method === 'GET') {
        result = {ok:true,interaction:['dragging','throwing'].includes(condition) ? {
          id:'fixture-drag',kind:'drag',phase:condition,startedAt:1000,updatedAt:1000,endedAt:null,revision:1,resumable:false,
        } : null};
      } else if (route === 'broadcast' && request.method === 'POST') {
        assert.equal(url.searchParams.get('lock'), 'retained-lease');
        assert.equal(body.anim, false);
        if (condition === 'takeover-at-ack') controller.preempted = true;
        result = {ok:true};
      } else { response.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({ok:false,reason:'fixture-disallowed-route'})); return; }
      response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
    });
    await new Promise(done => host.listen(0,'127.0.0.1',done));
    t.after(() => new Promise(done => { host.close(done); host.closeAllConnections(); }));
    await mkdir(join(home,'dsh-pet'),{recursive:true});
    await writeFile(join(home,'dsh-pet/standalone-runtime.json'),JSON.stringify({port:host.address().port,token}));
    controller = new PetController({client:new PetClient({dshHome:home}),availableAnimations:['idle','reading','stretching-wings'],now:()=>at});
    controller.status = {state:['working','waiting'].includes(condition)?condition:'idle'};
    controller.lockId = 'retained-lease'; controller.kick = () => {};
    if (condition === 'manual') controller.preempted = true;
    if (condition === 'paused') controller.paused = true;
    if (condition === 'reading') controller.activePlayback = {name:'reading',generation:0};
    const boot = () => createDeskService({dataDir:join(directory,'desk'),now:()=>at,autoTick:false,detectSleep:false,
      onNotice:notice => { const pending = deliverFocusNotice(notice,{desk,controller,getLanguage:async()=> 'en'}); deliveries.push(pending); return pending; }});
    desk = await boot(); t.after(()=>desk.close());
    await desk.command({type:'focus.configure',focusMinutes:10,breakMinutes:1});
    await desk.command({type:'focus.start',phase:'focus'});
    at += 10*60000;
    if (condition === 'wing-cooldown') controller.lastAmbientEnded['stretching-wings'] = at-1000;
    await desk.tick(); await new Promise(done=>setImmediate(done)); await Promise.all(deliveries);
    assert.equal(deliveries.length,1);
    const result = await desk.snapshot(); assert.equal(result.focus.status,'completed'); assert.equal(result.focus.phase,'focus');
    const bubbles = requests.filter(r=>r.route==='broadcast');
    const allowsBubble = ['idle','reading','wing-cooldown','takeover-at-ack'].includes(condition);
    assert.equal(bubbles.length,allowsBubble?1:0);
    assert.equal(controller.cue?.source,condition==='idle'?'focus':undefined);
    assert.equal(display,condition==='hidden'?'none':'desktop','no hidden surface is reopened');
    assert.equal(controller.lockId,'retained-lease');
    assert.ok(requests.every(r=>r.route==='config'&&r.method==='GET'||r.route==='interaction'&&r.method==='GET'||r.route==='broadcast'&&r.method==='POST'));
    assert.ok(!requests.some(r=>['anim','lock','position','shuangling-appearance','config/reload','shutdown'].includes(r.route)), 'notice never directly moves/plays/reopens a surface');
    const sent = requests.length;
    controller.status={state:'idle'}; controller.preempted=false; controller.paused=false; display='desktop';
    at+=60000; await desk.tick(); await new Promise(done=>setImmediate(done));
    await desk.close(); desk=await boot(); await desk.tick(); await new Promise(done=>setImmediate(done));
    assert.equal(deliveries.length,1); assert.equal(requests.length,sent,'no suppressed completion is replayed after idle/show/restart');
  });
}
