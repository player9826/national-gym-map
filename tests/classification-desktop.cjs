const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Store } = require("../electron/storage.cjs");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-classification-"));
  const profile = path.join(temp, "profile");
  const store = new Store(path.join(profile, "location.json"));
  store.configure(path.join(temp, "data"));
  const app = await electron.launch({
    ...(process.env.GYM_INSTALLED_EXE
      ? { executablePath: process.env.GYM_INSTALLED_EXE, args: [] }
      : { args: ["."] }),
    env: { ...process.env, GYM_TEST_PROFILE: profile },
  });
  const checks = [];
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = () => page.evaluate(() => window.desktop.call("state"));
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    for (const type of ["fixed", "cardio", "free_weight", "cable_station"]) {
      await page
        .getByRole("button", { name: "新增器械", exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog", {
        name: "新增器械",
        exact: true,
      });
      await dialog
        .getByLabel("品牌", { exact: false })
        .first()
        .selectOption("brand-1");
      await dialog
        .getByLabel("器械名称", { exact: false })
        .fill(`分类-${type}`);
      await expect(dialog.getByLabel("器械类型", { exact: true })).toHaveValue(
        "",
      );
      const before = (await state()).equipment.length;
      await dialog
        .getByRole("button", { name: "保存器械", exact: true })
        .click();
      assert.equal((await state()).equipment.length, before);
      await dialog.getByLabel("器械类型", { exact: true }).selectOption(type);
      if (type === "fixed") {
        await dialog.getByLabel("胸", { exact: true }).check();
        await dialog
          .getByRole("button", { name: "保存器械", exact: true })
          .click();
        await expect(dialog.getByRole("alert")).toContainText("应用标签");
        assert.equal((await state()).equipment.length, before);
        await dialog.getByLabel("推胸", { exact: true }).check();
        await dialog
          .getByLabel("负重类型", { exact: true })
          .selectOption("挂片");
      } else {
        await expect(dialog.getByLabel("胸", { exact: true })).toHaveCount(0);
        await expect(dialog.getByLabel("推胸", { exact: true })).toHaveCount(0);
        await expect(
          dialog.getByLabel("负重类型", { exact: true }),
        ).toHaveCount(0);
      }
      if (type === "free_weight") {
        await dialog
          .getByRole("button", { name: "保存器械", exact: true })
          .click();
        assert.equal((await state()).equipment.length, before);
        await dialog
          .getByLabel("自由力量子类", { exact: true })
          .selectOption("dumbbell");
      }
      await dialog
        .getByRole("button", { name: "保存器械", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "器械详情", exact: true }),
      ).toBeVisible();
      const saved = (await state()).equipment.find(
        (row) => row.name === `分类-${type}`,
      );
      assert.equal(saved.equipmentType, type);
      await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    }
    checks.push(
      "manual four types; type required; fixed parts/tags required; free subtype required; conditional fields",
    );
    const labels = {
      fixed: "固定器械",
      cardio: "有氧器械",
      free_weight: "自由力量",
      cable_station: "龙门架",
    };
    for (const [type, label] of Object.entries(labels)) {
      await page
        .locator(".equipment-type-tabs button")
        .filter({ hasText: label })
        .click();
      await expect(page.locator(".equipment-card")).toHaveCount(1);
      await expect(page.locator(".equipment-card")).toContainText(
        `分类-${type}`,
      );
      await expect(
        page.getByLabel("器械部位筛选", { exact: true }),
      ).toHaveCount(type === "fixed" ? 1 : 0);
      if (type === "fixed") {
        await page
          .getByLabel("应用标签筛选", { exact: true })
          .selectOption("夹胸");
        await expect(page.locator(".equipment-card")).toHaveCount(0);
        await page
          .getByLabel("应用标签筛选", { exact: true })
          .selectOption("推胸");
        await expect(page.locator(".equipment-card")).toHaveCount(1);
      }
      if (type === "free_weight") {
        for (const subtype of ["barbell", "smith", "rack"]) {
          await page
            .getByLabel("自由力量子类筛选", { exact: true })
            .selectOption(subtype);
          await expect(page.locator(".equipment-card")).toHaveCount(0);
        }
        await page
          .getByLabel("自由力量子类筛选", { exact: true })
          .selectOption("dumbbell");
        await expect(page.locator(".equipment-card")).toHaveCount(1);
      }
    }
    checks.push(
      "library four filters, fixed tags, free four subtypes, cardio/cable hide fixed filters",
    );
    await page
      .locator(".equipment-type-tabs button")
      .filter({ hasText: "固定器械" })
      .click();
    await page.locator(".equipment-card").click();
    await page.getByRole("button", { name: "编辑器械", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "编辑器械", exact: true });
    await edit
      .getByLabel("器械类型", { exact: true })
      .selectOption("free_weight");
    await edit
      .getByLabel("自由力量子类", { exact: true })
      .selectOption("smith");
    await edit.getByRole("button", { name: "保存器械", exact: true }).click();
    await expect(edit).toHaveCount(0);
    let changed = (await state()).equipment.find(
      (row) => row.name === "分类-fixed",
    );
    assert.equal(changed.equipmentType, "free_weight");
    assert.equal(changed.freeWeightType, "smith");
    assert.deepEqual(changed.parts, []);
    assert.deepEqual(changed.tags, []);
    assert.equal(changed.loading, "");
    await page.getByRole("button", { name: "编辑器械", exact: true }).click();
    await edit.getByLabel("器械类型", { exact: true }).selectOption("cardio");
    await expect(edit.getByLabel("自由力量子类", { exact: true })).toHaveCount(
      0,
    );
    await edit.getByRole("button", { name: "保存器械", exact: true }).click();
    await expect(edit).toHaveCount(0);
    changed = (await state()).equipment.find(
      (row) => row.name === "分类-fixed",
    );
    assert.equal(changed.equipmentType, "cardio");
    assert.equal(changed.freeWeightType, "");
    checks.push(
      "editing fixed to free clears parts tags loading; free to cardio clears subtype",
    );
    assert.deepEqual(errors, []);
    fs.mkdirSync("test-results/classification", { recursive: true });
    fs.writeFileSync(
      "test-results/classification/report.json",
      JSON.stringify({ passed: true, checks, temp }, null, 2),
    );
    console.log(JSON.stringify({ passed: true, checks, temp }, null, 2));
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
