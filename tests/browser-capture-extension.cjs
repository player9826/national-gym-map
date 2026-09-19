// Requires the optional Playwright Chromium download; never opens a real website.
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.build-tools/extension-browsers');
const {chromium}=require('@playwright/test');
const {createCanvas}=require('@napi-rs/canvas');
const image=createCanvas(200,150).encodeSync('png');
const requests=[];
const server=http.createServer((req,res)=>{
  requests.push(req.url);
  if(['/one.png','/two.png','/three.png'].includes(req.url)){res.writeHead(200,{'content-type':'image/png'});res.end(image);return;}
  if(req.url==='/store/brand/series/'){
    res.writeHead(200,{'content-type':'text/html'});res.end('<title>Nitro Plus</title><div id="content"><a href="compound-row-s5cr/"><h3>Compound Row S5CR</h3></a><a href="weight-stack-pins/"><h3>Weight Stack Pins</h3></a></div>');return;
  }
  if(req.url==='/store/brand/series/compound-row-s5cr/'){
    res.writeHead(200,{'content-type':'text/html'});res.end('<title>Compound Row S5CR | Supplier</title><div id="content"><div class="category-image" style="background-image:url(/one.png)"></div><img src="/two.png" alt="Compound Row"><img src="/three.png" alt="Compound Row"><script type="application/ld+json">{"@type":"Product","name":"Seat Pad","image":"/bad-pad.png"}</script></div>');return;
  }
  if(req.url==='/photo.png'){res.writeHead(200,{'content-type':'image/png'});res.end(image);return;}
  const content=req.url==='/catalog'?'<main><h1>Equipment</h1><div class="product"><a href="/product/press">Chest Press</a><a href="/product/blocked">Blocked</a><a href="/product/accessory">Accessory</a></div><form><input value="PRIVATE-FORM"><textarea>PRIVATE-NOTE</textarea></form><script>window.secret="PRIVATE-SCRIPT"</script></main>':
    req.url==='/product/blocked'?'<h1>Access denied</h1>':
    '<main><h1>Chest Press</h1><img src="/photo.png"><script type="application/ld+json">{"@type":"Product","name":"Chest Press","model":"P1","image":"/photo.png","privateToken":"PRIVATE-TOKEN"}</script></main>';
  res.writeHead(req.url==='/product/blocked'?403:200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><html><head><title>Fixture</title></head><body>'+content+'</body></html>');
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gym-capture-extension-'));const extension=path.join(temp,'extension');fs.cpSync(path.resolve('browser-capture'),extension,{recursive:true});
  // Fixture-only pregrant stands in for the user's browser permission dialog.
  const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));manifest.host_permissions=[origin+'/*'];fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  let context;
  try{
    context=await chromium.launchPersistentContext(path.join(temp,'profile'),{headless:true,channel:'chromium',args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const page=await context.newPage();await page.goto(origin+'/catalog');
    const bundle=await worker.evaluate(async origin=>{
      const [tab]=await chrome.tabs.query({url:origin+'/catalog'});
      let exported;
      chrome.downloads.download=async options=>{exported=JSON.parse(decodeURIComponent(options.url.slice(options.url.indexOf(',')+1)));return 1;};
      state.running=true;await capture(tab.id,origin);return exported;
    },origin);
    assert.equal(bundle.format,'national-gym-map-capture');assert.equal(bundle.pages.length,2);
    assert.equal(bundle.pages[1].images.length,1);assert.ok(bundle.pages[1].images[0].dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(bundle.failures.length,1);assert.ok(bundle.failures[0].url.endsWith('/product/blocked'));
    const text=JSON.stringify(bundle);assert.ok(!text.includes('PRIVATE-'));assert.ok(text.includes('application/ld+json'));assert.ok(!requests.includes('/product/accessory'));
    assert.ok((await context.pages()).some(p=>p.url()===origin+'/catalog'));
    assert.ok(!(await context.pages()).some(p=>p.url().includes('/product/')));
    await page.goto(origin+'/store/brand/series/');
    const nested=await worker.evaluate(async origin=>{
      const [tab]=await chrome.tabs.query({url:origin+'/store/brand/series/'});let exported;
      chrome.downloads.download=async options=>{exported=JSON.parse(decodeURIComponent(options.url.slice(options.url.indexOf(',')+1)));return 1;};
      state.running=true;await capture(tab.id,origin);return exported;
    },origin);
    assert.equal(nested.pages.length,2);
    assert.equal(nested.pages[1].images.length,3);
    assert.ok(!requests.includes('/bad-pad.png'));
    assert.ok(!requests.includes('/store/brand/series/weight-stack-pins/'));
    fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/browser-capture-extension.json',JSON.stringify({testedAt:new Date().toISOString(),scope:'local Chromium extension with fixture-only host pregrant and intercepted save dialog',passed:true,pages:bundle.pages.length,images:1,failures:bundle.failures,checks:['real extension service worker','normal tab navigation and isolated DOM extraction','image embedded','privacy fields excluded','product JSON-LD preserved','accessory excluded','403 excluded','created tabs closed and original preserved'],requests},null,2));
    console.log('Extension local integration passed: 2 pages, 1 image, 1 excluded denied page; private fields removed.');
  }finally{await context?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
