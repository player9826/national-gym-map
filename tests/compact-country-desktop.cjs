const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { Store } = require("../electron/storage.cjs");
const { createCanvas } = require("@napi-rs/canvas");
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-compact-country-")),
    profile = path.join(temp, "profile"),
    out = path.resolve("test-results/compact-country");
  fs.mkdirSync(out, { recursive: true });
  const store = new Store(path.join(profile, "location.json"));
  store.configure(path.join(temp, "data"));
  const longName = "超长器械名称 Long equipment name ".repeat(10),
    series = "Monolith 特别加长系列名称";
  store.save({
    ...store.db,
    brands: [
      { id: "brand-a", name: "HOIST", bannerImage: "brands/banner.png", publicDescription: "公开品牌介绍" },
      { id: "brand-b", name: "无展示图品牌" },
    ],
    equipment: Array.from({ length: 16 }, (_, i) => ({
      id: `eq-${i}`,
      name: `${String(i).padStart(2, "0")} ${i === 0 ? longName : "推胸训练器 Chest Press"}`,
      brandId: "brand-a",
      equipmentType: "fixed",
      part: "CHEST",
      parts: ["CHEST"],
      tags: ["推胸"],
      loading: "挂片",
      model: i === 1 ? "" : "MODEL-123",
      series: i === 1 ? "" : series,
    })),
    gyms: [
      {
        id: "sg",
        name: "Iron House Singapore",
        province: "",
        city: "Singapore",
        district: "",
        address: "17 Example Road",
        lat: null,
        lng: null,
        visited: false,
      },
      {
        id: "cn",
        name: "中国旧场馆",
        province: "四川",
        city: "成都",
        district: "武侯区",
        address: "原地址",
        visited: false,
      },
    ],
    links: [],
  });
  fs.mkdirSync(path.join(store.root, "brands"), { recursive: true });
  const bannerCanvas = createCanvas(560, 160),
    bannerContext = bannerCanvas.getContext("2d");
  bannerContext.fillStyle = "#24483c";
  bannerContext.fillRect(0, 0, 560, 160);
  bannerContext.fillStyle = "#acd5b4";
  bannerContext.fillRect(35, 30, 190, 100);
  fs.writeFileSync(path.join(store.root, "brands/banner.png"), bannerCanvas.toBuffer("image/png"));
  let app;
  try {
    app = await electron.launch({
      args: ["."],
      env: { ...process.env, GYM_TEST_PROFILE: profile, GYM_TEST_CONFIRM: "1" },
    });
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/^https?:/, (r) => r.abort());
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    await page.locator(".equipment-sidebar .group-item").nth(1).click();
    const cards = page.locator(".equipment-card");
    await expect(cards).toHaveCount(16);
    const metrics = await cards.evaluateAll((es) => {
      const r = (e) => e.getBoundingClientRect(),
        first = r(es[0]),
        name = es[0].querySelector("h3"),
        brand = es[0].querySelector(".brand-logo"),
        series = es[0].querySelector(".equipment-card-series"),
        shortName = es[2].querySelector("h3"),
        shortSeries = es[2].querySelector(".equipment-card-series"),
        banner = document.querySelector(".equipment-brand-banner");
      return {
        columns: es.filter((e) => Math.abs(r(e).top - first.top) < 1).length,
        firstTop: first.top,
        cardWidth: first.width,
        cardHeight: first.height,
        imageHeight: r(es[0].querySelector(".picture, .image-placeholder")).height,
        bannerWidth: r(banner).width,
        gridWidth: r(es[0].parentElement).width,
        nameHeight: r(name).height,
        lineHeight: parseFloat(getComputedStyle(name).lineHeight),
        lineClamp: getComputedStyle(name).webkitLineClamp,
        shortNameHeight: r(shortName).height,
        shortSeriesGap: r(shortSeries).top - r(shortName).bottom,
        seriesBelowName: r(series).top >= r(name).bottom - 1,
        brandAboveName: r(brand).bottom <= r(name).top + 1,
        bannerHeight: r(banner).height,
        cardOverflow: es.some(
          (e) =>
            r(e.querySelector(".equipment-card-foot")).bottom > r(e).bottom,
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    await page.screenshot({ path: path.join(out, "equipment-1366.png") });
    console.log(metrics);
    assert.equal(metrics.columns, 4);
    assert.ok(metrics.cardHeight >= 330 && metrics.imageHeight >= 175, JSON.stringify(metrics));
    assert.ok(Math.abs(metrics.bannerWidth - metrics.gridWidth) <= 1, JSON.stringify(metrics));
    assert.ok(Math.abs(metrics.bannerHeight - metrics.cardWidth) <= 2, JSON.stringify(metrics));
    assert.equal(metrics.lineClamp, "2");
    assert.ok(metrics.nameHeight <= metrics.lineHeight * 2 + 1);
    assert.ok(metrics.shortNameHeight <= metrics.lineHeight + 1, JSON.stringify(metrics));
    assert.ok(metrics.shortSeriesGap >= 0 && metrics.shortSeriesGap <= 6, JSON.stringify(metrics));
    assert.ok(metrics.seriesBelowName && metrics.brandAboveName);
    assert.equal(metrics.cardOverflow, false);
    assert.equal(metrics.overflow, false);
    for (const [width, expectedColumns] of [[1024, 3], [720, 2]]) {
      await page.setViewportSize({ width, height: 768 });
      const responsive = await cards.evaluateAll((elements) => ({
        columns: elements.filter((element) => Math.abs(element.getBoundingClientRect().top - elements[0].getBoundingClientRect().top) < 1).length,
        bannerWidth: document.querySelector(".equipment-brand-banner").getBoundingClientRect().width,
        bannerHeight: document.querySelector(".equipment-brand-banner").getBoundingClientRect().height,
        gridWidth: elements[0].parentElement.getBoundingClientRect().width,
        cardWidth: elements[0].getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(responsive.columns, expectedColumns);
      assert.ok(Math.abs(responsive.bannerWidth - responsive.gridWidth) <= 1, JSON.stringify(responsive));
      assert.ok(Math.abs(responsive.bannerHeight - responsive.cardWidth) <= 2, JSON.stringify(responsive));
      assert.equal(responsive.overflow, false);
      await expect(page.locator(".equipment-brand-banner")).toBeVisible();
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator(".equipment-sidebar .group-item").nth(2).click();
    await expect(page.locator(".equipment-brand-banner")).toHaveCount(0);
    await page.locator(".equipment-sidebar .group-item").nth(1).click();
    await expect(cards.nth(1).locator(".equipment-card-series")).toHaveCount(0);
    await page.getByRole("button", { name: "了解品牌 HOIST" }).click();
    await expect(page.getByRole("dialog", { name: "HOIST" })).toContainText("公开品牌介绍");
    await page.keyboard.press("Escape");
    await page.locator(".equipment-actions-menu > summary").click();
    await page.getByRole("button", { name: "品牌管理" }).click();
    const manager = page.getByRole("dialog", { name: "品牌管理" });
    await manager.locator(".brand-row .brand-select").first().click();
    await manager.getByLabel("公开品牌介绍").fill("更新后的公开品牌介绍");
    await manager.getByRole("button", { name: "保存品牌" }).click();
    await expect(manager.getByLabel("公开品牌介绍")).toHaveValue("");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "了解品牌 HOIST" }).click();
    await expect(page.getByRole("dialog", { name: "HOIST" })).toContainText("更新后的公开品牌介绍");
    await page.keyboard.press("Escape");
    await expect(page.locator(".equipment-type-tabs")).not.toContainText("固定器械");
    await expect(cards.nth(1)).not.toContainText("暂无照片");
    await expect(cards.nth(1)).not.toContainText("型号未填写");
    await cards.nth(1).click();
    const detail = page.getByRole("dialog", { name: "器械详情" });
    await expect(detail).not.toContainText("型号未填写");
    await expect(detail).not.toContainText("暂无备注");
    await expect(detail).not.toContainText("固定器械");
    await page.keyboard.press("Escape");
    await cards.first().click();
    await expect(
      page.getByRole("dialog").getByText(`00 ${longName}`, { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "健身房地图", exact: true }).click();
    const sg = page.locator('[data-gym-id="sg"]');
    await expect(sg).toContainText("新加坡");
    await sg.locator(".gym-open").click();
    await page.getByRole("button", { name: "编辑健身房", exact: true }).click();
    let form = page.getByRole("dialog", { name: "编辑健身房", exact: true });
    await expect(form.getByLabel("国家/地区")).toHaveValue("SG");
    await expect(form.getByLabel("省份", { exact: true })).toHaveCount(0);
    await expect(form.getByLabel("详细地址", { exact: true })).toHaveValue(
      "17 Example Road",
    );
    await form.getByLabel("国家/地区").selectOption("CN");
    await expect(form.getByLabel("城市", { exact: true })).toHaveValue(
      "Singapore",
    );
    await form.getByLabel("国家/地区").selectOption("SG");
    await page.screenshot({ path: path.join(out, "singapore-form.png") });
    await form.getByRole("button", { name: "保存健身房", exact: true }).click();
    await expect(form).toHaveCount(0);
    let db = await page.evaluate(() => window.desktop.call("state"));
    assert.equal(db.gyms.find((g) => g.id === "sg").country, "SG");
    assert.equal(db.gyms.find((g) => g.id === "sg").city, "Singapore");
    assert.equal(db.gyms.find((g) => g.id === "sg").address, "17 Example Road");
    await page.keyboard.press("Escape");
    await page.locator('[data-gym-id="cn"] .gym-open').click();
    await page.getByRole("button", { name: "编辑健身房", exact: true }).click();
    form = page.getByRole("dialog", { name: "编辑健身房", exact: true });
    await expect(form.getByLabel("国家/地区")).toHaveValue("CN");
    await expect(form.getByLabel("区县", { exact: true })).toHaveValue(
      "武侯区",
    );
    await form.getByLabel("国家/地区").selectOption("JP");
    await expect(form.getByLabel("区县", { exact: true })).toHaveCount(0);
    await form.getByRole("button", { name: "保存健身房", exact: true }).click();
    await expect(form).toHaveCount(0);
    db = await page.evaluate(() => window.desktop.call("state"));
    const jp = db.gyms.find((g) => g.id === "cn");
    assert.equal(jp.country, "JP");
    assert.equal(jp.province, "四川");
    assert.equal(jp.address, "原地址");
    assert.equal(jp.lat, null);
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      metrics,
      checks: [
        "four tall columns, full-row brand image with short side matching card width, long names clamped, series below name, blank fields omitted",
        "brand description edits persist and fixed category remains available only in advanced filters",
        "brand image fills the row at 1366, 1024 and 720 pixels; brands without an image show no banner",
        "full name available in detail",
        "legacy Singapore and China edit/save, country switch preserves address, overseas no coordinates allowed",
      ],
      temp,
    };
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
