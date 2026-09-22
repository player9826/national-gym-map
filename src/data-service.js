export const isWeb = typeof window !== "undefined" && !window.desktop;

let imageIndex = {};
const siteUrl = (path) => new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI)).href;

async function getBytes(url, signal) {
  const response = await fetch(url, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error("公开资料暂时无法加载，请稍后重试。");
  return response.arrayBuffer();
}

async function checkedJson(descriptor, revision, signal) {
  if (!descriptor || !/^(catalog|images)\.json$/.test(descriptor.path) || !/^[a-f0-9]{64}$/.test(descriptor.sha256))
    throw new Error("资料发布清单无效，请稍后重试。");
  const bytes = await getBytes(siteUrl(`data/${descriptor.path}?v=${revision}`), signal);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  if (bytes.byteLength !== descriptor.size || hash !== descriptor.sha256)
    throw new Error("资料正在更新，请重新加载以获取完整版本。");
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function loadSnapshot() {
  if (!isWeb) {
    const status = await window.desktop.call("status");
    return { status, db: status.ready ? await window.desktop.call("state") : null };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const manifest = JSON.parse(new TextDecoder().decode(await getBytes(siteUrl("data/manifest.json"), controller.signal)));
    if (manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.revision))
      throw new Error("资料版本暂不受支持，请刷新网页。");
    const [catalog, images] = await Promise.all([
      checkedJson(manifest.catalog, manifest.revision, controller.signal),
      checkedJson(manifest.images, manifest.revision, controller.signal),
    ]);
    if (!["gyms", "equipment", "brands", "links"].every((key) => Array.isArray(catalog[key])))
      throw new Error("公开资料不完整，请稍后重试。");
    imageIndex = images;
    return { status: { ready: true, updatedAt: manifest.updatedAt }, db: { ...catalog, settings: {} } };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("资料加载超时，请检查网络后重试。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function imageUrl(ref, { thumbnail = false } = {}) {
  if (!ref) return "";
  if (!isWeb) return `gymasset://local/${ref}`;
  const path = imageIndex[ref]?.[thumbnail ? "thumbnail" : "detail"];
  // Only published, content-addressed images may be requested by the public site.
  return typeof path === "string" && /^images\/(thumb|detail)\/[a-f0-9]{64}\.(webp|png|jpg)$/.test(path) ? siteUrl(path) : "";
}

export function openExternal(value) {
  if (!isWeb) return window.desktop.call("external", value);
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("此链接不是可打开的网页地址。");
  window.open(url.href, "_blank", "noopener,noreferrer");
}
