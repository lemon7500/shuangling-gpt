import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const helper = new URL('../../vendor/dsh-pet/runtime/electron-helper/', import.meta.url);
const source = file => readFileSync(new URL(file, helper), 'utf8');
const i18n = require('../../vendor/dsh-pet/runtime/electron-helper/panel-i18n.js');
const main = source('main.js'), constants = source('constants.js');
const languages = ['zh-CN', 'zh-TW', 'en'];
afterEach(() => i18n.setLanguage('zh-CN'));
const plain = value => JSON.parse(JSON.stringify(value));

function nativeMainFixture({ profile = true, initial = 'en' } = {}) {
  const config = path.resolve('fixture-data', 'desktop-runtime.json');
  const preference = path.join(path.dirname(config), 'plugin-config.json');
  let contents = JSON.stringify({ language: initial, autoLaunch: false, retained: 'kept' });
  const reads = [], watches = [], stops = [], sent = [], trayChanges = [];
  const context = vm.createContext({
    process: { env: { SHUANGLING_PROFILE: profile ? '1' : '0', SHUANGLING_MANAGER_STATE: config } }, path, nativeI18n: i18n,
    readFileSync(file, encoding) { reads.push(file); assert.equal(file, preference); assert.equal(encoding, 'utf8'); if (contents instanceof Error) throw contents; return contents; },
    watchFile(file, options, callback) { watches.push({ file, options, callback }); },
    unwatchFile(file, callback) { stops.push({ file, callback }); },
    refreshNativeTray: () => trayChanges.push(i18n.getLanguage()),
    windows: new Map([
      ['live', { isDestroyed: () => false, webContents: { send: (...values) => sent.push(values) } }],
      ['gone', { isDestroyed: () => true, webContents: { send: () => assert.fail('do not send to destroyed windows') } }],
    ]),
  });
  const start = main.indexOf('const nativeLanguageProfile =');
  const end = main.indexOf('/** win.id ->', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(main.slice(start, end) + '\nthis.controls={watchNativeLanguage,refreshNativeLanguage,unwatchNativeLanguage,current:()=>nativeLanguage};', context);
  return { api: context.controls, reads, watches, stops, sent, trayChanges, preference, set: value => { contents = value; } };
}

test('native helper reads only the fixed language preference, watches without keeping it alive and disposes exactly its listener', () => {
  const fixture = nativeMainFixture();
  fixture.api.watchNativeLanguage(); fixture.api.watchNativeLanguage();
  assert.equal(fixture.api.current(), 'en');
  assert.equal(fixture.watches.length, 1);
  assert.deepEqual(plain(fixture.watches[0].options), { persistent: false, interval: 1000 });
  assert.equal(fixture.watches[0].file, fixture.preference);
  for (const language of ['zh-TW', 'zh-CN', 'en']) {
    fixture.set(JSON.stringify({ language, autoLaunch: false, retained: 'kept', token: 'not-for-renderer' }));
    fixture.watches[0].callback();
    assert.equal(fixture.api.current(), language);
    assert.deepEqual(plain(fixture.sent.at(-1)), ['pet:language', language]);
    assert.equal(fixture.trayChanges.at(-1), language);
  }
  assert.equal(fixture.sent.length, 3);
  fixture.set(Error('temporarily unreadable')); fixture.api.refreshNativeLanguage();
  fixture.set('{"language":'); fixture.api.refreshNativeLanguage();
  assert.equal(fixture.api.current(), 'en'); assert.equal(fixture.sent.length, 3);
  fixture.set('{"language":"http://arbitrary.invalid"}'); fixture.api.refreshNativeLanguage();
  assert.equal(fixture.api.current(), 'zh-CN');
  fixture.api.unwatchNativeLanguage(); fixture.api.unwatchNativeLanguage();
  assert.equal(fixture.stops.length, 1); assert.equal(fixture.stops[0].file, fixture.preference);
  assert.equal(fixture.stops[0].callback, fixture.watches[0].callback);
  assert.ok(fixture.reads.every(file => file === fixture.preference));
  assert.ok(!JSON.stringify(fixture.sent).includes('not-for-renderer'));
  assert.match(main, /language: nativeLanguage/);
  assert.match(main, /did-finish-load'[\s\S]*?send\('pet:language', nativeLanguage\)/);
  assert.match(main, /app\.on\('before-quit', \(\) => \{\s*unwatchNativeLanguage\(\)/);
});

test('upstream non-Shuangling helpers do not read or watch Shuangling preferences', () => {
  const fixture = nativeMainFixture({ profile: false });
  fixture.api.watchNativeLanguage(); fixture.api.refreshNativeLanguage(); fixture.api.unwatchNativeLanguage();
  assert.deepEqual(fixture.reads, []); assert.deepEqual(fixture.watches, []); assert.deepEqual(fixture.sent, []);
});

test('native preload exposes a one-way enum-only subscription with cleanup and no path or request capability', () => {
  const listeners = new Map(); let api;
  vm.runInNewContext(source('preload.js'), { require(name) {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'petBridge'); api = value; } },
      ipcRenderer: { on(channel, listener) { listeners.set(channel, listener); }, removeListener(channel, listener) { assert.equal(listeners.get(channel), listener); listeners.delete(channel); } } };
  } });
  const received = [], stop = api.onLanguage(value => received.push(value));
  assert.equal(listeners.size, 1);
  const listener = listeners.get('pet:language');
  for (const value of [null, {}, ['en'], 'en-US', 'ja', 'https://example.invalid', 1]) listener({}, value);
  for (const language of languages) listener({}, language);
  assert.deepEqual(received, languages);
  stop(); assert.equal(listeners.size, 0);
  assert.equal(typeof api.onLanguage(null), 'function'); assert.equal(listeners.size, 0);
  assert.equal(api.languagePath, undefined); assert.equal(api.setLanguage, undefined);
});

test('only built-in default pet names translate; customized names and all pet configuration bytes stay unchanged', () => {
  const pet = Object.freeze({ name: '霜铃 GPT', display: 'desktop', size: 339, custom: '保留我的名字' });
  const original = JSON.stringify(pet);
  const names = { 'zh-CN': '霜铃 GPT', 'zh-TW': '霜鈴 GPT', en: 'Shuangling GPT' };
  for (const language of languages) {
    i18n.setLanguage(language);
    for (const builtIn of Object.values(names)) assert.equal(i18n.petName(builtIn), names[language]);
    assert.equal(i18n.petName('我的霜铃'), '我的霜铃'); assert.equal(i18n.petName('My own pet'), 'My own pet');
    assert.equal(i18n.petName(' 霜铃 GPT '), ' 霜铃 GPT ');
    assert.equal(JSON.stringify(pet), original);
  }
});

test('tray rebuild uses the chosen language while retaining checked visibility and click behavior', () => {
  const tooltips = [], menus = [], toggles = [];
  const context = vm.createContext({
    tray: { isDestroyed: () => false, setToolTip: value => tooltips.push(value), setContextMenu: value => menus.push(value) },
    trayPets: [{ id: 'default', name: '霜铃 GPT', display: 'desktop' }, { id: 'custom', name: 'My custom name', display: 'none' }],
    nativeLanguageProfile: true, nativeI18n: i18n,
    Menu: { buildFromTemplate: value => value }, isDesktopDisplay: value => value === 'desktop' || value === 'both',
    toggleDisplay: value => value === 'none' ? 'desktop' : 'none', traySetPetDisplay: (...args) => toggles.push(args),
  });
  const block = main.match(/function refreshNativeTray\(\) \{[\s\S]*?\n\}/)?.[0]; assert.ok(block);
  vm.runInContext(block, context);
  for (const language of languages) {
    i18n.setLanguage(language); context.refreshNativeTray();
    assert.equal(tooltips.at(-1), i18n.t('霜铃 GPT'));
    const menu = menus.at(-1);
    assert.equal(menu[0].label, i18n.t('霜铃 GPT')); assert.equal(menu[0].checked, true);
    assert.equal(menu[1].label, 'My custom name'); assert.equal(menu[1].checked, false);
    menu[1].click(); assert.deepEqual(toggles.at(-1), ['custom', 'desktop']);
  }
});

test('native page language updates title, accessible name, visible tooltip and a prior config error without restarting animation', () => {
  let visible = true, renderCalls = 0; const aria = [];
  const context = vm.createContext({
    window: { shuanglingI18n: i18n }, SHUANGLING_PROFILE: true,
    document: { documentElement: { lang: 'zh-CN' }, title: '' },
    sprites: [{ pet: { name: '霜铃 GPT' }, hit: { setAttribute: (...args) => aria.push(args) }, tipOn: true, renderTip: () => renderCalls++ }],
    nativePetName: value => i18n.petName(value),
    errorEl: { classList: { contains: () => visible }, textContent: 'old error' },
  });
  const block = constants.match(/function applyNativeLanguage\(value\) \{[\s\S]*?\n\}/)?.[0]; assert.ok(block);
  vm.runInContext(block, context);
  for (const language of languages) {
    context.applyNativeLanguage(language);
    assert.equal(context.document.documentElement.lang, language);
    assert.equal(context.document.title, i18n.t('霜铃 GPT · 桌面伙伴'));
    assert.deepEqual(aria.at(-1), ['aria-label', i18n.t('霜铃 GPT')]);
    assert.equal(context.errorEl.textContent, i18n.t('桌宠配置暂时不可用，正在重试。'));
  }
  assert.equal(renderCalls, 3);
  context.applyNativeLanguage('en-US'); assert.equal(renderCalls, 3);
  visible = false; context.errorEl.textContent = ''; context.applyNativeLanguage('en'); assert.equal(context.errorEl.textContent, '');
  const html = source('index.html');
  assert.ok(html.indexOf('panel-i18n.js') < html.indexOf('constants.js'));
  assert.match(constants, /onLanguage\?\.\(applyNativeLanguage\)/);
  assert.match(constants, /beforeunload/);
});

test('native configuration errors have translated friendly text and keep technical details in console only', () => {
  const diagnostics = [];
  const context = vm.createContext({ SHUANGLING_PROFILE: true, window: { shuanglingI18n: i18n, __dshPetDebug: {} },
    console: { error: value => diagnostics.push(value) }, errorEl: { textContent: '', classList: { add: () => {} } } });
  const block = source('renderer.js').match(/function showError\(message\) \{[\s\S]*?\n\}/)?.[0]; assert.ok(block);
  vm.runInContext(block, context);
  for (const language of languages) {
    i18n.setLanguage(language); context.showError('technical diagnostic: fixture-path');
    assert.equal(context.errorEl.textContent, i18n.t('桌宠配置暂时不可用，正在重试。'));
    assert.ok(!context.errorEl.textContent.includes('fixture-path'));
    assert.ok(diagnostics.at(-1).includes('fixture-path'));
    assert.equal(context.window.__dshPetDebug.configOk, false);
  }
});
