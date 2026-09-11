const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Store } = require("../electron/storage.cjs");
const c = require("../electron/catalog.cjs");
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gym-catalog-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const store = new Store(path.join(base, "config.json"));
  store.configure(path.join(base, "data"));
  return store;
}
test("multiple parts and loading types persist; legacy single part remains supported", (t) => {
  const s = fixture(t);
  const e = c.upsert(s, "equipment", {
    equipmentType: 'fixed',
    name: "多功能器械",
    brandId: "brand-1",
    parts: ["CHEST", "ARM"],
    loading: "插片",
    tags: ['推胸'],
  });
  assert.deepEqual(e.parts, ["CHEST", "ARM"]);
  assert.equal(e.loading, "插片");
  assert.throws(() => c.upsert(s, "equipment", { ...e, parts: [] }), /部位/);
  assert.throws(
    () => c.upsert(s, "equipment", { ...e, loading: "未知" }),
    /部位/,
  );
  const legacy = c.equipment({
    name: "旧器械",
    brandId: "brand-1",
    part: "LEG",
    tags: [],
  }, { legacy: true });
  assert.deepEqual(legacy.parts, ["LEG"]);
});
test("gym brand tags preserve referential integrity", (t) => {
  const s = fixture(t);
  const b = c.upsert(s, "brands", { name: "场馆品牌" });
  const g = c.upsert(s, "gyms", { name: "场馆", brandIds: [b.id] });
  assert.deepEqual(g.brandIds, [b.id]);
  assert.throws(
    () => c.remove(s, { collection: "brands", id: b.id }),
    /场馆标签/,
  );
  assert.throws(
    () => c.upsert(s, "gyms", { ...g, brandIds: ["missing"] }),
    /品牌标签/,
  );
});
test("review converts actual field structure, does not invent score and preserves every raw field", () => {
  const raw = {
    fields: { gymName: "测试馆", gymCity: "成都", gymArea: "2000" },
    state: {
      areaIsTotal: true,
      cats: { 推胸: 4 },
      muscles: { chest: 8 },
      muscleDetails: { a: 1 },
      smithCount: 2,
      sqRackCount: 3,
      dumbbellMax: 60,
      cardio: { run: 9 },
      layout: "宽敞",
      unknownFuture: { one: 1 },
    },
    lockerChecks: { shower: true },
  };
  const row = c.reviewToGym(raw);
  assert.equal(row.name, "测试馆");
  assert.equal(row.city, "成都");
  assert.equal(row.area, "2000");
  assert.equal(row.district, "");
  assert.equal(row.areaType, "总面积");
  assert.equal(row.score, null);
  assert.deepEqual(row.rawReview, raw);
  assert.equal(
    row.reviewSummary.find((s) => s.label === "史密斯机").value,
    "2",
  );
});
test("many to many links stay independent, duplicate link updates and deletions cascade", (t) => {
  const s = fixture(t);
  const g1 = c.upsert(s, "gyms", { name: "馆一" }),
    g2 = c.upsert(s, "gyms", { name: "馆二" });
  const e = c.upsert(s, "equipment", {
    name: "推胸器",
    equipmentType: 'fixed',
    brandId: s.db.brands[0].id,
    part: "CHEST",
    tags: ["推胸"],
  });
  c.link(s, { gymId: g1.id, equipmentId: e.id, quantity: 2 });
  c.link(s, { gymId: g2.id, equipmentId: e.id, quantity: 3 });
  c.link(s, { gymId: g1.id, equipmentId: e.id, quantity: 4 });
  assert.equal(s.db.links.length, 2);
  assert.equal(s.db.links.find((l) => l.gymId === g1.id).quantity, 4);
  assert.equal(s.db.equipment.length, 1);
  assert.throws(
    () => c.remove(s, { collection: "brands", id: e.brandId }),
    /仍有关联/,
  );
  c.remove(s, { collection: "gyms", id: g1.id });
  assert.equal(s.db.links.length, 1);
  c.remove(s, { collection: "equipment", id: e.id });
  assert.equal(s.db.links.length, 0);
});
test("brand without website and manual equipment work; invalid data never commits", (t) => {
  const s = fixture(t);
  const brand = c.upsert(s, "brands", { name: "自建品牌" });
  assert.equal(brand.website, "");
  assert.throws(() => c.upsert(s, "brands", { name: "自建品牌" }), /已存在/);
  assert.throws(
    () =>
      c.upsert(s, "equipment", {
        name: "器械",
        equipmentType: 'fixed',
        brandId: brand.id,
        part: "ABORMINAL",
        tags: [],
      }),
    /部位/,
  );
  c.upsert(s, "equipment", {
    name: "核心器械",
    equipmentType: 'fixed',
    brandId: brand.id,
    part: "ABDOMINAL",
    tags: ["脊柱屈"],
  });
  assert.equal(s.db.equipment.length, 1);
});
test("imports prevalidate whole batch and exported relationships can be imported in either order", (t) => {
  const s = fixture(t);
  const g = c.upsert(s, "gyms", { name: "健身房" });
  const e = c.upsert(s, "equipment", {
    name: "器械",
    equipmentType: 'fixed',
    part: "LEG",
    brandId: s.db.brands[0].id,
    tags: ["近固蹬"],
  });
  c.link(s, { gymId: g.id, equipmentId: e.id, quantity: 2 });
  const snapshot = structuredClone(s.db);
  c.remove(s, { collection: "gyms", id: g.id });
  c.remove(s, { collection: "equipment", id: e.id });
  const gymDraft = c.prepareImport(s, { kind: "gyms", raw: snapshot });
  c.commitImport(s, gymDraft);
  assert.equal(s.db.links.length, 0);
  const eqDraft = c.prepareImport(s, { kind: "equipment", raw: snapshot });
  c.commitImport(s, eqDraft);
  assert.equal(s.db.links.length, 1);
  assert.throws(
    () =>
      c.prepareImport(s, {
        kind: "gyms",
        raw: [{ name: "正常" }, { name: "" }],
      }),
    /名称/,
  );
  assert.equal(s.db.gyms.length, 1);
});
test("product parser reads structured metadata without choosing body part or tags", () => {
  const result = c.parseProduct(
    '<html><head><script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Chest Press","image":["/product.jpg"],"brand":{"name":"PANATTA"},"sku":"1HP"}]}</script></head></html>',
    "https://example.org/item",
  );
  assert.equal(result.name, "Chest Press");
  assert.equal(result.imageSource, "https://example.org/product.jpg");
  assert.equal(result.detectedBrand, "PANATTA");
  assert.equal(result.part, undefined);
  assert.equal(result.tags, undefined);
});
test("image copies are local, preserve content and reject executable payloads", (t) => {
  const s = fixture(t);
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    "base64",
  );
  const rel = c.saveImage(s, bytes, "equipment");
  assert.ok(rel.startsWith("equipment/"));
  assert.deepEqual(fs.readFileSync(path.join(s.root, rel)), bytes);
  assert.throws(
    () => c.saveImage(s, Buffer.from("<script>x</script>"), "gyms"),
    /格式/,
  );
});
