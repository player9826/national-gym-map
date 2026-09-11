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
test('rules preserve four top types and conservative unknown; duplicates scoped to brand',()=>{
  for(const [name,type,sub] of [['Chest Press','fixed',''],['Dumbbell','free_weight','dumbbell'],['Smith Machine','free_weight','smith'],['Power Rack','free_weight','rack'],['Treadmill','cardio',''],['Cable Crossover','cable_station','']]) {
    const result=suggest({name});assert.equal(result.equipmentType,type);assert.equal(result.freeWeightType,sub);
  }
  assert.equal(suggest({name:'Platinum V4'}).equipmentType,'');
  assert.equal(duplicate({brandId:'a',model:'R-10',name:'X'},[{id:'1',brandId:'a',model:'r 10',name:'Y'}]).kind,'exact');
  assert.equal(duplicate({brandId:'b',model:'R-10',name:'X'},[{id:'1',brandId:'a',model:'r 10',name:'X'}]).kind,'new');
});
test('scan persists candidates without equipment; restart, bulk edit, classification clears irrelevant fields',async t=>{
  const f=fixture(t,products),b=await scan(f);assert.equal(b.candidates.length,3);assert.equal(f.store.db.equipment.length,0);
  const reopened=new Store(f.config);assert.equal(reopened.db.importBatches[0].id,b.id);
  const updated=f.api.batchUpdate({id:b.id,candidateIds:b.candidates.map(c=>c.id),patch:{equipmentType:'cardio',parts:['CHEST'],tags:['推胸'],freeWeightType:'smith'}});
  assert.ok(updated.candidates.every(c=>c.status==='pending'&&!c.parts.length&&!c.tags.length&&!c.freeWeightType));
  assert.equal(f.store.db.equipment.length,0);
  const preview=f.api.batchPreview({id:b.id});assert.deepEqual(preview.issues,[]);assert.equal(preview.summary.added,3);
  const result=await f.api.batchCommit({id:b.id,token:preview.token});assert.equal(result.batch.status,'completed');assert.equal(f.store.db.equipment.length,3);
});
test('individual errors do not discard other candidates and retry recovers',async t=>{
  let failed=true;
  const f=fixture(t,products,()=>failed?{success:false,status:403,reason:'blocked',method:'http',message:'blocked',canBrowserFallback:true,canPdfFallback:true}:{success:true,name:'Treadmill',model:'recovered'});
  const b=await scan(f),c=b.candidates[0];let updated=await f.api.batchFetch({id:b.id,candidateId:c.id});
  assert.equal(updated.candidates[0].error.status,403);assert.equal(updated.candidates[0].status,'fetch_failed');assert.equal(updated.candidates[1].status,'pending');
  failed=false;updated=await f.api.batchFetch({id:b.id,candidateId:c.id});assert.equal(updated.candidates[0].status,'pending');assert.equal(updated.candidates[0].error,null);
  assert.equal(f.store.db.equipment.length,0);
});
test('404 timeout and network scan errors remain resumable failed batches',async t=>{
  const f=fixture(t,[]);
  for(const error of [{status:404,reason:'not_found'},{status:null,reason:'timeout'},{status:null,reason:'network_error'},{status:429,reason:'rate_limited'},{status:503,reason:'server_error'}]) {
    f.web.productMetadata=async()=>({success:false,...error,message:error.reason});const b=await scan(f);assert.equal(b.status,'failed');assert.equal(b.error.reason,error.reason);
  }
  assert.equal(f.api.batchList().length,5);assert.equal(f.store.db.equipment.length,0);
});
test('ignored and deferred memories persist, newest explicit pending cancels older memory',async t=>{
  const f=fixture(t,products),a=await scan(f);
  f.api.batchUpdate({id:a.id,candidateIds:[a.candidates[0].id],patch:{status:'ignored'}});
  f.api.batchUpdate({id:a.id,candidateIds:[a.candidates[1].id],patch:{status:'deferred'}});
  const b=await scan(f);assert.equal(b.candidates[0].status,'ignored');assert.equal(b.candidates[1].status,'deferred');
  f.api.batchUpdate({id:b.id,candidateIds:[b.candidates[0].id],patch:{status:'pending'}});
  const c=await scan(f);assert.equal(c.candidates[0].status,'pending');
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
