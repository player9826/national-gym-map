const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Store } = require("../electron/storage.cjs");
async function main() {
  const out = path.resolve("test-results/desktop");
  fs.mkdirSync(out, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-desktop-"));
  const profile = path.join(temp, "profile");
  const data = path.join(temp, "data");
  const photo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    "base64",
  );
  const photoFile = path.join(temp, "image.png");
  fs.writeFileSync(photoFile, photo);
  const server = http.createServer((req, res) => {
    if (req.url === "/photo.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(photo);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        '<html><head><meta property="og:title" content="官网推胸器"><meta property="og:image" content="/photo.png"></head><body><h1>官网推胸器</h1></body></html>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let app;
  const errors = [];
  const checks = [];
  const launch = async () => {
    const application = await electron.launch({
      ...(process.env.GYM_INSTALLED_EXE
        ? { executablePath: process.env.GYM_INSTALLED_EXE, args: [] }
        : { args: ["."] }),
      env: {
        ...process.env,
        GYM_TEST_PROFILE: profile,
        GYM_TEST_PICK_DIRECTORY: data,
        GYM_TEST_CONFIRM: "1",
        GYM_TEST_ALLOW_LOCAL: "1",
      },
    });
    const p = await application.firstWindow();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.waitForLoadState("domcontentloaded");
    return { app: application, page: p };
  };
  try {
    let current = await launch();
    app = current.app;
    let page = current.page;
    assert.equal(
      (await page.evaluate(() => window.desktop.call("status"))).version,
      require("../package.json").version,
    );
    await expect(page.locator(".leaflet-overlay-pane canvas")).toBeVisible();
    await page.waitForFunction(
      () => document.querySelectorAll(".province-label").length >= 30,
    );
    checks.push("map initializes before data directory");
    await page
      .getByRole("button", { name: "设置数据目录", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "设置数据目录", exact: true })
      .click();
    await expect(page.locator(".data-path")).toContainText(data);
    await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await page
      .getByRole("button", { name: "新增健身房", exact: true })
      .first()
      .click();
    await page
      .getByLabel("名称", { exact: false })
      .first()
      .fill("回归测试健身房");
    await page.getByLabel("省份", { exact: true }).fill("四川");
    await page.getByLabel("城市", { exact: true }).fill("成都");
    await page.getByLabel("区县", { exact: true }).fill("武侯区");
    await page.getByLabel("详细地址", { exact: true }).fill("测试路 1 号");
    await page.getByRole("button", { name: "地图选点", exact: true }).click();
    await expect(page.locator(".pick-banner")).toBeVisible();
    const mapBox = await page.getByTestId("map").boundingBox();
    await page.mouse.click(
      mapBox.x + mapBox.width * 0.5,
      mapBox.y + mapBox.height * 0.55,
    );
    await expect(
      page.getByRole("dialog", { name: "新增健身房" }),
    ).toBeVisible();
    await expect(page.getByLabel("纬度", { exact: true })).not.toHaveValue("");
    await page.getByLabel("纬度", { exact: true }).fill("30.5728");
    await page.getByLabel("经度", { exact: true }).fill("104.0668");
    await page.getByLabel("标签", { exact: true }).fill("力量训练，全天营业");
    await page
      .getByLabel("简介", { exact: true })
      .fill("专注力量训练的个人场馆档案。");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        filePaths: [file],
        canceled: false,
      });
    }, photoFile);
    await page
      .getByRole("button", { name: "添加照片", exact: true })
      .first()
      .click();
    await expect(page.locator(".photo-thumb")).toHaveCount(1);
    await page.getByRole("button", { name: "保存健身房", exact: true }).click();
    await expect(page.locator(".detail-body h2")).toHaveText("回归测试健身房");
    await expect(page.locator(".gym-marker")).toHaveCount(1);
    await expect(page.locator(".gym-cover")).toBeVisible();
    await page
      .locator(".gym-detail-modal")
      .getByRole("button", { name: "已去过", exact: true })
      .click();
    await expect(page.locator(".gym-marker")).toHaveClass(/visited/);
    await page.getByRole("button", { name: "编辑健身房", exact: true }).click();
    await page.getByLabel("测评评分", { exact: true }).fill("88");
    await page.getByRole("button", { name: "保存健身房", exact: true }).click();
    await expect(page.locator(".review-score strong")).toHaveText("88");
    await page
      .getByRole("button", { name: "关闭健身房详情", exact: true })
      .click();
    await page.getByLabel("搜索健身房").fill("不匹配");
    await expect(page.locator(".gym-marker")).toHaveCount(0);
    await page.getByLabel("搜索健身房").fill("");
    await expect(page.locator(".gym-marker")).toHaveCount(1);
    await page
      .getByRole("button", { name: "未去过", exact: true })
      .first()
      .click();
    await expect(page.locator(".gym-marker")).toHaveCount(0);
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.getByRole("button", { name: "回到全国", exact: true }).click();
    await page.getByRole("button", { name: "放大地图", exact: true }).click();
    await page.getByRole("button", { name: "缩小地图", exact: true }).click();
    const drag = await page.getByTestId("map").boundingBox();
    await page.mouse.move(drag.x + 130, drag.y + 250);
    await page.mouse.down();
    await page.mouse.move(drag.x + 210, drag.y + 290, { steps: 10 });
    await page.mouse.up();
    await page.getByRole("button", { name: "回到全国", exact: true }).click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(out, "map-desktop.png") });
    checks.push(
      "gym create edit map selection photo status search filter zoom drag",
    );
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    await page.getByRole("button", { name: "品牌管理", exact: true }).click();
    await page.getByLabel("品牌名称", { exact: false }).fill("无官网测试品牌");
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await expect(
      page.locator(".brand-select").filter({ hasText: "无官网测试品牌" }),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "编辑品牌 无官网测试品牌", exact: true })
      .click();
    await page.getByLabel("品牌备注", { exact: true }).fill("手动品牌");
    await page.getByRole("button", { name: "保存品牌", exact: true }).click();
    await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await page
      .getByRole("button", { name: "新增器械", exact: true })
      .first()
      .click();
    await page
      .getByLabel("品牌", { exact: false })
      .first()
      .selectOption({ label: "无官网测试品牌" });
    await page.getByLabel("器械名称", { exact: false }).fill("手动核心器械");
    await page.getByLabel("器械类型", { exact: true }).selectOption("fixed");
    await page.getByLabel("核心", { exact: true }).check();
    await page
      .getByRole("dialog", { name: "新增器械" })
      .getByLabel("负重类型", { exact: true })
      .selectOption("插片");
    await page.getByLabel("脊柱屈", { exact: true }).check();
    await page.getByRole("button", { name: "保存器械", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "器械详情" })).toBeVisible();
    await page.getByRole("button", { name: "编辑器械", exact: true }).click();
    await page.getByLabel("型号", { exact: true }).fill("CORE-1");
    await page.getByRole("button", { name: "保存器械", exact: true }).click();
    await expect(page.locator(".equipment-detail")).toContainText("CORE-1");
    await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await page.getByRole("button", { name: "按部位", exact: true }).click();
    await page.locator(".group-item").filter({ hasText: /^核心/ }).click();
    await expect(page.locator(".equipment-card")).toHaveCount(1);
    await page.getByRole("button", { name: "按品牌", exact: true }).click();
    await page.getByRole("button", { name: "官网导入", exact: true }).click();
    await page
      .getByLabel("品牌", { exact: false })
      .first()
      .selectOption({ label: "PANATTA" });
    await page
      .getByLabel("官方产品页或产品列表", { exact: true })
      .fill(`http://127.0.0.1:${server.address().port}/product`);
    await page.getByRole("button", { name: "读取产品", exact: true }).click();
    await expect(page.getByLabel("器械名称", { exact: false })).toHaveValue(
      "官网推胸器",
    );
    await expect(page.getByLabel("器械类型", { exact: true })).toHaveValue("");
    await page.getByLabel("器械类型", { exact: true }).selectOption("fixed");
    await expect(page.getByLabel("胸", { exact: true })).not.toBeChecked();
    await page.getByLabel("胸", { exact: true }).check();
    await expect(page.getByLabel("推胸", { exact: true })).not.toBeChecked();
    await page
      .getByRole("dialog", { name: "官网导入器械" })
      .getByLabel("负重类型", { exact: true })
      .selectOption("挂片");
    await page.getByLabel("推胸", { exact: true }).check();
    await page.getByRole("button", { name: "保存器械", exact: true }).click();
    await expect(page.locator(".equipment-detail img")).toBeVisible();
    await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    checks.push(
      "brand add edit no website; equipment manual edit grouping; official import local image user categories",
    );
    await page.getByRole("button", { name: "健身房地图", exact: true }).click();
    await page.locator(".gym-open").first().click();
    await page.getByRole("button", { name: "编辑健身房", exact: true }).click();
    await page.getByLabel("PANATTA", { exact: true }).check();
    await page.getByRole("button", { name: "保存健身房", exact: true }).click();
    await expect(page.locator(".gym-detail-modal .brand-tags button")).toHaveCount(
      1,
    );
    await page.getByRole("button", { name: "关联器械", exact: true }).click();
    await page
      .locator(".picker-card")
      .filter({ hasText: "官网推胸器" })
      .click();
    await page.locator("#batch-links input[type=number]").fill("3");
    await page.getByRole("button", { name: "保存关联", exact: true }).click();
    await expect(page.locator(".linked-item")).toHaveCount(1);
    await page.locator(".linked-open").click();
    await page.locator(".reverse-link").click();
    await expect(page.locator(".detail-body h2")).toHaveText("回归测试健身房");
    checks.push(
      "gym brand tag; visual batch association and reverse navigation",
    );
    const reviewPath = path.join(temp, "review.json");
    fs.writeFileSync(
      reviewPath,
      JSON.stringify({
        fields: { gymName: "测评导入场馆", gymCity: "上海", gymArea: "1500" },
        state: {
          areaIsTotal: false,
          cats: { 推胸: 6 },
          muscles: { chest: 8 },
          smithCount: 2,
          dumbbellMax: 50,
          cardio: { treadmill: 5 },
        },
        lockerChecks: { shower: true },
      }),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        filePaths: [file],
        canceled: false,
      });
    }, reviewPath);
    await page.getByRole("button", { name: "导入测评", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "测评导入预览" }),
    ).toBeVisible();
    await expect(page.getByLabel("评分", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(page.locator(".detail-body h2")).toHaveText("测评导入场馆");
    await expect(page.locator(".review-score strong")).toHaveText("待补充");
    let state = await page.evaluate(() => window.desktop.call("state"));
    assert.equal(
      state.gyms.find((g) => g.name === "测评导入场馆").rawReview.state
        .smithCount,
      2,
    );
    const exportFile = path.join(temp, "all.json");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ filePath: file, canceled: false });
    }, exportFile);
    await page.evaluate(() => window.desktop.call("export", "all"));
    assert.ok(fs.existsSync(exportFile));
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        filePaths: [file],
        canceled: false,
      });
    }, exportFile);
    await page.evaluate(() => window.desktop.call("previewImport", "gyms"));
    await page.evaluate(() => window.desktop.call("commitImport", {}));
    await page.evaluate(() =>
      window.desktop.call("previewImport", "equipment"),
    );
    await page.evaluate(() => window.desktop.call("commitImport", {}));
    checks.push(
      "review no score raw preservation and gym/equipment data imports exports",
    );
    const backup = await page.evaluate(() => window.desktop.call("backup"));
    assert.ok(fs.existsSync(backup.path));
    await app.close();
    app = null;
    current = await launch();
    app = current.app;
    page = current.page;
    state = await page.evaluate(() => window.desktop.call("state"));
    assert.equal(state.gyms.length, 2);
    assert.equal(state.equipment.length, 2);
    assert.equal(state.links.length, 1);
    assert.ok(
      fs.existsSync(
        path.join(
          data,
          state.equipment.find((e) => e.name === "官网推胸器").image,
        ),
      ),
    );
    await page
      .locator(".gym-open")
      .filter({ hasText: "回归测试健身房" })
      .click();
    await page
      .getByRole("button", { name: "解除关联 官网推胸器", exact: true })
      .click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.locator(".linked-item")).toHaveCount(0);
    await page.getByRole("button", { name: "删除健身房", exact: true }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.locator(".gym-item")).toHaveCount(1);
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    await page
      .locator(".equipment-card")
      .filter({ hasText: "手动核心器械" })
      .click();
    await page.getByRole("button", { name: "删除器械", exact: true }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.locator(".equipment-card")).toHaveCount(1);
    await page.getByRole("button", { name: "品牌管理", exact: true }).click();
    await page
      .getByRole("button", { name: "删除品牌 无官网测试品牌", exact: true })
      .click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(
      page.locator(".brand-select").filter({ hasText: "无官网测试品牌" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        filePaths: [file],
        canceled: false,
      });
    }, backup.path);
    await page.evaluate(() => window.desktop.call("restore"));
    state = await page.evaluate(() => window.desktop.call("state"));
    assert.equal(state.gyms.length, 2);
    assert.equal(state.equipment.length, 2);
    assert.equal(state.links.length, 1);
    await page.reload();
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    await page.screenshot({ path: path.join(out, "equipment-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, "equipment-mobile.png") });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.getByRole("button", { name: "健身房地图", exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "map-mobile.png") });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    checks.push(
      "restart persistence; unlink; gym equipment brand delete; backup restore; mobile layout",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(
        {
          passed: true,
          checks,
          errors,
          temp,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ passed: true, checks, errors, temp }, null, 2),
    );
  } catch (e) {
    if (app) {
      const pages = app.windows();
      if (pages[0]) {
        console.error(await pages[0].locator("body").innerText());
        await pages[0].screenshot({ path: path.join(out, "failure.png") });
      }
    }
    throw e;
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
