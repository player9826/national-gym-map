const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Store } = require("../electron/storage.cjs");
const catalog = require("../electron/catalog.cjs");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-hover-"));
  const profile = path.join(temp, "profile");
  const out = path.resolve(
    process.env.GYM_INSTALLED_EXE
      ? "test-results/hover-preview-packaged"
      : "test-results/hover-preview",
  );
  fs.mkdirSync(out, { recursive: true });
  const store = new Store(path.join(profile, "location.json"));
  store.configure(path.join(temp, "data"));
  const fixtures = [
    {
      id: "hover-a",
      name: "成都主题场馆",
      city: "成都",
      district: "武侯区",
      lat: 30.57,
      lng: 104.06,
      visited: true,
      score: 88,
      themeColor: "#c34279",
      cover: "gyms/missing.png",
    },
    {
      id: "hover-b",
      name: "北京旧版场馆",
      city: "北京",
      district: "朝阳区",
      lat: 39.9,
      lng: 116.4,
      visited: false,
    },
    {
      id: "hover-c",
      name: "广州快速切换",
      city: "广州",
      district: "天河区",
      lat: 23.13,
      lng: 113.26,
      visited: false,
      themeColor: "#126b80",
    },
  ];
  fixtures.forEach((row) => catalog.upsert(store, "gyms", row));
  const equipment = catalog.upsert(store, "equipment", {
    name: "测试器械",
    equipmentType: "fixed",
    brandId: store.db.brands[0].id,
    parts: ["CHEST"],
    tags: ["推胸"],
    loading: "",
  });
  const next = structuredClone(store.db);
  next.links.push({
    id: "hover-link",
    gymId: "hover-a",
    equipmentId: equipment.id,
    quantity: 3,
  });
  store.save(next);
  let app;
  const checks = [];
  const errors = [];
  try {
    app = await electron.launch({
      ...(process.env.GYM_INSTALLED_EXE
        ? { executablePath: process.env.GYM_INSTALLED_EXE, args: [] }
        : { args: ["."] }),
      env: { ...process.env, GYM_TEST_PROFILE: profile, GYM_TEST_CONFIRM: "1" },
    });
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.locator(".gym-item")).toHaveCount(3);
    await expect(page.locator(".gym-marker")).toHaveCount(3);
    const list = (id) => page.locator(`.gym-item[data-gym-id="${id}"]`);
    const marker = (id) => page.locator(`.gym-marker[data-gym-id="${id}"]`);
    const card = page.locator(".gym-preview");
    const globalAccent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent"),
    );
    const away = async () => {
      await page.mouse.move(5, 5);
      await expect(card).toHaveCount(0);
    };
    const bounds = async () => {
      const b = await card.boundingBox();
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      assert.ok(
        b &&
          b.x >= 0 &&
          b.y >= 0 &&
          b.x + b.width <= viewport.width + 1 &&
          b.y + b.height <= viewport.height + 1,
        "preview stays within viewport",
      );
      return b;
    };
    const open = async (trigger, id) => {
      await trigger.hover();
      await expect(card).toHaveAttribute("data-gym-id", id);
      await expect(card).toHaveCount(1);
      await bounds();
    };
    await away();
    await page.evaluate(() => {
      window.__hoverTimings = [];
      document.addEventListener(
        "mouseover",
        (event) => {
          if (event.target.closest(".gym-item") && !window.__hoverStart)
            window.__hoverStart = performance.now();
        },
      );
      new MutationObserver(() => {
        if (
          document.querySelector(".gym-preview") &&
          window.__hoverStart &&
          !window.__hoverTimings.length
        )
          window.__hoverTimings.push(performance.now() - window.__hoverStart);
      }).observe(document.body, { childList: true, subtree: true });
    });
    await open(list("hover-a"), "hover-a");
    const elapsed = await page.evaluate(() => window.__hoverTimings[0]);
    assert.ok(
      elapsed >= 150 && elapsed <= 250,
      `hover delay ${elapsed}ms outside 150–250ms`,
    );
    await expect(card).toContainText("成都主题场馆");
    await expect(card).toContainText("武侯区");
    await expect(card).toContainText("已去过");
    await expect(card).toContainText("88");
    await expect(card).toContainText("1 款器械");
    await expect(card.locator(".image-placeholder")).toContainText(
      "照片读取失败",
    );
    assert.equal(
      (
        await card.evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--gym-accent"),
        )
      ).trim(),
      "#c34279",
    );
    await expect(marker("hover-a")).toHaveClass(/is-hovered/);
    await expect(list("hover-a")).toHaveClass(/is-hovered/);
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--accent"),
      ),
      globalAccent,
    );
    await card.hover();
    await page.waitForTimeout(300);
    await expect(card).toBeVisible();
    await page.screenshot({ path: path.join(out, "list-preview.png") });
    await away();
    checks.push(
      "list delay 150–250ms, correct summary, theme color, broken image fallback, list-to-card persistence, leave close, paired highlight",
    );
    for (const source of ["list", "marker"]) {
      const trigger = source === "list" ? list("hover-b") : marker("hover-b");
      await open(trigger, "hover-b");
      await expect(list("hover-b")).toHaveClass(/is-hovered/);
      await expect(marker("hover-b")).toHaveClass(/is-hovered/);
      const accent = (
        await card.evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--gym-accent"),
        )
      ).trim();
      assert.ok(
        accent && accent !== "#c34279",
        "legacy gym has default accent",
      );
      if (source === "marker") {
        const b = await bounds(),
          m = await marker("hover-b").boundingBox();
        assert.ok(
          b.x + b.width <= m.x ||
            b.x >= m.x + m.width ||
            b.y + b.height <= m.y ||
            b.y >= m.y + m.height,
          "card does not cover marker",
        );
      }
      await card.hover();
      await page.waitForTimeout(300);
      await expect(card).toBeVisible();
      await card.click();
      await expect(page.locator(".detail-body h2")).toHaveText("北京旧版场馆");
      await page
        .getByRole("button", { name: "关闭健身房详情", exact: true })
        .click();
      await away();
      await (
        source === "list"
          ? list("hover-b").locator(".gym-open")
          : marker("hover-b")
      ).click();
      await expect(page.locator(".detail-body h2")).toHaveText("北京旧版场馆");
      await page
        .getByRole("button", { name: "关闭健身房详情", exact: true })
        .click();
      await away();
      checks.push(
        `${source}: paired highlight, persistence, preview and trigger clicks, default accent`,
      );
    }
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("desktop:call");
      global.__hoverCalls = [];
      ipcMain.removeHandler("desktop:call");
      ipcMain.handle("desktop:call", (event, method, payload) => {
        global.__hoverCalls.push(method);
        return original(event, method, payload);
      });
    });
    await page.evaluate(() => {
      window.__maxPreviewCount = 0;
      new MutationObserver(() => {
        window.__maxPreviewCount = Math.max(
          window.__maxPreviewCount,
          document.querySelectorAll(".gym-preview").length,
        );
      }).observe(document.body, { childList: true, subtree: true });
    });
    for (let i = 0; i < 12; i++) {
      await list(fixtures[i % 3].id).hover();
      await page.waitForTimeout(i % 4 === 0 ? 230 : 30);
    }
    await page.getByRole("button", { name: "回到全球", exact: true }).click();
    await page.waitForTimeout(500);
    for (let i = 0; i < 6; i++) {
      await list("hover-b").hover();
      await page.waitForTimeout(30);
      await marker("hover-c").hover();
      await page.waitForTimeout(30);
    }
    await open(list("hover-c"), "hover-c");
    assert.equal(await page.evaluate(() => window.__maxPreviewCount), 1);
    assert.deepEqual(
      await app.evaluate(() => global.__hoverCalls),
      [],
      "hover does not request data",
    );
    await away();
    checks.push("rapid changes keep one card and issue zero desktop calls");
    // Real Leaflet dragging places a marker near each map edge; no DOM relocation.
    for (const corner of [
      "top-right",
      "bottom-right",
      "top-left",
      "bottom-left",
    ]) {
      await away();
      await page.getByRole("button", { name: "回到全球", exact: true }).click();
      await page.waitForTimeout(500);
      const map = await page.locator('[data-testid="map"]').boundingBox();
      const m = await marker("hover-b").boundingBox();
      const destination = {
        x: corner.endsWith("right") ? map.x + map.width - 100 : map.x + 70,
        y: corner.startsWith("bottom") ? map.y + map.height - 125 : map.y + 140,
      };
      const delta = {
        x: destination.x - (m.x + m.width / 2),
        y: destination.y - (m.y + m.height / 2),
      };
      const start = {
        x: delta.x > 0 ? map.x + 120 : map.x + map.width - 140,
        y: delta.y > 0 ? map.y + 160 : map.y + map.height - 130,
      };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + delta.x, start.y + delta.y, {
        // One move avoids synthetic high-speed inertia differing across runners.
        steps: 1,
      });
      await page.waitForTimeout(200);
      await page.mouse.up();
      await page.waitForTimeout(300);
      await open(marker("hover-b"), "hover-b");
      const b = await bounds(),
        target = await marker("hover-b").boundingBox();
      assert.ok(
        b.x + b.width <= target.x ||
          b.x >= target.x + target.width ||
          b.y + b.height <= target.y ||
          b.y >= target.y + target.height,
        `${corner} marker remains unobscured`,
      );
      await card.hover();
      await page.waitForTimeout(300);
      await expect(card).toBeVisible();
      await page.screenshot({ path: path.join(out, `${corner}.png`) });
    }
    checks.push(
      "all four map edges keep card inside window and marker unobscured, mouse can enter card",
    );
    await away();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 700),
    );
    await open(list("hover-a"), "hover-a");
    await bounds();
    await away();
    await page.getByRole("button", { name: "回到全球", exact: true }).click();
    await open(marker("hover-b"), "hover-b");
    await card.hover();
    // Programmatic wheel events keep the pointer over the preview while moving the map.
    await page.locator('[data-testid="map"]').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      for (let i = 0; i < 8; i++)
        el.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            deltaY: -600,
            clientX: rect.left + 40,
            clientY: rect.top + 40,
          }),
        );
    });
    await expect(card).toHaveCount(0, { timeout: 5000 });
    checks.push(
      "window bounds after resize; map viewport change closes preview",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "result.json"),
      JSON.stringify(
        { passed: true, checks, hoverDelayMs: elapsed, errors },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ passed: true, checks, hoverDelayMs: elapsed }, null, 2),
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(out, "result.json"),
      JSON.stringify(
        { passed: false, checks, errors, error: error.stack },
        null,
        2,
      ),
    );
    if (app)
      await (
        await app.firstWindow()
      )
        .screenshot({ path: path.join(out, "failure.png") })
        .catch(() => {});
    throw error;
  } finally {
    if (app) await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
