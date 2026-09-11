const { _electron: electron, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-web-import-"));
  const output = path.resolve(
    process.env.GYM_INSTALLED_EXE
      ? "test-results/web-import-packaged.json"
      : "test-results/web-import.json",
  );
  const report = {
    date: new Date().toISOString(),
    checks: [],
    websites: [],
    temp,
  };
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    "base64",
  );
  const product = (name, imageUrl = "/image.png") =>
    `<html><head><title>${name}</title><meta property="og:image" content="${imageUrl}"></head><body><main><h1>${name}</h1><span class="sku">TEST-01</span></main></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect-product") {
      res.writeHead(302, { Location: "/product/press" });
      res.end();
      return;
    }
    if (req.url === "/redirect-image") {
      res.writeHead(302, { Location: "/image.png" });
      res.end();
      return;
    }
    if (req.url === "/slow") return;
    if (req.url === "/image.png") {
      if (
        !req.headers.referer ||
        !req.headers.cookie?.includes("product=yes")
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(image);
      return;
    }
    if (req.url === "/bad-image") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("not image");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Set-Cookie", "product=yes; Path=/; SameSite=Lax");
    if (req.url === "/blocked") {
      res.writeHead(403);
      res.end("<title>Attention Required! | Cloudflare</title>");
      return;
    }
    if (req.url === "/localized-challenge") {
      res.end(
        "<title>请稍候…</title><h1>example.com</h1><script>window._cf_chl_opt = {};</script>",
      );
      return;
    }
    if (req.url === "/missing") {
      res.writeHead(404);
      res.end(product("Unavailable"));
      return;
    }
    if (req.url === "/rate-limit") {
      res.writeHead(429);
      res.end("slow down");
      return;
    }
    if (req.url === "/dynamic") {
      res.end(
        `<html><head><title>Loading</title></head><body><script>setTimeout(() => {document.body.innerHTML='<main><h1>Dynamic Press</h1><img src="/image.png"></main>';}, 1200)</script></body></html>`,
      );
      return;
    }
    if (req.url === "/product-category/machines/") {
      res.end(
        '<title>Machines</title><ul class="products"><li class="product"><a href="/product/press"><h2>Fixture Press</h2></a></li><li class="product"><a href="/product/row"><h2>Fixture Row</h2></a></li></ul>',
      );
      return;
    }
    res.end(
      product(
        req.url === "/broken" ? "Broken Photo Press" : "Fixture Press",
        req.url === "/broken"
          ? "/bad-image"
          : req.url === "/image-redirect-product"
            ? "/redirect-image"
            : "/image.png",
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let app;
  try {
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
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.desktop));
    const call = (method, payload) =>
      page.evaluate(
        ({ method, payload }) => window.desktop.call(method, payload),
        { method, payload },
      );
    await call("configure");
    const brand = await call("saveBrand", {
      name: "Import regression",
      website: base,
      notes: "",
    });
    const brandId = brand.id;
    assert.ok(brandId);
    const read = (suffix, mode = "auto") =>
      call("productPreview", { url: `${base}${suffix}`, brandId, mode });
    const check = (name) => {
      report.checks.push(name);
      console.log(`PASS ${name}`);
    };
    const ordinary = await read("/product/press");
    assert.equal(ordinary.name, "Fixture Press");
    assert.equal(ordinary.model, "TEST-01");
    assert.ok(ordinary.image);
    assert.equal(ordinary.warning, "");
    check("ordinary product, model, image with cookie and referrer");
    const redirected = await read("/redirect-product");
    assert.equal(redirected.name, "Fixture Press");
    assert.match(redirected.productUrl, /\/product\/press$/);
    check("product redirect resolves final source");
    const redirectedImage = await read("/image-redirect-product");
    assert.ok(redirectedImage.image, redirectedImage.warning);
    check("redirected image downloads");
    const dynamic = await read("/dynamic", "browser");
    assert.equal(dynamic.name, "Dynamic Press");
    assert.ok(dynamic.image);
    check("browser executes delayed product content");
    const automatic = await read("/dynamic");
    assert.equal(automatic.name, "Dynamic Press");
    check("automatic fallback to browser");
    const listing = await read("/product-category/machines/");
    assert.equal(listing.kind, "listing");
    assert.equal(listing.products.length, 2);
    check("category produces product choices");
    const broken = await read("/broken");
    assert.equal(broken.name, "Broken Photo Press");
    assert.equal(broken.image, "");
    assert.match(broken.warning, /图片下载失败/);
    check("bad image preserves product text with warning");
    await assert.rejects(read("/blocked"), /验证|拒绝|403/);
    check("challenge cannot become product");
    await assert.rejects(read("/localized-challenge"), /验证|拒绝/);
    check("localized challenge cannot become product");
    await assert.rejects(read("/missing", "browser"), /404/);
    check("browser response status rejects missing product");
    await assert.rejects(read("/rate-limit"), /频率/);
    check("rate limit reported without browser fallback");
    await call("browserOpen", { url: `${base}/product/press` });
    await app.evaluate(async ({ BrowserWindow }) => {
      const win =
        BrowserWindow.getAllWindows().find((w) =>
          w.getTitle().includes("Fixture Press"),
        ) ||
        BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes("/product/press"),
        );
      if (win?.webContents.isLoading())
        await new Promise((resolve) =>
          win.webContents.once("did-stop-loading", resolve),
        );
    });
    // Poll readiness without assuming loadURL has completed when browserOpen returns.
    let assisted;
    for (let i = 0; i < 20; i++) {
      try {
        assisted = await call("browserRead", { brandId });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(assisted?.name, "Fixture Press");
    assert.ok(assisted.image);
    await call("browserClose");
    await assert.rejects(call("browserRead", { brandId }), /先打开/);
    check("assisted browser read and close");
    const pending = read("/slow").then(
      () => ({ success: true }),
      (error) => ({ error: error.message }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await call("browserClose");
    assert.match((await pending).error, /取消/);
    check("cancel interrupts pending read");
    const sites = [
      [
        "Panatta",
        "https://www.panattasport.com/en/freeweight-one/abdominal-crunch-2/",
      ],
      ["Booty Builder", "https://bootybuilder.com/product-category/machines/"],
      [
        "Booty Builder product",
        "https://bootybuilder.com/product/booty-builder-platinum/",
      ],
      ["Rogue", "https://www.roguefitness.com/rogue-ab-3-adjustable-bench"],
      ["REP Fitness", "https://repfitness.com/products/ab-5200-2-0"],
      ["Concept2", "https://www.concept2.com/ergs/rowerg"],
    ];
    if (!process.env.GYM_WEB_FIXTURES_ONLY)
      for (const [brand, url] of sites) {
        const started = Date.now();
        try {
          const result = await call("productPreview", {
            url,
            brandId,
            mode: "auto",
          });
          report.websites.push({
            brand,
            url,
            elapsedMs: Date.now() - started,
            ...result,
          });
        } catch (error) {
          report.websites.push({
            brand,
            url,
            elapsedMs: Date.now() - started,
            error: error.message,
          });
        }
        console.log(JSON.stringify(report.websites.at(-1)));
        if (process.env.GYM_WEB_CAPTURE) {
          await call("browserOpen", { url });
          await new Promise((resolve) => setTimeout(resolve, 7000));
          const html = await app.evaluate(async ({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((w) =>
              /^https:/.test(w.webContents.getURL()),
            );
            return win
              ? win.webContents.executeJavaScript(
                  "document.documentElement.outerHTML",
                )
              : "";
          });
          fs.mkdirSync(path.resolve("test-results"), { recursive: true });
          fs.writeFileSync(
            path.resolve(`test-results/web-${brand.replace(/\W/g, "-")}.html`),
            html,
          );
          await call("browserClose");
        }
      }
    await page.reload();
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    await page.getByRole("button", { name: "官网导入", exact: true }).click();
    const form = page.getByRole("dialog", { name: "官网导入器械" });
    await form
      .getByLabel("品牌", { exact: false })
      .first()
      .selectOption(brandId);
    const input = form.getByLabel("官方产品页或产品列表", { exact: true });
    await input.fill(`${base}/dynamic`);
    await form.getByRole("button", { name: "浏览器读取", exact: true }).click();
    await expect(form.getByLabel("器械名称", { exact: false })).toHaveValue(
      "Dynamic Press",
    );
    await input.fill(`${base}/product-category/machines/`);
    await form.getByRole("button", { name: "读取产品", exact: true }).click();
    await expect(form.getByLabel("选择产品（2 款）")).toBeVisible();
    await form
      .getByRole("button", { name: "读取所选产品", exact: true })
      .click();
    await expect(form.getByLabel("器械名称", { exact: false })).toHaveValue(
      "Fixture Press",
    );
    await form
      .getByRole("button", { name: "打开辅助浏览器", exact: true })
      .click();
    await page.waitForTimeout(800);
    await form.getByRole("button", { name: "读取当前页", exact: true }).click();
    await expect(form.locator('[role="status"]')).toContainText(
      "已读取产品预览",
    );
    await form
      .getByRole("button", { name: "关闭辅助浏览器", exact: true })
      .click();
    await form.getByRole("button", { name: "取消", exact: true }).click();
    check(
      "browser and assisted UI, category selection and cancel preserve preview-only workflow",
    );
    assert.equal((await call("state")).equipment.length, 0);
    check("preview never commits equipment");
    report.passed = true;
  } finally {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
