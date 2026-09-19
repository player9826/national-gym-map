const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Store } = require("../electron/storage.cjs");
const catalog = require("../electron/catalog.cjs");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-detail-refresh-"));
  const profile = path.join(temp, "profile");
  const out = path.resolve("test-results/detail-refresh");
  fs.mkdirSync(out, { recursive: true });
  const store = new Store(path.join(profile, "location.json"));
  store.configure(path.join(temp, "data"));
  fs.mkdirSync(path.join(store.root, "equipment"), { recursive: true });
  fs.writeFileSync(path.join(store.root, "equipment", "test.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64"));
  const brand = catalog.upsert(store, "brands", { name: "回归无标识品牌", website: "", logo: "brands/missing.png" });
  const equipment = catalog.upsert(store, "equipment", {
    name: "回归组合训练器", equipmentType: "fixed", brandId: brand.id,
    parts: ["CHEST", "BACK"], tags: ["推胸", "背下拉"], image: "equipment/test.png",
  });
  catalog.upsert(store, "gyms", {
    id: "detail-a", name: "回归成都场馆", city: "成都", district: "武侯区", province: "四川",
    address: "测试地址", lat: 30.57, lng: 104.06, themeColor: "#b34e77",
    description: "用于确认弹窗滚动和层级。".repeat(90),
  });
  catalog.upsert(store, "gyms", { id: "detail-b", name: "回归北京场馆", city: "北京", lat: 39.9, lng: 116.4 });
  const next = structuredClone(store.db);
  next.links.push({ id: "detail-link", gymId: "detail-a", equipmentId: equipment.id, quantity: 2 });
  store.save(next);
  const checks = [];
  const errors = [];
  let app, page;
  try {
    app = await electron.launch({ ...(process.env.GYM_INSTALLED_EXE ? { executablePath: process.env.GYM_INSTALLED_EXE, args: [] } : { args: ["."] }), env: { ...process.env, GYM_TEST_PROFILE: profile, GYM_TEST_CONFIRM: "1" } });
    page = await app.firstWindow();
    page.on("pageerror", error => errors.push(error.message));
    const list = page.locator('.gym-item[data-gym-id="detail-a"] .gym-open');
    const marker = page.locator('.gym-marker[data-gym-id="detail-a"]');
    const detail = page.getByRole("dialog", { name: "健身房详情", exact: true });
    await expect(list).toBeVisible();
    await page.getByLabel("搜索健身房").fill("回归");
    await expect(marker).toBeVisible();
    const mapPosition = () => marker.evaluate(el => ({ transform: el.style.transform, pane: el.closest(".leaflet-map-pane")?.style.transform }));
    // Wait for the initial Leaflet size/fit animation before comparing dialog behavior.
    await page.waitForTimeout(500);
    const before = await mapPosition();
    await list.click();
    await expect(detail).toBeVisible();
    await expect(page.locator("aside.detail-panel")).toHaveCount(0);
    await expect(detail).toContainText("回归成都场馆");
    assert.deepEqual(await mapPosition(), before, "list open must preserve map position");
    assert.equal(await page.getByLabel("搜索健身房").inputValue(), "回归");
    await page.screenshot({ path: path.join(out, "gym-detail.png") });
    const content = detail.locator(".modal-content");
    const imageButton = detail.getByRole("button", { name: "放大 回归组合训练器 图片", exact: true });
    await imageButton.scrollIntoViewIfNeeded();
    await expect(imageButton.locator("img")).toBeVisible();
    const scroll = await content.evaluate(el => el.scrollTop);
    await imageButton.click();
    await expect(page.getByRole("dialog", { name: "回归组合训练器", exact: true })).toBeVisible();
    await expect(page.locator(".full-photo")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(detail).toBeVisible();
    await expect(imageButton).toBeFocused();
    assert.equal(await content.evaluate(el => el.scrollTop), scroll, "photo close must restore detail scroll");
    await detail.locator(".linked-open").click();
    const eq = page.getByRole("dialog", { name: "器械详情", exact: true });
    await expect(eq).toBeVisible();
    await expect(page.locator(".equipment-page")).toHaveCount(0);
    await page.mouse.click(3, 3);
    await expect(eq).toHaveCount(0);
    await expect(detail).toBeVisible();
    await expect(detail.locator(".linked-open")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(list).toBeFocused();
    checks.push("list detail modal, preserved map/filter, linked image enlargement, nested Escape/backdrop, focus and scroll restore");

    await marker.click();
    await expect(detail).toBeVisible();
    await page.keyboard.press("Escape");
    await list.hover();
    const preview = page.locator(".gym-preview");
    await expect(preview).toBeVisible();
    const border = await preview.evaluate(el => {
      const style = getComputedStyle(el);
      return [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor];
    });
    assert.deepEqual(border, Array(4).fill("rgb(179, 78, 119)"));
    await preview.click();
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "编辑健身房", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "编辑健身房", exact: true });
    await edit.getByRole("button", { name: "主题色：湖蓝", exact: true }).click();
    await edit.getByRole("button", { name: "保存健身房", exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect(detail).toHaveCSS("border-top-color", "rgb(41, 122, 163)");
    await detail.getByRole("button", { name: "编辑健身房", exact: true }).click();
    await edit.getByLabel("自定义场馆主题色").fill("#993366");
    await edit.getByRole("button", { name: "保存健身房", exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect(detail).toHaveCSS("border-top-color", "rgb(153, 51, 102)");
    await detail.getByRole("button", { name: "编辑健身房", exact: true }).click();
    await edit.getByRole("button", { name: "恢复默认", exact: true }).click();
    await edit.getByRole("button", { name: "保存健身房", exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect(detail).toHaveCSS("border-top-color", "rgb(57, 124, 112)");
    const state = await page.evaluate(() => window.desktop.call("state"));
    assert.equal(state.gyms.find(g => g.id === "detail-a").themeColor, "");
    assert.deepEqual(await mapPosition(), before, "theme edits must preserve map position");
    await page.keyboard.press("Escape");
    checks.push("marker and hover open detail; four preview borders; preset/custom/default theme save");

    await page.getByRole("button", { name: "器械库", exact: true }).click();
    const card = page.locator(".equipment-card");
    await expect(card).toHaveCount(1);
    await expect(card.locator(".brand-logo-fallback")).toHaveText("回归无标识品牌");
    await expect(page.locator(".equipment-sidebar .brand-logo-fallback").filter({ hasText: "回归无标识品牌" })).toBeVisible();
    const chest = card.locator('.tags span[data-part="CHEST"]').filter({ hasText: "推胸" });
    const back = card.locator('.tags span[data-part="BACK"]').filter({ hasText: "背下拉" });
    await expect(chest).toBeVisible();
    await expect(back).toBeVisible();
    assert.notEqual(await chest.evaluate(el => getComputedStyle(el).backgroundColor), await back.evaluate(el => getComputedStyle(el).backgroundColor));
    const firstTab = await page.locator(".equipment-type-tabs button").first().boundingBox();
    const tabs = await page.locator(".equipment-type-tabs").boundingBox();
    assert.ok(firstTab.x - tabs.x >= 16, "classification tabs need at least 16px left inset");
    await page.waitForFunction(() => [...document.querySelectorAll(".equipment-sidebar .brand-logo img")].every(img => img.complete && img.naturalWidth > 0));
    const logoSizes = await page.locator(".equipment-sidebar .brand-logo img").evaluateAll(images => images.map(img => ({ width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height })));
    const expectedLogos = state.brands.filter(brand => require("../public/brand-logos/index.json")[brand.name.trim().toUpperCase()]).length;
    assert.ok(logoSizes.length === expectedLogos && logoSizes.every(size => size.height <= 20.1 && size.width <= 112.1), "all lettered brand marks decode and remain compact");
    checks.push("missing brand logo falls back after image error; independent multi-part tag colors; classification inset");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(out, "equipment.png") });
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ checks, errors, temp }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks, errors }));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ checks, errors, failure: error.stack, temp }, null, 2));
    throw error;
  } finally {
    await app?.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
