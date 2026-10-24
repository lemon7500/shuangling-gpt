import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActiveSelectionReader } from '../../src/bridge/active-selection.mjs';

const A='11111111-2222-4333-8444-555555555555';
const B='01a162a2-a5b2-7851-9f00-1a21ae436e8f';
const C='01a16289-ee16-7e52-9a38-743dbe60bb9b';
const fixture = () => ({
  'selected-project': {type:'local',projectId:'other-project'},
  'active-workspace-roots': ['D:\\unrelated'],
  'local-projects': {'real-project':{id:'real-project',name:'霜铃项目',rootPaths:['D:\\project\\','D:\\project\\','E:\\shared']},'other-project':{id:'other-project',name:'Other',rootPaths:['D:\\other']}},
  'thread-project-assignments': {[A]:{projectKind:'local',projectId:'real-project'},[B]:{projectKind:'local',projectId:'real-project'},[C]:{projectKind:'local',projectId:'real-project'},'../junk':{projectKind:'local',projectId:'real-project'}},
  'thread-project-membership-host-ids': {[A]:'local',[B]:'local',[C]:'remote'},
  'electron-persisted-atom-state': {'prompt-history':['PRIVATE CONVERSATION BODY']},
});
const verifiedMetadata = (ids=[A,B,C]) => ({refreshIndex:async()=>{},index:new Map(ids.map(id=>[id,{metadata:{id,source:'root'}}]))});
const reader = value => new ActiveSelectionReader({codexHome:'X:\\unused',now:()=>1000,readState:async()=>JSON.stringify(value),metadataReader:verifiedMetadata()});

test('active navigation remains unknown instead of guessing last selected/default project',async()=>{
  let reads=0;const r=new ActiveSelectionReader({now:()=>1000,readState:async()=>{reads++;return fixture();}});
  assert.deepEqual(await r.snapshot(),{status:'unknown',threadId:null,projectName:null,projectRoot:null,source:'codex-desktop-navigation',observedAt:'1970-01-01T00:00:01.000Z',reason:'active-page-not-exposed'});
  assert.equal(reads,0);
});
test('explicit conversation resolves its actual project, independent of new-chat default',async()=>{
  const result=await reader(fixture()).resolveThread(A);
  assert.equal(result.status,'available'); assert.equal(result.scope,'project'); assert.equal(result.projectId,'real-project');assert.equal(result.projectName,'霜铃项目');
  assert.equal(result.projectRoot,'D:\\project');assert.deepEqual(result.projectRoots,['D:\\project','E:\\shared']);assert.deepEqual(result.projectThreadIds,[A,B].sort());
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('foreign host assignment is never merged with local project',async()=>{
  const result=await reader(fixture()).resolveThread(C);assert.equal(result.scope,'thread');assert.equal(result.projectId,null);assert.deepEqual(result.projectThreadIds,[C]);assert.equal(result.reason,'non-local-project');
});
test('unassigned thread remains an explicitly selected thread instead of guessed workspace project',async()=>{
  const value=fixture();delete value['thread-project-assignments'][A];const result=await reader(value).resolveThread(A);assert.equal(result.scope,'thread');assert.equal(result.projectId,null);assert.equal(result.reason,'project-not-assigned');
});
test('missing project catalog entry does not create invented project membership',async()=>{
  const value=fixture();delete value['local-projects']['real-project'];const result=await reader(value).resolveThread(A);assert.equal(result.scope,'thread');assert.equal(result.reason,'project-metadata-missing');
});
test('verified root remains available as thread scope when project metadata is malformed or unreadable',async()=>{
  for(const readState of [async()=>'{',async()=>{throw Error('EACCES');}]) {
    const r=new ActiveSelectionReader({now:()=>1000,readState,metadataReader:verifiedMetadata()});
    const result=await r.resolveThread(A);
    assert.equal(result.status,'available');assert.equal(result.scope,'thread');assert.equal(result.reason,'project-metadata-unavailable');assert.equal(result.source,'codex-thread-project-membership');
    assert.equal(result.projectName,null);assert.equal(result.projectRoot,null);assert.deepEqual(result.projectThreadIds,[A]);
  }
});
test('invalid thread identifiers do not read local data',async()=>{
  let reads=0;const r=new ActiveSelectionReader({now:()=>1000,readState:async()=>{reads++;return fixture();}});assert.equal((await r.resolveThread('../../anything')).reason,'invalid-thread-id');assert.equal(reads,0);
});
test('only absolute roots and short display names survive metadata projection',async()=>{
  const value=fixture();Object.assign(value['local-projects']['real-project'],{name:'x'.repeat(513),rootPaths:['relative','D:\\safe','/tmp/safe','E:\\',42]});const result=await reader(value).resolveThread(A);assert.equal(result.projectName,null);assert.deepEqual(result.projectRoots,['D:\\safe','/tmp/safe','E:\\']);
});
test('explicit usage choices list only verified roots with membership and creation metadata',async()=>{
  let refreshed=0;const metadataReader={refreshIndex:async()=>{refreshed++;},index:new Map([
    [A,{metadata:{source:'root',timestamp:'2026-10-21T01:00:00Z',body:'DO NOT RETURN'}}],
    [B,{metadata:{source:'subagent',timestamp:'2026-10-22T01:00:00Z'}}],
    [C,{metadata:{source:'root',timestamp:'2026-10-23T01:00:00Z'}}],
    ['../invalid',{metadata:{source:'root',timestamp:'2026-10-24T01:00:00Z'}}],
  ])};
  const r=new ActiveSelectionReader({now:()=>1000,readState:async()=>fixture(),metadataReader});const rows=await r.listThreads();
  assert.equal(refreshed,1);assert.deepEqual(rows,[{threadId:C,threadName:null,projectName:null,projectId:null,createdAt:'2026-10-23T01:00:00Z'},{threadId:A,threadName:null,projectName:'霜铃项目',projectId:'real-project',createdAt:'2026-10-21T01:00:00Z'}]);assert.ok(!JSON.stringify(rows).includes('DO NOT RETURN'));assert.equal((await r.listThreads({limit:1})).length,1);
});

test('chat names come only from metadata for verified root chats and refresh after rename',async()=>{
  const row=(id,thread_name,updated_at='2026-10-24T01:00:00Z')=>JSON.stringify({id,thread_name,updated_at,body:'PRIVATE BODY'})+'\n';
  let index=row(A,'制作GPT Q版桌宠')+row(B,'子代理名字')+row('unverified','未知聊天');
  const metadataReader=verifiedMetadata([A]);
  const r=new ActiveSelectionReader({metadataReader,readState:async()=>fixture(),readNameIndex:async()=>index});
  assert.equal((await r.resolveThread(A)).threadName,'制作GPT Q版桌宠');
  const choices=await r.listThreads();
  assert.equal(choices.length,1);assert.equal(choices[0].threadName,'制作GPT Q版桌宠');
  assert.ok(!JSON.stringify(choices).includes('PRIVATE BODY'));
  index+=row(A,'新名称','2026-10-24T02:00:00Z')+row(A,'旧名称','2026-10-23T01:00:00Z');
  assert.equal((await r.listThreads())[0].threadName,'新名称');
  index+=JSON.stringify({id:A,thread_name:'尚未写完',updated_at:'2026-10-24T03:00:00Z'});
  assert.equal((await r.resolveThread(A)).threadName,'新名称');
  index+='\n';assert.equal((await r.resolveThread(A)).threadName,'尚未写完');
});

test('missing or unreadable names preserve choices and do not reuse cached titles',async()=>{
  let broken=false;
  const r=new ActiveSelectionReader({metadataReader:verifiedMetadata([A]),readState:async()=>{throw Error('unavailable');},readNameIndex:async()=>{if(broken)throw Error('EACCES');return JSON.stringify({id:A,thread_name:'已知名字'})+'\n';}});
  assert.equal((await r.resolveThread(A)).threadName,'已知名字');
  broken=true;
  const choices=await r.listThreads();assert.equal(choices.length,1);assert.equal(choices[0].threadName,null);
  const selected=await r.resolveThread(A);assert.equal(selected.status,'available');assert.equal(selected.threadName,null);
});

test('names are bounded plain text, malformed rows are skipped, and blank renames do not revive old names',async()=>{
  let index='bad row\n'+JSON.stringify({id:A,thread_name:'  名称\n\t测试\u202e ',updated_at:'2026-10-24T01:00:00Z'})+'\n'+JSON.stringify({id:B,thread_name:'长'.repeat(400)})+'\n';
  const r=new ActiveSelectionReader({metadataReader:verifiedMetadata([A,B]),readState:async()=>fixture(),readNameIndex:async()=>index});
  assert.equal((await r.resolveThread(A)).threadName,'名称 测试');
  assert.equal((await r.resolveThread(B)).threadName.length,200);
  index+=JSON.stringify({id:A,thread_name:15,updated_at:'2026-10-24T02:00:00Z'})+'\n';
  assert.equal((await r.resolveThread(A)).threadName,'名称 测试');
  index+=JSON.stringify({id:A,thread_name:' ',updated_at:'2026-10-24T02:00:00Z'})+'\n';
  assert.equal((await r.resolveThread(A)).threadName,null);
});
test('legal non-UUID local root identifiers remain compatible without project state or cwd',async()=>{
  for(const threadId of ['root','second','a_b-C_9']) {
    const r=new ActiveSelectionReader({now:()=>1000,metadataReader:verifiedMetadata([threadId]),readState:async()=>{throw Error('ENOENT');}});
    const result=await r.resolveThread(threadId);
    assert.equal(result.status,'available');assert.equal(result.threadId,threadId);assert.equal(result.scope,'thread');assert.deepEqual(result.projectThreadIds,[threadId]);
  }
});
test('unverified and child identifiers cannot become available through forged project assignments',async()=>{
  for(const metadataReader of [verifiedMetadata([]),{refreshIndex:async()=>{},index:new Map([[A,{metadata:{source:'subagent'}}]])}]) {
    let stateReads=0;const r=new ActiveSelectionReader({now:()=>1000,metadataReader,readState:async()=>{stateReads++;return fixture();}});
    const result=await r.resolveThread(A);assert.equal(result.status,'unknown');assert.equal(result.reason,'thread-not-root');assert.equal(stateReads,0);
  }
});
test('failure to verify root metadata cannot use project metadata as a fallback',async()=>{
  const r=new ActiveSelectionReader({now:()=>1000,metadataReader:{refreshIndex:async()=>{throw Error('EACCES');}},readState:async()=>fixture()});
  assert.equal((await r.resolveThread(A)).reason,'thread-metadata-unavailable');
});
