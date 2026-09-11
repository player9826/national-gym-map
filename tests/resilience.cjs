const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { Store, hash } = require("../electron/storage.cjs");
async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-resilience-"));
  const root = path.join(temp, "data");
  const profile = path.join(temp, "profile");
  const initial = new Store(path.join(profile, "location.json"));
  initial.configure(root);
  const backup = await initial.backup();
  fs.writeFileSync(path.join(root, "database/data.json"), "corrupt");
  const options = {
    ...(process.env.GYM_INSTALLED_EXE
      ? { executablePath: process.env.GYM_INSTALLED_EXE, args: [] }
      : { args: ["."] }),
    env: { ...process.env, GYM_TEST_PROFILE: profile, GYM_TEST_CONFIRM: "1" },
  };
  let app = await electron.launch(options);
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".setup-banner")).toContainText(
      "本地数据读取失败",
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".province-label").length >= 30,
    );
    await page.waitForFunction(() => {
      const c = document.querySelector(".leaflet-overlay-pane canvas");
      return (
        c &&
        c
          .getContext("2d")
          .getImageData(0, 0, c.width, c.height)
          .data.some((v, i) => i % 4 === 3 && v > 0)
      );
    });
    const colors = await page
      .locator(".leaflet-overlay-pane canvas")
      .evaluate((canvas) => {
        const ctx = canvas.getContext("2d");
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set();
        let nonempty = 0;
        for (let i = 0; i < data.length; i += 32) {
          if (data[i + 3] > 0) nonempty++;
          colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
        }
        return { distinct: colors.size, nonempty };
      });
    assert.ok(
      colors.distinct > 5 && colors.nonempty > 500,
      JSON.stringify(colors),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, backup.path);
    await page.evaluate(() => window.desktop.call("restore"));
    assert.equal(
      (await page.evaluate(() => window.desktop.call("status"))).ready,
      true,
    );
    await page.reload();
    await page.waitForFunction(() =>
      document
        .querySelector(".storage-state")
        ?.textContent.includes("本地档案"),
    );
    const result = await page.evaluate(() =>
      window.desktop.call("productPreview", {
        brandId: "brand-7",
        url: "https://www.primefitnessusa.com/products/plate-loaded-chest-press",
      }),
    );
    assert.ok(result.image);
    assert.ok(fs.existsSync(path.join(root, result.image)));
    await page.evaluate(
      (row) =>
        window.desktop.call("saveEquipment", {
          ...row,
          equipmentType: "fixed",
          part: "CHEST",
          tags: ["推胸"],
        }),
      result,
    );
    const before = fs.readFileSync(path.join(root, result.image));
    const destination = `E:\\NationalGymMap-Verification-${Date.now()}`;
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, destination);
    const moved = await page.evaluate(() => window.desktop.call("migrate"));
    assert.equal(moved.dataRoot, destination);
    assert.equal(
      hash(before),
      hash(fs.readFileSync(path.join(destination, result.image))),
    );
    assert.ok(fs.existsSync(path.join(root, result.image)));
    await page.reload();
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    await expect(page.locator(".equipment-card img")).toBeVisible();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".equipment-card img")].every(
        (i) => i.complete && i.naturalWidth > 1,
      ),
    );
    await page.screenshot({
      path: path.resolve("test-results/desktop/real-product.png"),
    });
    const update = await page.evaluate(() =>
      window.desktop.call("checkUpdate"),
    );
    assert.equal(update.phase, "unconfigured");
    await app.close();
    app = await electron.launch(options);
    const restarted = await app.firstWindow();
    assert.equal(
      (await restarted.evaluate(() => window.desktop.call("status"))).dataRoot,
      destination,
    );
    console.log(
      JSON.stringify(
        {
          passed: true,
          corruptDataMapVisible: true,
          mapPixels: colors,
          realOfficialImport: result.name,
          migration: destination,
          imageVerified: true,
          restart: true,
          unconfiguredUpdateFeedback: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
