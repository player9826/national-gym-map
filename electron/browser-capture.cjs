const {isPrivate, imageExtension} = require('./catalog.cjs');

// Capture files are untrusted input. Parsing is passive and performs no requests.
function validateCapture(bundle) {
  if (!bundle || bundle.format !== 'national-gym-map-capture' || bundle.version !== 1 ||
      !Array.isArray(bundle.pages) || !bundle.pages.length || bundle.pages.length > 50)
    throw new Error('浏览器采集文件格式无效，最多支持 50 个页面。');
  const address = value => {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || isPrivate(u.hostname))
      throw new Error('采集文件包含无效来源地址。');
    return u.href;
  };
  let size = 0;
  return bundle.pages.map(page => {
    const url = address(page.url);
    if (typeof page.html !== 'string' || Buffer.byteLength(page.html) > 4 * 1024 ** 2 ||
        !Array.isArray(page.images) || page.images.length > 3)
      throw new Error('采集页面或图片数量超过限制。');
    size += Buffer.byteLength(page.html);
    const images = page.images.map(image => {
      const source = address(image.source);
      if (typeof image.dataUrl !== 'string' || image.dataUrl.length > 28 * 1024 ** 2 ||
          !/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]*={0,2}$/i.test(image.dataUrl))
        throw new Error('采集图片格式无效。');
      const bytes = Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64');
      if (bytes.length > 20 * 1024 ** 2) throw new Error('单张采集图片超过大小限制。');
      imageExtension(bytes);
      size += bytes.length;
      return {source, bytes};
    });
    if (size > 48 * 1024 ** 2) throw new Error('采集内容过大，请分批采集。');
    return {url, html: page.html, images};
  });
}
module.exports = {validateCapture};
