const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("./catalog.cjs");
const { suggest } = require("./equipment-rules.cjs");
const { validateFields, validateImportBatches } = require("./batch-model.cjs");
const {
  normalizeClassification,
  validateClassification,
  normalizeSeries,
} = require("./equipment-model.cjs");
const STATES = [
  "pending",
  "imported",
  "deferred",
  "ignored",
  "fetch_failed",
  "possible_duplicate",
  "incomplete",
];
const now = () => new Date().toISOString();
const normalize = (s) =>
  String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
function canonical(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "ref"].forEach((k) =>
      u.searchParams.delete(k),
    );
    return u.href.replace(/\/$/, "");
  } catch {
    return String(url || "");
  }
}
function duplicate(row, equipment) {
  const same = equipment.filter((e) => e.brandId === row.brandId);
  const exact =
    row.model &&
    same.find((e) => e.model && normalize(e.model) === normalize(row.model));
  const suspected = same.find(
    (e) =>
      normalize(e.name) === normalize(row.name) ||
      (row.sourceUrl &&
        canonical(e.sourceUrl || e.productUrl) === canonical(row.sourceUrl)),
  );
  const match = exact || suspected;
  return match
    ? {
        kind: exact ? "exact" : "suspected",
        equipmentId: match.id,
        name: match.name,
      }
    : { kind: "new" };
}
function counts(batch) {
  const result = {
    total: batch.candidates.length,
    fixed: 0,
    cardio: 0,
    free_weight: 0,
    cable_station: 0,
    unknown: 0,
  };
  for (const row of batch.candidates) {
    result[row.status] = (result[row.status] || 0) + 1;
    result[row.equipmentType || "unknown"]++;
  }
  return result;
}
function createBatchImporter(store, web) {
  const tokens = new Map(), drafts = new Map(), fetches = new Map(), committing = new Set();
  let sessionRoot = store.root;
  function checkSession() {
    store.require();
    if (sessionRoot !== store.root) {
      drafts.clear(); tokens.clear(); fetches.clear();
      sessionRoot = store.root;
    }
  }
  const get = (id) => {
    checkSession();
    let b = drafts.get(id);
    if (!b) {
      b = (store.db.importBatches || []).find((b) => b.id === id);
      if (!b) throw new Error("批次不存在。");
      b = { ...structuredClone(b), temporary: true };
      drafts.set(id, b);
    }
    return structuredClone(b);
  };
  function save(batch) {
    checkSession();
    for (const row of batch.candidates) if (Object.hasOwn(row, "series")) row.series = normalizeSeries(row.series);
    batch.updatedAt = now();
    batch.counts = counts(batch);
    batch.temporary = true;
    validateImportBatches([batch]);
    drafts.set(batch.id, structuredClone(batch));
    tokens.delete(batch.id);
    return batch;
  }
  function cancelFetches(id, candidateIds) {
    for (const [key, request] of fetches)
      if (request.id === id && (!candidateIds || candidateIds.includes(request.candidateId))) fetches.delete(key);
  }
  function refresh(row, db = store.db) {
    row.duplicate = duplicate(row, db.equipment);
    if (
      ["ignored", "deferred", "imported", "fetch_failed"].includes(row.status)
    )
      return row;
    try {
      validateClassification(row);
      if (!row.name.trim()) throw new Error("名称为空");
      row.status =
        row.duplicate.kind === "new" || row.decision
          ? "pending"
          : "possible_duplicate";
    } catch {
      row.status = "incomplete";
    }
    return row;
  }
  function prepare(batch) {
    const summary = {
      added: 0,
      supplemented: 0,
      duplicates: 0,
      deferred: 0,
      ignored: 0,
      failed: 0,
      images: 0,
    };
    const issues = [],
      operations = [],
      scratch = structuredClone(store.db.equipment),
      imageTargets = new Set();
    for (const original of batch.candidates) {
      const row = structuredClone(original);
      if (row.status === "imported") continue;
      if (row.status === "deferred") {
        summary.deferred++;
        continue;
      }
      if (row.status === "ignored" || row.decision === "ignore") {
        summary.ignored++;
        continue;
      }
      if (row.status === "fetch_failed") {
        summary.failed++;
        continue;
      }
      row.duplicate = duplicate(row, scratch);
      if (row.duplicate.kind !== "new") summary.duplicates++;
      if (
        row.duplicate.kind !== "new" &&
        !["new", "supplement"].includes(row.decision)
      ) {
        issues.push(`${row.name}：请选择重复处理方式，或暂缓/忽略。`);
        continue;
      }
      const target =
        row.decision === "supplement" && row.duplicate.equipmentId
          ? scratch.find((e) => e.id === row.duplicate.equipmentId)
          : null;
      if (row.decision === "supplement" && !target) {
        issues.push(`${row.name}：找不到补充目标，请重新选择。`);
        continue;
      }
      const fields = {
        name: row.name,
        brandId: batch.brandId,
        model: row.model || "",
        equipmentType: row.equipmentType,
        freeWeightType: row.freeWeightType || "",
        parts: row.parts || [],
        tags: row.tags || [],
        loading: row.loading || "",
        image: "",
        imageSource: row.imageSource || "",
        productUrl: row.productUrl || row.sourceUrl,
        sourceUrl: row.sourceUrl,
        sourceType: batch.sourceType,
        sourceDate: row.sourceDate || batch.createdAt,
        notes: row.notes || row.description || "",
        series: row.series || "",
        verificationStatus: "verified",
        verifiedBy: "user",
        verifiedAt: now(),
      };
      let record;
      try {
        if (target) {
          record = structuredClone(target);
          for (const [k, v] of Object.entries(fields))
            if (
              (record[k] == null ||
                record[k] === "" ||
                (Array.isArray(record[k]) && !record[k].length)) &&
              v !== "" &&
              v != null
            )
              record[k] = v;
          record = catalog.equipment(record);
        } else record = catalog.equipment(fields);
        validateClassification(record);
      } catch (error) {
        issues.push(`${row.name}：${error.message}`);
        continue;
      }
      if (target) {
        summary.supplemented++;
        scratch[scratch.findIndex((e) => e.id === target.id)] = record;
      } else {
        summary.added++;
        scratch.push(record);
      }
      if (!record.image && record.imageSource && !imageTargets.has(record.id)) {
        summary.images++;
        imageTargets.add(record.id);
      }
      operations.push({ candidateId: row.id, targetId: target?.id, record });
    }
    return { summary, issues, operations };
  }
  return {
    batchList: () => {
      checkSession();
      return structuredClone(store.db.importBatches || []).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
    },
    batchRead: ({ id }) => get(id),
    batchDiscard: ({ id }) => {
      checkSession(); drafts.delete(id); tokens.delete(id); cancelFetches(id);
      web.captureDiscard?.();
      return true;
    },
    batchRemoveCandidates: ({ id, candidateIds }) => {
      const batch = get(id);
      if (!Array.isArray(candidateIds) || !candidateIds.length || candidateIds.some(value => typeof value !== "string"))
        throw new Error("请选择要删除的候选。");
      if (candidateIds.some(candidateId => !batch.candidates.some(row => row.id === candidateId))) throw new Error("候选不存在。");
      if (batch.candidates.some(row => candidateIds.includes(row.id) && row.status === "imported")) throw new Error("已导入项目不可删除。");
      batch.candidates = batch.candidates.filter(row => !candidateIds.includes(row.id));
      cancelFetches(id, candidateIds);
      return save(batch);
    },
    batchScan: async ({
      brandId,
      url,
      sourceType = "official_web",
      browser = false,
      capture = null,
    }) => {
      checkSession();
      const scanRoot = store.root;
      if (!store.db.brands.some((b) => b.id === brandId))
        throw new Error("请先选择品牌。");
      const batch = {
        id: crypto.randomUUID(),
        brandId,
        sourceUrl: url,
        sourceType,
        createdAt: now(),
        updatedAt: now(),
        status: "scanned",
        candidates: [],
      };
      const result = capture || await web.productMetadata({ url, brandId, browser });
      checkSession();
      if (scanRoot !== store.root) throw new Error("数据目录已变化，请重新扫描。");
      if (result.success === false) {
        batch.status = "failed";
        batch.error = result;
        return save(batch);
      }
      const products =
        result.kind === "listing"
          ? result.products
          : [{ ...result, url: result.productUrl || url }];
      const memory = (store.db.importBatches || [])
        .filter((b) => b.brandId === brandId)
        .flatMap((b) => b.candidates)
        .reverse()
        .sort((a, b) =>
          (b.updatedAt || b.createdAt || "").localeCompare(
            a.updatedAt || a.createdAt || "",
          ),
        );
      const seen = new Set();
      batch.candidates = products
        .filter((p) => {
          const key = canonical(p.url);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 200)
        .map((p) => {
          const previous = memory.find(
            (r) => canonical(r.sourceUrl) === canonical(p.url),
          );
          const row = {
            id: crypto.randomUUID(),
            brandId,
            name: p.name || "",
            model: p.model || "",
            imageSource: p.imageSource || "",
            listingImageSource: p.listingImageSource || "",
            listingUrl: p.listingUrl || "",
            ...(p.thumbnail ? {thumbnail: p.thumbnail} : {}),
            ...(p.imageOptions ? {imageOptions: p.imageOptions} : {}),
            productUrl: p.url,
            sourceUrl: p.url,
            sourceDate: now(),
            description: p.description || "",
            series: p.series || "",
            officialCategory: p.officialCategory || "",
            ...suggest(p),
            status: "pending",
            detailFetched: !!p.captured || result.kind !== "listing",
            decision: "",
            createdAt: now(),
            updatedAt: now(),
          };
          if (previous && ["ignored", "deferred"].includes(previous.status)) {
            for (const field of [
              "equipmentType",
              "freeWeightType",
              "parts",
              "tags",
              "decision",
              "status",
            ])
              row[field] = structuredClone(previous[field] ?? row[field]);
            row.remembered = true;
          }
          return refresh(row);
        });
      return save(batch);
    },
    batchFetch: async ({ id, candidateId, browser = false }) => {
      let batch = get(id),
        row = batch.candidates.find((r) => r.id === candidateId);
      if (!row) throw new Error("候选不存在。");
      if (row.status === "imported")
        throw new Error("已导入项目不能重复读取。");
      const requestKey = `${id}:${candidateId}`;
      const request = { id, candidateId, root: store.root };
      fetches.set(requestKey, request);
      tokens.delete(id);
      const result = await web.productMetadata({
        url: row.sourceUrl,
        brandId: batch.brandId,
        browser,
      });
      checkSession();
      if (request.root !== store.root || fetches.get(requestKey) !== request || !drafts.has(id)) throw new Error("候选读取已取消。");
      fetches.delete(requestKey);
      batch = get(id);
      row = batch.candidates.find((r) => r.id === candidateId);
      if (!row || row.status === "imported") throw new Error("候选已删除或已导入。");
      if (result.success === false || result.kind === "listing") {
        if (result.imageOptions?.length) {
          row.imageOptions = result.imageOptions;
          row.thumbnail = result.thumbnail;
          row.imageSource = result.imageSource;
        }
        row.error =
          result.success === false
            ? result
            : {
                success: false,
                status: 200,
                reason: "parse_error",
                method: "http",
                canBrowserFallback: true,
                canPdfFallback: true,
                message: "此地址仍为列表，请选择具体产品页。",
              };
        row.status = "fetch_failed";
      } else {
        for (const field of [
          "name",
          "model",
          "imageSource",
          "description",
          "series",
          "officialCategory",
          "thumbnail",
          "imageOptions",
        ])
          if (result[field]) row[field] = result[field];
        if (result.productUrl) row.productUrl = result.productUrl;
        if (!row.classificationEdited) Object.assign(row, suggest(row));
        row.detailFetched = true;
        row.error = null;
        row.status = "pending";
        refresh(row);
      }
      row.updatedAt = now();
      batch.status = "reviewing";
      return save(batch);
    },
    batchUpdate: ({ id, candidateIds, patch }) => {
      const batch = get(id);
      if (
        !Array.isArray(candidateIds) ||
        candidateIds.some((id) => typeof id !== "string") ||
        !patch ||
        typeof patch !== "object" ||
        Array.isArray(patch)
      )
        throw new Error("候选更新参数无效。");
      validateFields(patch);
      const allowed = [
        "name",
        "model",
        "equipmentType",
        "freeWeightType",
        "parts",
        "tags",
        "loading",
        "imageSource",
        "thumbnail",
        "sourceUrl",
        "productUrl",
        "sourceDate",
        "notes",
        "description",
        "series",
        "status",
        "decision",
      ];
      if (
        patch.status &&
        (!STATES.includes(patch.status) || patch.status === "imported")
      )
        throw new Error("无效候选状态。");
      if (
        patch.decision &&
        !["new", "supplement", "ignore"].includes(patch.decision)
      )
        throw new Error("无效重复处理方式。");
      for (let i = 0; i < batch.candidates.length; i++) {
        let row = batch.candidates[i];
        if (!candidateIds.includes(row.id)) continue;
        if (row.status === "imported") throw new Error("已导入项目不可修改。");
        for (const key of allowed)
          if (Object.hasOwn(patch, key)) row[key] = structuredClone(patch[key]);
        if (
          patch.status === "pending" &&
          !Object.hasOwn(patch, "decision") &&
          row.decision === "ignore"
        )
          row.decision = "";
        if (
          ["equipmentType", "freeWeightType", "parts", "tags"].some((k) =>
            Object.hasOwn(patch, k),
          )
        ) {
          row = normalizeClassification(row);
          row.classificationEdited = true;
        }
        if (patch.decision === "ignore") row.status = "ignored";
        if (
          ["pending", "incomplete", "possible_duplicate"].includes(row.status)
        )
          refresh(row);
        row.updatedAt = now();
        batch.candidates[i] = row;
      }
      batch.status = "reviewing";
      return save(batch);
    },
    batchPreview: ({ id }) => {
      let batch = get(id);
      // Show collisions within this batch before confirmation, using stable candidate IDs.
      const comparison = structuredClone(store.db.equipment);
      for (const row of batch.candidates) {
        if (
          ["imported", "ignored", "deferred", "fetch_failed"].includes(
            row.status,
          )
        )
          continue;
        row.duplicate = duplicate(row, comparison);
        if (row.duplicate.kind !== "new" && !row.decision)
          row.status = "possible_duplicate";
        if (row.duplicate.kind === "new" || row.decision === "new")
          comparison.push({ ...row, id: row.id });
      }
      batch = save(batch);
      const prepared = prepare(batch),
        token = crypto.randomUUID();
      tokens.set(id, {
        token,
        fingerprint: JSON.stringify(store.db),
        prepared,
      });
      return {
        token,
        summary: prepared.summary,
        issues: prepared.issues,
        batch,
      };
    },
    batchCommit: async ({ id, token }) => {
      checkSession();
      const entry = tokens.get(id);
      if (
        committing.has(id) ||
        !entry ||
        entry.token !== token ||
        entry.fingerprint !== JSON.stringify(store.db)
      )
        throw new Error("预览已过期，请重新确认导入摘要。");
      if (entry.prepared.issues.length)
        throw new Error("请先解决候选分类或重复处理问题。");
      committing.add(id);
      const imageRoot = store.root, createdImages = new Set();
      let saved = false;
      try {
      const batch = get(id),
        { operations, summary } = structuredClone(entry.prepared);
      const imageResults = new Map();
      summary.imageFailures = 0;
      for (const operation of operations) {
        if (!operation.record.image && operation.record.imageSource) {
          const imageKey = operation.record.id;
          if (imageResults.has(imageKey)) {
            Object.assign(operation.record, imageResults.get(imageKey));
            continue;
          }
          try {
            const result = await web.productImage(operation.record);
            operation.record.image = result.image || "";
            if (result.image) createdImages.add(result.image);
            operation.record.imageStatus = result.image ? "ready" : "failed";
            if (result.warning) operation.record.imageWarning = result.warning;
          } catch (error) {
            operation.record.imageStatus = "failed";
            operation.record.imageWarning = error.message;
          }
          if (operation.record.imageStatus === "failed")
            summary.imageFailures++;
          imageResults.set(imageKey, {
            image: operation.record.image || "",
            imageStatus: operation.record.imageStatus,
            imageWarning: operation.record.imageWarning || "",
          });
        }
      }
      checkSession();
      if (tokens.get(id) !== entry || entry.fingerprint !== JSON.stringify(store.db))
        throw new Error("数据已变化，请重新预览，尚未导入器械。");
      const next = structuredClone(store.db);
      const committed = new Map();
      for (const operation of operations) {
        // Later supplements use the accumulated earlier fields and image outcome.
        const prior = operation.targetId && committed.get(operation.targetId);
        if (prior)
          for (const [key, value] of Object.entries(prior))
            if (
              operation.record[key] == null ||
              operation.record[key] === "" ||
              (Array.isArray(operation.record[key]) &&
                !operation.record[key].length)
            )
              operation.record[key] = value;
        if (operation.targetId)
          next.equipment[
            next.equipment.findIndex((e) => e.id === operation.targetId)
          ] = operation.record;
        else next.equipment.push(operation.record);
        committed.set(operation.record.id, operation.record);
        const row = batch.candidates.find(
          (r) => r.id === operation.candidateId,
        );
        row.status = "imported";
        row.importedEquipmentId = operation.record.id;
        row.updatedAt = now();
        row.imageStatus = operation.record.imageStatus;
      }
      for (const row of batch.candidates)
        if (row.decision === "ignore") row.status = "ignored";
      batch.status = batch.candidates.every((r) =>
        ["imported", "ignored"].includes(r.status),
      )
        ? "completed"
        : "partial";
      batch.updatedAt = now();
      batch.counts = counts(batch);
      batch.lastSummary = summary;
      delete batch.temporary;
      // Preview thumbnails are temporary; history retains source URLs only.
      for (const row of batch.candidates) {
        delete row.thumbnail;
        delete row.imageOptions;
      }
      next.importBatches ||= [];
      const index = next.importBatches.findIndex((b) => b.id === id);
      if (index < 0) next.importBatches.push(batch); else next.importBatches[index] = batch;
      store.save(next);
      saved = true;
      drafts.delete(id); tokens.delete(id); cancelFetches(id);
      return { batch: { ...batch, temporary: false }, summary };
      } finally {
        if (!saved) for (const image of createdImages)
          fs.rmSync(path.join(imageRoot, image), {force: true});
        committing.delete(id);
      }
    },
  };
}
module.exports = { createBatchImporter, suggest, duplicate, canonical };
