const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Store}=require('../electron/storage.cjs');
const {createSharedCatalog}=require('../electron/shared-catalog.cjs');
const {_electron:electron,expect}=require('@playwright/test');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gym-public-catalog-'));
 const profile=path.join(temp,'profile'),store=new Store(path.join(profile,'location.json'));store.configure(path.join(temp,'data'));
 const catalog=createSharedCatalog(store,async url=>fs.readFileSync(path.join('shared',new URL(url).pathname.slice(1))));
 const preview=await catalog.sharedPreview({url:'https://example.test/manifest.json'});await catalog.sharedApply({token:preview.token});
 const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'../shared/catalog.json'),'utf8'));
 for(const collection of ['gyms','equipment','brands','links']) assert.equal(store.db[collection].length,expected[collection].length,`${collection} count matches the published snapshot`);
 assert.ok(store.db.gyms.every(g=>g.visited===false&&!g.description&&!g.rawReview));
 const again=await catalog.sharedPreview({url:'https://example.test/manifest.json'});assert.equal(again.counts.added,0);assert.equal(again.downloadImages,0);
 let app;try{
 app=await electron.launch({args:['.'],env:{...process.env,GYM_TEST_PROFILE:profile}});const page=await app.firstWindow();
 await page.getByRole('button',{name:'器械库',exact:true}).click();
 await expect(page.locator('.equipment-card').first()).toBeVisible();
 await page.waitForFunction(()=>[...document.querySelectorAll('.equipment-card img')].slice(0,8).every(i=>i.complete&&i.naturalWidth>0));
 fs.mkdirSync('docs/images',{recursive:true});await page.screenshot({path:path.resolve('docs/images/equipment-library.png')});
 fs.writeFileSync('test-results/public-catalog.json',JSON.stringify({passed:true,temp,gyms:store.db.gyms.length,equipment:store.db.equipment.length,links:store.db.links.length,images:preview.images,repeatAdded:again.counts.added,repeatImageDownloads:again.downloadImages},null,2));
 console.log('PASS full public catalog, local images, repeated subscription and public screenshot');
 }finally{if(app)await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
