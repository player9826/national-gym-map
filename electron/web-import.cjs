const { BrowserWindow, session, net, nativeImage } = require("electron");
const dns = require("node:dns").promises;
const cheerio = require("cheerio");
const catalog = require("./catalog.cjs");
const { discoverProducts, imageCandidates } = require("./page-extraction.cjs");

function explain(error) {
  const detail = `${error.message || error} ${error.cause?.code || ""}`;
  if (/TIMED?_?OUT|timeout|Timeout/i.test(detail))
    return "连接或页面加载超时，请检查网络及系统代理，或使用浏览器辅助导入。";
  if (/CERT|SSL/i.test(detail))
    return "网站证书验证失败，请检查系统时间和网络证书。";
  if (/NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(detail))
    return "网站域名无法解析，请检查网址和网络。";
  if (/ERR_ABORTED|destroyed/i.test(detail))
    return "读取已取消，请重新打开导入窗口。";
  if (/fetch failed|ERR_CONNECTION|ERR_PROXY|ERR_TUNNEL/i.test(detail))
    return `网站连接失败，请检查系统代理或使用文件导入。${error.cause?.code || ""}`;
  return error.message || String(error);
}

function parsePage(html, url) {
  const $ = cheerio.load(html);
  const title = $("head > title").first().text();
  const headingText = $("h1").first().text().trim();
  if (
    /^(?:404(?:\s|$)|page not found|not found|this page (?:could not|can't|cannot) be found)/i.test(
      title.trim(),
    ) ||
    /^(?:404(?:\s|$)|page not found|not found)/i.test(headingText)
  )
    throw new Error(
      "产品页面不存在或已移动，请检查链接，或从官网产品列表重新选择。",
    );
  if (
    /Attention Required!|Just a moment|Access Denied|Checking your browser|Verify you are human|Robot Check|请稍候|安全验证|访问被拒绝/i.test(
      title,
    ) ||
    $(
      "#challenge-running, #cf-challenge-running, #cf-error-details, #challenge-form",
    ).length ||
    /window\._cf_chl_opt\s*=|\/orchestrate\/chl_page\//.test(
      $("script").text(),
    ) ||
    (/^(?:www\.)?[^\s/]+\.[a-z]{2,}$/i.test(title.trim()) &&
      /security verification|verify (?:you are|that you)|checking (?:your browser|if the site connection)|performing security verification|Enable JavaScript and cookies/i.test(
        $("body").text(),
      ))
  )
    throw new Error(
      "网站正在验证或拒绝访问。请打开浏览器辅助窗口，完成验证后读取当前页；仍被拒绝时使用文件导入。",
    );
  const products = discoverProducts($, url);
  const pageName = headingText || title.split(/\s*[|–]\s*/)[0].trim();
  const modelHeading = /\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z][a-z0-9-]{2,}\b/i.test(pageName);
  const explicitListing = /\/product-category\/|\/collections\/[^/]+\/?(?:\?|$)/i.test(url) || $("body.post-type-archive-product, body.tax-product_cat").length;
  const explicitProduct = $('.single-product, [itemtype$="/Product"]').length;
  if (explicitListing || (products.length > 1 && !explicitProduct && !modelHeading)) {
    if (!products.length) throw new Error("这是产品分类页，尚未找到可识别的器械链接。请使用浏览器辅助读取，或进入具体机型页面。");
    return {kind: "listing", products, warning: "已排除明显导航和配件链接；请核对候选，本次最多展示 200 项。"};
  }
  const result = catalog.parseProduct(html, url);
  const heading = $("h1").first().text().trim();
  if (
    heading &&
    !$('script[type="application/ld+json"]').text().includes('"Product"')
  )
    result.name = heading.slice(0, 300);
  result.model ||= $('[itemprop="sku"], .sku').first().text().trim();
  result.name = heading || pageName || result.name;
  result.imageCandidates = imageCandidates($, url, result.name, result.imageSource);
  result.imageSource = result.imageCandidates[0] || "";
  result.model ||= result.name.match(/\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z][a-z0-9-]{2,}\b/i)?.[0] || "";
  if (!result.name)
    throw new Error("页面尚未提供产品名称，请使用浏览器读取或文件导入。");
  result.description = $(
    ".woocommerce-product-details__short-description, [itemprop='description'], .product-description",
  )
    .first()
    .text()
    .trim()
    .slice(0, 8000);
  result.officialCategory = $(
    ".posted_in, .product-category, .breadcrumb, .breadcrumbs",
  )
    .first()
    .text()
    .trim()
    .slice(0, 1000);
  result.series = $("[itemprop='isRelatedTo'], .product-series")
    .first()
    .text()
    .trim()
    .slice(0, 300);
  if (result.imageSource) {
    try {
      const imageUrl = new URL(result.imageSource);
      if (!["http:", "https:"].includes(imageUrl.protocol) || imageUrl.username || imageUrl.password) result.imageSource = "";
    } catch { result.imageSource = ""; }
  }
  return result;
}

function structuredError(error, method = "http") {
  const message = explain(error);
  const status =
    error.status ||
    Number(message.match(/(?:返回|status|HTTP)\s*(\d{3})/i)?.[1]) ||
    (/页面不存在/.test(message)
      ? 404
      : /验证或拒绝|网站正在验证/.test(message)
        ? 403
        : /频率/.test(message)
          ? 429
          : 0);
  const reason =
    error.reason ||
    (status === 403
      ? "blocked"
      : status === 404
        ? "not_found"
        : status === 429
          ? "rate_limited"
          : status >= 500
            ? "server_error"
            : /超时|timeout/i.test(message)
              ? "timeout"
              : /名称|不是网页|产品链接|parse/i.test(message)
                ? "parse_error"
                : "network_error");
  return {
    success: false,
    status: status || null,
    reason,
    method,
    canBrowserFallback: status !== 404,
    canPdfFallback: true,
    message,
  };
}

function createWebImporter(store, getWindow) {
  const ses = session.fromPartition("gym-official-import");
  const validated = new Map();
  const lastRequest = new Map();
  let assisted = null;
  let assistedError = "";
  let automatic = null;
  let generation = 0;
  const controllers = new Set();
  const ensureCurrent = (stamp) => {
    if (stamp !== generation) throw new Error("读取已取消。");
  };
  async function validate(url) {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw new Error("仅支持公开网站地址。");
    if (!process.env.GYM_TEST_ALLOW_LOCAL) {
      let check = validated.get(u.hostname);
      if (!check || check.expires < Date.now()) {
        let timer;
        const lookup = Promise.race([
          dns.lookup(u.hostname.replace(/^\[|\]$/g, ""), { all: true }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("域名解析超时")), 10000);
          }),
        ]).finally(() => clearTimeout(timer));
        check = { expires: Date.now() + 30000, promise: lookup };
        validated.set(u.hostname, check);
      }
      const addresses = await check.promise;
      if (
        !addresses.length ||
        addresses.some((a) => catalog.isPrivate(a.address))
      )
        throw new Error("官网导入仅支持公开互联网地址。");
    }
    return u;
  }
  ses.setPermissionRequestHandler((_, __, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (e) => e.preventDefault());
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (
      /^(data:|blob:)/.test(details.url) &&
      details.resourceType !== "mainFrame"
    )
      return callback({});
    validate(details.url).then(
      () => callback({}),
      () => callback({ cancel: true }),
    );
  });
  async function bytes(url, max, referer) {
    const stamp = generation;
    const u = await validate(url);
    ensureCurrent(stamp);
    const pause = Math.max(
      0,
      (lastRequest.get(u.host) || 0) + 600 - Date.now(),
    );
    if (pause) await new Promise((r) => setTimeout(r, pause));
    ensureCurrent(stamp);
    lastRequest.set(u.host, Date.now());
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(
      () => controller.abort(new Error("连接超时")),
      25000,
    );
    try {
      return await new Promise((resolve, reject) => {
        // Native Chromium requests expose redirect destinations; session.fetch does not
        // reliably expose the final URL and its manual mode cancels redirected images.
        const request = net.request({
          url: u.href,
          session: ses,
          redirect: "manual",
          useSessionCookies: true,
        });
        let settled = false,
          finalUrl = u.href,
          redirects = 0;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          controller.signal.removeEventListener("abort", abort);
          if (error) {
            reject(error);
            request.abort();
          } else resolve(value);
        };
        const abort = () =>
          finish(controller.signal.reason || new Error("读取已取消。"));
        controller.signal.addEventListener("abort", abort, { once: true });
        request.setHeader(
          "Accept",
          referer ? "image/*,*/*;q=0.8" : "text/html,*/*;q=0.8",
        );
        if (referer) request.setHeader("Referer", referer);
        request.on("error", (error) => finish(error));
        request.on("redirect", (_, __, target) => {
          if (++redirects > 6) {
            finish(new Error("网页重定向次数过多。"));
            return;
          }
          // followRedirect must run synchronously in this event. The session's
          // onBeforeRequest performs asynchronous destination validation before I/O.
          if (!settled) {
            finalUrl = target;
            request.followRedirect();
          }
        });
        request.on("response", (response) => {
          const header = (name) =>
            Array.isArray(response.headers[name])
              ? response.headers[name][0]
              : response.headers[name];
          if (
            response.statusCode < 200 ||
            response.statusCode >= 300 ||
            header("cf-mitigated") === "challenge"
          ) {
            finish(
              Object.assign(
                new Error(
                  response.statusCode === 429
                    ? "网站限制访问频率，请稍后重试。"
                    : `网站返回 ${response.statusCode}，请使用浏览器辅助导入。`,
                ),
                {
                  status: response.statusCode,
                  reason:
                    header("cf-mitigated") === "challenge"
                      ? "blocked"
                      : undefined,
                },
              ),
            );
            return;
          }
          const chunks = [];
          let size = 0;
          response.on("data", (chunk) => {
            if (settled) return;
            size += chunk.length;
            if (size > max) {
              finish(new Error("远程文件超过大小限制。"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", (error) => finish(error));
          response.on("end", () =>
            finish(null, {
              bytes: Buffer.concat(chunks),
              url: finalUrl,
              type: header("content-type") || "",
            }),
          );
        });
        request.end();
      });
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  function browser(show) {
    const win = new BrowserWindow({
      width: 1150,
      height: 850,
      show,
      parent: getWindow(),
      title: "官网浏览器 · 验证完成后回到导入窗口读取当前页",
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    win.setMenu(null);
    win.importStatus = 0;
    win.webContents.on("did-navigate", (_, __, code) => {
      win.importStatus = code;
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      validate(url)
        .then(() => win.loadURL(url))
        .catch(() => {});
      return { action: "deny" };
    });
    return win;
  }
  async function rendered(win) {
    if (!win || win.isDestroyed()) throw new Error("请先打开浏览器辅助窗口。");
    if (win.importStatus >= 400)
      throw new Error(
        `网站返回 ${win.importStatus}，请完成验证或在浏览器进入有效产品页后重新读取。`,
      );
    const url = win.webContents.getURL();
    await validate(url);
    const html = await win.webContents.executeJavaScript(`(() => {
      const copy = document.documentElement.cloneNode(true);
      const originals = Array.from(document.images);
      copy.querySelectorAll('img').forEach((img, i) => {
        const source = originals[i]?.currentSrc;
        if (source) img.setAttribute('src', source);
      });
      const selector = 'main [class], article [class], [role="main"] [class], #content [class], .category-image, .product-image';
      const originalsWithStyle = document.querySelectorAll(selector);
      copy.querySelectorAll(selector).forEach((element, i) => {
        if (i >= 400 || element.closest('nav,header,footer,aside')) return;
        const background = getComputedStyle(originalsWithStyle[i]).backgroundImage;
        if (background && background !== 'none') element.style.backgroundImage = background;
      });
      return copy.outerHTML;
    })()`);
    if (html.length > 8 * 1024 ** 2) throw new Error("网页内容超过大小限制。");
    return parsePage(html, url);
  }
  async function load(win, url) {
    let timer;
    try {
      await Promise.race([
        win.loadURL(url),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            if (!win.isDestroyed()) win.webContents.stop();
            reject(new Error("页面加载超时"));
          }, 35000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  // Bounded, session-only originals: previews never write into the data directory.
  const previewImages = new Map();
  const capturedImages = new Map();
  const cachedImage = source => capturedImages.get(source) || previewImages.get(source);
  let previewBytes = 0;
  function cacheImage(source, buffer) {
    if (previewImages.has(source)) previewBytes -= previewImages.get(source).length;
    previewImages.delete(source);
    previewImages.set(source, buffer);
    previewBytes += buffer.length;
    while (previewBytes > 64 * 1024 ** 2 || previewImages.size > 120) {
      const key = previewImages.keys().next().value;
      previewBytes -= previewImages.get(key).length;
      previewImages.delete(key);
    }
  }
  function imageOptions(result) {
    return [...new Set([result.imageSource, ...(result.imageCandidates || [])].filter(Boolean))].slice(0, 4);
  }
  async function finish(result, brandId) {
    const stamp = generation;
    if (result.kind === "listing") return result;
    let warning = "", lastError;
    for (const source of imageOptions(result)) {
      try {
        let image;
        try { image = cachedImage(source) ? {bytes: cachedImage(source)} : await bytes(source, 20 * 1024 ** 2, result.productUrl); }
        catch (error) {
          ensureCurrent(stamp);
          if (/大小限制|频率/.test(error.message)) throw error;
          image = await bytes(source, 20 * 1024 ** 2);
        }
        ensureCurrent(stamp);
        result.image = catalog.saveImage(store, image.bytes, "equipment");
        result.imageSource = source;
        break;
      } catch (error) { ensureCurrent(stamp); lastError = error; }
    }
    if (!result.image) warning = lastError ? `产品信息已读取，图片下载失败：${explain(lastError)} 可上传本地图片。` : "产品信息已读取，未找到产品图片，可上传本地图片。";
    return { ...result, image: result.image || "", brandId, warning, sourceType: "official_web", sourceUrl: result.productUrl || "", sourceDate: new Date().toISOString(), verificationStatus: "needs_review" };
  }
  async function thumbnail(result, capturedOnly = false) {
    if (result.kind === "listing") return result;
    const stamp = generation;
    result.imageOptions = [];
    for (const source of imageOptions(result)) {
      try {
        let response;
        try {
          if (cachedImage(source)) response = {bytes: cachedImage(source)};
          else if (capturedOnly) continue;
          else response = await bytes(source, 20 * 1024 ** 2, result.productUrl);
        }
        catch (error) {
          ensureCurrent(stamp);
          if (/大小限制|频率/.test(error.message)) throw error;
          response = await bytes(source, 20 * 1024 ** 2);
        }
        ensureCurrent(stamp);
        catalog.imageExtension(response.bytes);
        const image = nativeImage.createFromBuffer(response.bytes);
        let jpeg;
        if (image.isEmpty()) {
          const {loadImage, createCanvas} = require('@napi-rs/canvas');
          const decoded = await loadImage(response.bytes);
          ensureCurrent(stamp);
          const ratio = Math.min(1, 240 / decoded.width, 180 / decoded.height);
          const canvas = createCanvas(Math.max(1, Math.round(decoded.width * ratio)), Math.max(1, Math.round(decoded.height * ratio)));
          canvas.getContext('2d').drawImage(decoded, 0, 0, canvas.width, canvas.height);
          jpeg = canvas.encodeSync('jpeg', 65);
        } else {
          const size = image.getSize();
          const ratio = Math.min(1, 240 / size.width, 180 / size.height);
          jpeg = image.resize({width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio))}).toJPEG(65);
        }
        if (jpeg.length > 100 * 1024) continue;
        if (!capturedOnly) cacheImage(source, response.bytes);
        result.imageOptions.push({source, preview: `data:image/jpeg;base64,${jpeg.toString("base64")}`});
        if (result.imageOptions.length === 3) break;
      } catch { ensureCurrent(stamp); /* Keep metadata available when an image fails. */ }
    }
    result.thumbnail = result.imageOptions[0]?.preview || "";
    result.imageSource = result.imageOptions[0]?.source || result.imageSource || "";
    return result;
  }
  async function preview(result, brandId) {
    if (result.kind === "listing") return result;
    result = await thumbnail(result);
    return {...result, brandId, pendingWebImage: !!result.thumbnail,
      warning: result.thumbnail ? "" : "已读取资料，图片未能加载。可在辅助浏览器打开后重新读取。",
      sourceType: "official_web", sourceUrl: result.productUrl || "",
      sourceDate: new Date().toISOString(), verificationStatus: "needs_review"};
  }
  function checkBrand(brandId) {
    store.require();
    if (!store.db.brands.some((b) => b.id === brandId))
      throw new Error("请先选择品牌。");
  }
  return {
    captureDiscard: () => { capturedImages.clear(); return true; },
    capturePreview: async ({bundle, brandId}) => {
      checkBrand(brandId);
      const pages = require('./browser-capture.cjs').validateCapture(bundle);
      capturedImages.clear();
      for (const page of pages) for (const image of page.images)
        capturedImages.set(image.source, image.bytes);
      const products = [], errors = [];
      for (const page of pages) {
        try {
          const result = parsePage(page.html, page.url);
          if (result.kind === 'listing') continue;
          // Captured candidates are explicitly chosen from the rendered page.
          result.imageCandidates = page.images.map(image => image.source);
          result.imageSource = result.imageCandidates[0] || '';
          const data = await thumbnail(result, true);
          products.push({...data, captured: true, url: page.url, brandId,
            pendingWebImage: !!data.thumbnail, sourceUrl: page.url,
            sourceType: 'official_web', sourceDate: new Date().toISOString(),
            verificationStatus: 'needs_review'});
        } catch (error) { errors.push(`${page.url}: ${explain(error)}`); }
      }
      if (!products.length) throw new Error(`采集文件中没有可导入的器械详情。${errors[0] || '请采集具体产品页或包含详情的目录。'}`);
      const warning = errors.length ? `${errors.length} 个页面未能识别，其余资料待确认保存。` : '';
      return products.length === 1 ? {...products[0], warning} : {kind: 'listing', products, warning};
    },
    productMetadata: async ({ url, brandId, browser: useBrowser = false }) => {
      checkBrand(brandId);
      try {
        if (useBrowser)
          return {
            success: true,
            ...(await thumbnail(await rendered(assisted))),
            brandId,
          };
        const response = await bytes(url, 8 * 1024 ** 2);
        if (!response.type.includes("html"))
          throw new Error("链接不是网页，请下载文件后导入。");
        let html;
        try {
          html = new TextDecoder(
            response.type.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ||
              "utf-8",
          ).decode(response.bytes);
        } catch {
          html = response.bytes.toString("utf8");
        }
        return {
          success: true,
          ...(await thumbnail(parsePage(html, response.url))),
          brandId,
        };
      } catch (error) {
        return structuredError(error, useBrowser ? "browser" : "http");
      }
    },
    productImage: async ({ imageSource, productUrl, brandId }) => {
      checkBrand(brandId);
      return finish({ imageSource, productUrl }, brandId);
    },
    productPreview: async ({ url, brandId, mode = "auto" }) => {
      checkBrand(brandId);
      const stamp = generation;
      try {
        await validate(url);
        ensureCurrent(stamp);
        if (mode === "auto") {
          try {
            const response = await bytes(url, 8 * 1024 ** 2);
            if (!response.type.includes("html"))
              throw new Error("链接不是网页，请下载文件后导入。");
            const charset =
              response.type.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ||
              "utf-8";
            let html;
            try {
              html = new TextDecoder(charset).decode(response.bytes);
            } catch {
              html = response.bytes.toString("utf8");
            }
            const result = parsePage(html, response.url);
            if (result.kind !== "listing" && !result.imageSource)
              throw new Error("页面需要浏览器补充读取。");
            ensureCurrent(stamp);
            return await preview(result, brandId);
          } catch (e) {
            ensureCurrent(stamp);
            if (/频率|大小限制|不是网页/.test(e.message)) throw e;
          }
        }
        const win = browser(false);
        automatic = win;
        try {
          await load(win, url);
          let result;
          for (let i = 0; i < 8; i++) {
            ensureCurrent(stamp);
            try {
              result = await rendered(win);
              if (result.kind === "listing" || result.imageSource) break;
            } catch (e) {
              if (i === 7) throw e;
            }
            await new Promise((r) => setTimeout(r, 750));
          }
          ensureCurrent(stamp);
          return await preview(result, brandId);
        } finally {
          if (!win.isDestroyed()) win.destroy();
          if (automatic === win) automatic = null;
        }
      } catch (e) {
        throw new Error(explain(e));
      }
    },
    browserOpen: async ({ url }) => {
      store.require();
      await validate(url);
      if (assisted && !assisted.isDestroyed()) assisted.destroy();
      assisted = browser(true);
      assistedError = "";
      const current = assisted;
      current.webContents.on("did-finish-load", () => {
        if (assisted === current) assistedError = "";
      });
      // Loading is deliberately independent of the application operation lock.
      load(current, url).catch((e) => {
        if (assisted === current) assistedError = explain(e);
      });
      return { opened: true };
    },
    browserRead: async ({ brandId }) => {
      checkBrand(brandId);
      try {
        if (assistedError) throw new Error(assistedError);
        return await preview(await rendered(assisted), brandId);
      } catch (e) {
        throw new Error(explain(e));
      }
    },
    browserClose: () => {
      generation++;
      previewImages.clear();
      previewBytes = 0;
      for (const controller of controllers)
        controller.abort(new Error("读取已取消。"));
      if (automatic && !automatic.isDestroyed()) automatic.destroy();
      automatic = null;
      if (assisted && !assisted.isDestroyed()) assisted.destroy();
      assisted = null;
      return true;
    },
  };
}
module.exports = { createWebImporter, parsePage, explain, structuredError };
