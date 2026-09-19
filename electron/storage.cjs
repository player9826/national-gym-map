const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const archive = require("./archive.cjs");
const {
  normalizeClassification,
  validateClassification,
  migrateEquipmentDatabase,
} = require("./equipment-model.cjs");

const BRAND_NAMES = [
  "PANATTA",
  "LIFE FITNESS",
  "FREE MOTION",
  "HOIST",
  "NAUTILUS",
  "PRECOR",
  "PRIME",
  "HAMMER STRENGTH",
  "ATLANTIS",
  "GYM LECO",
  "GYM80",
  "ROSEN",
  "炁研力量",
  "DIVINE POWER",
  "FORWARD",
  "MATRIX",
  "CYBEX",
  "FLEX",
  "ARSENAL",
];
const PARTS = ["CHEST", "SHOULDER", "BACK", "LEG", "ABDOMINAL", "ARM"];
const TAGS = [
  "推胸",
  "肩推",
  "近固蹬",
  "髋伸",
  "夹胸",
  "中后束",
  "远固蹬",
  "髋旋",
  "背下拉",
  "二头",
  "腿屈伸",
  "脊柱屈",
  "背后拉",
  "三头",
  "腿弯举",
  "脊柱伸",
];
const blank = () => ({
  schemaVersion: 1,
  appVersion: require("../package.json").version,
  gyms: [],
  equipment: [],
  brands: BRAND_NAMES.map((name, i) => ({
    id: `brand-${i + 1}`,
    name,
    website: "",
    notes: "",
  })),
  links: [],
  settings: {},
  metadata: { createdAt: new Date().toISOString(), equipmentModelVersion: 1 },
});
const hash = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  const fd = fs.openSync(temp, "wx");
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temp, file);
  } catch (e) {
    fs.rmSync(temp, { force: true });
    throw e;
  }
}
function inside(root, target) {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
function validate(db) {
  if (!db || db.schemaVersion !== 1)
    throw new Error("数据格式或版本不受支持。");
  require("./batch-model.cjs").validateImportBatches(db.importBatches);
  for (const key of ["gyms", "equipment", "brands", "links"]) {
    if (!Array.isArray(db[key]) || db[key].length > 100000)
      throw new Error(`数据集合无效：${key}`);
    const ids = new Set();
    for (const row of db[key]) {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id))
        throw new Error(`记录标识无效或重复：${key}`);
      ids.add(row.id);
    }
  }
  const gyms = new Set(db.gyms.map((r) => r.id)),
    eq = new Set(db.equipment.map((r) => r.id)),
    brands = new Set(db.brands.map((r) => r.id));
  for (const key of ["gyms", "equipment", "brands"])
    for (const row of db[key]) {
      if (typeof row.name !== "string" || !row.name.trim())
        throw new Error("名称不能为空。");
      for (const field of [
        "website",
        "productUrl",
        "imageSource",
        "reviewUrl",
        "sourceUrl",
      ])
        if (row[field]) {
          const u = new URL(row[field]);
          if (!["https:", "http:"].includes(u.protocol))
            throw new Error("网址必须以 https:// 或 http:// 开头。");
        }
      for (const value of [row.image, row.cover, row.logo, ...(row.photos || [])].filter(
        Boolean,
      ))
        if (
          typeof value !== "string" ||
          !/^(equipment|gyms|brands)\/[a-zA-Z0-9_.-]+$/.test(value)
        )
          throw new Error("本地图片路径无效。");
    }
  for (const r of db.gyms) {
    if (
      r.brandIds &&
      (!Array.isArray(r.brandIds) || r.brandIds.some((id) => !brands.has(id)))
    )
      throw new Error("场馆品牌标签无效。");
    if (typeof r.visited !== "boolean")
      throw new Error("打卡状态必须是已去过或未去过。");
    if (
      (r.lat == null) !== (r.lng == null) ||
      (r.lat != null &&
        (!Number.isFinite(r.lat) ||
          !Number.isFinite(r.lng) ||
          Math.abs(r.lat) > 90 ||
          Math.abs(r.lng) > 180))
    )
      throw new Error("经纬度无效。");
    if (r.score != null && (!Number.isFinite(r.score) || r.score < 0))
      throw new Error("测评评分必须是非负数。");
  }
  for (const r of db.equipment) {
    if (!brands.has(r.brandId)) throw new Error("器械品牌无效。");
    const legacy = !r.equipmentType && db.metadata?.equipmentModelVersion !== 1;
    validateClassification(
      legacy ? normalizeClassification(r, { legacy: true }) : r,
      { allowIncomplete: legacy || r.verificationStatus === "needs_review" },
    );
  }
  const pairs = new Set();
  for (const r of db.links) {
    const pair = `${r.gymId}:${r.equipmentId}`;
    if (
      !gyms.has(r.gymId) ||
      !eq.has(r.equipmentId) ||
      pairs.has(pair) ||
      !Number.isInteger(r.quantity) ||
      r.quantity < 1
    )
      throw new Error("器械关联无效、重复或数量小于 1。");
    pairs.add(pair);
  }
  return db;
}
class Store {
  constructor(configFile) {
    this.configFile = configFile;
    this.root = null;
    this.error = null;
    this.db = null;
    try {
      if (fs.existsSync(configFile)) {
        this.root = JSON.parse(fs.readFileSync(configFile, "utf8")).dataRoot;
        this.load();
      }
    } catch (e) {
      this.error = e.message;
    }
  }
  status() {
    return { dataRoot: this.root, error: this.error, ready: !!this.db };
  }
  require() {
    if (!this.root || !this.db)
      throw new Error(
        `数据目录尚未就绪${this.root ? `：${this.root}` : ""}。${this.error || "请先设置数据目录。"}`,
      );
  }
  probe(root) {
    if (!path.isAbsolute(root)) throw new Error("请选择绝对路径。");
    fs.mkdirSync(root, { recursive: true });
    if (fs.lstatSync(root).isSymbolicLink())
      throw new Error("根目录不能是符号链接。");
    const probe = path.join(root, `.write-test-${crypto.randomUUID()}`);
    try {
      fs.writeFileSync(probe, "test", { flag: "wx" });
      if (fs.readFileSync(probe, "utf8") !== "test")
        throw new Error("读写校验失败");
    } finally {
      fs.rmSync(probe, { force: true });
    }
  }
  load() {
    if (!this.root) return;
    this.db = readDatabase(this.root);
    this.error = null;
  }
  configure(root) {
    if (this.root)
      throw new Error("已经设置数据目录，请使用更换数据目录或重新连接。");
    root = path.resolve(root);
    this.probe(root);
    const file = path.join(root, "database", "data.json");
    const db = fs.existsSync(file) ? readDatabase(root) : blank();
    if (!fs.existsSync(file)) atomic(file, JSON.stringify(db, null, 2));
    atomic(this.configFile, JSON.stringify({ dataRoot: root }));
    this.root = root;
    this.db = db;
    this.error = null;
    return this.status();
  }
  reconnect(root) {
    if (this.db) throw new Error("当前数据可用，请通过迁移更换目录。");
    root = path.resolve(root);
    this.probe(root);
    const db = readDatabase(root);
    atomic(this.configFile, JSON.stringify({ dataRoot: root }));
    this.root = root;
    this.db = db;
    this.error = null;
    return this.status();
  }
  save(next) {
    this.require();
    validate(next);
    atomic(
      path.join(this.root, "database", "data.json"),
      JSON.stringify(next, null, 2),
    );
    this.db = next;
    return next;
  }
  migrate(dest) {
    this.require();
    dest = path.resolve(dest);
    if (inside(this.root, dest) || inside(dest, this.root))
      throw new Error("新旧数据目录不能相同，也不能相互嵌套。");
    this.probe(dest);
    if (fs.readdirSync(dest).length)
      throw new Error("目标目录必须为空，以免覆盖其他文件。");
    const files = archive.filesUnder(this.root);
    for (const rel of files) {
      fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
      fs.copyFileSync(
        path.join(this.root, rel),
        path.join(dest, rel),
        fs.constants.COPYFILE_EXCL,
      );
      if (
        archive.hashFileSync(path.join(dest, rel)) !==
        archive.hashFileSync(path.join(this.root, rel))
      )
        throw new Error(`迁移校验失败：${rel}`);
    }
    validate(
      JSON.parse(
        fs.readFileSync(path.join(dest, "database/data.json"), "utf8"),
      ),
    );
    atomic(this.configFile, JSON.stringify({ dataRoot: dest }));
    this.root = dest;
    this.error = null;
    return this.status();
  }
  backup() {
    return archive.backup(this);
  }
  restore(file) {
    return archive.restore(this, file);
  }
}
// This complete directory snapshot can be selected with reconnect/configure. Its
// original data.json is never rewritten; a later reconnect creates a new snapshot.
function readDatabase(root) {
  const file = path.join(root, "database", "data.json");
  const original = JSON.parse(fs.readFileSync(file, "utf8"));
  validate(original);
  const migration = migrateEquipmentDatabase(original);
  if (!migration.changed) return original;
  validate(migration.db);
  const snapshot = path.join(
    root,
    "backups",
    `equipment-model-${Date.now()}-${crypto.randomUUID()}`,
  );
  const files = archive.filesUnder(root, "", true);
  for (const rel of files) {
    const dest = path.join(snapshot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, rel), dest, fs.constants.COPYFILE_EXCL);
    if (
      archive.hashFileSync(dest) !== archive.hashFileSync(path.join(root, rel))
    )
      throw new Error(`分类迁移备份校验失败：${rel}`);
  }
  migration.db.metadata.equipmentMigrationBackup = snapshot;
  atomic(file, JSON.stringify(migration.db, null, 2));
  return migration.db;
}
module.exports = {
  Store,
  blank,
  validate,
  atomic,
  inside,
  PARTS,
  TAGS,
  hash,
  readDatabase,
};
