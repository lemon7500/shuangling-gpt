'use strict';
// Offscreen typography samples only. No pet, account, preferences or desktop capture.
const { app, BrowserWindow } = require('electron');
const { mkdirSync, mkdtempSync, writeFileSync, statfsSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const output = resolve(process.argv[2] || join(root, 'reports/typography-samples'));
const disk = statfsSync(root); assert.ok(disk.bavail * disk.bsize > 3 * 1024 ** 3 + 32 * 1024 ** 2, 'disk-safety-stop');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'type-profile-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.setName('shuangling-typography-fixture'); app.disableHardwareAcceleration();
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
const helper = join(root, 'vendor/dsh-pet/runtime/electron-helper');
const fontCss = pathToFileURL(join(helper, 'fonts/shuangling-fonts.css')).href;
const bubbleCss = pathToFileURL(join(helper, 'shuangling-bubble.css')).href;
const html = `<!doctype html><html lang="zh-CN" class="shuangling-profile"><meta charset="utf-8"><title>霜铃 · 三语字体样张</title>
<link rel="stylesheet" href="${fontCss}"><link rel="stylesheet" href="${bubbleCss}">
<style>*{box-sizing:border-box}body{margin:0;background:#f4f0f8;color:#342d40;font:14px/1.6 "Microsoft YaHei UI","Segoe UI",sans-serif;padding:28px}h1{margin:0;font-size:22px;font-weight:500}header p{margin:5px 0 22px;color:#776684}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}section{background:#fff;border:1px solid #e4ddec;border-radius:16px;overflow:hidden}h2{font:400 20px/1.5 var(--shuangling-font-family);margin:16px 18px 2px}.caption{margin:0 18px;color:#887695;font-size:12px}.stage{height:185px;position:relative;margin-top:8px;background:linear-gradient(145deg,#fbf9fd,#eee7f5)}.stage.dark{background:#302a3b;height:155px;margin:0}.stage .pet-bubble{position:absolute;left:16px;top:25px;bottom:auto;transform:none;opacity:1;max-width:235px;--dsh-pet-font-bubble:15px}.glyphs{font:400 15px/1.8 var(--shuangling-font-family);margin:15px 18px;min-height:95px}.pet-bubble:after{content:"";position:absolute}footer{margin-top:17px;color:#776684;font-size:12px}</style>
<style>html.shuangling-profile .stage .pet-bubble.is-whisper{max-width:calc(100% - 32px)}</style>
<header><h1>霜境便笺 · 三语字体样张</h1><p>霞鹜文楷 LXGW WenKai 1.530 · 提示字号 15 px · 简体中文 / 繁體中文 / English</p></header>
<div class="grid">
<section lang="zh-CN"><h2>霜铃 GPT</h2><p class="caption">简体中文</p><div class="stage"><div class="pet-bubble is-on is-whisper is-shuangling-note">慢慢看看这一轮的结果。</div></div><div class="stage dark"><div class="pet-bubble is-on is-whisper is-shuangling-note">接下来，由你决定。</div></div><p class="glyphs">龙翼 · 书签 · 专注 · 剩余<br>这一步完成了。<br>0123456789 · 81% · 1,234,567</p></section>
<section lang="zh-TW"><h2>霜鈴 GPT</h2><p class="caption">繁體中文</p><div class="stage"><div class="pet-bubble is-on is-whisper is-shuangling-note">慢慢看看這一輪的結果。</div></div><div class="stage dark"><div class="pet-bubble is-on is-whisper is-shuangling-note">接下來，由你決定。</div></div><p class="glyphs">龍翼 · 書籤 · 專注 · 剩餘<br>這一步完成了。<br>0123456789 · 81% · 1,234,567</p></section>
<section lang="en"><h2>Shuangling GPT</h2><p class="caption">English</p><div class="stage"><div class="pet-bubble is-on is-whisper is-shuangling-note">Take a look when ready.</div></div><div class="stage dark"><div class="pet-bubble is-on is-whisper is-shuangling-note">You choose what is next.</div></div><p class="glyphs">Wings · Bookmarks · Focus<br>This step is complete.<br>0123456789 · 81% · 1,234,567</p></section></div>
<footer>字体依 OFL-1.1 随附，保留原版文件及版权。此页面使用独立演示文字，不读取你的聊天、手记或书签。</footer></html>`;
const file = join(output, 'font-samples.html'); writeFileSync(file, html);
let win;
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 900, height: 800, show: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await win.loadFile(file);
  await win.webContents.executeJavaScript('document.fonts.ready');
  const state = await win.webContents.executeJavaScript(`({loaded:document.fonts.check('15px "Shuangling WenKai"'),faces:[...document.fonts].map(f=>({family:f.family,status:f.status})),overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,cards:[...document.querySelectorAll('.pet-bubble')].map(n=>{const r=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();return{text:n.textContent,font:getComputedStyle(n).fontFamily,width:n.offsetWidth,height:n.offsetHeight,overflow:n.scrollWidth>n.clientWidth||r.left<p.left||r.right>p.right||r.bottom>p.bottom}})})`);
  assert.ok(state.loaded && state.faces.some(f => f.family === 'Shuangling WenKai' && f.status === 'loaded'));
  assert.equal(state.overflow, false); assert.ok(state.cards.every(card => !card.overflow));
  writeFileSync(join(output, 'font-samples.png'), (await win.webContents.capturePage()).toPNG());
  writeFileSync(join(output, 'font-samples-render.json'), JSON.stringify({ ok: true, fixtureOnly: true, ...state }, null, 2));
  console.log(JSON.stringify({ ok: true, cards: state.cards.length, loaded: state.loaded, sample: join(output, 'font-samples.png') }));
  win.destroy(); app.quit();
}).catch(error => { console.error(error.message); win?.destroy(); app.exit(1); });
