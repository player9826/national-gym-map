importScripts('extract.js');
const MAX_TOTAL=64*1024*1024,MAX_DECODED=48*1024*1024,MAX_HTML=4*1024*1024,MAX_IMAGE=20*1024*1024;
let state={running:false,message:''},stop=false;
const bytes=value=>new TextEncoder().encode(value).length;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function progress(message){state.message=message;chrome.action.setBadgeText({text:state.running?'…':''});}
async function readTab(tabId){
  const result=await chrome.scripting.executeScript({target:{tabId},func:extractCapturePage});
  if(!result[0]?.result)throw new Error('页面尚未准备好。');
  return result[0].result;
}
async function waitForTab(tabId){
  const deadline=Date.now()+25000;
  while(Date.now()<deadline){if(stop)throw new Error('已停止');const tab=await chrome.tabs.get(tabId);if(tab.status==='complete'){await pause(800);return;}await pause(300);}
  throw new Error('页面加载超时');
}
async function imageData(source,origin){
  const url=new URL(source);
  // Only domains explicitly granted in the browser's permission dialog are read.
  if(!await chrome.permissions.contains({origins:[`${url.origin}/*`]}))throw new Error('当前授权不含此图片域名；可在该产品页重新启动并授权图片来源。');
  const response=await fetch(source,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`图片返回 ${response.status}`);
  const type=(response.headers.get('content-type')||'').split(';')[0];
  if(!/^image\/(png|jpeg|webp|gif|avif)$/.test(type))throw new Error('不是支持的图片格式。');
  if(Number(response.headers.get('content-length'))>MAX_IMAGE)throw new Error('图片超过大小限制。');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>MAX_IMAGE)throw new Error('图片超过大小限制。');chunks.push(value);}}finally{await reader.cancel();}
  const all=new Uint8Array(length);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  let binary='';for(let i=0;i<all.length;i+=16384)binary+=String.fromCharCode(...all.subarray(i,i+16384));
  return `data:${type};base64,${btoa(binary)}`;
}
async function capture(tabId,origin){
  const bundle={format:'national-gym-map-capture',version:1,pages:[],failures:[]};let opened,decodedSize=0;
  try{
    const initial=await readTab(tabId);if(initial.error)throw new Error(initial.error);
    const queue=[initial.url,...initial.links].slice(0,50);
    for(let index=0;index<queue.length&&!stop;index++){
      const url=queue[index];progress(`正在采集 ${index+1}/${queue.length} 页，已完成 ${bundle.pages.length} 页。`);
      try{
        let page=initial;
        const listing=(initial.listingImages||[]).find(item=>item.url===url);
        if(index){
          try{
            const tab=await chrome.tabs.create({url,active:false});opened=tab.id;await waitForTab(opened);page=await readTab(opened);
            if(page.error)throw new Error(page.error);
          }catch(error){
            if(!listing||stop)throw error;
            bundle.failures.push({url,message:error.message});
            const name=listing.name.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
            page={url,html:`<h1>${name}</h1>`,imageSources:[],detailError:String(error.message).slice(0,500)};
          }
        }
        if(new URL(page.url).origin!==origin)throw new Error('页面跳转离开已授权官网。');
        if(page.error)throw new Error(page.error);
        const htmlSize=bytes(page.html);
        if(htmlSize>MAX_HTML)throw new Error('页面内容超过大小限制。');
        if(decodedSize+htmlSize>MAX_DECODED)throw new Error('采集内容达到大小上限。');
        const saved={url:page.url,html:page.html,images:[]};
        if(page.detailError)saved.detailError=page.detailError;
        const paired=listing&&page.url===url?listing:null;
        if(paired){saved.listingUrl=initial.url;saved.listingImageSource=paired.source;}
        if(bytes(JSON.stringify({...bundle,pages:[...bundle.pages,saved]}))>MAX_TOTAL)throw new Error('采集文件达到总大小上限。');
        bundle.pages.push(saved);
        decodedSize+=htmlSize;
        const sources=[...new Set([...(paired?[paired.source]:[]),...page.imageSources.slice(0,3)])];
        for(const source of sources){
          if(stop)break;
          try{const dataUrl=await imageData(source,origin);const imageSize=atob(dataUrl.split(',')[1]).length;if(decodedSize+imageSize>MAX_DECODED)throw new Error('采集内容达到大小上限。');saved.images.push({source,dataUrl});if(bytes(JSON.stringify(bundle))>MAX_TOTAL){saved.images.pop();throw new Error('采集文件达到总大小上限。');}decodedSize+=imageSize;}
          catch(error){bundle.failures.push({url:source,message:error.message});}
        }
        if(paired&&!saved.images.some(image=>image.source===paired.source)){delete saved.listingUrl;delete saved.listingImageSource;}
      }catch(error){bundle.failures.push({url,message:error.message});}
      finally{if(opened){await chrome.tabs.remove(opened).catch(()=>{});opened=undefined;}}
      if(index<queue.length-1)await pause(500);
    }
    if(!bundle.pages.length)throw new Error('没有可导出的公开器械页面。');
    let serialized=JSON.stringify(bundle);
    while(bytes(serialized)>MAX_TOTAL&&bundle.failures.length){bundle.failures.pop();serialized=JSON.stringify(bundle);}
    await chrome.downloads.download({url:`data:application/json;charset=utf-8,${encodeURIComponent(serialized)}`,filename:`gym-capture-${Date.now()}.gymcapture.json`,saveAs:true});
    progress(`已导出 ${bundle.pages.length} 页，${bundle.pages.reduce((n,p)=>n+p.images.length,0)} 张图片；${bundle.failures.length} 项未完成。`);
  }catch(error){progress(error.message);}
  finally{state.running=false;chrome.action.setBadgeText({text:''});}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message.method==='status')respond(state);
  else if(message.method==='stop'){stop=true;respond({ok:true});}
  else if(message.method==='start'){
    if(state.running){respond({error:'已有采集任务正在运行。'});return;}
    state.running=true;stop=false;progress('开始采集…');respond({ok:true});capture(message.tabId,message.origin);
  }
});
