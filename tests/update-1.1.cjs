const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Store } = require("../electron/storage.cjs");
const c = require("../electron/catalog.cjs");
async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-v11-"));
  const profile = path.join(temp, "profile");
  const store = new Store(path.join(profile, "location.json"));
  store.configure(path.join(temp, "data"));
  const gym = c.upsert(store, "gyms", {
    name: "多选验证场馆",
    brandIds: ["brand-1"],
    tags: ["力量训练"],
    lat: 30.5,
    lng: 104,
  });
  c.upsert(store, "equipment", {
    name: "多部位插片器械",
    equipmentType: "fixed",
    brandId: "brand-1",
    parts: ["CHEST", "ARM"],
    loading: "插片",
    tags: ["推胸"],
  });
  c.upsert(store, "equipment", {
    name: "挂片器械",
    equipmentType: "fixed",
    brandId: "brand-1",
    parts: ["BACK"],
    loading: "挂片",
    tags: ["背下拉"],
  });
  // Write an actual pre-migration record, rather than passing old data through new-record validation.
  store.db.equipment.push({ id: "legacy-part", name: "旧部位器械", brandId: "brand-2", part: "LEG", tags: [], loading: "" });
  delete store.db.metadata.equipmentModelVersion;
  fs.writeFileSync(path.join(temp, "data", "database", "data.json"), JSON.stringify(store.db));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, GYM_TEST_PROFILE: profile },
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.locator(".gym-item .brand-tags button").click();
    await expect(page.locator(".equipment-card")).toHaveCount(2);
    await page.getByLabel("器械部位筛选", { exact: true }).selectOption("ARM");
    await expect(page.locator(".equipment-card")).toHaveCount(1);
    await page
      .getByLabel("器械负重类型筛选", { exact: true })
      .selectOption("挂片");
    await expect(page.locator(".equipment-card")).toHaveCount(0);
    await page
      .getByLabel("器械负重类型筛选", { exact: true })
      .selectOption("插片");
    await page.locator(".equipment-card").click();
    await page.getByRole("button", { name: "编辑器械", exact: true }).click();
    await expect(page.getByLabel("胸", { exact: true })).toBeChecked();
    await expect(page.getByLabel("手臂", { exact: true })).toBeChecked();
    await page.getByLabel("肩", { exact: true }).check();
    await page.getByRole("button", { name: "保存器械", exact: true }).click();
    await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await page.getByRole("button", { name: "健身房地图", exact: true }).click();
    await page.locator(".gym-open").click();
    await page.getByRole("button", { name: "编辑健身房", exact: true }).click();
    await page.getByLabel("LIFE FITNESS", { exact: true }).check();
    await page.getByRole("button", { name: "保存健身房", exact: true }).click();
    await expect(page.locator(".gym-item .brand-tags button")).toHaveCount(2);
    await page.getByRole("button", { name: "关联器械", exact: true }).click();
    await page
      .locator(".picker-card")
      .filter({ hasText: "多部位插片器械" })
      .click();
    await page.getByLabel("选择负重类型", { exact: true }).selectOption("挂片");
    await page.locator(".picker-card").click();
    await expect(page.locator(".modal-foot")).toContainText("已选 2 款");
    await page.locator("#batch-links input[type=number]").first().fill("3");
    fs.mkdirSync("test-results/update-1.1", { recursive: true });
    await page.screenshot({ path: "test-results/update-1.1/picker.png" });
    await page.getByRole("button", { name: "保存关联", exact: true }).click();
    await expect(page.locator(".linked-item")).toHaveCount(2);
    await page.getByRole("button", { name: "关联器械", exact: true }).click();
    await page
      .locator(".picker-card")
      .filter({ hasText: "多部位插片器械" })
      .click();
    await page.locator("#batch-links input[type=number]").fill("4");
    await page.getByRole("button", { name: "保存关联", exact: true }).click();
    const state = await page.evaluate(() => window.desktop.call("state"));
    const migrated = state.equipment.find((e) => e.id === "legacy-part");
    assert.equal(migrated.equipmentType, "fixed");
    assert.deepEqual(migrated.parts, ["LEG"]);
    assert.deepEqual(migrated.tags, []);
    assert.equal(migrated.verificationStatus, "needs_review");
    assert.equal(migrated.brandId, "brand-2");
    assert.equal(state.links.length, 2);
    assert.ok(state.links.some((l) => l.quantity === 4));
    assert.equal(
      state.equipment.find((e) => e.name === "多部位插片器械").parts.length,
      3,
    );
    await assert.rejects(() =>
      page.evaluate(
        (gymId) =>
          window.desktop.call("linkBatch", {
            gymId,
            rows: [{ equipmentId: "invalid", quantity: 1 }],
          }),
        gym.id,
      ),
    );
    assert.equal(
      (await page.evaluate(() => window.desktop.call("state"))).links.length,
      2,
    );
    await page
      .getByRole("button", { name: "关闭健身房详情", exact: true })
      .click();
    await page.screenshot({ path: "test-results/update-1.1/brands.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".gym-open").click();
    await page.getByRole("button", { name: "关联器械", exact: true }).click();
    await page.screenshot({ path: "test-results/update-1.1/mobile.png" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: multi-part, loading filters, brand navigation, batch association, atomic rejection, legacy data, mobile",
    );
  } finally {
    await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
