import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CodexWorkWatcher} from '../../src/bridge/codex-work.mjs';
import {ProjectUsageReader} from '../../src/bridge/project-usage.mjs';

async function fixture(t, fsApi = fs) {
  const home = await fs.mkdtemp(join(tmpdir(), 'shuangling-discovery-header-'));
  t.after(() => fs.rm(home, {recursive:true, force:true}));
  await fs.mkdir(join(home, 'sessions')); await fs.mkdir(join(home, 'archived_sessions'));
  let now = Date.now(); const boundary = now - 1000, events = [];
  const reader = new ProjectUsageReader({codexHome:home, fsApi, now:()=>now, indexMaxAgeMs:0});
  const watcher = new CodexWorkWatcher({codexHome:home, metadataReader:reader, now:()=>now,
    sessionStartedAt:boundary, onChange:value=>events.push(value)});
  t.after(() => watcher.close());
  const meta = (id, extra={}) => JSON.stringify({type:'session_meta', timestamp:new Date(now).toISOString(), payload:{id, thread_source:'user', ...extra}});
  const event = (type, turn) => JSON.stringify({type:'event_msg',timestamp:new Date(now).toISOString(),payload:{type,turn_id:turn}})+'\n';
  const file = (name, archive=false) => join(home, archive?'archived_sessions':'sessions', name+'.jsonl');
  const start = async () => {await fs.writeFile(file('a'), meta('a')+'\n'+event('task_started','a-turn')); await watcher.tick();};
  const finish = async () => {now+=1000; await fs.appendFile(file('a'),event('task_complete','a-turn')); await watcher.tick();};
  return {home,reader,watcher,events,meta,event,file,start,finish,boundary,advance:ms=>{now+=ms;}};
}

test('a recent partial session header blocks a final verdict without inventing an active root, then joins the existing batch', async t => {
  const f=await fixture(t); await f.start(); const turn=f.watcher.snapshot().turnId;
  const header=f.meta('b', {base_instructions:'PRIVATE HEADER'});
  await fs.writeFile(f.file('b'),header.slice(0,-1));
  await f.finish();
  const uncertain=f.watcher.snapshot();
  assert.equal(uncertain.state,'unknown'); assert.equal(uncertain.reason,'session-header-pending');
  assert.equal(uncertain.activeCount,0); assert.equal(uncertain.unknownCount,0);
  assert.equal(uncertain.turnId,turn); assert.equal(f.events.some(value=>value.state==='complete'),false);
  assert.deepEqual(Object.keys(f.reader.pendingHeaders[0]).sort(),['mtimeMs','path','reason']);
  assert.doesNotMatch(JSON.stringify([...f.reader.metadataCache.values()]),/PRIVATE HEADER|base_instructions/);
  await fs.appendFile(f.file('b'),'}\n'+f.event('task_started','b-turn'));
  f.advance(5001); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state,'working'); assert.equal(f.watcher.snapshot().turnId,turn);
  assert.equal(f.reader.pendingHeaders.length,0);
});

test('empty files, stale partial headers, archived candidates and verified children cannot hold the app session open', async t => {
  const f=await fixture(t); await f.start();
  await fs.writeFile(f.file('empty'),'');
  await fs.writeFile(f.file('old'),f.meta('old').slice(0,-1));
  await fs.utimes(f.file('old'),new Date(f.boundary-86400000),new Date(f.boundary-86400000));
  await fs.writeFile(f.file('archive',true),f.meta('archive').slice(0,-1));
  await fs.writeFile(f.file('child'),f.meta('child',{thread_source:'subagent',parent_thread_id:'a'})+'\n');
  await f.finish();
  assert.equal(f.watcher.snapshot().state,'complete'); assert.equal(f.watcher.records.size,1);
  assert.equal(f.watcher.snapshot().discoveryReason,null);
});

test('a complete header without a final newline proves identity but not a running task and later appends are discoverable', async t => {
  const f=await fixture(t); await f.start();
  await fs.writeFile(f.file('b'),f.meta('b'));
  await f.finish();
  assert.equal(f.reader.index.get('b').metadata.source,'root'); assert.equal(f.reader.index.get('b').headerOnly,true);
  assert.equal(f.reader.pendingHeaders.length,0); assert.equal(f.watcher.snapshot().state,'complete');
  assert.equal(f.watcher.records.has('b'),false);
  f.advance(5001); await fs.appendFile(f.file('b'),'\n'+f.event('task_started','b-turn')); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state,'working'); assert.equal(f.watcher.records.has('b'),true);
});

test('unverified metadata is re-read after same-size same-mtime repair rather than retained as a negative cache hit', async t => {
  const f=await fixture(t); const header=f.meta('b'), fixedTime=new Date();
  await fs.writeFile(f.file('b'),header.slice(0,-1)+' '); await fs.utimes(f.file('b'),fixedTime,fixedTime);
  await f.reader.refreshIndex(); const before=await fs.stat(f.file('b'));
  assert.equal(f.reader.pendingHeaders.length,1); assert.equal(f.reader.index.has('b'),false);
  await fs.writeFile(f.file('b'),header); await fs.utimes(f.file('b'),fixedTime,fixedTime);
  const after=await fs.stat(f.file('b')); assert.equal(after.size,before.size); assert.equal(after.mtimeMs,before.mtimeMs);
  await f.reader.refreshIndex();
  assert.equal(f.reader.pendingHeaders.length,0); assert.equal(f.reader.index.get('b').headerOnly,true);
});

test('rotation at the same path replaces a pending header with its new verified owner', async t => {
  const f=await fixture(t); await fs.writeFile(f.file('changing'),f.meta('old').slice(0,-1));
  await f.reader.refreshIndex(); assert.equal(f.reader.pendingHeaders.length,1);
  await fs.rename(f.file('changing'),join(f.home,'retained-partial'));
  await fs.writeFile(f.file('changing'),f.meta('new')+'\n'+f.event('task_started','new-turn'));
  await f.reader.refreshIndex();
  assert.equal(f.reader.pendingHeaders.length,0); assert.equal(f.reader.index.has('old'),false);
  assert.equal(f.reader.index.get('new').path,f.file('changing'));
});

test('header permission failure remains unknown and recovery clears the diagnostic before admitting its root', async t => {
  let denied=false, target;
  const fsApi={...fs,open:async (...args)=>{
    if(denied&&args[0]===target)throw Object.assign(Error('private failure'),{code:'EACCES'});
    return fs.open(...args);
  }};
  const f=await fixture(t,fsApi); await f.start(); target=f.file('b');
  await fs.writeFile(target,f.meta('b').slice(0,-1)); denied=true;
  await f.finish(); assert.equal(f.watcher.snapshot().state,'unknown');
  assert.equal(f.watcher.snapshot().discoveryReason,'log-permission-denied');
  denied=false; await fs.writeFile(target,f.meta('b')+'\n'+f.event('task_started','b-turn'));
  f.advance(5001); await f.watcher.tick();
  assert.equal(f.watcher.snapshot().state,'working'); assert.equal(f.watcher.snapshot().discoveryReason,null);
});
