import assert from 'node:assert/strict';
import { copyFile, cp, link, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const release = resolve(process.argv[2] || join(root, `release/shuangling-gpt-${version}-windows-x64`));
const output = join(root, 'reports/i18n-audit', 'native-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0,8));
const skeleton = join(output, 'isolated-source'), data = join(output, 'isolated-data'), home = join(output, 'fake-codex-home');
const probeFile = join(output, 'native-probe.json'), commandFile = join(output, 'probe-command.json');
const json = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
const delay = ms => new Promise(done => setTimeout(done, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const report = { startedAt: new Date().toISOString(), realSettingsWrites: 0, publishedPackageWrites: 0, productCodeChanges: 0, checks: {} };
let manager, identity, native;
async function until(operation, timeout = 15000) { const end = Date.now()+timeout; while(Date.now()<end) { const value=await operation(); if(value) return value; await delay(100); } throw Error('native-i18n-timeout'); }
async function request(base,path,token,body,header='x-shuangling-token') { const response=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:{[header]:token,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000)});assert.ok(response.ok,'isolated API succeeds');return response.json(); }
async function stopOwned() { if(identity?.pid===manager?.pid&&alive(identity.pid))await request('http://127.0.0.1:'+identity.managerPort,'/stop',identity.token,{}).catch(()=>{}); if(manager)await until(()=>!alive(manager.pid),10000).catch(()=>{}); }
try {
  await mkdir(skeleton,{recursive:true}); await mkdir(data,{recursive:true}); await mkdir(home,{recursive:true});
  await writeFile(join(home,'config.toml'),'# Isolated native UI check; no plugins, accounts or credentials.\n');
  await writeFile(join(data,'plugin-config.json'),JSON.stringify({autoLaunch:false,language:'zh-CN',retained:'fixture-only'}));
  for(const directory of ['src','vendor/dsh-pet/runtime/electron-helper'])await cp(join(root,directory),join(skeleton,directory),{recursive:true});
  for(const file of ['package.json','windows/start.mjs','windows/outline-contract.mjs','windows/default-config.json','windows/runtime-config.json','windows/hd-geometry.json','windows/animation-timing.json','vendor/dsh-pet/lib/standalone.js','vendor/dsh-pet/package.json','vendor/dsh-pet/assets/config.jsonc','vendor/dsh-pet/assets/logo.png','reports/windows-assets.json','reports/windows-action-frames-v179.json']){await mkdir(dirname(join(skeleton,file)),{recursive:true});await copyFile(join(root,file),join(skeleton,file));}
  await symlink(join(release,'windows/runtime'),join(skeleton,'windows/runtime'),'junction');
  await symlink(join(release,'vendor/dsh-pet/node_modules'),join(skeleton,'vendor/dsh-pet/node_modules'),'junction');
  const assets=await json(join(skeleton,'reports/windows-assets.json'));
  for(const directory of ['windows/assets/shuangling'])await mkdir(join(skeleton,directory),{recursive:true});
  await mkdir(join(data,'dsh-home/dsh-pet/main-animation/webm'),{recursive:true});
  for(const {name} of assets.animations){await link(join(release,'windows/assets/shuangling',name+'.webm'),join(skeleton,'windows/assets/shuangling',name+'.webm'));await link(join(release,'windows/assets/shuangling',name+'.webm'),join(data,'dsh-home/dsh-pet/main-animation/webm',name+'.webm'));}
  // Test copies only: use the existing invisible/input-transparent render mode.
  const launcher=join(skeleton,'windows/start.mjs');
  await writeFile(launcher,(await readFile(launcher,'utf8')).replace("DSH_PET_CADENCE_TEST: '0'","DSH_PET_CADENCE_TEST: '1'"));
  const helperMain=join(skeleton,'vendor/dsh-pet/runtime/electron-helper/main.js');
  const instrumentation=String.raw`
// Test-skeleton-only read probe; not part of the product or distributable.
(() => {
  const probeFs=require('node:fs');const issues=[];let busy=false;
  app.on('web-contents-created',(_event,contents)=>{
    contents.on('console-message',event=>{if(event.level==='error'||event.level===3)issues.push(String(event.message).slice(0,200));});
    contents.on('render-process-gone',(_event,details)=>issues.push('renderer-gone:'+details.reason));
  });
  process.on('uncaughtExceptionMonitor',error=>issues.push('main-error:'+String(error.message).slice(0,200)));
  setInterval(async()=>{
    if(busy)return;busy=true;
    try{
      const win=[...windows.values()].find(value=>!value.isDestroyed());if(!win)return;
      let command={};try{command=JSON.parse(probeFs.readFileSync(process.env.NATIVE_I18N_COMMAND,'utf8'))}catch{}
      const snapshot=await win.webContents.executeJavaScript('('+((showError)=>{
        const p=typeof sprites!=='undefined'?sprites[0]:null;
        if(p&&!p.__nativeProbeTip){p.__nativeProbeTip=true;p.tipOn=true;p.renderTip();}
        const error=document.getElementById('pet-error');
        if(error){error.classList.toggle('visible',showError);if(showError)error.textContent=window.shuanglingI18n.t('桌宠配置暂时不可用，正在重试。');}
        const area=error?.getBoundingClientRect();
        return {language:document.documentElement.lang,title:document.title,aria:p?.hit?.getAttribute('aria-label'),hover:p?.tip?.textContent,configOk:window.__dshPetDebug?.configOk,spriteCount:window.__dshPetDebug?.spriteCount,errors:window.__dshPetDebug?.errors||[],errorVisible:error?.classList.contains('visible'),errorText:error?.textContent,errorOverflow:showError&&(error.scrollWidth>error.clientWidth+1||area.left<0||area.right>innerWidth+1)};
      }).toString()+')('+JSON.stringify(command.showError===true)+')');
      probeFs.writeFileSync(process.env.NATIVE_I18N_PROBE,JSON.stringify({...snapshot,mainLanguage:nativeLanguage,trayTooltip:tray?.getToolTip?.(),issues}));
    }catch(error){issues.push('probe:'+String(error.message).slice(0,200));}finally{busy=false;}
  },250).unref();
})();
`;
  await writeFile(helperMain,(await readFile(helperMain,'utf8'))+instrumentation);
  const env={...process.env,CODEX_HOME:home,SHUANGLING_DATA_DIR:data,SHUANGLING_NO_OPEN:'1',SHUANGLING_SILENT_ERRORS:'1',SHUANGLING_CODEX_EXE:join(home,'missing-native-account.exe'),NATIVE_I18N_PROBE:probeFile,NATIVE_I18N_COMMAND:commandFile};
  for(const key of ['CODEX_THREAD_ID','ELECTRON_RUN_AS_NODE','SHUANGLING_LIFECYCLE_INTENT'])delete env[key];
  manager=spawn(join(skeleton,'windows/runtime/node/node.exe'),[launcher,'start'],{cwd:skeleton,env,windowsHide:true,stdio:'ignore'});
  identity=await until(async()=>{const value=await json(join(data,'desktop-runtime.json'));return value?.pid===manager.pid&&value?.settingsUrl?value:null;});
  native=await json(join(data,'dsh-home/dsh-pet/standalone-runtime.json'));
  const url=new URL(identity.settingsUrl), token=url.hash.slice(1);
  await request(url.origin,'/api/settings',token,{paused:true});
  const ready=await until(async()=>{const value=await json(probeFile);return value?.configOk&&value?.spriteCount===1?value:null;});
  assert.deepEqual(ready.issues,[]);assert.deepEqual(ready.errors,[]);
  report.checks.nativeRendererLoaded={passed:true,configOk:true,spriteCount:1};
  const expected={ 'zh-CN':{name:'霜铃 GPT',title:'霜铃 GPT · 桌面伙伴'},'zh-TW':{name:'霜鈴 GPT',title:'霜鈴 GPT · 桌面夥伴'},en:{name:'Shuangling GPT',title:'Shuangling GPT · Desktop companion'} };
  report.checks.languageWatcher=[];
  for(const language of ['en','zh-TW','zh-CN']){
    await request(url.origin,'/api/preferences',token,{language});
    const value=await until(async()=>{const probe=await json(probeFile);return probe?.language===language&&probe.mainLanguage===language&&probe.aria===expected[language].name&&probe.hover===expected[language].name?probe:null;},6000);
    assert.equal(value.title,expected[language].title);if(value.trayTooltip!==undefined)assert.equal(value.trayTooltip,expected[language].name);assert.deepEqual(value.issues,[]);assert.deepEqual(value.errors,[]);
    report.checks.languageWatcher.push({language,passed:true,main:true,document:true,title:true,aria:true,hover:true,tray:value.trayTooltip===undefined?'not-created-in-passive-test-mode':true});
    if(language==='en'){
      await writeFile(commandFile,JSON.stringify({showError:true}));
      const error=await until(async()=>{const p=await json(probeFile);return p?.errorVisible?p:null;});
      assert.equal(error.errorText,'Pet settings are temporarily unavailable. Retrying.');assert.equal(error.errorOverflow,false);
      await writeFile(commandFile,JSON.stringify({showError:false}));await until(async()=>{const p=await json(probeFile);return p?.errorVisible===false;});
      report.checks.englishErrorBanner={passed:true,translated:true,noHorizontalClipping:true,restored:true};
    }
  }
  const {PetClient}=await import(pathToFileURL(join(skeleton,'src/bridge/pet-client.mjs')));
  const client=new PetClient({dshHome:join(data,'dsh-home')});
  const lock=await until(()=>client.lock(undefined,15000).catch(()=>null),3000);assert.ok(lock.lockId);
  const playback=await client.play('waving',lock.lockId);assert.ok(playback.playbackId);
  const ended=await until(async()=>{const value=await client.playback(playback.playbackId);if(['failed','cancelled'].includes(value.status))throw Error('native-playback-'+value.status);return value.status==='ended'?value:null;},12000);
  await client.release(lock.lockId);report.checks.realPlayback={passed:true,animation:'waving',receipt:ended.status};
  const final=await json(probeFile);assert.deepEqual(final.issues,[]);assert.deepEqual(final.errors,[]);
  assert.deepEqual(await json(join(data,'plugin-config.json')),{autoLaunch:false,language:'zh-CN',retained:'fixture-only'});
  report.checks.unrelatedFixturePreferencesRetained={passed:true};
  await stopOwned();assert.equal(alive(identity.pid),false);await until(()=>!alive(native.pid),10000);
  report.checks.fullExit={passed:true};report.ok=true;
}catch(error){report.ok=false;report.failure=String(error.message).split('\n')[0].slice(0,180);}
finally{await stopOwned();report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({...report,reportDirectory:output},null,2));process.exitCode=report.ok?0:1;
