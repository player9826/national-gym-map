const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gym-batch-live-"));
  const report = {
    date: new Date().toISOString(),
    brand: "Booty Builder",
    url: "https://bootybuilder.com/product-category/machines/",
    temp,
    products: [],
  };
  let app;
  try {
    app = await electron.launch({
      args: ["."],
      env: {
        ...process.env,
        GYM_TEST_PROFILE: path.join(temp, "profile"),
        GYM_TEST_PICK_DIRECTORY: path.join(temp, "data"),
      },
    });
    const page = await app.firstWindow();
    const call = (method, payload) =>
      page.evaluate(
        ({ method, payload }) => window.desktop.call(method, payload),
        { method, payload },
      );
    await call("configure");
    const brand = await call("saveBrand", { name: report.brand });
    let batch = await call("batchScan", { brandId: brand.id, url: report.url });
    report.batchId = batch.id;
    report.found = batch.candidates.length;
    if (batch.error) throw new Error(JSON.stringify(batch.error));
    for (const candidate of batch.candidates) {
      batch = await call("batchFetch", {
        id: batch.id,
        candidateId: candidate.id,
      });
      const row = batch.candidates.find((c) => c.id === candidate.id);
      report.products.push({
        name: row.name,
        url: row.sourceUrl,
        model: row.model,
        status: row.status,
        detailFetched: row.detailFetched,
        error: row.error,
        thumbnail: !!row.thumbnail,
        duplicate: row.duplicate.kind,
      });
      console.log(
        `${report.products.length}/${report.found} ${row.name}: ${row.error?.status || row.status}`,
      );
    }
    report.success = report.products.filter(
      (p) => p.detailFetched && !p.error,
    ).length;
    report.failed = report.found - report.success;
    report.duplicates = report.products.filter(
      (p) => p.duplicate !== "new",
    ).length;
    report.formalRecords = (await call("state")).equipment.length;
    report.classificationNeedsReview = report.products.filter(
      (p) => p.status === "incomplete",
    ).length;
  } catch (e) {
    report.error = e.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(
      "test-results/batch-live.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify({ ...report, products: undefined }, null, 2));
  }
})();
