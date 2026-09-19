const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../electron/storage.cjs');
const catalog = require('../electron/catalog.cjs');
const { createBatchImporter, suggest, duplicate } = require('../electron/batch-import.cjs');
function fixture(t, products, metadata) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'gym-batch-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const config=path.join(base,'config.json'),store=new Store(config); store.configure(path.join(base,'data'));
  const calls=[];
  const web={productMetadata:async args=>{calls.push(args);return args.url.endsWith('/catalog')?{success:true,kind:'listing',products}:metadata?metadata(args):{success:true,name:'Chest Press',model:args.url.split('/').pop(),productUrl:args.url,imageSource:'https://example.com/image.avif'};},productImage:async()=>({image:'',warning:'fixture image failure'})};
  return {store,web,calls,config,api:createBatchImporter(store,web)};
}
const products=[{name:'Chest Press',url:'https://example.com/product/a'},{name:'Dumbbell',url:'https://example.com/product/b'},{name:'Unclassified',url:'https://example.com/product/c'}];
const scan=f=>f.api.batchScan({brandId:'brand-1',url:'https://example.com/catalog'});
test('batch custom parts, new tags and series commit through the same model validation', async t => {
  const f=fixture(t,[products[0]]),b=await scan(f),id=b.id,candidateIds=[b.candidates[0].id];
  const updated=f.api.batchUpdate({id,candidateIds,patch:{equipmentType:'fixed',parts:['CUSTOM: 颈部 '],tags:[],series:'  Special  '}});
  assert.equal(updated.candidates[0].series,'Special');assert.equal(updated.candidates[0].status,'pending');
  assert.deepEqual(updated.candidates[0].parts,['CUSTOM:颈部']);
  for(const patch of [{series:'x'.repeat(20001)},{parts:['CUSTOM:']},{parts:Array.from({length:21},(_,i)=>`CUSTOM:p${i}`)}])assert.throws(()=>f.api.batchUpdate({id,candidateIds,patch}),/系列|部位/);
  const p=f.api.batchPreview({id});assert.deepEqual(p.issues,[]);await f.api.batchCommit({id,token:p.token});
  assert.equal(f.store.db.equipment[0].series,'Special');assert.deepEqual(f.store.db.equipment[0].parts,['CUSTOM:颈部']);
});
test('scan, detail fetch, edits, preview and discard never save the database', async t => {
  const f=fixture(t,[products[0]]);let saves=0;
  const original=f.store.save.bind(f.store);f.store.save=db=>{saves++;return original(db);};
  const b=await scan(f);await f.api.batchFetch({id:b.id,candidateId:b.candidates[0].id});
  f.api.batchUpdate({id:b.id,candidateIds:[b.candidates[0].id],patch:{notes:'Draft'}});
  f.api.batchPreview({id:b.id});f.api.batchDiscard({id:b.id});
  assert.equal(saves,0);assert.throws(()=>f.api.batchRead({id:b.id}),/不存在/);
  assert.equal(f.store.db.equipment.length,0);
});
test('single and bulk removal invalidate previews and late detail responses cannot revive deleted candidates', async t => {
  const f=fixture(t,products),b=await scan(f);let resolve;
  f.web.productMetadata=()=>new Promise(r=>{resolve=r;});
  const late=f.api.batchFetch({id:b.id,candidateId:b.candidates[0].id});
  const rejected=assert.rejects(late,/取消|删除/);
  const preview=f.api.batchPreview({id:b.id});
  let updated=f.api.batchRemoveCandidates({id:b.id,candidateIds:[b.candidates[0].id]});
  assert.equal(updated.candidates.length,2);
  resolve({success:true,name:'Revived treadmill'});await rejected;
  await assert.rejects(f.api.batchCommit({id:b.id,token:preview.token}),/过期/);
  updated=f.api.batchRemoveCandidates({id:b.id,candidateIds:updated.candidates.map(c=>c.id)});
  assert.equal(updated.candidates.length,0);assert.equal(f.store.db.equipment.length,0);
});
test('discard of historical editing retains saved history and prevents late detail writes', async t => {
  const f=fixture(t,[products[0],products[1]]),b=await scan(f);
  f.api.batchUpdate({id:b.id,candidateIds:[b.candidates[1].id],patch:{status:'deferred'}});
  const p=f.api.batchPreview({id:b.id});await f.api.batchCommit({id:b.id,token:p.token});
  const before=JSON.stringify(f.store.db);let resolve;
  f.web.productMetadata=()=>new Promise(r=>{resolve=r;});
  const late=f.api.batchFetch({id:b.id,candidateId:b.candidates[1].id});
  const rejected=assert.rejects(late,/取消/);
  f.api.batchDiscard({id:b.id});resolve({success:true,name:'Late result'});await rejected;
  assert.equal(JSON.stringify(f.store.db),before);assert.equal(f.api.batchList().length,1);
  assert.throws(()=>f.api.batchRemoveCandidates({id:b.id,candidateIds:[b.candidates[0].id]}),/已导入/);
  assert.equal(f.store.db.equipment.length,1);
});
test('failed confirmation retains a retryable draft and successful retry persists once', async t => {
  const f=fixture(t,[products[0]]),b=await scan(f),p=f.api.batchPreview({id:b.id});
  const original=f.store.save.bind(f.store);f.store.save=()=>{throw new Error('disk failure');};
  await assert.rejects(f.api.batchCommit({id:b.id,token:p.token}),/disk failure/);
  assert.equal(f.api.batchRead({id:b.id}).candidates[0].status,'pending');
  assert.equal(f.store.db.equipment.length,0);assert.equal(f.api.batchList().length,0);
  f.store.save=original;await f.api.batchCommit({id:b.id,token:p.token});
  assert.equal(f.store.db.equipment.length,1);assert.equal(f.api.batchList().length,1);
});
test('deletion during image download cancels confirmation without persisting records', async t => {
  const f=fixture(t,[products[0]]),b=await scan(f);let resolve;
  f.api.batchUpdate({id:b.id,candidateIds:[b.candidates[0].id],patch:{imageSource:'https://example.com/image.png'}});
  f.web.productImage=()=>new Promise(r=>{resolve=r;});
  const p=f.api.batchPreview({id:b.id}),pending=f.api.batchCommit({id:b.id,token:p.token});
  const rejected=assert.rejects(pending,/变化/);
  f.api.batchRemoveCandidates({id:b.id,candidateIds:[b.candidates[0].id]});resolve({image:''});await rejected;
  assert.equal(f.api.batchRead({id:b.id}).candidates.length,0);assert.equal(f.store.db.equipment.length,0);
  assert.equal(f.api.batchList().length,0);
});
test('rules preserve four top types and conservative unknown; duplicates scoped to brand',()=>{
  for(const [name,type,sub] of [['Chest Press','fixed',''],['Dumbbell','free_weight','dumbbell'],['Smith Machine','free_weight','smith'],['Power Rack','free_weight','rack'],['Treadmill','cardio',''],['Cable Crossover','cable_station','']]) {
    const result=suggest({name});assert.equal(result.equipmentType,type);assert.equal(result.freeWeightType,sub);
  }
  assert.equal(suggest({name:'Platinum V4'}).equipmentType,'');
  assert.equal(duplicate({brandId:'a',model:'R-10',name:'X'},[{id:'1',brandId:'a',model:'r 10',name:'Y'}]).kind,'exact');
  assert.equal(duplicate({brandId:'b',model:'R-10',name:'X'},[{id:'1',brandId:'a',model:'r 10',name:'X'}]).kind,'new');
});
test('scan and review stay in memory; only confirmed import persists records and batch',async t=>{
  const f=fixture(t,products),b=await scan(f);assert.equal(b.candidates.length,3);assert.equal(f.store.db.equipment.length,0);
  const before=fs.readFileSync(path.join(f.store.root,'database/data.json'),'utf8');const reopened=new Store(f.config);assert.equal(reopened.db.importBatches?.length||0,0);assert.equal(f.api.batchList().length,0);assert.equal(b.temporary,true);
  const updated=f.api.batchUpdate({id:b.id,candidateIds:b.candidates.map(c=>c.id),patch:{equipmentType:'cardio',parts:['CHEST'],tags:['推胸'],freeWeightType:'smith'}});
  assert.ok(updated.candidates.every(c=>c.status==='pending'&&!c.parts.length&&!c.tags.length&&!c.freeWeightType));
  assert.equal(f.store.db.equipment.length,0);
  const preview=f.api.batchPreview({id:b.id});assert.deepEqual(preview.issues,[]);assert.equal(preview.summary.added,3);
  assert.equal(fs.readFileSync(path.join(f.store.root,'database/data.json'),'utf8'),before);const result=await f.api.batchCommit({id:b.id,token:preview.token});assert.equal(new Store(f.config).db.importBatches[0].id,b.id);assert.equal(result.batch.temporary,false);assert.equal(result.batch.status,'completed');assert.equal(f.store.db.equipment.length,3);
});
test('individual errors do not discard other candidates and retry recovers',async t=>{
  let failed=true;
  const f=fixture(t,products,()=>failed?{success:false,status:403,reason:'blocked',method:'http',message:'blocked',canBrowserFallback:true,canPdfFallback:true}:{success:true,name:'Treadmill',model:'recovered'});
  const b=await scan(f),c=b.candidates[0];let updated=await f.api.batchFetch({id:b.id,candidateId:c.id});
  assert.equal(updated.candidates[0].error.status,403);assert.equal(updated.candidates[0].status,'fetch_failed');assert.equal(updated.candidates[1].status,'pending');
  failed=false;updated=await f.api.batchFetch({id:b.id,candidateId:c.id});assert.equal(updated.candidates[0].status,'pending');assert.equal(updated.candidates[0].error,null);
  assert.equal(f.store.db.equipment.length,0);
});
test('failed scans remain temporary and never enter saved history',async t=>{
  const f=fixture(t,[]);
  for(const error of [{status:404,reason:'not_found'},{status:null,reason:'timeout'},{status:null,reason:'network_error'},{status:429,reason:'rate_limited'},{status:503,reason:'server_error'}]) {
    f.web.productMetadata=async()=>({success:false,...error,message:error.reason});const b=await scan(f);assert.equal(b.status,'failed');assert.equal(b.error.reason,error.reason);
  }
  assert.equal(f.api.batchList().length,0);assert.equal(f.store.db.equipment.length,0);
});
test('only confirmed history supplies ignored and deferred memory',async t=>{
  const f=fixture(t,products),a=await scan(f);
  f.api.batchUpdate({id:a.id,candidateIds:[a.candidates[0].id],patch:{status:'ignored'}});
  f.api.batchUpdate({id:a.id,candidateIds:[a.candidates[1].id,a.candidates[2].id],patch:{status:'deferred'}});
  const unconfirmed=await scan(f);assert.notEqual(unconfirmed.candidates[0].status,'ignored');
  const p=f.api.batchPreview({id:a.id});await f.api.batchCommit({id:a.id,token:p.token});
  const b=await scan(f);assert.equal(b.candidates[0].status,'ignored');assert.equal(b.candidates[1].status,'deferred');
  f.api.batchDiscard({id:a.id});assert.equal(f.api.batchList().length,1);
});
test('duplicates require decision, supplement preserves existing populated fields and gym links',async t=>{
  const f=fixture(t,[products[0]]);
  const existing=catalog.upsert(f.store,'equipment',{name:'Original name',model:'a',brandId:'brand-1',equipmentType:'fixed',parts:['CHEST'],tags:['推胸'],notes:'Keep notes'});
  const gym=catalog.upsert(f.store,'gyms',{name:'Fixture gym'});catalog.link(f.store,{gymId:gym.id,equipmentId:existing.id,quantity:2});
  const b=await scan(f);await f.api.batchFetch({id:b.id,candidateId:b.candidates[0].id});
  let preview=f.api.batchPreview({id:b.id});assert.equal(preview.summary.duplicates,1);assert.equal(preview.issues.length,1);
  await assert.rejects(f.api.batchCommit({id:b.id,token:preview.token}),/分类或重复/);
  f.api.batchUpdate({id:b.id,candidateIds:[b.candidates[0].id],patch:{decision:'supplement'}});
  preview=f.api.batchPreview({id:b.id});assert.equal(preview.summary.supplemented,1);assert.equal(preview.issues.length,0);
  await f.api.batchCommit({id:b.id,token:preview.token});
  assert.equal(f.store.db.equipment.length,1);const e=f.store.db.equipment[0];assert.equal(e.name,'Original name');assert.equal(e.notes,'Keep notes');assert.equal(e.imageStatus,'failed');assert.ok(e.imageSource.endsWith('.avif'));assert.equal(f.store.db.links[0].quantity,2);
});
test('same batch duplicate appears in preview and can supplement newly added record atomically',async t=>{
  const f=fixture(t,[{name:'Treadmill',url:'https://example.com/product/1'},{name:'Treadmill',url:'https://example.com/product/2'}]);
  const b=await scan(f);let p=f.api.batchPreview({id:b.id});assert.equal(p.issues.length,1);assert.equal(p.batch.candidates[1].duplicate.kind,'suspected');assert.equal(p.batch.candidates[1].status,'possible_duplicate');
  f.api.batchUpdate({id:b.id,candidateIds:[b.candidates[1].id],patch:{decision:'supplement',model:'M2'}});
  p=f.api.batchPreview({id:b.id});assert.equal(p.issues.length,0);await f.api.batchCommit({id:b.id,token:p.token});assert.equal(f.store.db.equipment.length,1);assert.equal(f.store.db.equipment[0].model,'M2');
});
test('multiple supplements to same existing target accumulate fields',async t=>{
  const f=fixture(t,[{name:'Treadmill',model:'T1',url:'https://example.com/product/1'},{name:'Treadmill',model:'T1',url:'https://example.com/product/2'}]);
  catalog.upsert(f.store,'equipment',{name:'Treadmill',model:'T1',brandId:'brand-1',equipmentType:'cardio'});
  const b=await scan(f);
  f.api.batchUpdate({id:b.id,candidateIds:[b.candidates[0].id],patch:{decision:'supplement',notes:'First notes'}});
  f.api.batchUpdate({id:b.id,candidateIds:[b.candidates[1].id],patch:{decision:'supplement',series:'Second series'}});
  const p=f.api.batchPreview({id:b.id});assert.equal(p.issues.length,0);await f.api.batchCommit({id:b.id,token:p.token});assert.equal(f.store.db.equipment[0].notes,'First notes');assert.equal(f.store.db.equipment[0].series,'Second series');
});
test('explicit create despite duplicate, stale confirmation blocked, no implicit commit',async t=>{
  const f=fixture(t,[products[0]]);catalog.upsert(f.store,'equipment',{name:'Chest Press',brandId:'brand-1',equipmentType:'fixed',parts:['CHEST'],tags:['推胸']});
  const b=await scan(f);f.api.batchUpdate({id:b.id,candidateIds:[b.candidates[0].id],patch:{decision:'new'}});const stale=f.api.batchPreview({id:b.id});
  f.api.batchUpdate({id:b.id,candidateIds:[b.candidates[0].id],patch:{notes:'changed'}});await assert.rejects(f.api.batchCommit({id:b.id,token:stale.token}),/过期/);assert.equal(f.store.db.equipment.length,1);
  const p=f.api.batchPreview({id:b.id});await f.api.batchCommit({id:b.id,token:p.token});assert.equal(f.store.db.equipment.length,2);
});
test('returning an ignored candidate to pending clears ignore decision',async t=>{
  const f=fixture(t,[products[0]]),b=await scan(f),candidateId=b.candidates[0].id;
  f.api.batchUpdate({id:b.id,candidateIds:[candidateId],patch:{decision:'ignore'}});
  const resumed=f.api.batchUpdate({id:b.id,candidateIds:[candidateId],patch:{status:'pending'}});
  assert.equal(resumed.candidates[0].decision,'');assert.equal(resumed.candidates[0].status,'pending');
  const p=f.api.batchPreview({id:b.id});assert.equal(p.summary.added,1);assert.equal(p.summary.ignored,0);
});
test('candidate updates reject malformed values and unsafe source protocols without altering saved data',async t=>{
  const f=fixture(t,[products[0]]),b=await scan(f);const args={id:b.id,candidateIds:[b.candidates[0].id]};
  for(const patch of [{name:null},{name:4},{parts:'CHEST'},{tags:[null]},{sourceUrl:'javascript:alert(1)'},{productUrl:'file:///tmp/a'},{sourceUrl:'https://user:pass@example.com/'},{imageSource:'not a url'}]) assert.throws(()=>f.api.batchUpdate({...args,patch}),/字段|网址/);
  assert.equal(f.api.batchRead({id:b.id}).candidates[0].name,'Chest Press');
});
test('batch structure validation rejects corruption before persistence',async t=>{
  const {validateImportBatches}=require('../electron/batch-model.cjs');
  const f=fixture(t,[products[0]]),b=await scan(f);assert.doesNotThrow(()=>validateImportBatches([b]));
  for(const mutate of [b=>b.candidates=null,b=>b.candidates.push({...b.candidates[0]}),b=>b.candidates[0].name=null,b=>b.status='unknown',b=>b.candidates[0].sourceUrl='file:///tmp/x']) {
    const damaged=structuredClone(b);mutate(damaged);assert.throws(()=>validateImportBatches([damaged]),/无效|网址/);
  }
});
test('explicit incline and vertical press rules, series hints, rack word boundaries and storage exclusion',()=>{
  for(const name of ['Super Incline Press','Vertical Press']) { const result=suggest({name});assert.equal(result.equipmentType,'fixed');assert.deepEqual(result.tags,['推胸']); }
  assert.equal(suggest({name:'Competition Rack'}).freeWeightType,'rack');
  assert.equal(suggest({name:'Tracker'}).equipmentType,'');
  assert.equal(suggest({name:'Storage Rack'}).equipmentType,'');
  assert.equal(suggest({name:'Dumbbell Storage Rack'}).equipmentType,'');
  assert.equal(suggest({name:'Dumbbell Rack'}).equipmentType,'');
  assert.equal(suggest({name:'RX100',series:'Cardio Treadmill'}).equipmentType,'cardio');
});
