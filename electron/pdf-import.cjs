const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("node:worker_threads");

const MAX_BYTES = 80 * 1024 ** 2;
const MAX_PAGES = 1000;
const SESSION_MS = 30 * 60 * 1000;

// Parsing and native canvas work are isolated so timeout/cancel can release them.
async function processDocument({ file, page }) {
  const canvas = require("@napi-rs/canvas");
  globalThis.DOMMatrix ||= canvas.DOMMatrix;
  globalThis.ImageData ||= canvas.ImageData;
  globalThis.Path2D ||= canvas.Path2D;
  const base = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const pdfjs = await import(
    pathToFileURL(path.join(base, "legacy/build/pdf.mjs")).href
  );
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES)
    throw new Error("文件必须小于 80 兆字节。");
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
    throw new Error("文件不是有效的便携式文档格式。");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    stopAtErrors: true,
    maxImageSize: 24 * 1024 * 1024,
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
    standardFontDataUrl: path.join(base, "standard_fonts").replaceAll("\\", "/") + "/",
    cMapUrl: path.join(base, "cmaps").replaceAll("\\", "/") + "/",
    cMapPacked: true,
    wasmUrl: path.join(base, "wasm").replaceAll("\\", "/") + "/",
  });
  try {
    const doc = await loading.promise;
    if (doc.numPages > MAX_PAGES)
      throw new Error("文档超过 1000 页，请先拆分文件。");
    if (page == null) return { pageCount: doc.numPages };
    if (!Number.isInteger(page) || page < 1 || page > doc.numPages)
      throw new Error("所选页码超出文档范围。");
    const selected = await doc.getPage(page);
    const content = await selected.getTextContent();
    let line = "";
    const lines = [];
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      line += (line ? " " : "") + item.str;
      if (item.hasEOL) {
        lines.push(line.trim());
        line = "";
      }
    }
    if (line) lines.push(line.trim());
    const text = lines.filter(Boolean).join("\n").slice(0, 12000);
    const original = selected.getViewport({ scale: 1 });
    if (
      !Number.isFinite(original.width + original.height) ||
      original.width <= 0 ||
      original.height <= 0
    )
      throw new Error("该页面尺寸无效。");
    const viewport = selected.getViewport({
      scale: Math.min(2, 1600 / Math.max(original.width, original.height)),
    });
    const surface = canvas.createCanvas(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    await selected.render({
      canvasContext: surface.getContext("2d"),
      viewport,
      background: "white",
    }).promise;
    const png = surface.toBuffer("image/png");
    selected.cleanup();
    // Titles in catalogues are ambiguous: always require the user to enter the product name.
    return { text, png };
  } finally {
    await loading.destroy();
  }
}

if (!isMainThread && workerData?.gymPdfImport) {
  processDocument(workerData).then(
    (result) => parentPort.postMessage({ result }),
    (error) =>
      parentPort.postMessage({
        error:
          error.name === "PasswordException"
            ? "文档有密码保护，请先使用阅读器解锁并保存副本。"
            : `文档读取失败：${error.message}`,
      }),
  );
}

function createPdfImporter(store, getWindow) {
  let session = null;
  let active = null;
  let owner = null;
  let generation = 0;
  const cancel = () => {
    generation++;
    active?.(new Error("文档导入已取消。"));
    session = null;
  };
  function run(file, page) {
    if (active) throw new Error("文档正在读取，请稍候再操作。");
    return new Promise((resolve, reject) => {
      const workerFile = __filename.replace(
        /app\.asar([\\/])/,
        "app.asar.unpacked$1",
      );
      const worker = new Worker(workerFile, {
        workerData: { gymPdfImport: true, file, page },
        resourceLimits: { maxOldGenerationSizeMb: 384 },
      });
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        active = null;
        void worker.terminate();
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(
        () => finish(new Error("文档读取超时，请拆分文档或选择较小文件。")),
        45000,
      );
      active = (error) => finish(error);
      worker.once("message", (message) =>
        finish(message.error ? new Error(message.error) : null, message.result),
      );
      worker.once("error", (error) => finish(error));
      worker.once("exit", () =>
        finish(new Error("文档处理进程提前退出，请尝试较小文件。")),
      );
    });
  }
  return {
    async pdfOpen() {
      store.require();
      const stamp = generation;
      if (active) throw new Error("文档正在读取，请稍候再操作。");
      const window = getWindow();
      if (owner !== window) {
        owner = window;
        window?.once("closed", cancel);
      }
      let file = process.env.GYM_TEST_OPEN_FILE;
      if (!file) {
        const result = await require("electron").dialog.showOpenDialog(window, {
          title: "选择器械目录文档",
          filters: [
            {
              name: "PDF（Portable Document Format，便携式文档格式）",
              extensions: ["pdf"],
            },
          ],
          properties: ["openFile"],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        file = result.filePaths[0];
      }
      if (stamp !== generation) throw new Error("文档导入已取消。");
      session = null;
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_BYTES)
        throw new Error("文件必须小于 80 兆字节。");
      const { pageCount } = await run(file);
      if (stamp !== generation) throw new Error("文档导入已取消。");
      session = {
        token: crypto.randomUUID(),
        file,
        pageCount,
        size: stat.size,
        modified: stat.mtimeMs,
        root: store.root,
        expires: Date.now() + SESSION_MS,
      };
      return { token: session.token, pageCount, fileName: path.basename(file) };
    },
    async pdfPage({ token, page, brandId } = {}) {
      store.require();
      const selected = session;
      if (
        !selected ||
        selected.token !== token ||
        selected.root !== store.root ||
        Date.now() > selected.expires
      )
        throw new Error("文档选择已过期，请重新打开文件。");
      if (!store.db.brands.some((brand) => brand.id === brandId))
        throw new Error("请先选择品牌。");
      const number = Number(page);
      if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > selected.pageCount
      )
        throw new Error("请选择有效页码。");
      const stat = fs.statSync(selected.file);
      if (stat.size !== selected.size || stat.mtimeMs !== selected.modified)
        throw new Error("文档已更改，请重新选择文件。");
      const result = await run(selected.file, number);
      if (session !== selected || store.root !== selected.root)
        throw new Error("导入已取消或资料库已切换，请重新打开文件。");
      const image = require("./catalog.cjs").saveImage(
        store,
        Buffer.from(result.png),
        "equipment",
      );
      selected.expires = Date.now() + SESSION_MS;
      return {
        name: "",
        model: "",
        image,
        brandId,
        imageSource: "",
        sourceType: "official_pdf",
        sourceDate: new Date().toISOString(),
        verificationStatus: "needs_review",
        productUrl: "",
        notes:
          `来源：${path.basename(selected.file)}，第 ${number} 页\n${result.text}`.trim(),
        warning: result.text
          ? "已提取选定页文字及整页图片。请填写器械名称，核对是否仅含一款器械；可替换为裁剪后的产品照片。"
          : "此页没有可提取的文字，已生成整页图片。请手动填写器械名称与型号；可替换为裁剪后的产品照片。",
      };
    },
    pdfCancel() {
      cancel();
      return { canceled: true };
    },
  };
}

module.exports = { createPdfImporter };
