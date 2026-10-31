'use strict';
// Fixed synthetic native input reproduction. Launch with Windows hidden startup,
// exactly like the shipped launcher; never connect to the installed manager.
const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const root=resolve(__dirname,'..'),helper=join(root,'vendor/dsh-pet/runtime/electron-helper');
const run=process.argv.includes('--baseline')?'baseline':'fixed';
const first=process.argv.find(value=>value.startsWith('--first='))?.slice(8)||'focus';
assert.ok(['focus','journal','notes'].includes(first),'fixed-shortcut-required');
const output=join(process.env.SHUANGLING_FIRST_TOOL_QA?resolve(process.env.SHUANGLING_FIRST_TOOL_QA):join(root,'reports/first-tools'),run+'-'+first);
const guard=()=>{const disk=fs.statfsSync(root);assert.ok(disk.bavail*disk.bsize>3*1024**3+32*1024**2,'disk-safety-stop')};
guard();fs.mkdirSync(output,{recursive:true});
const profile=fs.mkdtempSync(join(output,'isolated-profile-'));
app.setPath('userData',profile);app.setPath('sessionData',profile);
app.setName('Shuangling independent first-input check');
app.commandLine.appendSwitch('force-device-scale-factor','1');app.commandLine.appendSwitch('host-resolver-rules','MAP * ~NOTFOUND');
app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const {createPanelController}=require(join(helper,'panel-main.cjs'));
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const report={ok:false,run,syntheticDataOnly:true,realSettingsReads:0,realSettingsWrites:0,actualPetOrManagerStarted:false,networkRequestsAllowed:0,generationCredits:0,githubWrites:false,inputOrigin:'Electron.webContents.sendInputEvent',osMouseEvidence:false,windowsHiddenStartupRequired:true,windowEvents:[],showCalls:[],pointerEvents:[],commands:[],firstClicks:[],errors:[]};
const save=()=>{guard();fs.writeFileSync(join(output,'first-input-report.json'),JSON.stringify(report,null,2)+'\n')};
function nativeState(win){return win.isDestroyed()?{destroyed:true}:{destroyed:false,visible:win.isVisible(),focused:win.isFocused(),bounds:win.getBounds()}}
class TrackedWindow extends BrowserWindow{
  constructor(options){super({...options,webPreferences:{...options.webPreferences,backgroundThrottling:false}});this.role=options.transparent?'panel':'desk';
    for(const type of ['show','hide','focus','blur','closed'])this.on(type,()=>report.windowEvents.push({at:Date.now(),id:this.id,role:this.role,event:type,...nativeState(this)}));
    this.webContents.on('console-message',(event,details)=>{const value=typeof details==='object'?details:event;const message=String(value.message);if(message.startsWith('__FIRST_INPUT__'))report.pointerEvents.push({...JSON.parse(message.slice('__FIRST_INPUT__'.length)),windowId:this.id});else if(value.level>=2)report.errors.push(message.slice(0,200))});
    this.webContents.on('did-finish-load',()=>this.webContents.executeJavaScript(`document.addEventListener('pointerdown',event=>console.log('__FIRST_INPUT__'+JSON.stringify({at:Date.now(),trusted:event.isTrusted,tab:event.target.closest('[data-desk]')?.dataset.desk||null})),true)`));
  }
  show(){const before=nativeState(this);super.show();report.showCalls.push({at:Date.now(),id:this.id,role:this.role,before,after:nativeState(this)})}
}
let panel,owner,deskData;
const prefs={language:'zh-CN',autoLaunch:true,ambientEnabled:true,ambientFrequency:'normal',lifecycle:{available:true,taskInstalled:true,taskEnabled:true,pluginEnabled:true}};
const client={async request(route,body){if(body!==undefined){assert.equal(route,'/api/desk');assert.ok(['story.select','story.position','story.read','memory.read'].includes(body.type));return structuredClone(deskData)}
  if(route==='/api/state')return{status:{state:'working',scope:'codex',workingCount:1,waitingCount:0},control:{paused:false,preempted:false},availableAnimations:['idle']};
  if(route==='/api/preferences')return structuredClone(prefs);if(route==='/api/desk')return structuredClone(deskData);
  if(route==='/api/appearance')return{size:562,position:{corner:'bottom-right',marginX:20,marginY:12},metrics:{minWidth:160,maxWidth:1200,visibleHeightRatio:.35390625}};
  if(['/api/usage','/api/account-usage'].includes(route))return{};throw Error('fixture-route-forbidden');
}};
const ipc={handle(channel,handler){ipcMain.handle(channel,(event,value)=>{if(channel==='shuangling-panel:command'&&value?.type==='desk')report.commands.push({at:Date.now(),tab:value.tab,windowId:BrowserWindow.fromWebContents(event.sender)?.id});return handler(event,value)})},on(...args){ipcMain.on(...args);return ipc},removeListener(...args){ipcMain.removeListener(...args);return ipc},removeHandler(...args){return ipcMain.removeHandler(...args)}};
async function until(fn,label,timeout=10000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const v=await fn();if(v)return v;await wait(30)}throw Error('timeout:'+label)}
app.whenReady().then(async()=>{
  session.defaultSession.webRequest.onBeforeRequest((details,done)=>done({cancel:!(details.url.startsWith('file:')||details.url==='about:blank')}));
  const {STORIES}=await import(pathToFileURL(join(root,'src/desk/stories.mjs')));
  deskData={focus:{phase:'focus',status:'idle',focusMinutes:25,breakMinutes:5,remainingMs:1500000},journal:{entries:STORIES,selectedId:STORIES[0].id,positionById:{}},notes:[],memories:{enabled:true,reminders:true,entries:[],prompt:null}};
  owner=new BrowserWindow({x:500,y:300,width:100,height:200,show:false,skipTaskbar:true});await owner.loadURL('about:blank');
  panel=createPanelController({BrowserWindow:TrackedWindow,ipcMain:ipc,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1920,height:1080}})},getScale:()=>1,shell:{openExternal:()=>{throw Error('external-forbidden')}},client,isPetWindow:win=>win===owner,onError:e=>report.errors.push(e)});
  for(const tab of [first,...['focus','journal','notes'].filter(tab=>tab!==first)]){
    panel.close();panel.desk.close();await panel.open(owner);const card=panel.window;
    await until(()=>card.webContents.executeJavaScript(`!document.querySelector('[data-desk="${tab}"]').disabled`),'enabled-'+tab);
    await wait(70);const panelFirst=nativeState(card);
    // Baseline diagnostics may need the historically successful second show to
    // reach the actual tool shortcut. The first-show receipt remains explicit.
    if(run==='baseline'&&!card.isVisible()){card.show();card.focus();await wait(80)}
    const pointer=await card.webContents.executeJavaScript(`(()=>{const r=document.querySelector('[data-desk="${tab}"]').getBoundingClientRect();const x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);return{x,y,hit:document.elementFromPoint(x,y)?.closest('[data-desk]')?.dataset.desk}})()`);
    assert.equal(pointer.hit,tab);const offset=report.pointerEvents.length,commandOffset=report.commands.length,showOffset=report.showCalls.length,sentAt=Date.now();
    for(const type of ['mouseMove','mouseDown','mouseUp']){card.webContents.sendInputEvent({type,x:pointer.x,y:pointer.y,...(type==='mouseMove'?{}:{button:'left',clickCount:1})});await wait(20)}
    const tool=await until(()=>panel.desk.window,'desk-created-'+tab);
    await until(()=>tool.webContents.executeJavaScript(`document.readyState==='complete'&&!document.getElementById('${tab}').hidden&&!document.getElementById('note-text').disabled`),'desk-ready-'+tab);
    await wait(120);const first=nativeState(tool),firstShows=report.showCalls.slice(showOffset).filter(r=>r.role==='desk');
    const row={tab,clicks:1,inputOrigin:report.inputOrigin,panelFirst,first,readyMs:Date.now()-sentAt,pointers:report.pointerEvents.slice(offset),commands:report.commands.slice(commandOffset),firstShows};
    if(run==='baseline'&&!tool.isVisible()){tool.show();tool.focus();await wait(80);row.afterSecondShow=nativeState(tool)}
    report.firstClicks.push(row);save();panel.desk.close();await wait(80);
  }
  report.ok=report.firstClicks.length===3&&report.firstClicks.every(row=>row.panelFirst.visible&&row.first.visible&&row.first.focused&&row.pointers.length===1&&row.pointers[0].trusted===true&&row.commands.length===1)&&report.errors.length===0;
  save();panel.destroy();owner.destroy();app.exit(report.ok?0:1);
}).catch(error=>{report.failure=String(error.stack||error).slice(0,1400);save();panel?.destroy();owner?.destroy();app.exit(1)});
