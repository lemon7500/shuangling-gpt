import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const directory = new URL('../../vendor/dsh-pet/runtime/electron-helper/', import.meta.url);
const i18n = require('../../vendor/dsh-pet/runtime/electron-helper/panel-i18n.js');
const { presentUsage, presentState, presentSelection, presentProjectUsage } = require('../../vendor/dsh-pet/runtime/electron-helper/panel-ui.js');
const { validateCommand, sanitizeSnapshot } = require('../../vendor/dsh-pet/runtime/electron-helper/panel-main.cjs');
const html = readFileSync(new URL('panel.html', directory), 'utf8');
const script = readFileSync(new URL('panel-ui.js', directory), 'utf8');
const languages = ['zh-CN', 'zh-TW', 'en'];
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const now = Date.parse('2026-10-24T08:00:00Z');
const observedAt = new Date(now - 60_000).toISOString();

// panel-ui.js and existing model tests share this cached dictionary in a process.
afterEach(() => i18n.setLanguage('zh-CN'));

function objectStrings(name) {
  const literal = script.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});`))?.[1];
  assert.ok(literal, `find the ${name} translation-key table`);
  return Object.values(vm.runInNewContext(`(${literal})`)).filter(Boolean);
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('panel dictionaries cover static text, attributes and dynamic keys in all three languages', () => {
  assert.deepEqual(i18n.languages, languages);
  assert.equal(i18n.getLanguage(), 'zh-CN');
  const keys = new Set([
    ...[...html.matchAll(/data-i18n(?:-title|-aria-label)?="([^"]+)"/g)].map(match => match[1]),
    ...[...script.matchAll(/\bt\(\s*(['"])(.*?)\1/g)].map(match => match[2]),
    ...objectStrings('STATE_LABELS'),
    ...objectStrings('HINTS'),
  ]);
  const defaultKeys = Object.keys(i18n.dictionaries['zh-CN']).sort();
  for (const language of languages) {
    const dictionary = i18n.dictionaries[language];
    assert.deepEqual(Object.keys(dictionary).sort(), defaultKeys, `${language}: no omitted keys`);
    for (const key of keys) {
      assert.ok(Object.hasOwn(dictionary, key), `${language}: missing ${key}`);
      assert.equal(typeof dictionary[key], 'string');
      assert.ok(dictionary[key].trim(), `${language}: empty ${key}`);
    }
    for (const key of defaultKeys) {
      assert.deepEqual(placeholders(dictionary[key]), placeholders(i18n.dictionaries['zh-CN'][key]), `${language}: preserve values in ${key}`);
    }
  }
  assert.match(html, /<option value="zh-CN">简体中文<\/option>/);
  assert.match(html, /<option value="zh-TW">繁體中文<\/option>/);
  assert.match(html, /<option value="en">English<\/option>/);
});

test('task labels and global counters translate without changing source activity or control state', () => {
  const source = deepFreeze({
    status: { state: 'working', scope: 'codex', workingCount: 2, waitingCount: 1, unknownCount: 3, threadId: 'unchanged-chat' },
    control: { paused: true, preempted: false },
  });
  const original = JSON.stringify(source);
  const labels = { idle: '安静陪伴中', working: '正在认真思考', running: '正在认真思考', waiting: '等你回答', complete: '本轮已完成', completed: '本轮已完成', interrupted: '动作已收起', unknown: '任务状态未知' };
  for (const language of languages) {
    i18n.setLanguage(language);
    const state = presentState(source);
    assert.equal(state.label, i18n.t('正在认真思考'));
    assert.equal(state.badge, i18n.t('联动已暂停'));
    assert.equal(state.resume, true);
    assert.equal(state.threadId, source.status.threadId);
    assert.equal(state.counts, i18n.t('运行 {working} · 等待 {waiting}', { working: 2, waiting: 1 }) + i18n.t(' · 未知 {unknown}', { unknown: 3 }));
    assert.deepEqual(state.counts.match(/\d+/g), ['2', '1', '3']);
    for (const [value, key] of Object.entries(labels)) {
      assert.equal(presentState({ status: { state: value } }).label, i18n.t(key));
    }
    assert.equal(presentState(source, true).label, i18n.t('本机连接已断开'));
    assert.equal(presentState({ status: { state: 'unknown', reason: 'log-permission-denied' } }).hint, i18n.t('日志暂时不可读，陪伴和拖动仍可使用。'));
    assert.equal(presentState({ status: { state: 'working' }, control: { preempted: true } }).badge, i18n.t('你在控制'));
  }
  assert.equal(JSON.stringify(source), original);
});

test('usage values, partial totals and user chat names survive language changes unchanged', () => {
  const selection = deepFreeze({ status: 'available', source: 'selected-chat', threadId: 'chat-one', threadName: '用户原名 User chat', projectName: '原项目 Project' });
  const context = deepFreeze({ status: 'available', observedAt, remainingTokens: 123456, windowTokens: 258400, remainingPercent: 47.8 });
  const account = deepFreeze({ status: 'available', observedAt, remainingPercent: 96.7, resetsAt: Math.floor(now / 1000) + 3600 });
  const total = deepFreeze({ status: 'partial', scope: 'thread', usedTokens: 9234, observedAt, threadCount: 1 });
  const originals = JSON.stringify({ selection, context, account, total });
  for (const language of languages) {
    i18n.setLanguage(language);
    const selected = presentSelection(selection);
    assert.equal(selected.threadId, 'chat-one');
    assert.equal(selected.label, '用户原名 User chat · 原项目 Project');
    assert.equal(selected.caption, i18n.t('所选聊天'));
    const available = presentUsage(context, { context: true, now });
    assert.equal(available.state, 'available');
    assert.equal(available.value, (123456).toLocaleString(language));
    assert.equal(available.suffix, `/ ${(258400).toLocaleString(language)} tokens`);
    assert.equal(available.percent, '47.8%');
    assert.equal(available.bar, 47.8);
    const quota = presentUsage(account, { now });
    assert.equal(quota.value, '96.7%');
    assert.equal(quota.bar, 96.7);
    assert.equal(quota.suffix, i18n.t('剩余'));
    const project = presentProjectUsage(total, { selection, now });
    assert.equal(project.label, i18n.t('本聊天已用'));
    assert.equal(project.value, `≥ ${(9234).toLocaleString(language)}`);
    assert.equal(project.suffix, 'tokens');
    assert.equal(project.state, 'partial');
    assert.ok(project.time.startsWith(i18n.t('部分记录 · ')));
  }
  assert.equal(JSON.stringify({ selection, context, account, total }), originals);
});

test('unknown, expired, disconnected and historical labels translate while historical numbers remain intact', () => {
  const historical = deepFreeze({ status: 'historical', sample: 'last-model-request', observedAt: new Date(now - 86_400_000).toISOString(), remainingTokens: 321, windowTokens: 1000, remainingPercent: 32.1 });
  const original = JSON.stringify(historical);
  for (const language of languages) {
    i18n.setLanguage(language);
    const old = presentUsage(historical, { context: true, now });
    assert.equal(old.state, 'historical');
    assert.equal(old.value, (321).toLocaleString(language));
    assert.equal(old.suffix, `/ ${(1000).toLocaleString(language)} tokens`);
    assert.equal(old.bar, 32.1);
    assert.ok(old.time.startsWith(i18n.t('历史采样 · {time}', { time: '' })));
    const unknown = presentUsage(null, { now });
    assert.equal(unknown.value, i18n.t('未知'));
    assert.equal(unknown.time, i18n.t('等待可靠采样'));
    assert.equal(unknown.bar, null);
    const expired = presentUsage({ status: 'stale', observedAt }, { now });
    assert.equal(expired.value, i18n.t('未知'));
    assert.ok(expired.time.startsWith(i18n.t('采样已过期')));
    assert.equal(expired.state, 'stale');
    const disconnected = presentUsage(historical, { context: true, now, disconnected: true });
    assert.equal(disconnected.value, i18n.t('未知'));
    assert.ok(disconnected.time.startsWith(i18n.t('本机连接已断开')));
    assert.equal(disconnected.bar, null);
    const inapplicable = presentUsage({ status: 'not-applicable' }, { now });
    assert.equal(inapplicable.hidden, true);
    assert.equal(inapplicable.value, '');
  }
  assert.equal(JSON.stringify(historical), original);
});

test('panel language IPC accepts only three locale enums and rejects extra fields', () => {
  for (const language of languages) {
    const command = { type: 'language', language };
    assert.deepEqual(validateCommand(command), command);
    assert.equal(sanitizeSnapshot({ preferences: { language } }).preferences.language, language);
    for (const extra of [{ url: 'http://example.test' }, { enabled: true }, { token: 'private' }, { languageCode: language }]) {
      assert.equal(validateCommand({ ...command, ...extra }), null);
    }
  }
  for (const language of [undefined, null, false, 1, '', 'zh', 'zh-cn', 'en-US', 'ja', ['en'], { language: 'en' }]) {
    assert.equal(validateCommand({ type: 'language', language }), null);
    assert.equal(sanitizeSnapshot({ preferences: { language } }).preferences.language, 'zh-CN');
    assert.equal(i18n.normalizeLanguage(language), 'zh-CN');
  }
  assert.equal(validateCommand({ type: 'language' }), null);
  assert.equal(validateCommand({ language: 'en' }), null);
  assert.equal(sanitizeSnapshot({ preferences: { language: 'en', token: 'private' } }).preferences.token, undefined);
});
