const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { zipSync, unzipSync } = require("fflate");
const { Store, blank } = require("../electron/storage.cjs");
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-store-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return {
    temp,
    store: new Store(path.join(temp, "profile/location.json")),
    root: path.join(temp, "data"),
  };
}
test("first setup only creates required database, restarts and persists", (t) => {
  const { store, root, temp } = fixture(t);
  assert.equal(store.status().ready, false);
  store.configure(root);
  assert.deepEqual(fs.readdirSync(root), ["database"]);
  assert.equal(new Store(path.join(temp, "profile/location.json")).root, root);
  assert.throws(() => store.configure(root), /已经设置/);
});
test("unwritable selection leaves configuration absent and process usable", (t) => {
  const { store, temp, root } = fixture(t);
  const file = path.join(temp, "file");
  fs.writeFileSync(file, "x");
  assert.throws(() => store.configure(path.join(file, "child")));
  assert.equal(store.root, null);
  store.configure(root);
  assert.equal(store.status().ready, true);
});
test("migration copies images, database and backups and retains source", async (t) => {
  const { store, root, temp } = fixture(t);
  store.configure(root);
  fs.mkdirSync(path.join(root, "gyms"));
  fs.writeFileSync(path.join(root, "gyms/test.jpg"), "photo");
  await store.backup();
  const dest = path.join(temp, "new-data");
  store.migrate(dest);
  assert.equal(store.root, dest);
  assert.equal(
    fs.readFileSync(path.join(dest, "gyms/test.jpg"), "utf8"),
    "photo",
  );
  assert.equal(fs.readdirSync(path.join(dest, "backups")).length, 1);
  assert.ok(fs.existsSync(path.join(root, "database/data.json")));
  assert.throws(() => store.migrate(path.join(dest, "nested")), /嵌套/);
  assert.throws(() => store.migrate(root), /必须为空/);
});
test("complete backup restores records, settings, images and preserves safety backup", async (t) => {
  const { store, root } = fixture(t);
  store.configure(root);
  const db = structuredClone(store.db);
  db.settings.theme = "light";
  db.gyms.push({
    id: "g1",
    name: "测试馆",
    visited: false,
    lat: 30,
    lng: 120,
    rawReview: { state: { cats: [1, 2] } },
  });
  store.save(db);
  fs.mkdirSync(path.join(root, "gyms"));
  fs.writeFileSync(path.join(root, "gyms/test.jpg"), "original-photo");
  const backup = await store.backup();
  store.save(blank());
  fs.writeFileSync(path.join(root, "gyms/test.jpg"), "changed");
  const result = await store.restore(backup.path);
  assert.equal(store.db.gyms[0].name, "测试馆");
  assert.equal(store.db.settings.theme, "light");
  assert.equal(
    fs.readFileSync(path.join(root, "gyms/test.jpg"), "utf8"),
    "original-photo",
  );
  assert.ok(fs.existsSync(result.safetyBackup));
});
test("corrupted archive is rejected without changing records", async (t) => {
  const { store, root } = fixture(t);
  store.configure(root);
  const backup = await store.backup();
  const files = unzipSync(fs.readFileSync(backup.path));
  files["database/data.json"] = Buffer.from("{}");
  const bad = path.join(root, "bad.zip");
  fs.writeFileSync(bad, zipSync(files));
  await assert.rejects(() => store.restore(bad), /校验失败/);
  assert.equal(store.db.brands.length, 19);
});
test("missing or corrupt database reports error, never silently overwrites", (t) => {
  const { store, root, temp } = fixture(t);
  store.configure(root);
  fs.writeFileSync(path.join(root, "database/data.json"), "broken");
  const retry = new Store(path.join(temp, "profile/location.json"));
  assert.equal(retry.status().ready, false);
  assert.ok(retry.status().error);
  assert.equal(
    fs.readFileSync(path.join(root, "database/data.json"), "utf8"),
    "broken",
  );
});
test("referential integrity rejects orphan equipment and relationships", (t) => {
  const { store, root } = fixture(t);
  store.configure(root);
  const db = structuredClone(store.db);
  db.equipment.push({
    id: "e",
    name: "器械",
    brandId: "missing",
    part: "CHEST",
    tags: [],
  });
  assert.throws(() => store.save(db), /品牌/);
  assert.equal(store.db.equipment.length, 0);
});
test("brand banner and public introduction validate while older brands remain valid", (t) => {
  const { store, root } = fixture(t);
  store.configure(root);
  const db = structuredClone(store.db);
  delete db.brands[0].bannerImage;
  delete db.brands[0].publicDescription;
  store.save(db);
  db.brands[0].bannerImage = "brands/banner.png";
  db.brands[0].publicDescription = "品牌简介";
  store.save(db);
  db.brands[0].bannerImage = "../private.png";
  assert.throws(() => store.save(db), /本地图片路径无效/);
  db.brands[0].bannerImage = "";
  db.brands[0].publicDescription = { private: true };
  assert.throws(() => store.save(db), /品牌公开介绍无效/);
});
