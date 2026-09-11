const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createCanvas } = require("@napi-rs/canvas");

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-avif-desktop-"));
  const canvas = createCanvas(32, 24),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e24854";
  ctx.fillRect(0, 0, 32, 24);
  const bytes = canvas.encodeSync("avif");
  const input = path.join(temp, "photo.avif");
  fs.writeFileSync(input, bytes);
  const server = http.createServer((req, res) => {
    if (req.url === "/photo.avif") {
      res.setHeader("Content-Type", "image/avif");
      res.end(bytes);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<h1>AVIF Press</h1><meta property="og:image" content="/photo.avif">',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
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
    const call = (method, payload) =>
      page.evaluate(
        ({ method, payload }) => window.desktop.call(method, payload),
        { method, payload },
      );
    await call("configure");
    const state = await call("state");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async (_win, options) => {
        if (!options.filters[0].extensions.includes("avif"))
          throw new Error("AVIF missing from picker");
        return { canceled: false, filePaths: [file] };
      };
    }, input);
    const local = await call("uploadImage", "equipment");
    const product = await call("productPreview", {
      url: `http://127.0.0.1:${server.address().port}/product/press`,
      brandId: state.brands[0].id,
    });
    assert.match(product.image, /\.avif$/);
    for (const rel of [local, product.image]) {
      assert.deepEqual(fs.readFileSync(path.join(temp, "data", rel)), bytes);
      const dimensions = await page.evaluate(
        (src) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
            img.onerror = () => reject(new Error("cannot display AVIF"));
            img.src = `gymasset://local/${src}`;
          }),
        rel,
      );
      assert.deepEqual(dimensions, [32, 24]);
    }
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(
      "test-results/avif.json",
      JSON.stringify(
        {
          date: new Date().toISOString(),
          passed: [
            "manual picker imports AVIF",
            "official product image localizes AVIF",
            "both original byte streams preserved",
            "both local images decode at 32x24 in desktop",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS AVIF manual import, official import, local display (32x24)",
    );
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
