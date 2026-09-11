const STATES = [
  "pending",
  "imported",
  "deferred",
  "ignored",
  "fetch_failed",
  "possible_duplicate",
  "incomplete",
];
const BATCH_STATES = ["scanned", "reviewing", "partial", "completed", "failed"];
const STRING_FIELDS = [
  "name",
  "model",
  "equipmentType",
  "freeWeightType",
  "loading",
  "imageSource",
  "sourceUrl",
  "productUrl",
  "sourceDate",
  "notes",
  "description",
  "series",
  "status",
  "decision",
];
function validateFields(row) {
  for (const field of STRING_FIELDS) {
    if (row[field] === undefined) continue;
    if (typeof row[field] !== "string" || row[field].length > 20000)
      throw new Error(`候选字段无效：${field}`);
  }
  for (const field of ["parts", "tags"])
    if (
      row[field] !== undefined &&
      (!Array.isArray(row[field]) ||
        row[field].length > 100 ||
        row[field].some((v) => typeof v !== "string"))
    )
      throw new Error(`候选字段无效：${field}`);
  for (const field of ["sourceUrl", "productUrl", "imageSource"])
    if (row[field]) {
      let url;
      try {
        url = new URL(row[field]);
      } catch {
        throw new Error(`候选网址无效：${field}`);
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error(
          "候选网址必须使用公开网页协议，且不能包含用户名或密码。",
        );
    }
  if (row.status !== undefined && !STATES.includes(row.status))
    throw new Error("候选状态无效。");
  if (
    row.decision !== undefined &&
    !["", "new", "supplement", "ignore"].includes(row.decision)
  )
    throw new Error("重复处理方式无效。");
}
function validateImportBatches(batches) {
  if (batches === undefined) return;
  if (!Array.isArray(batches) || batches.length > 10000)
    throw new Error("导入批次集合无效。");
  const batchIds = new Set();
  for (const batch of batches) {
    if (
      !batch ||
      typeof batch.id !== "string" ||
      !batch.id ||
      batchIds.has(batch.id) ||
      typeof batch.brandId !== "string" ||
      !batch.brandId ||
      typeof batch.updatedAt !== "string" ||
      !BATCH_STATES.includes(batch.status) ||
      !Array.isArray(batch.candidates) ||
      batch.candidates.length > 200
    )
      throw new Error("导入批次结构无效。");
    batchIds.add(batch.id);
    validateFields({ sourceUrl: batch.sourceUrl });
    const candidateIds = new Set();
    for (const row of batch.candidates) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !row.id ||
        candidateIds.has(row.id) ||
        typeof row.name !== "string" ||
        !STATES.includes(row.status)
      )
        throw new Error("候选记录结构无效。");
      candidateIds.add(row.id);
      validateFields(row);
      if (
        row.thumbnail !== undefined &&
        (typeof row.thumbnail !== "string" ||
          row.thumbnail.length > 150000 ||
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(row.thumbnail))
      )
        throw new Error("候选缩略图无效。");
    }
  }
}
module.exports = { validateFields, validateImportBatches };
