const { _electron: electron, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { createCanvas } = require("@napi-rs/canvas");
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-batch-desktop-"));
  const checks = [],
    image = createCanvas(24, 24).encodeSync("png");
  const products = [
    ["press", "Chest Press"],
    ["dumbbell", "Dumbbell"],
    ["cardio", "Treadmill"],
    ["cable", "Cable Station"],
    ["blocked", "Blocked"],
    ["missing", "Missing"],
    ["timeout", "Timeout"],
  ];
  const server = http.createServer((req, res) => {
    if (req.url === "/image.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(image);
      return;
    }
    if (req.url === "/product/timeout") return;
    if (req.url === "/product/blocked") {
      res.writeHead(403);
      res.end("Access denied");
      return;
    }
    if (req.url === "/product/missing") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.setHeader("Content-Type", "text/html");
    if (req.url.startsWith("/product-category/"))
      res.end(
        `<ul class="products">${products.map(([id, name]) => `<li class="product"><a href="/product/${id}"><h2>${name}</h2><img src="/image.png"></a></li>`).join("")}</ul>`,
      );
    else {
      const [id, name] =
        products.find(([id]) => req.url === `/product/${id}`) || [];
      res.end(
        `<h1>${name}</h1><span class="sku">${id}</span><meta property="og:image" content="/image.png">`,
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/product-category/machines/`;
  let app, page;
  async function launch() {
    app = await electron.launch({
      ...(process.env.GYM_INSTALLED_EXE
        ? { executablePath: process.env.GYM_INSTALLED_EXE, args: [] }
        : { args: ["."] }),
      env: {
        ...process.env,
        GYM_TEST_PROFILE: path.join(temp, "profile"),
        GYM_TEST_PICK_DIRECTORY: path.join(temp, "data"),
        GYM_TEST_ALLOW_LOCAL: "1",
      },
    });
    page = await app.firstWindow();
    await page.waitForFunction(() => !!window.desktop);
  }
  const call = (method, payload) =>
    page.evaluate(
      ({ method, payload }) => window.desktop.call(method, payload),
      { method, payload },
    );
  try {
    await launch();
    await call("configure");
    await page.reload();
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    await page
      .getByRole("button", { name: "批量网页导入", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "批量器械导入工作台" });
    await dialog.getByLabel("目录或系列页地址").fill(url);
    await dialog.getByRole("button", { name: "扫描页面", exact: true }).click();
    await expect(dialog.locator("tbody tr")).toHaveCount(7);
    assert.equal((await call("state")).equipment.length, 0);
    checks.push("directory UI scans 7 candidates without formal records");
    let batch = (await call("batchList"))[0];
    for (const c of batch.candidates)
      batch = await call("batchFetch", { id: batch.id, candidateId: c.id });
    assert.equal(
      batch.candidates.find((c) => c.name === "Blocked").error.status,
      403,
    );
    assert.equal(
      batch.candidates.find((c) => c.name === "Missing").error.status,
      404,
    );
    assert.equal(
      batch.candidates.find((c) => c.name === "Timeout").error.reason,
      "timeout",
    );
    checks.push(
      "individual 403, 404 and timeout persist without failing batch",
    );
    await app.close();
    await launch();
    batch = await call("batchRead", { id: batch.id });
    assert.equal(batch.candidates.length, 7);
    assert.equal(batch.candidates.filter((c) => c.detailFetched).length, 4);
    checks.push("batch and detail results resume after app restart");
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    await page
      .getByRole("button", { name: "批量网页导入", exact: true })
      .click();
    const work = page.getByRole("dialog", { name: "批量器械导入工作台" });
    await work.getByLabel("继续已有批次").selectOption(batch.id);
    await expect(work.locator("tbody tr")).toHaveCount(7);
    await work.locator("summary").click();
    await work.getByLabel("选择 Dumbbell", { exact: true }).check();
    await work.getByLabel("选择 Treadmill", { exact: true }).check();
    await work.getByRole("button", { name: "设为暂缓", exact: true }).click();
    await expect(work.locator(".batch-status.deferred")).toHaveCount(2);
    await work.getByRole("button", { name: "设为待导入", exact: true }).click();
    await expect(work.locator(".batch-status.pending")).toHaveCount(4);
    await work.getByRole("button", { name: "检查重复并预览入库" }).click();
    await expect(
      work.getByRole("region", { name: "最终导入确认" }),
    ).toBeVisible();
    assert.equal((await call("state")).equipment.length, 0);
    checks.push(
      "multi-select defer/resume and final confirmation preserve draft-only state",
    );
    await work
      .getByRole("button", { name: "确认批量导入", exact: true })
      .click();
    await expect(work.getByRole("status")).toContainText("正式入库完成");
    const state = await call("state");
    assert.equal(state.equipment.length, 4);
    assert.deepEqual(
      new Set(state.equipment.map((e) => e.equipmentType)),
      new Set(["fixed", "cardio", "free_weight", "cable_station"]),
    );
    assert.ok(state.equipment.every((e) => e.image && e.sourceUrl));
    checks.push(
      "explicit UI confirmation creates four classified records with localized images and source",
    );
    await page.screenshot({
      path: path.resolve("test-results/batch-workbench.png"),
    });
    console.log(checks);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(
      "test-results/batch-desktop.json",
      JSON.stringify({ date: new Date().toISOString(), checks, temp }, null, 2),
    );
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
