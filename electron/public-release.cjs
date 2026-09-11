const PUBLIC_REPOSITORY = 'https://github.com/player9826/national-gym-map';
const DEFAULT_SHARED_URL = 'https://raw.githubusercontent.com/player9826/national-gym-map/main/shared/manifest.json';
const DEFAULT_UPDATE_FEED = `${PUBLIC_REPOSITORY}/releases/latest/download/`;
function validatePublicUrl(value) {
  const url = new URL(value);
  if (process.env.GYM_TEST_ALLOW_LOCAL === '1' && url.hostname === '127.0.0.1' && url.protocol === 'http:') return url.href;
  if (url.protocol !== 'https:' || url.username || url.password || !['github.com', 'api.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(url.hostname)) throw new Error('共享地址必须是 GitHub 的公开加密下载地址。');
  return url.href;
}
function fetchPublicBytes(value, { maxBytes = 32 * 1024 ** 2 } = {}) {
  const { net } = require('electron');
  const url = validatePublicUrl(value);
  return new Promise((resolve, reject) => {
    let settled = false, redirects = 0;
    const request = net.request({url, redirect:'manual'});
    const timer = setTimeout(() => fail(new Error('共享资料下载超时，请稍后重试。')), 45000);
    function fail(error) { if(settled)return;settled=true;clearTimeout(timer);request.abort();reject(error); }
    request.on('redirect', (_status,_method,target) => {
      try { if(++redirects>6)throw new Error('共享下载重定向过多。');validatePublicUrl(target);request.followRedirect(); } catch(e){fail(e);}
    });
    request.on('error',fail);
    request.on('response', response => {
      if(response.statusCode!==200){fail(new Error(`共享资料返回 ${response.statusCode}，请检查发布地址。`));return;}
      const chunks=[];let size=0;
      response.on('error',fail);
      response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)fail(new Error('共享文件超过支持大小。'));else chunks.push(chunk);});
      response.on('end',()=>{if(settled)return;settled=true;clearTimeout(timer);resolve(Buffer.concat(chunks));});
    });
    request.end();
  });
}
module.exports={PUBLIC_REPOSITORY,DEFAULT_SHARED_URL,DEFAULT_UPDATE_FEED,validatePublicUrl,fetchPublicBytes};
