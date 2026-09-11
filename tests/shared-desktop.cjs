const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const assert = require("node:assert/strict");
const { Store } = require("../electron/storage.cjs");
const { exportShared } = require("../electron/shared-catalog.cjs");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-shared-desktop-"));
  const out = path.resolve("test-results/shared-desktop");
  fs.mkdirSync(out, { recursive: true });
  const source = new Store(path.join(temp, "publisher.json"));
  source.configure(path.join(temp, "publisher"));
  const photo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    "base64",
  );
  for (const folder of ["gyms", "equipment"]) {
    fs.mkdirSync(path.join(source.root, folder), { recursive: true });
    fs.writeFileSync(path.join(source.root, folder, "shared.png"), photo);
  }
  const db = structuredClone(source.db);
  db.gyms.push({
    id: "public-gym",
    name: "共享测试场馆",
    city: "上海",
    district: "浦东",
    lat: 31.23,
    lng: 121.47,
    visited: true,
    visitDate: "2026-01-01",
    description: "PUBLISHER_PRIVATE",
    notes: "PUBLISHER_PRIVATE",
    reviewUrl: "https://private.example/",
    brandIds: ["brand-1"],
    cover: "gyms/shared.png",
    photos: [],
  });
  db.equipment.push({
    id: "public-equipment",
    name: "共享单车",
    brandId: "brand-1",
    equipmentType: "cardio",
    parts: [],
    tags: [],
    notes: "PUBLISHER_PRIVATE",
    image: "equipment/shared.png",
  });
  db.links.push({
    id: "public-link",
    gymId: "public-gym",
    equipmentId: "public-equipment",
    quantity: 2,
  });
  source.save(db);
  const published = path.join(temp, "published");
  const publish = () =>
    exportShared(source, { destination: published, includeImages: true });
  publish();
  const requests = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    ).replace(/^\//, "");
    requests.push(name);
    if (name === "latest.yml") {
      const digest = require("node:crypto")
        .createHash("sha512")
        .update("fixture-only")
        .digest("base64");
      res.writeHead(200, {
        "Content-Type": "text/yaml",
        "Cache-Control": "no-store",
      });
      res.end(
        `version: 99.0.0\nfiles:\n  - url: fixture-only.exe\n    sha512: ${digest}\n    size: 12\npath: fixture-only.exe\nsha512: ${digest}\nreleaseDate: '2026-09-11T00:00:00.000Z'\n`,
      );
      return;
    }
    const file = path.resolve(published, name);
    if (!file.startsWith(published + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, {
      "Content-Type": name.endsWith(".png") ? "image/png" : "application/json",
      "Cache-Control": "no-store",
    });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/manifest.json`;
  const profile = path.join(temp, "profile");
  const local = new Store(path.join(profile, "location.json"));
  local.configure(path.join(temp, "subscriber"));
  local.save({
    ...local.db,
    settings: {
      ...local.db.settings,
      updateFeed: `http://127.0.0.1:${server.address().port}/`,
    },
  });
  const errors = [],
    checks = [];
  let app, page;
  async function launch() {
    app = await electron.launch({
      ...(process.env.GYM_INSTALLED_EXE
        ? { executablePath: process.env.GYM_INSTALLED_EXE, args: [] }
        : { args: ["."] }),
      env: {
        ...process.env,
        GYM_TEST_PROFILE: profile,
        GYM_TEST_ALLOW_LOCAL: "1",
        GYM_TEST_CONFIRM: "1",
      },
    });
    page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForLoadState("domcontentloaded");
  }
  const state = () => page.evaluate(() => window.desktop.call("state"));
  const settings = () => page.getByRole("dialog", { name: "数据与设置" });
  async function openSettings() {
    await page.getByRole("button", { name: "数据与设置", exact: true }).click();
  }
  async function preview() {
    await settings()
      .getByRole("button", { name: "检查共享数据", exact: true })
      .click();
    await expect(
      settings().getByRole("button", { name: "确认同步", exact: true }),
    ).toBeEnabled({ timeout: 20000 });
  }
  async function apply() {
    await settings()
      .getByRole("button", { name: "确认同步", exact: true })
      .click();
    await expect(
      settings().getByText("共享数据同步完成，个人资料已保留。", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 20000 });
  }
  try {
    await launch();
    await openSettings();
    await settings().getByLabel("共享库地址", { exact: true }).fill(url);
    await settings()
      .getByRole("button", { name: "保存订阅地址", exact: true })
      .click();
    await expect(
      settings().getByText("订阅地址已保存。", { exact: true }),
    ).toBeVisible();
    await preview();
    assert.equal((await state()).gyms.length, 0);
    await expect(settings().getByText(/本次需下载 2 张/)).toBeVisible();
    await page.screenshot({ path: path.join(out, "preview.png") });
    await apply();
    let current = await state();
    assert.equal(current.gyms.length, 1);
    assert.equal(current.equipment.length, 1);
    assert.equal(current.links.length, 1);
    assert.equal(current.gyms[0].visited, false);
    assert.ok(!JSON.stringify(current.gyms).includes("PUBLISHER_PRIVATE"));
    assert.ok(fs.readdirSync(path.join(local.root, "backups")).length > 0);
    checks.push(
      "preview is read only, explicit confirmation imports linked public data and backs up",
    );
    await settings()
      .getByRole("button", { name: "关闭弹窗", exact: true })
      .click();
    await expect(page.locator(".gym-item")).toHaveCount(1);
    await expect(page.locator(".gym-item")).toContainText("共享测试场馆");
    await page.locator(".gym-item").hover();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".gym-preview img")].some(
          (image) => image.naturalWidth > 0,
        ),
      null,
      { timeout: 10000 },
    );
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    await expect(page.locator(".equipment-card")).toHaveCount(1);
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".equipment-card img")].some(
        (image) => image.naturalWidth > 0,
      ),
    );
    checks.push("shared gym and equipment appear with decoded local images");
    await page.evaluate(
      async (row) =>
        window.desktop.call("saveGym", {
          ...row,
          name: "本地场馆改名",
          visited: true,
          description: "SUBSCRIBER_PRIVATE",
        }),
      current.gyms[0],
    );
    const revised = structuredClone(source.db);
    revised.gyms[0].name = "维护者修改场馆名";
    revised.gyms[0].city = "北京";
    source.save(revised);
    publish();
    const imageRequests = requests.filter((name) =>
      name.startsWith("images/"),
    ).length;
    await openSettings();
    await preview();
    await expect(settings().getByText(/本次需下载 0 张/)).toBeVisible();
    await expect(settings().getByText(/以下资料与本地修改冲突/)).toBeVisible();
    assert.equal(
      requests.filter((name) => name.startsWith("images/")).length,
      imageRequests,
    );
    await apply();
    current = await state();
    assert.equal(current.gyms[0].name, "本地场馆改名");
    assert.equal(current.gyms[0].city, "北京");
    assert.equal(current.gyms[0].visited, true);
    assert.equal(current.gyms[0].description, "SUBSCRIBER_PRIVATE");
    checks.push(
      "three way conflicts preserve local edits, private fields survive, image cache avoids downloads",
    );
    const exported = path.join(temp, "subscriber-export");
    fs.mkdirSync(exported);
    await app.evaluate(({ dialog }, destination) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [destination],
      });
    }, exported);
    await settings().getByText("维护者导出共享库", { exact: true }).click();
    await settings()
      .getByRole("button", { name: "导出共享库", exact: true })
      .click();
    await expect(settings().getByText(/共享库已导出/)).toBeVisible();
    const text = fs.readFileSync(path.join(exported, "catalog.json"), "utf8");
    assert.ok(!text.includes("PRIVATE"));
    assert.ok(!text.includes('"visited"'));
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(exported, "manifest.json"))).images
        .length,
      0,
    );
    await settings()
      .getByRole("checkbox", { name: /我确认导出的图片可公开分享/ })
      .check();
    await settings()
      .getByRole("button", { name: "导出共享库", exact: true })
      .click();
    await expect(settings().getByText(/共享库已导出/)).toBeVisible();
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(exported, "manifest.json"))).images
        .length,
      2,
    );
    checks.push(
      "export excludes private fields and requires opt in for images",
    );
    await app.close();
    app = null;
    await launch();
    current = await state();
    assert.equal(current.gyms.length, 1);
    assert.equal(current.gyms[0].visited, true);
    await openSettings();
    await expect(
      settings().getByLabel("共享库地址", { exact: true }),
    ).toHaveValue(url);
    await expect(settings().getByText(/上次同步：/)).toBeVisible();
    checks.push("subscription, data and private fields survive restart");
    if (process.env.GYM_INSTALLED_EXE) {
      await settings()
        .getByRole("button", { name: "检查更新", exact: true })
        .click();
      await expect(
        settings().getByText("发现版本 99.0.0", { exact: true }),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        settings().getByRole("button", { name: "下载更新", exact: true }),
      ).toBeVisible();
      assert.ok(requests.includes("latest.yml"));
      checks.push(
        "packaged app detects fixture release and offers download without installing",
      );
    }
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      packaged: !!process.env.GYM_INSTALLED_EXE,
      checks,
      errors,
      temp,
    };
    fs.writeFileSync(
      path.join(
        out,
        process.env.GYM_INSTALLED_EXE ? "packaged-result.json" : "result.json",
      ),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
