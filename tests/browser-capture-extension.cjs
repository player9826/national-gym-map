// Requires the optional Playwright Chromium download; never opens a real website.
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.build-tools/extension-browsers');
const {chromium}=require('@playwright/test');
const {createCanvas}=require('@napi-rs/canvas');
const image=createCanvas(200,150).encodeSync('png');
const requests=[];
const server=http.createServer((req,res)=>{
  requests.push(req.url);
  if(['/one.png','/two.png','/three.png','/machine.png','/other-machine.png','/blocked-machine.png'].includes(req.url)){res.writeHead(200,{'content-type':'image/png'});res.end(image);return;}
  if(req.url==='/store/brand/series/'){
    res.writeHead(200,{'content-type':'text/html'});res.end('<title>Nitro Plus</title><div id="content"><div class="product-card"><a href="compound-row-s5cr/"><span class="image" style="background-image:url(/machine.png)"></span></a><a href="compound-row-s5cr/"><h3>Compound Row S5CR</h3></a></div><div class="product-card"><a href="another-row/"><img src="/other-machine.png" alt="Another Row"><h3>Another Row</h3></a></div><div class="product-card"><a href="blocked-row/"><img src="/blocked-machine.png" alt="Blocked Row"><h3>Blocked Row</h3></a></div><a href="weight-stack-pins/"><h3>Weight Stack Pins</h3></a></div>');return;
  }
  if(req.url==='/store/brand/series/compound-row-s5cr/'){
    res.writeHead(200,{'content-type':'text/html'});res.end('<title>Compound Row S5CR | Supplier</title><div id="content"><div class="category-image" style="background-image:url(/one.png)"></div><img src="/two.png" alt="Compound Row"><img src="/three.png" alt="Compound Row"><script type="application/ld+json">{"@type":"Product","name":"Seat Pad","image":"/bad-pad.png"}</script></div>');return;
  }
  if(req.url==='/store/brand/series/another-row/'){res.writeHead(200,{'content-type':'text/html'});res.end('<h1>Another Row</h1><img src="/other-machine.png">');return;}
  if(req.url==='/store/brand/series/blocked-row/'){res.writeHead(403,{'content-type':'text/html'});res.end('<h1>Access denied</h1>');return;}
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
    assert.equal(nested.pages.length,4);
    const row=nested.pages.find(p=>p.url.endsWith('/compound-row-s5cr/'));
    assert.equal(row.images.length,4);
    assert.equal(row.listingUrl,origin+'/store/brand/series/');
    assert.equal(row.listingImageSource,origin+'/machine.png');
    assert.equal(row.images[0].source,row.listingImageSource);
    assert.ok(!row.images.some(img=>img.source.endsWith('/other-machine.png')));
    assert.ok(nested.pages[0].html.includes(`src="${origin}/machine.png"`),'background listing image remains associated in sanitized HTML');
    const other=nested.pages.find(p=>p.url.endsWith('/another-row/'));
    assert.equal(other.images.length,1,'same listing/detail image is deduplicated');
    const blocked=nested.pages.find(p=>p.url.endsWith('/blocked-row/'));
    assert.equal(blocked.images.length,1);
    assert.equal(blocked.images[0].source,origin+'/blocked-machine.png');
    assert.ok(blocked.detailError);
    assert.ok(!blocked.html.includes('Access denied'));
    assert.ok(!requests.includes('/bad-pad.png'));
    assert.ok(!requests.includes('/store/brand/series/weight-stack-pins/'));
    fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/browser-capture-extension.json',JSON.stringify({testedAt:new Date().toISOString(),scope:'local Chromium extension with fixture-only host pregrant and intercepted save dialog',passed:true,pages:bundle.pages.length,images:1,failures:bundle.failures,checks:['real extension service worker','normal tab navigation and isolated DOM extraction','image embedded','privacy fields excluded','product JSON-LD preserved','accessory excluded','403 excluded','created tabs closed and original preserved'],requests},null,2));
    console.log('Extension local integration passed: listing + three detail candidates, exact pairing, duplicate exclusion, listing-only fallback, privacy removal.');
  }finally{await context?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
