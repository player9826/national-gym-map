const status = document.querySelector('#status');
document.querySelector('#start').onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const url = new URL(tab.url);
    if (!['http:','https:'].includes(url.protocol)) throw new Error('请先打开官网页面。');
    const [capture] = await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractCapturePage});
    // Ask explicitly for the current site's detected image domains as well.
    const origins = [...new Set([`${url.origin}/*`,...(capture?.result?.imageSources||[]).map(source=>`${new URL(source).origin}/*`)])];
    if (!await chrome.permissions.request({origins})) throw new Error('未获得本站及图片来源采集权限。');
    const result = await chrome.runtime.sendMessage({method:'start',tabId:tab.id,origin:url.origin});
    if (result.error) throw new Error(result.error);
  } catch(error) { status.textContent = error.message; }
};
document.querySelector('#stop').onclick = () => chrome.runtime.sendMessage({method:'stop'});
async function refresh() {
  const result=await chrome.runtime.sendMessage({method:'status'});
  document.querySelector('#start').disabled=result.running;
  status.textContent=result.message||'采集文件只保存到你的下载目录，不自动上传。';
}
refresh();setInterval(refresh,1000);
