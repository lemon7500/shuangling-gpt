/** Owned production-decoder fixture; never addresses the installed pet or real chats. */
import assert from 'node:assert/strict';
import {copyFile,cp,link,mkdir,readFile,statfs,symlink,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dirname,join,parse,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {mainInstrumentation,sanitizeAuditText,statePollRecoverySelfCheck} from './verify-reading-handoff.mjs';
import {validateAssets,assertAuditDiskHeadroom} from './verify-companion-native.mjs';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async p=>{try{return JSON.parse(await readFile(p,'utf8'))}catch{return null}};
const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true}catch{return false}};
async function headroom(p){const s=await statfs(parse(p).root);return assertAuditDiskHeadroom(s.bavail*s.bsize)}
async function until(fn,timeout,label){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await delay(70)}throw Error(label+'-timeout')}
async function request(base,route,token,body){const r=await fetch(new URL(route,base),{method:body===undefined?'GET':'POST',headers:{'x-shuangling-token':token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(4000)});assert.ok(r.ok,'owned-api-'+r.status);return r.json()}

/** Missing state is missing evidence, never an implicit unchanged zero. */
export function sleepHostStateSummary(state,petId='shuangling'){
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  assert.ok(object(state)&&Number.isSafeInteger(state.counter)&&state.counter>=0,'sleep-host-state-counter-required');
  assert.ok(object(state.sections)&&object(state.pets)&&Object.hasOwn(state.pets,petId),'sleep-host-pet-entry-required');
  const leaves=state.pets[petId];assert.ok(object(leaves),'sleep-host-pet-leaves-required');
  for(const name of ['lock','say','anim','position','throw']){
    const leaf=leaves[name];
    assert.ok(Object.hasOwn(leaves,name)&&object(leaf)&&Number.isSafeInteger(leaf.counter)&&leaf.counter>=0&&leaf.counter<=state.counter&&Object.hasOwn(leaf,'data'),'sleep-host-'+name+'-leaf-required');
  }
  assert.ok(object(leaves.lock.data)&&typeof leaves.lock.data.locked==='boolean','sleep-host-explicit-lock-state-required');
  return{petId,lockHeld:leaves.lock.data.locked,lockCounter:leaves.lock.counter,sayCounter:leaves.say.counter,animCounter:leaves.anim.counter};
}

export function focusInstrumentation({sleepEvents=false}={}){
  assert.equal(typeof sleepEvents,'boolean','sleep-event-instrumentation-must-be-boolean');
  let value=mainInstrumentation({captureEnabled:false});
  const a='opacity:win.getOpacity(),focusable:win.isFocusable(),captures';
  assert.equal(value.split(a).length,2,'native-probe-shape-changed');
  value=value.replace(a,'opacity:win.getOpacity(),focusable:win.isFocusable(),visible:win.isVisible(),focused:win.isFocused(),title:win.getTitle(),bounds:win.getBounds(),captures');
  const b="await win.webContents.executeJavaScript('window.__readingHandoffAudit.command('+JSON.stringify(command)+')');probe=null;";
  assert.equal(value.split(b).length,2,'native-command-shape-changed');
  const powerBranch=sleepEvents?"else if(command.operation==='native.suspend'||command.operation==='native.resume'){const event=command.operation==='native.suspend'?'suspend':'resume',row={id:command.id,operation:command.operation,event,at:Date.now(),listeners:powerMonitor.listenerCount(event)};powerEvents.push(row);row.hadListener=powerMonitor.emit(event);}":'';
  value=value.replace(b,"if(command.operation==='native.present'){win.setTitle('霜铃专注联调 · 独立测试');win.setOpacity(1);win.setPosition(64,96);win.showInactive();}"+powerBranch+"else{await win.webContents.executeJavaScript('window.__readingHandoffAudit.command('+JSON.stringify(command)+')');}probe=null;");
  if(sleepEvents){
    const declaration='const issues=[],loopByPlayback=new Map()';
    assert.equal(value.split(declaration).length,2,'native-power-event-declaration-shape-changed');
    value=value.replace(declaration,'const powerEvents=[],issues=[],loopByPlayback=new Map()');
    const publish='captures,mainEventLoop:{...loop}';
    assert.equal(value.split(publish).length,2,'native-power-event-publish-shape-changed');
    value=value.replace(publish,'captures,powerEvents:powerEvents.slice(-8),mainEventLoop:{...loop}');
  }
  // Actual bubble DOM evidence, appended to the existing read-only snapshot.
  const c="if(!probe)probe=await win.webContents.executeJavaScript('window.__readingHandoffAudit?.snapshot() || {ready:false}');";
  assert.equal(value.split(c).length,2,'native-snapshot-shape-changed');
  value=value.replace(c,"if(!probe)probe=await win.webContents.executeJavaScript('Object.assign(window.__readingHandoffAudit?.snapshot() || {ready:false},{bubble:{on:sprites?.[0]?.bubble?.classList.contains(\\\"is-on\\\")===true,text:sprites?.[0]?.bubble?.textContent||\\\"\\\"}})');");
  new Function(value);return value;
}

/** Optional phase evidence; old reports remain valid and never gain invented times. */
export function transitionLatencySummary(stage,request){
  const fields=['switchAt','handoffRequestedAt','commitAt','handoffCommitConfirmedAt','firstPaintAt','nativePlayingAt'];
  const times=Object.fromEntries(fields.map(name=>[name,Number.isFinite(stage?.[name])?stage[name]:null]));
  const delta=(end,start)=>Number.isFinite(end)&&Number.isFinite(start)?Math.round((end-start)*1000)/1000:null;
  return{available:times.switchAt!==null,generation:Number.isSafeInteger(stage?.generation)?stage.generation:null,
    slot:stage?.slot?{cache:stage.slot.cache,sameSource:stage.slot.sameSource,readyState:stage.slot.readyState,seeking:stage.slot.seeking,currentTime:stage.slot.currentTime,error:stage.slot.error}:null,
    ...times,submitToSwitchMs:delta(times.switchAt,request?.submittedAt),ackToSwitchMs:delta(times.switchAt,request?.acceptedAckAt),
    switchToHandoffRequestMs:delta(times.handoffRequestedAt,times.switchAt),
    handoffRequestToFirstPaintMs:delta(times.firstPaintAt,times.handoffRequestedAt),
    handoffRequestToCommitMs:delta(times.commitAt,times.handoffRequestedAt),
    firstPaintToNativePlayingMs:delta(times.nativePlayingAt,times.firstPaintAt),
    commitToNativePlayingMs:delta(times.nativePlayingAt,times.commitAt),
    interpretation:'Observed phase boundaries only. Cold/warm describes the spare native decoder slot at switch entry, not disk-cache state or an established cause.'};
}

export function readingLatencySummary(idle,reading,request){
  const times={idleNativeEndedAt:idle?.endedAt,submittedAt:request?.submittedAt,acceptedAckAt:request?.acceptedAckAt,nativePlayingAt:reading?.startedAt,nativeEndedAt:reading?.endedAt};
  assert.ok(Object.values(times).every(Number.isFinite),'reading-latency-missing-actual-time');
  assert.ok(times.submittedAt<=times.acceptedAckAt&&times.submittedAt<=times.nativePlayingAt&&times.nativePlayingAt<=times.nativeEndedAt,'reading-latency-invalid-order');
  const rounded=value=>Math.round(value*1000)/1000;
  return{...times,idleEndedToSubmitMs:rounded(times.submittedAt-times.idleNativeEndedAt),submitToAckMs:rounded(times.acceptedAckAt-times.submittedAt),ackToNativePlayingMs:rounded(times.nativePlayingAt-times.acceptedAckAt),submitToNativePlayingMs:rounded(times.nativePlayingAt-times.submittedAt),idleEndedToNativePlayingMs:rounded(times.nativePlayingAt-times.idleNativeEndedAt),nativePlayingDurationMs:rounded(times.nativeEndedAt-times.nativePlayingAt),nativePaints:reading.paints,maxNativePaintGapMs:reading.maxPaintGapMs,qualityStart:reading.qualityStart,qualityEnd:reading.qualityEnd,loopDelay:{renderer:reading.rendererEventLoop??null,main:reading.mainEventLoop??null},transition:transitionLatencySummary(reading.transition,request)};
}

export async function auditFocusPriority(sourceRoot,{runtimeRoot=sourceRoot,visible=false,conditions=null,readingLatency=false,readingRepeats=3,autonomousReading=false,statePollRecovery=false,sleepEventsOnly=false}={}){
  assert.ok(Number.isSafeInteger(readingRepeats)&&readingRepeats>=1&&readingRepeats<=20,'invalid-reading-repeat-count');
  assert.ok(!autonomousReading||readingLatency,'autonomous-reading-requires-latency-mode');
  assert.equal(typeof statePollRecovery,'boolean','state-poll-recovery-must-be-boolean');
  assert.ok(!statePollRecovery||readingLatency&&!autonomousReading,'state-poll-recovery-requires-scripted-reading-latency');
  assert.equal(typeof sleepEventsOnly,'boolean','sleep-events-only-must-be-boolean');
  assert.ok(!sleepEventsOnly||!readingLatency&&!autonomousReading&&!statePollRecovery&&!visible&&conditions===null,'sleep-events-only-requires-unfocused-exclusive-mode');
  const source=resolve(sourceRoot),runtime=resolve(runtimeRoot);
  await headroom(runtime);
  const assets=validateAssets(await json(join(source,'reports/windows-assets.json')));
  for(const row of assets.animations)assert.equal(hash(await readFile(join(source,'windows/assets/shuangling',row.name+'.webm'))),row.webmSha256,'media-hash-'+row.name);
  const output=join(runtime,'qa/focus-native-20261029',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
  const isolated=join(output,'isolated'),skeleton=join(isolated,'source'),data=join(isolated,'data'),home=join(isolated,'fake-codex-home');
  const probeFile=join(isolated,'probe.json'),commandFile=join(isolated,'command.json');
  const report={startedAt:new Date().toISOString(),output,productionDecoder:true,syntheticDataOnly:true,visibleRequested:visible,realSettingsWrites:0,generationCredits:0,githubPublished:false,cases:[],checks:{},ok:false};
  const allConditions=['idle','working','waiting','paused','manual','dragging','reading','wing-cooldown','pending-new-task','hidden'];
  const selected=readingLatency||sleepEventsOnly?[]:conditions??allConditions;assert.ok(readingLatency||sleepEventsOnly||selected.length>0&&selected.every(value=>allConditions.includes(value))&&new Set(selected).size===selected.length,'invalid-condition-selection');
  report.selectedConditions=selected;
  report.mode=sleepEventsOnly?'sleep-events':readingLatency?'reading-latency':'focus-priority';
  let manager,identity,settings,client,controller,realDesk,realController,helperPid,nativeHostPid;
  const helperPids=new Set(),deliveries=[],apiCalls=[];
  async function probe(){await headroom(runtime);const p=await until(()=>json(probeFile),3000,'native-probe');if(p.nativePid)helperPids.add(p.nativePid);return p}
  async function command(operation,extra={}){const id=randomUUID();await writeFile(commandFile,JSON.stringify({id,operation,...extra}));return until(async()=>{const p=await probe();return p.commandId===id||sleepEventsOnly&&p.powerEvents?.some(row=>row.id===id)||operation==='native.present'&&p.title==='霜铃专注联调 · 独立测试'?p:null},5000,'command-'+operation)}
  async function stopOwned(){if(identity&&manager?.pid===identity.pid&&alive(identity.pid))await request(`http://127.0.0.1:${identity.managerPort}`,'/stop',identity.token,{}).catch(()=>{});if(manager?.pid)await until(()=>!alive(manager.pid),12000,'manager-exit').catch(()=>{})}
  try{
    for(const p of [skeleton,data,join(home,'sessions')])await mkdir(p,{recursive:true});
    await writeFile(join(home,'config.toml'),'# Owned native-focus fixture. No credentials, conversations or plugins.\n');
    await writeFile(join(data,'plugin-config.json'),JSON.stringify({autoLaunch:false,language:'zh-CN',ambientEnabled:false}));
    await writeFile(join(data,'bridge-config.json'),JSON.stringify({threadId:null,paused:true}));
    for(const directory of ['src','vendor/dsh-pet/runtime/electron-helper'])await cp(join(source,directory),join(skeleton,directory),{recursive:true});
    const files=['package.json','windows/start.mjs','windows/outline-contract.mjs','windows/default-config.json','windows/runtime-config.json','windows/hd-geometry.json','windows/animation-timing.json','vendor/dsh-pet/lib/standalone.js','vendor/dsh-pet/package.json','vendor/dsh-pet/assets/config.jsonc','vendor/dsh-pet/assets/logo.png','reports/windows-assets.json',assets.motionManifest];
    for(const p of new Set(files)){await mkdir(dirname(join(skeleton,p)),{recursive:true});await copyFile(join(source,p),join(skeleton,p))}
    await symlink(join(runtime,'windows/runtime'),join(skeleton,'windows/runtime'),'junction');
    await symlink(join(runtime,'vendor/dsh-pet/node_modules'),join(skeleton,'vendor/dsh-pet/node_modules'),'junction');
    for(const p of ['windows/assets/shuangling'])await mkdir(join(skeleton,p),{recursive:true});
    await mkdir(join(data,'dsh-home/dsh-pet/main-animation/webm'),{recursive:true});
    for(const row of assets.animations){const media=join(source,'windows/assets/shuangling',row.name+'.webm');await link(media,join(skeleton,'windows/assets/shuangling',row.name+'.webm'));await link(media,join(data,'dsh-home/dsh-pet/main-animation/webm',row.name+'.webm'))}
    const launcher=join(skeleton,'windows/start.mjs'),launchText=await readFile(launcher,'utf8');assert.equal(launchText.split("DSH_PET_CADENCE_TEST: '0'").length,2);await writeFile(launcher,launchText.replace("DSH_PET_CADENCE_TEST: '0'","DSH_PET_CADENCE_TEST: '1'"));
    const main=join(skeleton,'vendor/dsh-pet/runtime/electron-helper/main.js');
    report.sourceHashes=Object.fromEntries(await Promise.all(['src/bridge/controller.mjs','src/bridge/index.mjs','src/desk/service.mjs','src/desk/focus-notices.mjs','vendor/dsh-pet/runtime/electron-helper/sprite.js',...(statePollRecovery?['vendor/dsh-pet/runtime/electron-helper/events.js','vendor/dsh-pet/runtime/electron-helper/shared-core.js']:[]),...(sleepEventsOnly?['vendor/dsh-pet/runtime/electron-helper/main.js','vendor/dsh-pet/runtime/electron-helper/panel-main.cjs','vendor/dsh-pet/runtime/electron-helper/focus-sleep.cjs']:[])].map(async p=>[p,hash(await readFile(join(source,p)))])));
    await writeFile(main,await readFile(main,'utf8')+focusInstrumentation({sleepEvents:sleepEventsOnly}));
    const env={...process.env,CODEX_HOME:home,DSH_HOME:join(data,'dsh-home'),SHUANGLING_DATA_DIR:data,SHUANGLING_NO_OPEN:'1',SHUANGLING_SILENT_ERRORS:'1',SHUANGLING_CODEX_EXE:join(home,'missing-client.exe'),READING_AUDIT_PROBE:probeFile,READING_AUDIT_COMMAND:commandFile,READING_AUDIT_OUTPUT:output};
    for(const k of ['CODEX_THREAD_ID','ELECTRON_RUN_AS_NODE','SHUANGLING_LIFECYCLE_INTENT','DSH_PET_SMOKE','DSH_PET_INTERACTION_TEST'])delete env[k];
    manager=spawn(join(runtime,'windows/runtime/node/node.exe'),[launcher,'start'],{cwd:skeleton,env,windowsHide:true,stdio:'ignore'});manager.unref();
    identity=await until(async()=>{const v=await json(join(data,'desktop-runtime.json'));return v?.pid===manager.pid&&v.settingsUrl?v:null},25000,'manager-start');
    nativeHostPid=(await until(()=>json(join(data,'dsh-home/dsh-pet/standalone-runtime.json')),15000,'native-host-manifest')).pid;
    settings=new URL(identity.settingsUrl);assert.equal(settings.hostname,'127.0.0.1');
    const ready=await until(async()=>{const p=await probe();return p.ready&&p.configOk&&p.spriteCount===1?p:null},25000,'renderer-ready');
    helperPid=ready.nativePid;assert.deepEqual(ready.errors,[]);assert.deepEqual(ready.issues,[]);assert.equal(ready.focusable,false);
    if(visible){await command('native.present');console.log(JSON.stringify({progress:'visible-fixture-ready',title:'霜铃专注联调 · 独立测试',helperPid,output}));}
    const {PetClient}=await import(pathToFileURL(join(skeleton,'src/bridge/pet-client.mjs')));
    const {PetController}=await import(pathToFileURL(join(skeleton,'src/bridge/controller.mjs')));
    const {createDeskService}=await import(pathToFileURL(join(skeleton,'src/desk/service.mjs')));
    const {deliverFocusNotice}=await import(pathToFileURL(join(skeleton,'src/desk/focus-notices.mjs')));
    client=new PetClient({dshHome:join(data,'dsh-home')});
    const originalPlay=client.play.bind(client),originalBroadcast=client.broadcast.bind(client),originalPlayback=client.playback.bind(client);
    let pendingRetarget=false,retargetCheckpoint=null;
    client.play=async(name,...args)=>{const submittedAt=Date.now(),v=await originalPlay(name,...args),acceptedAckAt=Date.now();apiCalls.push({caseId:report.currentCase,kind:'play',name,id:v.playbackId,at:acceptedAckAt,submittedAt,acceptedAckAt});if(pendingRetarget&&name==='stretching-wings'){pendingRetarget=false;const receipt=await client.playback(v.playbackId,{waitTimeoutMs:0});retargetCheckpoint={status:receipt.status,at:Date.now()};controller.update(status('working','-new'));}return v};
    client.broadcast=async(...args)=>{apiCalls.push({caseId:report.currentCase,kind:'bubble',at:Date.now()});return originalBroadcast(...args)};
    client.playback=async(id,options)=>{if(report.currentCase==='pending-new-task')apiCalls.push({caseId:report.currentCase,kind:'receipt',waitTimeoutMs:options?.waitTimeoutMs??1000,id,at:Date.now()});return originalPlayback(id,options)};
    const status=(state,suffix='')=>({state,scope:'codex',threadId:'owned-fixture',turnId:'case-'+report.currentCase+suffix,updatedAt:new Date().toISOString()});
    const fresh=async(state='idle')=>{controller=new PetController({client,availableAnimations:assets.animations.map(r=>r.name),ambientPreferences:{ambientEnabled:false}});controller.kick=()=>{};controller.update(status(state));await until(async()=>{try{await controller.lease();return true}catch(error){if(['pose-unavailable','interaction-unavailable'].includes(error.reason))return false;throw error}},6000,'real-pose-before-fixture-lease');return controller};
    async function finishController(){if(controller){await controller.close();controller=null}}
    async function actualPlay(name){const promise=controller.one(name,controller.generation,{observeInteraction:true});let settled=false,failure;promise.then(()=>settled=true,error=>{settled=true;failure=error});await until(async()=>{if(failure)throw failure;const p=await probe();return Object.values(p.records).some(r=>r.caseId===report.currentCase&&r.name===name&&r.status==='playing'&&r.paints>=2)?p:null},15000,'playing-'+name);return{promise,get settled(){return settled}}}
    async function completeSynthetic(id){let clock=1800000000000,desk;const delivery=[];desk=await createDeskService({dataDir:join(output,'timer-'+id),now:()=>clock,autoTick:false,detectSleep:false,onNotice:n=>{const v=deliverFocusNotice(n,{desk,controller,getLanguage:async()=> 'zh-CN'});delivery.push(v);return v}});await desk.command({type:'focus.configure',focusMinutes:10,breakMinutes:1});await desk.command({type:'focus.start',phase:'focus'});clock+=600000;await desk.tick();await delay(1);await Promise.all(delivery);assert.equal(delivery.length,1);const state=await desk.snapshot();assert.equal(state.focus.status,'completed');return{desk,delivery,advance:async()=>{clock+=60000;await desk.tick();await delay(10)},done:()=>desk.close()}}
    if(sleepEventsOnly){
      // Exercise the real Electron listener -> private main-process client ->
      // authenticated manager API -> durable service. This emits an event only
      // inside the owned fixture; it never asks Windows to sleep.
      report.currentCase='sleep-event-route';await command('mark',{caseId:report.currentCase});
      const deskRequest=body=>request(settings.origin,'/api/desk',settings.hash.slice(1),body);
      const bridgeState=()=>request(settings.origin,'/api/state',settings.hash.slice(1));
      const hostSummary=async()=>sleepHostStateSummary(await client.request('state'),client.petId);
      // PollStateStore creates the pet entry lazily on its first actual write.
      // Seed genuine empty command leaves via a short acquire/release confined
      // to this fixture, BEFORE the baseline. Never invent counters for absence.
      const warmup=await client.lock(undefined,1000);
      assert.ok(typeof warmup.lockId==='string'&&warmup.lockId,'sleep-host-warmup-lock-required');
      await client.release(warmup.lockId);
      const beforeBridge=await bridgeState(),beforeAppearance=await client.appearance(),beforeHost=await hostSummary();
      const before=await until(async()=>{const p=await probe();return !p.bubble?.on?p:null},5000,'sleep-no-initial-bubble');
      assert.equal(beforeBridge.control.paused,true,'sleep-fixture-must-remain-paused');
      assert.equal(beforeHost.lockHeld,false,'sleep-fixture-must-not-hold-lock');
      assert.equal(before.focused,false,'sleep-fixture-must-not-be-focused');
      await deskRequest({type:'focus.configure',focusMinutes:10,breakMinutes:1});
      const startedAt=Date.now(),started=await deskRequest({type:'focus.start',phase:'focus'});
      assert.equal(started.focus.status,'running');assert.equal(started.focus.remainingMs,600000);
      await delay(250);
      const suspend=await command('native.suspend'),event=suspend.powerEvents.at(-1);
      assert.equal(event.event,'suspend');assert.equal(event.hadListener,true);assert.ok(event.listeners>=1,'actual-main-suspend-listener-required');
      const paused=await until(async()=>{const value=await deskRequest();return value.focus.status==='paused'&&value.focus.pauseReason==='sleep'?value:null},5000,'native-suspend-persisted-pause');
      assert.ok(paused.focus.remainingMs>0&&paused.focus.remainingMs<started.focus.remainingMs,'native-suspend-retains-remaining-time');
      assert.equal(paused.focus.endsAt,null);assert.equal(paused.focus.completionId,null);
      await command('native.resume');await delay(1200);
      const resumed=await deskRequest(),afterBridge=await bridgeState(),afterHost=await hostSummary(),after=await probe();
      assert.equal(resumed.focus.status,'paused');assert.equal(resumed.focus.pauseReason,'sleep');
      assert.equal(resumed.focus.remainingMs,paused.focus.remainingMs,'resume-never-counts-or-restarts-the-paused-timer');
      assert.equal(resumed.focus.endsAt,null);assert.equal(resumed.focus.completionId,null);
      assert.deepEqual(afterBridge.control,beforeBridge.control,'power-events-never-acquire-or-change-user-control');
      assert.deepEqual(afterHost,beforeHost,'power-events-never-write-lock-bubble-or-animation');
      assert.deepEqual(await client.appearance(),beforeAppearance,'power-events-never-show-or-reposition-pet');
      assert.equal(after.focused,false);assert.equal(after.visible,before.visible);assert.deepEqual(after.bounds,before.bounds);
      assert.equal(after.bubble.on,false);assert.equal(after.captures,0);
      assert.ok(!Object.values(after.records).some(row=>row.caseId===report.currentCase&&row.name==='stretching-wings'),'sleep-never-starts-reminder-wings');
      assert.deepEqual(after.powerEvents.map(row=>row.event),['suspend','resume'],'exactly-one-owned-event-per-phase');
      report.sleepEvents={ok:true,actualElectronEmitter:true,osSleepRequested:false,startedAt,events:after.powerEvents,
        hostBaselinePreparation:{kind:'owned-fixture-lock-acquire-release',beforeEventBaseline:true,noAnimationOrBubble:true},
        started:started.focus,paused:paused.focus,afterResume:resumed.focus,controlUnchanged:true,appearanceUnchanged:true,
        noControlAcquired:!afterHost.lockHeld,noBubble:true,noAnimationRequest:true,noWindowReveal:true,noFocus:true,noScreenshots:true,
        hostBefore:beforeHost,hostAfter:afterHost,persistence:null};
      report.cases.push({condition:'native-suspend-resume-route',ok:true});
    }else if(readingLatency){
      report.readingLatency={trials:[],repeats:readingRepeats,sameNativeWindow:true,clock:'Date.now plus native performance.timeOrigin+performance.now',speed:1,interpretation:'Observed submission, acceptance and native paint timing only; this replay does not identify a root cause or prove every visual transition.'};
      if(statePollRecovery)report.statePollRecovery={explicitFaultInjection:true,operation:'One successful native state response is returned as null per trial; later real responses are unchanged.',trials:[],historicalCauseEstablished:false};
      for(let index=0;index<readingRepeats;index++){
        report.currentCase='reading-latency-'+(index+1);await command('mark',{caseId:report.currentCase});
        if(!controller)await fresh('idle');else controller.update(status('idle'));
        const idle=await actualPlay('idle');assert.equal(await idle.promise,true,'latency-idle-real-ended');
        // Submit as soon as the production controller confirms idle ended;
        // fault mode alone adds the explicit arm command before submission.
        if(statePollRecovery)await command('state-poll.fail-once',{animation:'reading'});
        const reading=await actualPlay('reading');assert.equal(await reading.promise,true,'latency-reading-real-ended');
        const ended=await until(async()=>{const p=await probe(),rows=Object.values(p.records).filter(r=>r.caseId===report.currentCase);return rows.some(r=>r.name==='idle'&&r.status==='ended')&&rows.some(r=>r.name==='reading'&&r.status==='ended')?p:null},4000,'latency-native-ended-evidence');
        const rows=Object.values(ended.records).filter(r=>r.caseId===report.currentCase),idleRow=rows.find(r=>r.name==='idle'),readingRow=rows.find(r=>r.name==='reading');
        const call=apiCalls.find(r=>r.caseId===report.currentCase&&r.kind==='play'&&r.name==='reading');
        assert.ok(readingRow.paints>=2);report.readingLatency.trials.push({trial:index+1,idlePlaybackId:idleRow.id,readingPlaybackId:readingRow.id,...readingLatencySummary(idleRow,readingRow,call)});
        if(statePollRecovery){
          const faults=ended.statePollRecovery?.rows?.filter(row=>row.caseId===report.currentCase)||[];
          assert.equal(faults.length,1,'one-poll-fault-row-required');const fault=faults[0];
          assert.equal(fault.injectedCount,1,'one-successful-response-dropped');
          assert.equal(fault.affected?.playbackId,readingRow.id,'fault-must-affect-requested-reading');assert.equal(fault.affected?.name,'reading');
          assert.equal(fault.recovered?.playbackId,readingRow.id,'same-command-recovered-from-real-state');
          assert.ok(['armedAt','originalRequestedAt','originalResponseAt','injectedAt','recoveryRequestedAt','recoveredAt'].every(field=>Number.isFinite(fault[field])),'fault-timeline-incomplete');
          assert.ok(fault.originalRequestedAt<=fault.originalResponseAt&&fault.armedAt<=fault.injectedAt&&fault.injectedAt<=fault.recoveryRequestedAt&&fault.recoveryRequestedAt<=fault.recoveredAt,'fault-timeline-invalid');
          assert.equal(ended.statePollRecovery.armed,false);assert.equal(ended.statePollRecovery.recovering,false);
          report.statePollRecovery.trials.push({trial:index+1,...fault,injectedToRecoveryRequestMs:Math.round((fault.recoveryRequestedAt-fault.injectedAt)*1000)/1000,
            injectedToRecoveredMs:Math.round((fault.recoveredAt-fault.injectedAt)*1000)/1000,submitToNativeSwitchMs:report.readingLatency.trials.at(-1).transition.submitToSwitchMs});
        }
        await writeFile(join(output,'progress.json'),JSON.stringify({at:new Date().toISOString(),mode:report.mode,trials:report.readingLatency.trials},null,2));
      }
      report.readingLatency.maximumGapMs=Math.max(...report.readingLatency.trials.map(r=>r.idleEndedToNativePlayingMs));
      if(autonomousReading){
        await finishController();
        report.currentCase='autonomous-reading';await command('mark',{caseId:report.currentCase});
        const startedAt=Date.now();
        controller=new PetController({client,availableAnimations:assets.animations.map(r=>r.name),ambientPreferences:{ambientEnabled:true,ambientFrequency:'normal'}});
        controller.update(status('idle'));
        const ended=await until(async()=>{const p=await probe();return Object.values(p.records).some(r=>r.caseId===report.currentCase&&r.name==='reading'&&r.status==='ended')?p:null},300000,'autonomous-reading-ended');
        const rows=Object.values(ended.records).filter(r=>r.caseId===report.currentCase),readingRow=rows.find(r=>r.name==='reading'&&r.status==='ended');
        const idleRow=rows.filter(r=>r.name==='idle'&&r.status==='ended'&&r.endedAt<=readingRow.startedAt).sort((a,b)=>b.endedAt-a.endedAt)[0];
        const call=apiCalls.find(r=>r.caseId===report.currentCase&&r.kind==='play'&&r.id===readingRow.id);
        assert.ok(idleRow&&call,'autonomous-reading-missing-boundary');
        report.autonomousReading={normalFrequency:true,randomSelection:'Math.random',controllerRunUnmodified:true,speed:1,wallClockMs:Date.now()-startedAt,plays:rows.map(r=>({name:r.name,status:r.status,startedAt:r.startedAt,endedAt:r.endedAt})),...readingLatencySummary(idleRow,readingRow,call)};
        await finishController();
      }
    }else{
    // One honest wall-clock minute, while its logical controller remains paused.
    realController=new PetController({client,initialPaused:true});realController.kick=()=>{};realController.update(status('idle'));let realCompletionAt=null;
    realDesk=await createDeskService({dataDir:join(output,'real-minute-timer'),detectSleep:false,onNotice:n=>{realCompletionAt=Date.now();const v=deliverFocusNotice(n,{desk:realDesk,controller:realController});deliveries.push(v);return v}});
    await realDesk.command({type:'focus.configure',focusMinutes:10,breakMinutes:1});const realStartedAt=Date.now();await realDesk.command({type:'focus.start',phase:'break'});
    for(const condition of selected.filter(value=>value!=='hidden')){
      report.currentCase=condition;await command('mark',{caseId:condition});await fresh(['working','waiting'].includes(condition)?condition:'idle');
      let play=null;
      if(['idle','working','waiting','reading','wing-cooldown','pending-new-task'].includes(condition)){play=await actualPlay(condition==='working'?'running':condition==='waiting'?'waiting':condition==='reading'?'reading':'idle');await delay(condition==='pending-new-task'?1500:350)}
      if(condition==='paused')controller.paused=true;
      if(condition==='manual'){await command('manual');await until(async()=>{const p=await probe();return p.interaction?.kind==='menu'&&!p.interaction.resumable?p:null},5000,'manual-ownership')}
      if(condition==='dragging'){await command('drag.begin');await until(async()=>{const p=await probe();return p.dragActive&&p.interaction?.phase==='dragging'?p:null},7000,'drag-ownership')}
      if(condition==='wing-cooldown')controller.lastAmbientEnded['stretching-wings']=Date.now();
      const beforeCalls=apiCalls.length,before=await probe();
      const completion=await completeSynthetic(condition);
      const notices=apiCalls.slice(beforeCalls).filter(r=>r.kind==='bubble');
      const allowsBubble=['idle','reading','wing-cooldown','pending-new-task'].includes(condition);
      assert.equal(notices.length,allowsBubble?1:0,'bubble-priority-'+condition);
      const cue=controller.cue?{...controller.cue}:null;
      assert.equal(!!cue,['idle','pending-new-task'].includes(condition),'cue-priority-'+condition);
      if(allowsBubble)await until(async()=>{const p=await probe();return p.bubble?.on&&p.bubble.text.includes('专注结束')?p:null},5000,'real-bubble-dom');
      if(condition==='idle'||condition==='pending-new-task'){
        await play.promise;pendingRetarget=condition==='pending-new-task';
        const rest=controller.restUntil(Date.now()+100,controller.generation);
        if(condition==='idle'){
          await until(async()=>{const p=await probe();return Object.values(p.records).some(r=>r.caseId===condition&&r.name==='stretching-wings'&&r.status==='playing'&&r.paints>=2)?p:null},10000,'focus-wing-native');
          await until(async()=>{const p=await probe();return Object.values(p.records).some(r=>r.caseId===condition&&r.name==='stretching-wings'&&r.status==='ended')?p:null},15000,'focus-wing-ended');
          controller.generation++;await rest;
        }else{
          await rest;assert.equal(retargetCheckpoint?.status,'accepted','retarget-requires-host-accepted');
          const task=await actualPlay('running');await task.promise;
          await until(async()=>{const p=await probe();return Object.values(p.records).some(r=>r.caseId===condition&&r.name==='running'&&r.status==='ended')?p:null},4000,'retarget-running-native-ended');
          const p=await probe();assert.ok(!Object.values(p.records).some(r=>r.caseId===condition&&r.name==='stretching-wings'&&r.paints>0),'unstarted-focus-wing-cannot-jump-a-new-task');
        }
      }else if(play){await play.promise;await until(async()=>{const p=await probe();return Object.values(p.records).some(r=>r.caseId===condition&&r.status==='ended')?p:null},4000,'native-confirmed-ended-'+condition)}
      if(condition==='manual')await until(async()=>{const p=await probe();return p.interaction?.phase==='settled'?p:null},14000,'manual-ended');
      if(condition==='dragging'){await delay(1000);await command('drag.release',{cancelled:false});await until(async()=>{const p=await probe();return p.interaction?.phase==='settled'&&!p.dragVisualActive&&!p.throwActive?p:null},14000,'drag-settled')}
      const callsAfter=apiCalls.length;
      controller.status=status('idle','-restored');controller.paused=false;controller.preempted=false;
      await completion.advance();await completion.advance();assert.equal(apiCalls.length,callsAfter,'suppressed-notice-no-backlog-'+condition);await completion.done();
      const after=await probe();assert.equal(after.focused,false,'no-focus-theft');assert.deepEqual(after.errors,[]);assert.deepEqual(after.issues,[]);
      report.cases.push({condition,ok:true,bubbleCount:notices.length,cueQueued:!!cue,nativeVisibleBefore:before.visible,nativeVisibleAfter:after.visible,nativeFocused:after.focused,ownershipBefore:before.interaction,ownershipAfter:after.interaction,playRequests:apiCalls.slice(beforeCalls).filter(r=>r.kind==='play').map(r=>r.name),nativePlaybacks:Object.values(after.records).filter(r=>r.caseId===condition).map(r=>({name:r.name,status:r.status,paints:r.paints,firstTime:r.firstTime})),noLateReplay:true,syntheticCompletionClock:true,...(condition==='pending-new-task'?{retargetCheckpoint}:{})});
      await finishController();await delay(4500);
      await writeFile(join(output,'progress.json'),JSON.stringify({at:new Date().toISOString(),cases:report.cases,realTimerStartedAt:realStartedAt},null,2));
    }
    // Genuine persisted hide/show route, confined to this fixture host.
    if(selected.includes('hidden')){
    report.currentCase='hidden';await command('mark',{caseId:'hidden'});await fresh('idle');
    const config=await client.config();await client.request('config',{method:'PUT',surface:false,body:{...config.main,pets:config.main.pets.map(p=>p.id==='shuangling'?{...p,display:'none'}:p)}});
    await until(async()=>{const value=await client.appearance();return value.display==='none'},10000,'hidden-config');
    await until(()=>!alive(helperPid),10000,'hidden-native-window-process-gone');
    const beforeHiddenCalls=apiCalls.length,hiddenCompletion=await completeSynthetic('hidden');assert.equal(apiCalls.length,beforeHiddenCalls,'hidden-notice-makes-no-play-or-broadcast');
    await hiddenCompletion.advance();assert.equal((await client.appearance()).display,'none','completion-never-reopens-hidden-pet');
    await finishController();
    const hiddenConfig=await client.config();await client.request('config',{method:'PUT',surface:false,body:{...hiddenConfig.main,pets:hiddenConfig.main.pets.map(p=>p.id==='shuangling'?{...p,display:'desktop'}:p)}});
    await until(async()=>{const p=await probe();return p.ready&&p.nativePid!==helperPid&&alive(p.nativePid)?p:null},20000,'reshown-native');
    await hiddenCompletion.advance();assert.equal(apiCalls.length,beforeHiddenCalls,'show-does-not-replay-hidden-completion');await hiddenCompletion.done();
    report.cases.push({condition:'hidden',ok:true,bubbleCount:0,cueQueued:false,persistedDisplayNone:true,hiddenNativeProcessExited:true,explicitShowRequired:true,noLateReplay:true,syntheticCompletionClock:true});
    }
    await until(async()=>{const s=await realDesk.snapshot();return s.focus.status==='completed'?s:null},Math.max(1000,68000-(Date.now()-realStartedAt)),'real-minute-completion');await Promise.all(deliveries);
    assert.equal(deliveries.length,1);assert.ok(realCompletionAt-realStartedAt>=59000,'real-minute-not-accelerated');assert.equal(realController.cue,null);
    report.realMinute={ok:true,phase:'break',logicalControl:'paused',wallClockMs:realCompletionAt-realStartedAt,completionCount:deliveries.length,noAction:true,noAutoNextPhase:(await realDesk.snapshot()).focus.phase==='break'};
    }
    const final=await probe();report.checks={noRendererErrors:!final.errors.length&&!final.issues.length,noCrossGenerationPaint:!final.violations.length,noFocusTheft:!final.focused,...(sleepEventsOnly?{nativeSleepEventRoute:report.sleepEvents?.ok===true}:readingLatency?{completeReadingReplays:report.readingLatency.trials.length===readingRepeats,...(autonomousReading?{autonomousReadingEnded:!!report.autonomousReading}:{} ),...(statePollRecovery?{exactlyOnePollFailurePerTrial:report.statePollRecovery.trials.length===readingRepeats&&final.statePollRecovery.rows.length===readingRepeats&&final.statePollRecovery.rows.every(row=>row.injectedCount===1&&Number.isFinite(row.recoveredAt))}:{})}:{allSelectedConditions:report.cases.length===selected.length&&report.cases.every(r=>r.ok)}),fixtureBridgeRemainedPaused:(await request(settings.origin,'/api/state',settings.hash.slice(1))).control.paused===true,sourceUnchanged:true,mediaUnchanged:true};
    for(const[p,expected]of Object.entries(report.sourceHashes))if(hash(await readFile(join(source,p)))!==expected)report.checks.sourceUnchanged=false;
    for(const row of assets.animations)if(hash(await readFile(join(source,'windows/assets/shuangling',row.name+'.webm')))!==row.webmSha256)report.checks.mediaUnchanged=false;
    report.ok=Object.values(report.checks).every(Boolean)&&(sleepEventsOnly||readingLatency||report.realMinute.ok);
  }catch(error){report.failure=sanitizeAuditText(error.message);report.failureDetails={name:error.name,stack:sanitizeAuditText(error.stack),case:report.currentCase||'startup'};const p=await json(probeFile);report.nativeFailure=p?{ready:p.ready,current:p.current,interaction:p.interaction,errors:p.errors,issues:p.issues}:null;}
  finally{
    await controller?.close().catch(()=>{});await realDesk?.close().catch(()=>{});await realController?.close().catch(()=>{});await stopOwned();
    if(nativeHostPid)await until(()=>!alive(nativeHostPid),10000,'native-exit').catch(()=>{});
    for(const pid of helperPids)await until(()=>!alive(pid),10000,'helper-exit').catch(()=>{});
    report.checks.fullExit=!alive(manager?.pid)&&!alive(nativeHostPid)&&[...helperPids].every(pid=>!alive(pid));report.ok&&=report.checks.fullExit;
    if(sleepEventsOnly&&report.ok){
      // The previous writer is fully gone. Re-open its actual isolated store
      // through the production service; never copy it into the live data dir.
      let recovered;
      try{
        const {createDeskService}=await import(pathToFileURL(join(skeleton,'src/desk/service.mjs')));
        recovered=await createDeskService({dataDir:data,autoTick:false});
        const value=await recovered.snapshot();
        assert.equal(value.focus.status,'paused');assert.equal(value.focus.pauseReason,'sleep');
        assert.equal(value.focus.remainingMs,report.sleepEvents.paused.remainingMs);
        assert.equal(value.focus.endsAt,null);assert.equal(value.focus.completionId,null);
        report.sleepEvents.persistence={ok:true,method:'normal-fixture-manager-exit-then-production-service-reopen',focus:value.focus};
        report.checks.sleepPausePersisted=true;
      }catch(error){report.checks.sleepPausePersisted=false;report.ok=false;report.persistenceFailure=sanitizeAuditText(error.message);}
      finally{await recovered?.close().catch(()=>{report.ok=false;report.checks.sleepPausePersisted=false;});}
    }
    report.ownedProcesses={manager:manager?.pid||null,nativeHost:nativeHostPid||null,helpers:[...helperPids]};report.apiCalls=apiCalls;
    report.finishedAt=new Date().toISOString();delete report.currentCase;
    report.limitations=[...(sleepEventsOnly?['Only the owned Electron process emits suspend/resume events. Windows is never put to sleep; this validates the installed event listener and authenticated forwarding, not delivery during real OS power transitions.','The actual fixture manager owns the timer. After its normal exit, the same isolated store is reopened by the production service in the audit process; this is not a live-pet restart.','No completion deadline is accelerated in this mode. Failure of an asynchronous request during a real short sleep remains outside this evidence.']:readingLatency?['Scripted idle-to-reading replays use production one()/PetClient and the native decoder; they are not weighted autonomous scheduling. Any separate autonomousReading record uses the normal production run loop, frequency and random selection.','Submission time is recorded before invoking PetClient.play; acknowledgement follows its HTTP response, native timestamps come from the real playing/ended reports. Native playing may precede acknowledgement if the response itself was delayed.']:['Task/ownership inputs and most completions are explicit synthetic fixture inputs, not real Codex tasks or OS mouse gestures.','The one-minute break uses actual wall-clock time; all other completion clocks are advanced solely inside independent test storage.']),'Native decoding, paint ownership and visibility do not prove all artwork anatomy or absence of every subtle visual artifact.','The fixture is input-transparent and showInactive; no automatic deletion or media/runtime copying is performed.'];
    if(statePollRecovery)report.limitations.push('State-poll recovery is an explicit, one-response fault injection inside the isolated renderer; it neither proves a spontaneous failure occurred nor establishes the cause of the earlier 1597.7 ms observation. The arm-command wait is separately included in idle-ended-to-submit timing.');
    await headroom(runtime);await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  }
  return report;
}

export function selfCheck(){
  const reading={startedAt:1500,endedAt:11500,paints:240,maxPaintGapMs:42};
  const s=readingLatencySummary({endedAt:1000},reading,{submittedAt:1100,acceptedAckAt:1200});
  assert.equal(s.submitToAckMs,100);assert.equal(s.ackToNativePlayingMs,300);assert.equal(s.idleEndedToNativePlayingMs,500);
  assert.equal(s.transition.available,false);assert.equal(s.transition.slot,null);assert.equal(s.transition.switchToHandoffRequestMs,null);
  const transition={generation:7,switchAt:1120,handoffRequestedAt:1250,firstPaintAt:1400,commitAt:1401,nativePlayingAt:1402,handoffCommitConfirmedAt:1403,
    slot:{cache:'cold',sameSource:false,readyState:0,seeking:false,currentTime:0,error:false}};
  const traced=readingLatencySummary({endedAt:1000},{...reading,transition},{submittedAt:1100,acceptedAckAt:1600});
  assert.equal(traced.ackToNativePlayingMs,-100,'late-http-ack-keeps-signed-native-delta');
  assert.equal(traced.transition.ackToSwitchMs,-480,'late-http-ack-keeps-signed-switch-delta');
  assert.equal(traced.transition.switchToHandoffRequestMs,130);assert.equal(traced.transition.handoffRequestToFirstPaintMs,150);
  assert.equal(traced.transition.commitToNativePlayingMs,1);assert.equal(traced.transition.firstPaintToNativePlayingMs,2);
  assert.equal(traced.transition.slot.cache,'cold');assert.equal(traced.transition.generation,7);
  for(const cache of ['warm','preloaded'])assert.equal(transitionLatencySummary({...transition,slot:{...transition.slot,cache}},{}).slot.cache,cache);
  const partial=transitionLatencySummary({generation:8,switchAt:0},{});
  assert.equal(partial.available,true);assert.equal(partial.firstPaintAt,null);assert.equal(partial.handoffRequestToFirstPaintMs,null);
  const ordinary=focusInstrumentation(),sleep=focusInstrumentation({sleepEvents:true});
  assert.equal(ordinary.includes('powerMonitor.emit(event)'),false,'ordinary-mode-keeps-original-command-surface');
  assert.ok(sleep.includes('powerMonitor.emit(event)')&&sleep.includes('powerEvents:powerEvents.slice(-8)'));
  assert.throws(()=>focusInstrumentation({sleepEvents:'yes'}));
  const host={counter:10,sections:{},pets:{shuangling:{lock:{counter:10,data:{locked:false}},say:{counter:0,data:null},anim:{counter:0,data:null},position:{counter:0,data:null},throw:{counter:0,data:null}}}};
  assert.deepEqual(sleepHostStateSummary(host),{petId:'shuangling',lockHeld:false,lockCounter:10,sayCounter:0,animCounter:0});
  const invalidHost=[];
  for(const mutate of [value=>{value.pets={}},value=>{value.pets.other=value.pets.shuangling;delete value.pets.shuangling},value=>{delete value.pets.shuangling.anim},value=>{value.pets.shuangling.say.counter=null},value=>{value.pets.shuangling.anim.counter=NaN},value=>{value.pets.shuangling.lock.data=null},value=>{value.pets.shuangling.lock.data.locked='false'},value=>{value.pets.shuangling.say.counter=11}]){const value=structuredClone(host);mutate(value);invalidHost.push(value);}
  for(const value of [null,{},...invalidHost])assert.throws(()=>sleepHostStateSummary(value));
  return{ok:!!ordinary&&!!sleep,readingLatencySummary:true,transitionTimelineSummary:true,sleepInstrumentationSyntax:true,strictSleepHostEvidence:true,nativeStarted:false};
}

/** Test the generated event command/ack observer without Electron or disk I/O. */
export async function sleepEventInstrumentationSelfCheck(){
  let tick,command={id:'owned-suspend',operation:'native.suspend'},published,suspends=0;
  const events=new EventEmitter();events.on('suspend',()=>suspends++);
  const fs={statfsSync:()=>({bavail:10,bsize:1024**3}),readFileSync:()=>JSON.stringify(command),writeFileSync:(_path,contents)=>{published=JSON.parse(contents)}};
  const app=new EventEmitter(),fakeProcess=new EventEmitter();fakeProcess.pid=123;fakeProcess.env={READING_AUDIT_OUTPUT:'D:/owned-fixture',READING_AUDIT_PROBE:'probe',READING_AUDIT_COMMAND:'command'};
  const win={isDestroyed:()=>false,getOpacity:()=>0,getFocusable:()=>false,isFocusable:()=>false,isVisible:()=>false,isFocused:()=>false,getTitle:()=>'',getBounds:()=>({x:1,y:2,width:3,height:4}),webContents:{executeJavaScript:async()=>({ready:true,records:{},current:null,bubble:{on:false}})}};
  runInNewContext(focusInstrumentation({sleepEvents:true}),{require:name=>name==='node:fs'?fs:name==='node:path'?{parse:()=>({root:'D:/'})}:name==='node:perf_hooks'?{performance:{now:()=>1}}:assert.fail('unexpected-instrumentation-require'),app,process:fakeProcess,powerMonitor:events,windows:new Map([[1,win]]),setInterval:fn=>{tick=fn;return{unref(){}}}});
  await tick();assert.equal(suspends,1);assert.equal(published.captures,0);
  assert.equal(published.powerEvents[0].id,command.id);assert.equal(published.powerEvents[0].listeners,1);assert.equal(published.powerEvents[0].hadListener,true);
  command={id:'owned-resume',operation:'native.resume'};await tick();
  assert.deepEqual(published.powerEvents.map(row=>row.event),['suspend','resume']);
  assert.equal(published.powerEvents[1].hadListener,false);assert.equal(suspends,1);assert.deepEqual(published.issues,[]);
  await tick();assert.equal(published.powerEvents.length,2,'same-command-is-not-repeated');
  return{ok:true,generatedEventCommands:true,nativeStarted:false,realFilesWritten:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),runtimeIndex=args.indexOf('--runtime-root'),conditionsIndex=args.indexOf('--conditions'),repeatsIndex=args.indexOf('--reading-repeats');
  if(args.includes('--self-check')){const checked=selfCheck();await statePollRecoverySelfCheck();const sleep=await sleepEventInstrumentationSelfCheck();console.log(JSON.stringify({...checked,sleepEventCommands:sleep.ok}));}
  else{const report=await auditFocusPriority(args[0]||projectRoot,{runtimeRoot:runtimeIndex>=0?args[runtimeIndex+1]:args[0]||projectRoot,visible:args.includes('--visible'),conditions:conditionsIndex>=0?args[conditionsIndex+1].split(','):null,readingLatency:args.includes('--reading-latency'),readingRepeats:repeatsIndex>=0?Number(args[repeatsIndex+1]):3,autonomousReading:args.includes('--autonomous-reading'),statePollRecovery:args.includes('--state-poll-recovery'),sleepEventsOnly:args.includes('--sleep-events-only')});console.log(JSON.stringify(report,null,2));process.exitCode=report.ok?0:1}
}
