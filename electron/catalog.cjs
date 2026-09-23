const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns").promises;
const net = require("node:net");
const cheerio = require("cheerio");
const { atomic, validate, TAGS } = require("./storage.cjs");
const { countryOf } = require("./gym-location.mjs");
const {
  normalizeClassification,
  validateClassification,
  normalizeSeries,
} = require("./equipment-model.cjs");
const id = () => crypto.randomUUID();
const text = (value) => (value == null ? "" : String(value).trim());
function gym(input) {
  return {
    ...input,
    id: input.id || id(),
    name: text(input.name),
    country: countryOf(input),
    province: text(input.province),
    city: text(input.city),
    district: text(input.district),
    address: text(input.address),
    lat: input.lat === "" || input.lat == null ? null : Number(input.lat),
    lng: input.lng === "" || input.lng == null ? null : Number(input.lng),
    visited: input.visited === true,
    visitDate: text(input.visitDate),
    tags: Array.isArray(input.tags) ? input.tags.map(text) : [],
    brandIds: Array.isArray(input.brandIds) ? [...new Set(input.brandIds)] : [],
    description: text(input.description),
    score:
      input.score === "" || input.score == null ? null : Number(input.score),
    reviewUrl: text(input.reviewUrl),
    reviewSource: text(input.reviewSource),
    reviewVersion: text(input.reviewVersion),
    reviewDate: text(input.reviewDate),
    cover: input.cover || "",
    photos: input.photos || [],
    updatedAt: new Date().toISOString(),
  };
}
function equipment(input, { legacy = false, allowIncomplete = false } = {}) {
  const row = normalizeClassification(
    {
      ...input,
      id: input.id || id(),
      name: text(input.name),
      brandId: text(input.brandId),
      part: text(input.part),
      parts: [
        ...new Set(input.parts ?? [input.part || input.body].filter(Boolean)),
      ],
      loading: input.loading || "",
      tags: Array.isArray(input.tags)
        ? input.tags
        : [input.applicationTag].filter(Boolean),
      model: text(input.model),
      series: normalizeSeries(input.series),
      image: input.image || "",
      imageSource: text(input.imageSource),
      productUrl: text(input.productUrl),
      notes: text(input.notes),
      sourceType:
        text(input.sourceType) || (input.productUrl ? "official" : "manual"),
      sourceUrl: text(input.sourceUrl || input.productUrl),
      sourceDate: text(input.sourceDate),
      verificationStatus: text(input.verificationStatus) || "unverified",
      verifiedBy: text(input.verifiedBy),
      verifiedAt: text(input.verifiedAt),
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { legacy },
  );
  validateClassification(row, { allowIncomplete: legacy || allowIncomplete });
  for (const field of ['thumbnail', 'imageOptions', 'imageCandidates', 'listingImageSource', 'listingUrl', 'pendingWebImage', 'captured', 'kind', 'success', 'warning', 'url'])
    delete row[field];
  return row;
}
function summarize(value) {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "有" : "无";
  if (Array.isArray(value)) return value.map(summarize).join("、");
  if (typeof value === "object")
    return Object.entries(value)
      .map(([k, v]) => `${k}：${summarize(v)}`)
      .join("；");
  return String(value);
}
function reviewToGym(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !raw.fields ||
    !raw.state
  )
    throw new Error(
      "测评文件必须包含 fields（基本信息字段）和 state（测评状态）对象。",
    );
  const f = raw.fields,
    s = raw.state;
  const entries = [
    ["16 大类覆盖", s.cats],
    ["肌群分布", s.muscles],
    ["肌群详细分类", s.muscleDetails],
    ["史密斯机", s.smithCount],
    ["深蹲架", s.sqRackCount],
    ["卧推台", s.benchCount],
    ["可调凳", s.adjBenchCount],
    ["硬拉平台", s.deadliftCount],
    ["最大哑铃", s.dumbbellMax],
    ["插片器械", s.pinCount],
    ["挂片器械", s.plateCount],
    ["绳索器械", s.ropeCount],
    ["杠铃杆", s.barbellBarTypes],
    ["杠铃片", s.plateTypes],
    ["有氧设备", s.cardio],
    ["空间摘要", s.layout],
    ["更衣储物", s.lockerStorage],
    ["淋浴", s.shower],
    ["更衣设计", s.lockerDesign],
    ["卫生间", s.restroom],
    ["更衣检查", raw.lockerChecks],
    ["交通", s.transport],
    ["停车", s.parking],
    [
      "训练生态",
      {
        团课: s.groupClass,
        自由教练: s.freeTrainer,
        高阶设施: s.advancedSet,
        功能训练: s.funcToolsSet,
        功能区: s.funcArea,
        运动竞赛训练: s.hyrox,
        泳池: s.pool,
        恢复: s.recovery,
      },
    ],
  ];
  const candidate =
    raw.finalScore ??
    raw.totalScore ??
    raw.score ??
    f.finalScore ??
    f.totalScore ??
    f.score;
  const score =
    candidate !== "" && candidate != null && Number.isFinite(Number(candidate))
      ? Number(candidate)
      : null;
  const area = f.gymArea ?? f.area ?? null;
  return gym({
    name: f.gymName || "",
    city: f.gymCity || "",
    province: f.gymProvince || "",
    district: f.gymDistrict || "",
    address: f.gymAddress || "",
    area,
    areaType:
      s.areaIsTotal == null ? "未说明" : s.areaIsTotal ? "总面积" : "训练面积",
    score,
    visited: false,
    reviewSource: raw.source || raw.reviewSource || "",
    reviewUrl: raw.reviewUrl || raw.url || "",
    reviewVersion: raw.version || "",
    reviewDate: raw.date || raw.reviewDate || "",
    reviewImportedAt: new Date().toISOString(),
    rawReview: raw,
    reviewSummary: entries
      .filter(([, v]) => v != null)
      .map(([label, v]) => ({ label, value: summarize(v) })),
    description: "",
  });
}
function upsert(store, collection, input) {
  store.require();
  const db = structuredClone(store.db);
  const exists = input.id && db[collection].find((r) => r.id === input.id);
  const row =
    collection === "gyms"
      ? gym({ ...exists, ...input })
      : collection === "equipment"
        ? equipment(
            { ...exists, ...input },
            {
              allowIncomplete:
                !!exists &&
                exists.verificationStatus === "needs_review" &&
                (input.equipmentType === undefined ||
                  input.equipmentType === exists.equipmentType) &&
                JSON.stringify(input.parts ?? exists.parts) ===
                  JSON.stringify(exists.parts) &&
                JSON.stringify(input.tags ?? exists.tags) ===
                  JSON.stringify(exists.tags),
            },
          )
        : {
            ...exists,
            ...input,
            id: input.id || id(),
            name: text(input.name),
            website: text(input.website),
            notes: text(input.notes),
          };
  if (!row.name) throw new Error("名称不能为空。");
  if (
    collection === "brands" &&
    db.brands.some(
      (b) =>
        b.id !== row.id &&
        b.name.toLocaleLowerCase() === row.name.toLocaleLowerCase(),
    )
  )
    throw new Error("品牌名称已存在。");
  const index = db[collection].findIndex((r) => r.id === row.id);
  if (index >= 0) db[collection][index] = row;
  else db[collection].push(row);
  store.save(db);
  return row;
}
function remove(store, { collection, id: target }) {
  store.require();
  if (!["gyms", "equipment", "brands"].includes(collection))
    throw new Error("数据类型无效。");
  const db = structuredClone(store.db);
  if (!db[collection].some((r) => r.id === target))
    throw new Error("记录已不存在，请刷新后重试。");
  if (collection === "brands" && db.equipment.some((e) => e.brandId === target))
    throw new Error("此品牌仍有关联器械，请先调整或删除器械。");
  if (
    collection === "brands" &&
    db.gyms.some((g) => g.brandIds?.includes(target))
  )
    throw new Error("此品牌仍被场馆标签使用，请先移除对应标签。");
  db[collection] = db[collection].filter((r) => r.id !== target);
  if (collection === "gyms")
    db.links = db.links.filter((r) => r.gymId !== target);
  if (collection === "equipment")
    db.links = db.links.filter((r) => r.equipmentId !== target);
  store.save(db);
  return true;
}
function link(store, input) {
  store.require();
  const db = structuredClone(store.db);
  const old = db.links.find(
    (r) => r.gymId === input.gymId && r.equipmentId === input.equipmentId,
  );
  const row = {
    ...old,
    ...input,
    id: old?.id || id(),
    quantity: Number(input.quantity),
    status: input.status || "正常",
    notes: text(input.notes),
    verifiedAt: input.verifiedAt || "",
  };
  db.links = db.links.filter((r) => r.id !== row.id);
  db.links.push(row);
  store.save(db);
  return row;
}
function unlink(store, target) {
  const db = structuredClone(store.db);
  db.links = db.links.filter((r) => r.id !== target);
  store.save(db);
  return true;
}
function prepareImport(store, { kind, raw }) {
  store.require();
  if (kind === "review")
    return {
      kind,
      rows: [reviewToGym(raw)],
      warnings: ["文件未包含经纬度时，保存档案后可通过地图选点补充位置。"],
    };
  const key =
    kind === "gyms" ? "gyms" : kind === "equipment" ? "equipment" : null;
  if (!key) throw new Error("导入类型无效。");
  const rows = Array.isArray(raw) ? raw : raw[key];
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("文件中没有可导入的记录数组。");
  if (rows.length > 5000) throw new Error("单次最多导入 5000 条记录。");
  const brands = Array.isArray(raw.brands) ? structuredClone(raw.brands) : [];
  const normalized = rows.map((r) =>
    key === "gyms" ? gym(r) : equipment(r, { legacy: !r.equipmentType }),
  );
  const known = new Set(store.db[key].map((r) => r.id));
  const repeated = normalized.filter((r) => known.has(r.id)).length;
  const draft = structuredClone(store.db);
  for (const brand of brands)
    if (!draft.brands.some((b) => b.id === brand.id)) draft.brands.push(brand);
  const incomingIds = new Set(normalized.map((r) => r.id));
  draft[key] = [
    ...draft[key].filter((r) => !incomingIds.has(r.id)),
    ...normalized,
  ];
  validate(draft);
  const links = Array.isArray(raw.links)
    ? raw.links.filter(
        (l) =>
          draft.gyms.some((g) => g.id === l.gymId) &&
          draft.equipment.some((e) => e.id === l.equipmentId),
      )
    : [];
  const warnings = [];
  for (const brand of brands) {
    if (brand.logo && !fs.existsSync(path.join(store.root, brand.logo))) {
      warnings.push(`「${brand.name}」的品牌标识不在当前数据目录，将恢复内置标识或品牌名称。跨电脑转移图片请使用共享资料库或完整备份。`);
      brand.logo = "";
    }
  }
  if (repeated) warnings.push(`${repeated} 条已有标识的记录将被更新。`);
  if (raw.links?.length > links.length)
    warnings.push(
      "部分关联的另一端尚未导入，本次跳过；导入另一类数据后可再次导入以补齐。",
    );
  for (const row of normalized) {
    for (const key of ["image", "cover"])
      if (row[key] && !fs.existsSync(path.join(store.root, row[key]))) {
        warnings.push(
          `「${row.name}」的本地图片不在当前数据目录，将清除图片引用。跨电脑转移图片请恢复完整备份。`,
        );
        row[key] = "";
      }
    if (row.photos)
      row.photos = row.photos.filter((p) =>
        fs.existsSync(path.join(store.root, p)),
      );
  }
  return {
    kind,
    rows: normalized,
    brands,
    links,
    warnings: [...new Set(warnings)],
  };
}
function commitImport(store, draft) {
  if (draft.kind === "review") return upsert(store, "gyms", draft.rows[0]);
  const key = draft.kind;
  if (!["gyms", "equipment"].includes(key)) throw new Error("导入类型无效。");
  const db = structuredClone(store.db);
  for (const brand of draft.brands || [])
    if (!db.brands.some((b) => b.id === brand.id)) db.brands.push(brand);
  const ids = new Set(draft.rows.map((r) => r.id));
  db[key] = [...db[key].filter((r) => !ids.has(r.id)), ...draft.rows];
  for (const incoming of draft.links || []) {
    db.links = db.links.filter(
      (l) =>
        l.id !== incoming.id &&
        !(l.gymId === incoming.gymId && l.equipmentId === incoming.equipmentId),
    );
    db.links.push(incoming);
  }
  store.save(db);
  return { count: draft.rows.length };
}
function isPrivate(address) {
  if (net.isIP(address) === 4) {
    const p = address.split(".").map(Number);
    return (
      p[0] === 0 ||
      p[0] === 10 ||
      p[0] === 127 ||
      p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    );
  }
  const a = address.toLowerCase();
  return (
    a === "::" ||
    a === "::1" ||
    a.startsWith("fc") ||
    a.startsWith("fd") ||
    a.startsWith("fe80") ||
    a.startsWith("::ffff:") ||
    a.startsWith("ff")
  );
}
async function fetchBytes(url, max = 20 * 1024 * 1024) {
  for (let redirect = 0; redirect < 6; redirect++) {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw new Error("请输入有效的公开网页地址。");
    const addresses = await dns.lookup(u.hostname.replace(/^\[|\]$/g, ""), {
      all: true,
    });
    if (
      !process.env.GYM_TEST_ALLOW_LOCAL &&
      addresses.some((a) => isPrivate(a.address))
    )
      throw new Error("官网导入仅支持公开互联网地址。");
    const response = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: {
        "User-Agent": "NationalGymMap/1.0 (+local personal equipment catalog)",
        Accept: "text/html,image/*,*/*;q=0.8",
      },
    });
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get("location")
    ) {
      url = new URL(response.headers.get("location"), u).toString();
      await response.body?.cancel();
      continue;
    }
    if (!response.ok)
      throw new Error(
        `官网返回状态 ${response.status}，请检查链接或手动添加。`,
      );
    if (Number(response.headers.get("content-length")) > max) {
      await response.body?.cancel();
      throw new Error("远程文件超过大小限制。");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > max) throw new Error("远程文件超过大小限制。");
      chunks.push(chunk);
    }
    return {
      bytes: Buffer.concat(chunks),
      url: u.toString(),
      type: response.headers.get("content-type") || "",
    };
  }
  throw new Error("网页重定向次数过多。");
}
function parseProduct(html, url) {
  const $ = cheerio.load(html);
  let product;
  const productNodes = [];
  const search = (value) => {
    if (!value || typeof value !== "object") return;
    if (
      (Array.isArray(value["@type"])
        ? value["@type"]
        : [value["@type"]]
      ).includes("Product")
    )
      productNodes.push(value);
    for (const v of Object.values(value)) {
      if (Array.isArray(v)) v.forEach(search);
      else if (v && typeof v === "object") search(v);
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      search(JSON.parse($(el).text()));
    } catch {}
  });
  const pageHeading = $("h1").first().text().trim() || $('meta[property="og:title"]').attr('content') || $("title").text().split(/\s*[|–]\s*/)[0].trim();
  const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  product = productNodes.find(value => value.url && require('./page-extraction.cjs').publicUrl(value.url, url)?.replace(/\/$/,'') === url.replace(/\/$/,'')) || productNodes.find(value => normalized(pageHeading) && normalized(value.name) && (normalized(pageHeading).includes(normalized(value.name)) || normalized(value.name).includes(normalized(pageHeading))));
  if (!product && !pageHeading && productNodes.length === 1) product = productNodes[0];
  const name =
    product?.name ||
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text() ||
    $("title").text();
  const images = require('./page-extraction.cjs').imageCandidates($, url, name, product?.image);
  return {
    name: text(name).slice(0, 300),
    imageSource: images[0] || "",
    imageCandidates: images,
    model: text(product?.model || product?.sku),
    detectedBrand: text(
      typeof product?.brand === "object" ? product.brand.name : product?.brand,
    ),
    productUrl: url,
  };
}
function imageExtension(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "webp";
  if (bytes.subarray(0, 3).toString() === "GIF") return "gif";
  // AVIF uses an ISO base media FileTypeBox, with avif/avis as a major
  // or compatible brand. Do not trust the filename or match arbitrary payload text.
  if (bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp") {
    let size = bytes.readUInt32BE(0),
      start = 8;
    if (size === 1 && bytes.length >= 24) {
      const extended = bytes.readBigUInt64BE(8);
      size = extended <= BigInt(bytes.length) ? Number(extended) : -1;
      start = 16;
    }
    if (size >= start + 8 && size <= bytes.length && (size - start) % 4 === 0) {
      const brands = [bytes.toString("ascii", start, start + 4)];
      for (let offset = start + 8; offset < size; offset += 4)
        brands.push(bytes.toString("ascii", offset, offset + 4));
      if (brands.some((brand) => brand === "avif" || brand === "avis"))
        return "avif";
    }
  }
  throw new Error("图片不是支持的照片格式，请使用照片文件。");
}
function saveImage(store, bytes, category) {
  store.require();
  if (!["gyms", "equipment", "brands"].includes(category))
    throw new Error("图片类别无效。");
  if (bytes.length > 20 * 1024 * 1024)
    throw new Error("单张图片最大 20 MB（Megabyte，兆字节）。");
  const rel = `${category}/${id()}.${imageExtension(bytes)}`;
  atomic(path.join(store.root, rel), bytes);
  return rel;
}
module.exports = {
  gym,
  equipment,
  upsert,
  remove,
  link,
  unlink,
  reviewToGym,
  prepareImport,
  commitImport,
  fetchBytes,
  parseProduct,
  saveImage,
  imageExtension,
  isPrivate,
};
