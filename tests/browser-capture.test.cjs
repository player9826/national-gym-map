const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {validateCapture}=require('../electron/browser-capture.cjs');
const image=fs.readFileSync(require('node:path').join(__dirname,'../build/icon.png'));
const fixture=()=>({format:'national-gym-map-capture',version:1,pages:[{url:'https://example.com/product',html:'<h1>Press</h1>',images:[{source:'https://example.com/photo.png',dataUrl:`data:image/png;base64,${image.toString('base64')}`}]}]});
test('capture validates original bytes without storing anything',()=>{assert.deepEqual(validateCapture(fixture())[0].images[0].bytes,image);});
test('capture rejects unsafe sources and disguised non-images',()=>{
  for(const url of ['file:///C:/private','javascript:alert(1)','https://name:secret@example.com/x','http://127.0.0.1/x']){
    const b=fixture();b.pages[0].url=url;assert.throws(()=>validateCapture(b));
  }
  const b=fixture();b.pages[0].images[0].dataUrl='data:image/png;base64,PGh0bWw+';assert.throws(()=>validateCapture(b));
});
test('capture enforces page and per-page image limits',()=>{
  const b=fixture();b.pages=Array(51).fill(b.pages[0]);assert.throws(()=>validateCapture(b));
  const c=fixture();c.pages[0].images=Array(4).fill(c.pages[0].images[0]);assert.throws(()=>validateCapture(c));
});

test('capture accepts one paired listing image and three detail images, rejecting invalid listing metadata',()=>{
  const b=fixture(),page=b.pages[0];
  page.listingUrl='https://example.com/catalog';page.listingImageSource=page.images[0].source;
  page.images=Array.from({length:4},(_,i)=>({...page.images[0],source:i?`https://example.com/detail-${i}.png`:page.listingImageSource}));
  assert.equal(validateCapture(b)[0].images.length,4);
  for(const values of [
    {listingUrl:'https://other.example/catalog'},
    {listingUrl:page.url},
    {listingImageSource:'https://example.com/missing.png'},
    {listingImageSource:undefined},
    {detailError:'x'.repeat(501)}
  ])assert.throws(()=>validateCapture({...b,pages:[{...page,...values}]}));
  const fallback={...page,detailError:'访问被拒绝',images:[page.images[0]]};
  assert.equal(validateCapture({...b,pages:[fallback]})[0].detailError,'访问被拒绝');
});
