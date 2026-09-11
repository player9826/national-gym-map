const { _electron: electron, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Small deterministic test documents; no authoring tool/runtime is shipped with the app.
function fixture(scanned = false) {
  const stream = (s) =>
    `<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    stream(
      scanned
        ? "0.1 0.4 0.8 rg 50 50 250 150 re f"
        : "BT /F1 24 Tf 40 220 Td (CHEST PRESS PAGE ONE) Tj ET",
    ),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    stream(
      scanned
        ? "0.8 0.2 0.1 rg 70 70 200 120 re f"
        : "BT /F1 24 Tf 40 220 Td (ABDOMINAL PAGE TWO) Tj ET",
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  if (scanned) {
    const canvas = require("@napi-rs/canvas").createCanvas(400, 300);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 400, 300);
    context.fillStyle = "#185ca0";
    context.fillRect(50, 50, 300, 150);
    context.fillStyle = "white";
    context.font = "24px sans-serif";
    context.fillText("SCANNED MACHINE", 70, 130);
    const hex = canvas.toBuffer("image/jpeg").toString("hex") + ">";
    bodies.push(
      `<< /Type /XObject /Subtype /Image /Width 400 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${hex.length} >>\nstream\n${hex}\nendstream`,
    );
    for (const index of [2, 4])
      bodies[index] = bodies[index].replace(
        "/Font << /F1 7 0 R >>",
        "/XObject << /Im1 8 0 R >>",
      );
    bodies[3] = bodies[5] = stream("q 400 0 0 300 0 0 cm /Im1 Do Q");
  }
  let value = "%PDF-1.4\n";
  const offsets = [0];
  bodies.forEach((body, i) => {
    offsets.push(Buffer.byteLength(value));
    value += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const start = Buffer.byteLength(value);
  value += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    value += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  value += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(value);
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-pdf-test-"));
  const out = path.resolve(
    process.env.GYM_INSTALLED_EXE
      ? "test-results/pdf-installed"
      : "test-results/pdf",
  );
  fs.mkdirSync(out, { recursive: true });
  const textFile = path.join(temp, "catalog.pdf"),
    scanFile = path.join(temp, "scan.pdf"),
    invalidFile = path.join(temp, "invalid.pdf");
  fs.writeFileSync(textFile, fixture());
  fs.writeFileSync(scanFile, fixture(true));
  fs.writeFileSync(invalidFile, "not a document");
  const data = path.join(temp, "data");
  const checks = [];
  let app;
  try {
    app = await electron.launch({
      ...(process.env.GYM_INSTALLED_EXE
        ? { executablePath: process.env.GYM_INSTALLED_EXE, args: [] }
        : { args: ["."] }),
      env: {
        ...process.env,
        GYM_TEST_PROFILE: path.join(temp, "profile"),
        GYM_TEST_PICK_DIRECTORY: data,
      },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const call = (method, payload) =>
      page.evaluate(
        ({ method, payload }) => window.desktop.call(method, payload),
        { method, payload },
      );
    await call("configure");
    const state = await call("state");
    const brandId = state.brands[0].id;
    const choose = (file) =>
      app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: !file,
          filePaths: file ? [file] : [],
        });
      }, file);
    await choose(null);
    assert.equal(await call("pdfOpen"), null);
    checks.push("file dialog cancellation returns null");
    await choose(textFile);
    let opened = await call("pdfOpen");
    assert.equal(opened.pageCount, 2);
    const preview = await call("pdfPage", {
      token: opened.token,
      page: 2,
      brandId,
    });
    assert.match(preview.notes, /ABDOMINAL PAGE TWO/);
    assert.doesNotMatch(preview.notes, /CHEST PRESS/);
    assert.equal(preview.name, "");
    const rendered = fs.readFileSync(path.join(data, preview.image));
    assert.equal(rendered.subarray(1, 4).toString(), "PNG");
    fs.copyFileSync(
      path.join(data, preview.image),
      path.join(out, "text-page.png"),
    );
    checks.push("selected page text only, editable name, real page image");
    await assert.rejects(
      call("pdfPage", { token: opened.token, page: 3, brandId }),
      /页码/,
    );
    await assert.rejects(
      call("pdfPage", { token: "wrong", page: 1, brandId }),
      /过期/,
    );
    await assert.rejects(
      call("pdfPage", { token: opened.token, page: 1, brandId: "wrong" }),
      /品牌/,
    );
    checks.push("invalid page, token and brand rejected");
    await call("pdfCancel");
    await assert.rejects(
      call("pdfPage", { token: opened.token, page: 1, brandId }),
      /过期/,
    );
    checks.push("cancel invalidates document session");
    await choose(scanFile);
    opened = await call("pdfOpen");
    const scan = await call("pdfPage", {
      token: opened.token,
      page: 1,
      brandId,
    });
    assert.match(scan.warning, /没有可提取/);
    assert.equal(scan.name, "");
    fs.copyFileSync(
      path.join(data, scan.image),
      path.join(out, "scan-page.png"),
    );
    checks.push("image-only page renders with manual-entry warning");
    fs.appendFileSync(scanFile, "\n");
    await assert.rejects(
      call("pdfPage", { token: opened.token, page: 1, brandId }),
      /更改/,
    );
    checks.push("changed document rejected");
    await choose(invalidFile);
    await assert.rejects(call("pdfOpen"), /不是有效/);
    checks.push("non-document rejected");
    await choose(textFile);
    const canceled = await page.evaluate(async () => {
      const pending = window.desktop.call("pdfOpen").then(
        () => "unexpected success",
        (e) => e.message,
      );
      await window.desktop.call("pdfCancel");
      return pending;
    });
    assert.match(canceled, /取消/);
    opened = await call("pdfOpen");
    assert.equal(opened.pageCount, 2);
    checks.push(
      "in-flight cancellation terminates worker and allows reopening",
    );
    await call("pdfCancel");
    await page.reload();
    await page.getByRole("button", { name: "器械库", exact: true }).click();
    await page.getByRole("button", { name: "官网导入", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "官网导入器械" });
    await dialog
      .getByLabel("品牌", { exact: false })
      .first()
      .selectOption(brandId);
    await choose(textFile);
    await dialog.getByRole("button", { name: /^选择 PDF/ }).click();
    await dialog.getByLabel("页码（共 2 页）").fill("2");
    await dialog
      .getByRole("button", { name: "读取所选页", exact: true })
      .click();
    await expect(page.locator("#equipment-form textarea")).toHaveValue(
      /ABDOMINAL PAGE TWO/,
      { timeout: 15000 },
    );
    await expect(dialog.locator(".photo-thumb img")).toBeVisible();
    assert.equal((await call("state")).equipment.length, 0);
    await dialog
      .getByLabel("器械名称", { exact: false })
      .fill("文档导入腹肌器");
    await expect(dialog.getByLabel("器械类型", { exact: true })).toHaveValue("");
    await dialog.getByLabel("器械类型", { exact: true }).selectOption("fixed");
    await dialog.getByLabel("核心", { exact: true }).check();
    await dialog.getByLabel("脊柱屈", { exact: true }).check();
    await dialog.getByRole("button", { name: "保存器械", exact: true }).click();
    await expect(page.locator(".equipment-detail")).toBeVisible();
    const saved = (await call("state")).equipment.find(
      (row) => row.name === "文档导入腹肌器",
    );
    assert.match(saved.notes, /ABDOMINAL PAGE TWO/);
    assert.ok(saved.image);
    checks.push(
      "document UI chooses page, previews text/photo, requires name and saves confirmed equipment",
    );
    const report = {
      passed: checks.length,
      checks,
      packaged: (await call("status")).packaged,
      fixtureDirectory: temp,
    };
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (app) await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
