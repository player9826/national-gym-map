const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
async function main() {
  const base = path.resolve("test-results/foundation");
  fs.mkdirSync(base, { recursive: true });
  const root = path.join(
    require("node:os").tmpdir(),
    `NationalGymMap-Test-${Date.now()}`,
  );
  const profile = path.join(base, `profile-${Date.now()}`);
  const exe = process.env.GYM_INSTALLED_EXE;
  const launch = () =>
    electron.launch({
      ...(exe ? { executablePath: exe, args: [] } : { args: ["."] }),
      env: {
        ...process.env,
        GYM_TEST_PROFILE: profile,
        GYM_TEST_PICK_DIRECTORY: root,
        GYM_TEST_CONFIRM: "1",
      },
    });
  let app = await launch();
  let page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  assert.equal(await page.title(), "全国健身房地图");
  await page.getByRole("button", { name: "设置数据目录", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "数据与设置" });
  if (await settings.count()) await settings.getByRole("button", { name: "设置数据目录", exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal(
    (await page.evaluate(() => window.desktop.call("status"))).ready,
    true,
  );
  const backup = await page.evaluate(() => window.desktop.call("backup"));
  assert.ok(fs.existsSync(backup.path));
  await page.screenshot({ path: path.join(base, "foundation-desktop.png") });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  const status = await page.evaluate(() => window.desktop.call("status"));
  assert.equal(status.dataRoot, root);
  assert.equal(status.ready, true);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      filePaths: [file],
      canceled: false,
    });
  }, backup.path);
  const restored = await page.evaluate(() => window.desktop.call("restore"));
  assert.ok(restored.safetyBackup);
  await app.close();
  console.log(
    JSON.stringify({
      passed: true,
      installed: !!exe,
      dataRoot: root,
      restart: true,
      backupRestore: true,
    }),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
