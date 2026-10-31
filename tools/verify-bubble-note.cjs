// Isolated native renderer check. Never connects to the real manager or reads user data.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const qa = path.resolve(process.env.SHUANGLING_BUBBLE_QA || path.join(root, 'reports/bubble-native'));
assert.notEqual(qa, root, 'QA output must use a dedicated directory');
app.setPath('userData', path.join(qa, 'isolated-bubble-profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
const url = file => pathToFileURL(path.join(root, file)).href;
const helper = 'vendor/dsh-pet/runtime/electron-helper/';
const guard = async () => { const disk = await fs.statfs(root); assert.ok(disk.bavail * disk.bsize > 3 * 1024 ** 3 + 32 * 1024 ** 2, 'disk-safety-stop'); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
async function main() {
  await guard(); await fs.mkdir(qa, { recursive: true });
  const { completionCaptions, statusCaption } = await import(pathToFileURL(path.join(root, 'src/bridge/captions.mjs')).href);
  const { deliverFocusNotice } = await import(pathToFileURL(path.join(root, 'src/desk/focus-notices.mjs')).href);
  const focusMessages = {};
  for (const language of Object.keys(completionCaptions)) {
    focusMessages[language] = {};
    for (const phase of ['focus', 'break']) await deliverFocusNotice({ id: 'isolated-'+phase, phase }, { getLanguage: async () => language,
      desk: { consumeNotice: async () => {} }, controller: { status: { state: 'idle' }, generation: 1, lockId: 'isolated-lease',
        client: { appearance: async () => ({ display: 'desktop' }) }, companionNotice: async text => { focusMessages[language][phase] = text; return true; } } });
  }
  const index = await fs.readFile(path.join(root, helper, 'index.html'), 'utf8');
  const stockStyle = index.match(/<style>([\s\S]*?)<\/style>/)[1];
  const fixture = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'none'"><style>${stockStyle}</style><link rel="stylesheet" href="${url(helper + 'fonts/shuangling-fonts.css')}"><link rel="stylesheet" href="${url(helper + 'shuangling-bubble.css')}"><style>body{overflow:hidden}#test-root{position:absolute;inset:0}.pet-stage video{width:100%;height:100%;display:block}.test-caption{position:fixed;left:12px;bottom:8px;font:12px 'Segoe UI',sans-serif;color:#81758e}</style></head><body><div id="test-root"></div><script src="${url(helper + 'shared-core.js')}"></script><script>const SHUANGLING_PROFILE=true;const S=window.PetShared;const BASE='fixture://unused';window.__dshPetDebug={};</script><script src="${url(helper + 'shuangling-bubble.js')}"></script><script src="${url(helper + 'sprite.js')}"></script><script>
  const testRoot=document.getElementById('test-root');
  const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=${JSON.stringify(url('windows/assets/shuangling/idle.webm'))};
  let active=null;
  window.fixtureReady=(async()=>{await document.fonts.load('16px "Shuangling WenKai"','霜鈴Shuangling');await document.fonts.ready;await new Promise((resolve,reject)=>{video.addEventListener('loadeddata',resolve,{once:true});video.addEventListener('error',()=>reject(Error('local-idle-not-loaded')),{once:true});video.load();});video.pause();return true})();
  window.renderFixture=async function(args){
    await window.fixtureReady;document.documentElement.lang=args.language;document.body.style.background=args.dark?'#282331':'#f6f3f9';
    testRoot.replaceChildren();testRoot.style.clipPath='inset('+args.bounds.y+'px '+Math.max(0,args.width-args.bounds.x-args.bounds.w)+'px '+Math.max(0,args.height-args.bounds.y-args.bounds.h)+'px '+args.bounds.x+'px)';
    const size=args.size,font=S.DEFAULT_FONT,m=size*.5,p=Object.create(PetSprite.prototype),fontPx=S.resolveFontPx(font,size),margin={l:m,r:m,b:m,t:Math.max(m,S.bubbleTopMarginPx(font,size))};
    const el=document.createElement('div');el.className='pet-sprite';el.style.left=margin.l+'px';el.style.top=margin.t+'px';el.style.setProperty('--pet-size',size+'px');el.style.setProperty('--dsh-pet-font-bubble',fontPx.bubble+'px');
    const stage=document.createElement('div');stage.className='pet-stage';stage.style.transform='translateY('+(size*9/16*(360-330)/360)+'px)';stage.append(video);el.append(stage);
    const bubble=document.createElement('div');bubble.className='pet-bubble';el.append(bubble);testRoot.append(el);
    Object.assign(p,{size,margin,height:size*9/16,el,bubble,hitRect:{x:200/640*size,y:size*9/16*(360-330)/360+50/360*size*9/16,w:240/640*size,h:285/360*size*9/16},
      whisperOn:true,whisperView:[{role:'row',text:args.text}],whisperUrl:'',whisperImage:'',assetRoot:'fixture',workOn:false,bubbleOn:false,workState:null,usageOn:false,
      visibleClampRect:()=>args.bounds,syncInputBusy(){},balanceClickable:()=>false});
    p.renderBubble();
    if(args.kind==='quota'){
      p.whisperOn=false;p.bubbleOn=true;p.usageOn=false;p.balanceExpanded=args.expanded;p.balanceState=null;p.balanceClickable=()=>true;
      p.balanceView=args.expanded?[{role:'quota',label:'5h',percent:36,tone:'normal',usedText:'36%',resetText:'2h 34m'},{role:'quota',label:args.language==='en'?'Weekly':'每週',percent:19,tone:'normal',usedText:'19%',resetText:'3d'}]:[{role:'row',text:'5h 64% · '+(args.language==='en'?'Weekly':'每週')+' 81%'}];
      p.renderBubble();
    }
    active=p;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const r=bubble.getBoundingClientRect(),row=bubble.querySelector('.pet-bub-row,.pet-bub-quota'),range=document.createRange();range.selectNodeContents(row);const lineRects=[...range.getClientRects()].map(x=>({x:x.x,y:x.y,w:x.width,h:x.height}));
    const rect={x:r.x,y:r.y,w:r.width,h:r.height};const face={x:margin.l+200/640*size,y:margin.t+p.hitRect.y,w:240/640*size,h:Math.min(p.hitRect.h*.35,size*.14)};
    const faceOverlap=Math.max(0,Math.min(r.right,face.x+face.w)-Math.max(r.left,face.x))*Math.max(0,Math.min(r.bottom,face.y+face.h)-Math.max(r.top,face.y));
    const visible=r.left>=args.bounds.x-.6&&r.top>=args.bounds.y-.6&&r.right<=args.bounds.x+args.bounds.w+.6&&r.bottom<=args.bounds.y+args.bounds.h+.6;
    const uncut=range.getBoundingClientRect().width<=row.clientWidth+.6&&lineRects.every(line=>line.x>=r.x-.6&&line.x+line.w<=r.right+.6&&line.y>=r.y-.6&&line.y+line.h<=r.bottom+.6);
    const screenshot={x:Math.max(0,Math.floor(Math.min(r.x,margin.l)-8)),y:Math.max(0,Math.floor(Math.min(r.y,margin.t)-8)),width:Math.min(args.width,Math.ceil(Math.max(r.right,margin.l+size)+8))-Math.max(0,Math.floor(Math.min(r.x,margin.l)-8)),height:Math.min(args.height,Math.ceil(Math.max(r.bottom,margin.t+size*9/16+size*9/16/12)+8))-Math.max(0,Math.floor(Math.min(r.y,margin.t)-8))};
    const seal=getComputedStyle(bubble,'::before'),sealRect={x:r.x+parseFloat(seal.left),y:r.y+parseFloat(seal.top),w:parseFloat(seal.width),h:parseFloat(seal.height)};
    const sealVisible=args.kind==='quota'||(sealRect.x>=args.bounds.x-.6&&sealRect.y>=args.bounds.y-.6&&sealRect.x+sealRect.w<=args.bounds.x+args.bounds.w+.6&&sealRect.y+sealRect.h<=args.bounds.y+args.bounds.h+.6);
    const preservedQuota=args.kind!=='quota'||(!bubble.classList.contains('is-shuangling-note')&&['left','top','bottom','maxWidth','transform'].every(key=>bubble.style[key]==='')&&getComputedStyle(bubble).pointerEvents==='auto'&&bubble.classList.contains('is-expanded')===args.expanded);
    return{rect,face,faceOverlap,visible,uncut,lines:lineRects.length,font:getComputedStyle(bubble).fontFamily,fontSize:getComputedStyle(bubble).fontSize,fontLoaded:document.fonts.check('16px "Shuangling WenKai"'),placement:bubble.dataset.shuanglingPlacement,compact:bubble.classList.contains('is-compact-note'),sealRect,sealVisible,preservedQuota,balancedTextSupported:CSS.supports('text-wrap','balance'),screenshot};
  };
  </script></body></html>`;
  await fs.writeFile(path.join(qa, 'bubble-fixture.html'), fixture);
  win = new BrowserWindow({ width: 1200, height: 1000, show: false, skipTaskbar: true, title: '霜铃气泡独立验收', webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const errors = [];
  win.webContents.on('console-message', (_event, details) => { if (details.level === 'error') errors.push(String(details.message).slice(0,200)); });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file:|data:|about:)/.test(details.url) }));
  await win.loadFile(path.join(qa, 'bubble-fixture.html'));
  await win.webContents.executeJavaScript('window.fixtureReady');
  const shared = await win.webContents.executeJavaScript('({defaultFont:S.DEFAULT_FONT})');
  const cases = [], quotaCases = [], shots = [];
  for (const zoom of [1, 1.5, 2]) {
    win.webContents.setZoomFactor(zoom);
    for (const size of [160, 367, 562]) {
      const m=size*.5,t=Math.max(m,await win.webContents.executeJavaScript('S.bubbleTopMarginPx(S.DEFAULT_FONT,'+size+')')),h=size*9/16,winW=size+2*m,winH=h+h/12+t+m;
      win.setContentSize(Math.ceil(winW*zoom),Math.ceil(winH*zoom)); await wait(20);
      const body={x:m+200/640*size,y:t+h/12+50/360*h,right:m+440/640*size,bottom:t+h/12+335/360*h};
      const clipped={center:{x:0,y:0,w:winW,h:winH},'top-left':{x:body.x,y:body.y,w:winW-body.x,h:winH-body.y},'top-right':{x:0,y:body.y,w:body.right,h:winH-body.y},'bottom-left':{x:body.x,y:0,w:winW-body.x,h:body.bottom},'bottom-right':{x:0,y:0,w:body.right,h:body.bottom}};
      for (const [language, messages] of Object.entries(completionCaptions)) for (const variant of (size===160?['short','long','waiting','interrupted','unknown','focus','break']:['short','long'])) for (const [corner,bounds] of Object.entries(clipped)) for (const dark of [false,true]) {
        const text=variant==='short'?messages[0]:variant==='long'?messages.reduce((a,b)=>a.length>b.length?a:b):['focus','break'].includes(variant)?focusMessages[language][variant]:statusCaption(variant,language);
        const args={language,text,size,bounds,width:winW,height:winH,dark};
        const metrics=await win.webContents.executeJavaScript('window.renderFixture('+JSON.stringify(args)+')');
        cases.push({zoom,size,language,variant,corner,dark,...metrics});
        if (zoom===1&&size===367&&variant==='long'&&corner==='center') { await wait(220);await guard(); const shot=await win.webContents.capturePage(metrics.screenshot);shots.push({language,dark,size,src:shot.toDataURL()}); }
      }
      for (const language of Object.keys(completionCaptions)) for (const expanded of [false,true]) {
        const args={language,text:completionCaptions[language][0],size,bounds:clipped.center,width:winW,height:winH,dark:false,kind:'quota',expanded};
        quotaCases.push({zoom,size,language,expanded,...await win.webContents.executeJavaScript('window.renderFixture('+JSON.stringify(args)+')')});
      }
    }
  }
  const failures=cases.filter(row=>!row.visible||!row.uncut||!row.fontLoaded||!row.sealVisible||row.faceOverlap>.5);
  const quotaFailures=quotaCases.filter(row=>!row.preservedQuota||!row.uncut);
  await guard(); await fs.writeFile(path.join(qa,'bubble-native-verification.json'),JSON.stringify({ok:!failures.length&&!quotaFailures.length,at:new Date().toISOString(),renderer:'isolated Electron BrowserWindow; actual PetSprite.renderBubble, note CSS/JS, local font, paused local idle video',realManagerContacted:false,userDataRead:false,desktopCaptured:false,scope:'local bubble layout under simulated work-area intersections, note-to-quota collapsed/expanded rendering and restoration; does not close Codex, modify pet bounds or exercise native pointer injection',cases:cases.length,quotaCases:quotaCases.length,failures,quotaFailures,consoleErrors:errors,results:cases,quotaResults:quotaCases},null,2)+'\n');
  win.webContents.setZoomFactor(1);win.setContentSize(1160,760);
  const sheet=`<!doctype html><html><meta charset="utf-8"><style>body{margin:0;padding:12px;background:#e9e4ef;font:13px 'Segoe UI',sans-serif;color:#342d40}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.card{border:1px solid #d6c9e2;border-radius:12px;padding:8px;background:#f9f7fc;text-align:center}.card img{display:block;max-width:100%;height:290px;object-fit:contain;margin:auto}.caption{padding:4px}</style><body><div class="grid">${shots.map(shot=>`<div class="card"><img src="${shot.src}"><div class="caption">${shot.language} · ${shot.dark?'Dark':'Light'} · ${shot.size}px</div></div>`).join('')}</div></body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(sheet));await wait(150);await guard();await fs.writeFile(path.join(qa,'bubble-three-language-native.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ok:!failures.length&&!quotaFailures.length,cases:cases.length,quotaCases:quotaCases.length,failureCount:failures.length,quotaFailureCount:quotaFailures.length,firstFailures:failures.slice(0,4),consoleErrors:errors,screenshot:path.join(qa,'bubble-three-language-native.png')}));
  app.exit(failures.length||quotaFailures.length?1:0);
}
app.whenReady().then(main).catch(async error=>{await fs.writeFile(path.join(qa,'bubble-native-error.json'),JSON.stringify({message:error.message,stack:error.stack},null,2)+'\n');console.error(error.stack);app.exit(1);});
