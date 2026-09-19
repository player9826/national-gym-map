const cheerio = require('cheerio');
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
function publicUrl(value, base) { if (typeof value !== 'string' || !value.trim()) return ''; try { const u = new URL(value, base); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } }
const chrome = 'nav,header,footer,aside,[role="navigation"],.breadcrumb,.breadcrumbs,.pagination,.menu,.navigation';
const noise = /(?:logo|favicon|sprite|spinner|placeholder|loading|shipping|payment|social|banner|newsletter|tracking|pixel)(?:[\W_]|$)/i;
const accessory = /^(?:(?:seat|back|chest|arm|knee|roller)\s+pad(?:s)?\b|weight\s+stack\s+(?:pins?|selector)\b|(?:replacement\s+)?(?:bolts?|washers?|screws?|nuts?|bushings?|bearings?|upholstery|decals?|stickers?|cable supplies)\b)|\b(?:hex head bolt|selector pin)\b/i;
function imageCandidates($, base, name = '', structured) {
  const out = new Map(); const words = clean(name).toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  function add(raw, score) { const url = publicUrl(raw, base); if (!url || noise.test(url)) return; const match = words.filter(w => url.toLowerCase().includes(w)).length; out.set(url, Math.max(out.get(url) || 0, score + match * 18)); }
  const jsonImages = Array.isArray(structured) ? structured : [structured];
  for (const entry of jsonImages) add(typeof entry === 'object' ? entry?.url || entry?.contentUrl : entry, 110);
  $('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]').each((_, el) => add($(el).attr('content'), 65));
  $('img,source,[style*="url("],[data-background],[data-bg]').each((_, el) => {
    const node = $(el); if (node.closest(chrome).length) return;
    const context = `${node.attr('class') || ''} ${node.attr('id') || ''} ${node.parent().attr('class') || ''}`;
    if (noise.test(context) || noise.test(node.attr('alt') || '') || accessory.test(node.attr('alt') || '')) return;
    if (node.closest('.related-products,.recommendations').length) return;
    const width = Number(node.attr('width')), height = Number(node.attr('height'));
    if ((width > 0 && width < 40) || (height > 0 && height < 40)) return;
    let score = node.closest('main,article,[role="main"],#content,#main,.main-content').length ? 35 : 15;
    if (/product.*(?:image|photo|gallery)|(?:image|photo).*product|category.*(?:image|description)|machine.*image|detail.*(?:image|photo)/i.test(context)) score += 45;
    if (node.closest('.related-products,.recommendations,.product-list,.category-list').length) score -= 25;
    if (words.some(w => clean(node.attr('alt')).toLowerCase().includes(w))) score += 30;
    for (const [i, attr] of ['data-zoom-image','data-large_image','data-original','data-lazy-src','data-src','data-background','data-bg','src'].entries()) add(node.attr(attr), score + 12 - i);
    for (const attr of ['data-srcset','srcset']) {
      const entries = String(node.attr(attr) || '').split(',').map(v => v.trim().split(/\s+/)).sort((a,b) => parseFloat(b[1] || 1) - parseFloat(a[1] || 1));
      entries.forEach((v,i) => add(v[0], score + 14 - i));
    }
    const background = String(node.attr('style') || '').match(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/i); if (background) add(background[1], score);
  });
  const ranked = [...out].sort((a,b) => b[1]-a[1]);
  return ranked.slice(0,8).map(([url]) => url);
}
function discoverProducts($, base) {
  const current = new URL(base); const prefix = current.pathname.replace(/\/$/,'') + '/'; const found = new Map();
  $('a[href]').each((_, el) => {
    const node = $(el); if (node.closest(chrome).length) return;
    const url = publicUrl(node.attr('href'), base); if (!url) return; const target = new URL(url);
    if (target.origin !== current.origin || target.pathname.replace(/\/$/,'') === current.pathname.replace(/\/$/,'') || /\.(pdf|zip|jpe?g|png|webp|avif)$/i.test(target.pathname) || /(?:cart|login|register|account|wishlist|checkout|contact|privacy|shipping|search)(?:\/|$)/i.test(target.pathname) || [...target.searchParams.keys()].some(k => /sort|filter|page|cart/i.test(k))) return;
    const grid = node.closest('.products,.product-grid,.products-grid,.product-list,.category-list,.category-grid,[itemtype$="/ItemList"]');
    const content = node.closest('main,article,[role="main"],#content,#main,.main-content');
    const nested = target.pathname.startsWith(prefix) && target.pathname.slice(prefix.length).split('/').filter(Boolean).length === 1;
    const heading = node.find('h2,h3,h4,.product-title,.category-title,.woocommerce-loop-product__title').first();
    if (!grid.length && !(nested && (heading.length || node.find('img').length || node.parent().is('h2,h3,h4')))) return;
    let name = clean(heading.text() || node.attr('aria-label') || node.text() || node.find('img').attr('alt'));
    name = name.replace(/\s+(?:\$|€|£)\s*\d[\s\S]*$/, '').trim();
    if (!name || name.length > 200 || /^(?:quick view|read more|select options|add to cart|view all|learn more|shop now|next|previous|home|全部|查看更多)$/i.test(name) || accessory.test(name)) return;
    target.hash = ''; const key = target.href.replace(/\/$/,'');
    const local = cheerio.load(node.html() || ''); const images = imageCandidates(local, base, name);
    if (!found.has(key) || (!found.get(key).imageSource && images.length)) found.set(key,{name,url:target.href,imageSource:images[0] || ''});
  });
  return [...found.values()].slice(0,200);
}
module.exports = { imageCandidates, discoverProducts, publicUrl, accessory };
