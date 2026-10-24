import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../../src/settings/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const staticKeys = [...html.split('<script>')[0].matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]);

async function page(saved = { language: 'zh-CN', autoLaunch: false }) {
  const nodes = new Map(), writes = [], calls = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', hidden: false, disabled: false, title: '',
      classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; },
      replaceChildren(...children) { this.children = children; }, scrollIntoView() {},
    });
    return nodes.get(id);
  };
  const staticNodes = staticKeys.map(key => ({ dataset: { i18n: key }, textContent: '' }));
  const choices = [
    { threadId: 'chat-one', threadName: '优化动画', projectName: '桌宠项目' },
    { threadId: 'chat-two', threadName: null, projectName: null },
  ];
  const model = {
    failLanguage: false, failUsage: false, failAccount: false,
    state: { status: { state: 'working', scope: 'codex', workingCount: 2, waitingCount: 1, unknownCount: 1 }, control: { paused: true, issue: 'runtime-unreachable' } },
    usage: {
      selection: { status: 'available', source: 'selected-chat', ...choices[0], choices },
      context: { status: 'historical', sample: 'last-model-request', remainingTokens: 123000, windowTokens: 256000, remainingPercent: 48, observedAt: '2026-10-24T00:00:00Z' },
      project: { status: 'partial', scope: 'thread', usedTokens: 9000, observedAt: '2026-10-24T00:00:00Z' },
    },
    account: { fiveHour: { status: 'not-applicable' }, weekly: { status: 'available', remainingPercent: 87, observedAt: '2026-10-24T00:00:00Z' } },
  };
  const document = {
    getElementById: node, createElement: () => ({}), documentElement: {}, activeElement: null,
    querySelectorAll: () => staticNodes,
  };
  const context = vm.createContext({
    document, location: { hash: '#isolated-test', search: '' }, URLSearchParams, setInterval() {},
    fetch: async (url, options) => {
      calls.push(url);
      const response = (value, ok = true) => ({ ok, json: async () => value });
      if (options.method === 'POST') {
        const body = JSON.parse(options.body); writes.push({ url, body });
        if (url.endsWith('/preferences')) {
          if (model.failLanguage) return response({ error: 'operation-unavailable' }, false);
          Object.assign(saved, body); return response(saved);
        }
        return response({});
      }
      if (url.endsWith('/preferences')) return response(saved);
      if (url.endsWith('/usage')) { if (model.failUsage) throw Error('unreadable'); return response(model.usage); }
      if (url.endsWith('/account-usage')) { if (model.failAccount) throw Error('disconnected'); return response(model.account); }
      if (url.endsWith('/appearance')) return response({ size: 562, position: { corner: 'bottom-right', marginX: 24, marginY: 24 } });
      return response(model.state);
    },
  });
  await vm.runInContext(script, context);
  return { context, node, document, model, saved, writes, calls, staticNodes };
}

test('advanced settings has a complete three-language dictionary for every static and dynamic key', async () => {
  const { context, document, staticNodes } = await page();
  const dictionaries = JSON.parse(vm.runInContext('JSON.stringify(translations)', context));
  assert.deepEqual(Object.keys(dictionaries), ['zh-CN', 'zh-TW', 'en']);
  const keys = Object.keys(dictionaries['zh-CN']).sort();
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys);
    for (const value of Object.values(dictionary)) assert.equal(typeof value, 'string');
    for (const key of staticKeys) assert.ok(dictionary[key], language + ': ' + key);
    vm.runInContext('applyLanguage(' + JSON.stringify(language) + ')', context);
    assert.equal(document.documentElement.lang, language);
    assert.equal(document.title, dictionary.title);
    assert.ok(staticNodes.every(node => node.textContent === dictionary[node.dataset.i18n]));
  }
  assert.match(html, /id="language"/);
  assert.match(html, /<option value="zh-CN">简体中文<\/option>/);
  assert.match(html, /<option value="zh-TW">繁體中文<\/option>/);
  assert.match(html, /<option value="en">English<\/option>/);
});

test('saving language changes only that preference and preserves chat, appearance edits, pause and account data', async () => {
  const p = await page();
  p.node('height').value = '211'; p.node('corner').value = 'top-left'; p.node('marginX').value = '37';
  const callsBefore = p.calls.length;
  p.node('language').value = 'en'; await p.node('language').onchange();
  assert.deepEqual(p.writes, [{ url: '/api/preferences', body: { language: 'en' } }]);
  assert.equal(p.calls.length, callsBefore + 1, 'locale redraw uses existing snapshots');
  assert.equal(p.saved.autoLaunch, false);
  assert.equal(p.node('height').value, '211'); assert.equal(p.node('corner').value, 'top-left'); assert.equal(p.node('marginX').value, '37');
  assert.equal(p.node('usageThread').value, 'chat-one');
  assert.equal(p.node('usageThread').children[1].textContent, '优化动画 · 桌宠项目');
  assert.equal(p.node('usageThread').children[2].textContent, 'Untitled chat · No project · chat-two');
  assert.equal(p.node('status').textContent, 'Thinking'); assert.equal(p.node('control').textContent, 'Linking paused');
  assert.equal(p.node('pause').textContent, 'Resume linking'); assert.equal(p.node('issue').textContent, 'The pet process is temporarily unreachable.');
  assert.equal(p.node('contextLabel').textContent, 'Context remaining at last request');
  assert.match(p.node('contextTime').textContent, /^Historical sample/);
  assert.equal(p.node('projectValue').textContent, '≥ 9,000 tokens');
  assert.match(p.node('projectTime').textContent, /^Partial records/);
  assert.equal(p.node('weeklyValue').textContent, '87% remaining'); assert.equal(p.node('fiveHourCard').hidden, true);
  assert.equal(p.node('notice').textContent, 'Interface language saved.');
  const reopened = await page(p.saved);
  assert.equal(reopened.document.documentElement.lang, 'en', 'reopening uses the persisted preference');
  assert.equal(reopened.node('language').value, 'en');
});

test('traditional Chinese, empty/disconnected states and errors redraw without altering balances or controls', async () => {
  const p = await page({ language: 'zh-TW', autoLaunch: true });
  assert.equal(p.node('control').textContent, '連動已暫停');
  assert.equal(p.node('weeklyValue').textContent, '剩餘 87%');
  assert.match(p.node('usageThread').children[2].textContent, /未命名聊天 · 未歸入專案/);
  p.model.failUsage = true; p.model.failAccount = true;
  await vm.runInContext('Promise.all([usage(),accountUsage()])', p.context);
  assert.equal(p.node('contextValue').textContent, '未知（連線已中斷）');
  assert.equal(p.node('weeklyValue').textContent, '未知（連線已中斷）');
  assert.equal(p.node('fiveHourCard').hidden, true);
  p.node('language').value = 'en'; await p.node('language').onchange();
  assert.equal(p.node('contextValue').textContent, 'Unknown (disconnected)');
  assert.equal(p.node('weeklyValue').textContent, 'Unknown (disconnected)');
  assert.equal(p.node('usageThread').value, '');
  p.model.failLanguage = true;
  p.node('language').value = 'zh-CN'; await p.node('language').onchange();
  assert.equal(p.node('language').value, 'en'); assert.equal(p.node('language').disabled, false);
  assert.equal(p.node('notice').textContent, 'This action is temporarily unavailable. Please try again later.');
  assert.equal(p.saved.language, 'en');
});

test('external preference changes refresh language while an open language chooser is left alone', async () => {
  const p = await page();
  p.saved.language = 'zh-TW'; await vm.runInContext('preferences()', p.context);
  assert.equal(p.node('language').value, 'zh-TW');
  p.document.activeElement = p.node('language'); p.node('language').value = 'en';
  p.saved.language = 'zh-CN'; await vm.runInContext('preferences()', p.context);
  assert.equal(p.node('language').value, 'en');
  assert.equal(p.document.documentElement.lang, 'zh-TW');
});
