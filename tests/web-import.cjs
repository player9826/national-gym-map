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
  const image = fs.readFileSync(path.resolve('build/icon.png'));
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
    if (["/image.png", "/angle-two.png", "/angle-three.png"].includes(req.url)) {
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
    if (req.url === '/three-images') {
      res.end('<title>Gallery Press</title><main><h1>Gallery Press</h1><div class="product-gallery"><img src="/image.png"><img src="/angle-two.png"><img src="/angle-three.png"></div></main>');
      return;
    }
    if (req.url === "/store/brand/series/") {
      res.end('<title>Nitro Plus</title><div id="content"><a href="compound-row-s5cr/"><h3>Compound Row S5CR</h3><img data-src="/image.png"></a><a href="abdominal-s5ab/"><h3>Abdominal S5AB</h3></a><a href="weight-stack-pins/"><h3>Weight Stack Pins</h3></a></div>');
      return;
    }
    if (req.url === "/store/brand/series/compound-row-s5cr/") {
      res.end('<title>Compound Row S5CR | Parts supplier</title><script type="application/ld+json">{"@type":"Product","name":"Seat Pad","sku":"NA812","image":"/bad-image"}</script><div id="content"><h1>Compound Row S5CR</h1><div class="category-image" style="background-image:url(/image.png)"></div><div class="product-list"><a href="/pads/seat/"><h3>Seat Pad</h3><img src="/bad-image"></a><a href="/pads/bolt/"><h3>Hex Head Bolt</h3></a></div></div>');
      return;
    }
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
    assert.ok(ordinary.thumbnail);
    assert.ok(!ordinary.image);
    assert.equal(ordinary.warning, "");
    check("ordinary product, model, image with cookie and referrer");
    const redirected = await read("/redirect-product");
    assert.equal(redirected.name, "Fixture Press");
    assert.match(redirected.productUrl, /\/product\/press$/);
    check("product redirect resolves final source");
    const redirectedImage = await read("/image-redirect-product");
    assert.ok(redirectedImage.thumbnail, redirectedImage.warning);
    check("redirected image downloads");
    const dynamic = await read("/dynamic", "browser");
    assert.equal(dynamic.name, "Dynamic Press");
    assert.ok(dynamic.thumbnail);
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
    assert.ok(!broken.image);
    assert.match(broken.warning, /图片未能加载/);
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
    assert.ok(assisted.thumbnail);
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
    const nestedListing = await read("/store/brand/series/");
    assert.equal(nestedListing.kind, "listing");
    assert.deepEqual(nestedListing.products.map(p => p.name), ["Compound Row S5CR", "Abdominal S5AB"]);
    const nestedMachine = await read("/store/brand/series/compound-row-s5cr/");
    assert.equal(nestedMachine.name, "Compound Row S5CR");
    assert.equal(nestedMachine.model, "S5CR");
    assert.ok(nestedMachine.thumbnail, "machine background image downloads; replacement-part metadata must not override it");
    check("nested parts supplier machine directory, accessory filtering, category image and related-product metadata isolation");
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
    const imageFiles = () => fs.existsSync(path.join(temp, 'data', 'equipment')) ? fs.readdirSync(path.join(temp, 'data', 'equipment')) : [];
    assert.deepEqual(imageFiles(), []);
    const gallery = await read('/three-images');
    assert.equal(gallery.imageOptions.length, 3);
    assert.deepEqual(imageFiles(), []);
    assert.equal((await call('state')).equipment.length, 0);
    const selected = gallery.imageOptions[2];
    await assert.rejects(call('saveEquipment', {...gallery, name: '', equipmentType:'cardio', parts:[], tags:[], imageSource: selected.source}), /名称/);
    assert.deepEqual(imageFiles(), [], 'failed save removes newly written image');
    const saved = await call('saveEquipment', {...gallery, name:'Gallery Press', equipmentType:'cardio', parts:[], tags:[], imageSource: selected.source});
    assert.equal(imageFiles().length, 1);
    assert.equal(saved.imageSource, selected.source);
    assert.ok(saved.image);
    assert.equal(saved.pendingWebImage, undefined);
    assert.equal(saved.imageOptions, undefined);
    check('three selectable photos remain temporary; only selected image commits and failed save cleans up');
    const captured = await call('capturePreview', {brandId, bundle:{format:'national-gym-map-capture', version:1, pages:[{
      url:'https://offline-capture.invalid/product/press', html:product('Offline Capture Press', 'https://offline-capture.invalid/photo.png'),
      images:[{source:'https://offline-capture.invalid/photo.png', dataUrl:`data:image/png;base64,${image.toString('base64')}`}]
    }]}});
    assert.ok(captured.thumbnail);
    assert.equal(imageFiles().length, 1);
    const captureBatch = await call('batchScan', {brandId, url:captured.productUrl, capture:captured});
    assert.equal(captureBatch.candidates[0].detailFetched, true);
    await call('batchUpdate', {id:captureBatch.id, candidateIds:[captureBatch.candidates[0].id], patch:{equipmentType:'cardio', parts:[], tags:[]}});
    assert.equal(imageFiles().length, 1);
    const summary = await call('batchPreview', {id:captureBatch.id});
    await call('batchCommit', {id:captureBatch.id, token:summary.token});
    assert.equal(imageFiles().length, 2, 'capture saves its original without visiting its deliberately nonexistent host');
    const state = await call('state');
    assert.equal(state.importBatches[0].candidates[0].thumbnail, undefined);
    assert.equal(state.importBatches[0].candidates[0].imageOptions, undefined);
    check('browser capture imports offline through batch confirmation; history contains no embedded previews');
    await call('browserClose');
    const retained = await call('productImage', {brandId, productUrl:captured.productUrl, imageSource:captured.imageSource});
    assert.ok(retained.image, 'closing auxiliary browser must retain captured originals');
    fs.unlinkSync(path.join(temp, 'data', retained.image));
    const avif = require('@napi-rs/canvas').createCanvas(24,16).encodeSync('avif');
    const avifCapture = await call('capturePreview', {brandId,bundle:{format:'national-gym-map-capture',version:1,pages:[{
      url:'https://offline-capture.invalid/product/avif',html:'<h1>AVIF Test Press</h1>',images:[{source:'https://offline-capture.invalid/photo.avif',dataUrl:`data:image/avif;base64,${avif.toString('base64')}`}]
    }]}});
    assert.equal(avifCapture.imageOptions.length,1);
    assert.ok(avifCapture.thumbnail.startsWith('data:image/jpeg;'));
    check('captured originals survive auxiliary window close; AVIF candidates decode for preview');
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
