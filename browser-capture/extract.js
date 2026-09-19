// Executed in an isolated world in a tab the user explicitly authorized.
function extractCapturePage() {
  const current = new URL(location.href);
  const heading = (document.querySelector('h1')?.innerText || '').trim();
  const title = document.title || '';
  const gate = /just a moment|verify you are human|checking your browser|access denied|attention required|security verification|\bsign in\b|\blog ?in\b|人机验证|访问被拒绝|登录/i;
  if (gate.test(`${title} ${heading}`) || (performance.getEntriesByType('navigation')[0]?.responseStatus||0)>=400 || document.querySelector('input[type="password"],iframe[src*="challenges.cloudflare.com"],iframe[src*="recaptcha"]'))
    return {url:current.href,error:'登录或验证页面未作为成功采集内容。'};
  const productNodes=[];
  function findProducts(value) {
    if (!value || typeof value!=='object') return;
    if (Array.isArray(value)) {value.forEach(findProducts);return;}
    if ([].concat(value['@type']||[]).includes('Product')) {
      // Keep only public product facts, never arbitrary embedded application state.
      const clean={'@type':'Product'};
      for(const key of ['name','description','sku','model','image','url','category'])
        if(typeof value[key]==='string' || (key==='image'&&Array.isArray(value[key])&&value[key].every(v=>typeof v==='string')))clean[key]=value[key];
      if(typeof value.brand==='string')clean.brand=value.brand;
      else if(typeof value.brand?.name==='string')clean.brand={'@type':'Brand',name:value.brand.name};
      productNodes.push(clean);
    }
    if(value['@graph'])findProducts(value['@graph']);
    if(value.mainEntity)findProducts(value.mainEntity);
  }
  for(const script of document.querySelectorAll('script[type="application/ld+json"]'))try{findProducts(JSON.parse(script.textContent));}catch{}
  const clone=document.documentElement.cloneNode(true);
  clone.querySelectorAll('script,style,link,iframe,object,embed,form,input,textarea,select,button,noscript,nav,header,footer,[contenteditable],#wpadminbar,[autocomplete]').forEach(el=>el.remove());
  for(const el of clone.querySelectorAll('*')) {
    for(const attr of [...el.attributes]) {
      if(!['src','href','alt','title','class','id','name','content','property','itemprop','itemscope','itemtype'].includes(attr.name))el.removeAttribute(attr.name);
      else if(['src','href'].includes(attr.name)) {
        try {const u=new URL(attr.value,current);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)el.removeAttribute(attr.name);else el.setAttribute(attr.name,u.href);}catch{el.removeAttribute(attr.name);}
      }
    }
  }
  clone.querySelectorAll('meta').forEach(el=>{if(!/^(og:|twitter:|description$)/.test(el.getAttribute('property')||el.getAttribute('name')||''))el.remove();});
  const head=clone.querySelector('head');
  for(const product of productNodes){const script=document.createElement('script');script.type='application/ld+json';script.textContent=JSON.stringify(product).replace(/</g,'\\u003c');head?.append(script);}
  const links=[],seen=new Set();
  const excluded=/accessor|spare.part|replacement|cart|checkout|account|login|privacy|contact|blog|news|配件|维修/i;
  const accessory=/^(?:(?:seat|back|chest|arm|knee|roller)\s+pads?\b|weight\s+stack\s+(?:pins?|selector)\b)|\b(?:hex head bolt|selector pin)\b/i;
  for(const a of document.querySelectorAll('a[href]')){
    try {
      if(a.closest('nav,header,footer,aside,[role="navigation"],.breadcrumb,.breadcrumbs,.pagination,.menu'))continue;
      const u=new URL(a.href,current);u.hash='';
      if(u.origin!==current.origin||u.href===current.href||u.search||excluded.test(`${u.pathname} ${a.textContent}`)||accessory.test(a.textContent.trim())||seen.has(u.href))continue;
      if(/product-category|\/category\/|\/collections\/[^/]+\/?$/i.test(u.pathname))continue;
      const prefix=current.pathname.replace(/\/$/,'')+'/';
      const directChild=u.pathname.startsWith(prefix)&&u.pathname.slice(prefix.length).split('/').filter(Boolean).length===1;
      const isProduct=/\/products?\//i.test(u.pathname)||a.closest('.product,[class*="product-card"],[class*="product-item"]')||(directChild&&(a.querySelector('h2,h3,h4,img')||a.parentElement.matches('h2,h3,h4')));
      if(!isProduct)continue;
      seen.add(u.href);links.push(u.href);
    }catch{}
  }
  const candidates=[];
  const pageName=(heading||title.split(/\s*[|–]\s*/)[0]).trim().toLowerCase();
  for(const product of productNodes.filter(p=>p.name?.trim().toLowerCase()===pageName))for(const image of [].concat(product.image||[]))candidates.push(image);
  const og=document.querySelector('meta[property="og:image"]')?.content;if(og)candidates.push(og);
  for(const el of document.querySelectorAll('img,[class*="image"],[class*="photo"],[style*="url("]')) {
    if(el.closest('nav,header,footer,aside,.related-products,.recommendations')||accessory.test(el.getAttribute('alt')||''))continue;
    if(el.tagName==='IMG'&&el.naturalWidth>=160&&el.naturalHeight>=100&&!/logo|icon|avatar|banner/i.test(`${el.src} ${el.alt}`))candidates.push(el.currentSrc||el.src);
    const background=getComputedStyle(el).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
    if(background&&!/logo|icon|avatar|banner|shipping/i.test(background[1]))candidates.push(background[1]);
  }
  const images=[...new Set(candidates.map(value=>{try{const u=new URL(value,current);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}).filter(Boolean))].slice(0,3);
  return {url:current.href,html:'<!doctype html>'+clone.outerHTML,links:links.slice(0,49),imageSources:images};
}
