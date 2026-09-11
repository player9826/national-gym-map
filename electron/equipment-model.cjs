const EQUIPMENT_TYPES = ["fixed", "cardio", "free_weight", "cable_station"];
const FREE_WEIGHT_TYPES = ["dumbbell", "barbell", "smith", "rack"];
const PART_TAGS = {
  CHEST: ["推胸", "夹胸"],
  SHOULDER: ["肩推", "中后束"],
  BACK: ["背下拉", "背后拉"],
  LEG: ["近固蹬", "远固蹬", "髋伸", "髋旋", "腿屈伸", "腿弯举"],
  ABDOMINAL: ["脊柱屈", "脊柱伸"],
  ARM: ["二头", "三头"],
};
const PART_ALIASES = {
  胸: "CHEST",
  肩: "SHOULDER",
  背: "BACK",
  腿: "LEG",
  核心: "ABDOMINAL",
  手臂: "ARM",
};
function normalizeClassification(input, { legacy = false } = {}) {
  const row = { ...input };
  row.parts = [
    ...new Set(
      Array.isArray(input.parts)
        ? input.parts
        : [input.part || input.body].filter(Boolean),
    ),
  ];
  if (legacy)
    row.parts = [
      ...new Set(row.parts.map((part) => PART_ALIASES[part] || part)),
    ];
  row.tags = [
    ...new Set(
      Array.isArray(input.tags)
        ? input.tags
        : [input.applicationTag].filter(Boolean),
    ),
  ];
  row.equipmentType = input.equipmentType || "";
  if (legacy && !row.equipmentType) {
    if (
      row.parts.some((part) => PART_TAGS[part]) ||
      row.tags.some((tag) => Object.values(PART_TAGS).flat().includes(tag))
    )
      row.equipmentType = "fixed";
    row.verificationStatus = "needs_review";
  }
  row.freeWeightType = input.freeWeightType || "";
  if (row.equipmentType && row.equipmentType !== "fixed") {
    row.parts = [];
    row.tags = [];
    row.loading = "";
    row.part = "";
    delete row.body;
    delete row.applicationTag;
  } else {
    row.part = row.parts[0] || "";
    row.loading = input.loading || "";
  }
  if (row.equipmentType !== "free_weight") row.freeWeightType = "";
  return row;
}
function validateClassification(row, { allowIncomplete = false } = {}) {
  if (!EQUIPMENT_TYPES.includes(row.equipmentType)) {
    if (allowIncomplete && !row.equipmentType) return;
    throw new Error("请选择有效的器械顶级分类。");
  }
  if (row.equipmentType === "fixed") {
    if (
      !Array.isArray(row.parts) ||
      row.parts.some((p) => !PART_TAGS[p]) ||
      !Array.isArray(row.tags) ||
      row.tags.some((t) => !Object.values(PART_TAGS).flat().includes(t)) ||
      !["", "插片", "挂片"].includes(row.loading || "")
    )
      throw new Error("器械部位或应用标签无效。");
    if (!allowIncomplete && (!row.parts.length || !row.tags.length))
      throw new Error("固定器械必须选择部位和应用标签。");
    if (
      !allowIncomplete &&
      row.tags.some(
        (tag) => !row.parts.some((part) => PART_TAGS[part].includes(tag)),
      )
    )
      throw new Error("应用标签必须属于已选择的部位。");
  } else if (
    row.equipmentType === "free_weight" &&
    !FREE_WEIGHT_TYPES.includes(row.freeWeightType)
  ) {
    if (!(allowIncomplete && !row.freeWeightType))
      throw new Error("请选择自由力量子分类。");
  }
}
function migrateEquipmentDatabase(db) {
  if (!db || db.schemaVersion !== 1 || db.metadata?.equipmentModelVersion === 1)
    return { db, changed: false };
  const next = structuredClone(db);
  if (!Array.isArray(next.equipment)) return { db, changed: false };
  next.equipment = next.equipment.map((row) =>
    normalizeClassification(row, { legacy: true }),
  );
  next.metadata = {
    ...next.metadata,
    equipmentModelVersion: 1,
    equipmentMigratedAt: new Date().toISOString(),
  };
  return { db: next, changed: true };
}
module.exports = {
  EQUIPMENT_TYPES,
  FREE_WEIGHT_TYPES,
  PART_TAGS,
  PART_ALIASES,
  normalizeClassification,
  validateClassification,
  migrateEquipmentDatabase,
};
