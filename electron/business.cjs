const { dialog, app, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { atomic } = require("./storage.cjs");
const catalog = require("./catalog.cjs");
function createHandlers(store, getWindow) {
  const publicRelease = require('./public-release.cjs');
  const shared = require('./shared-catalog.cjs');
  let pending = null;
  const pick = async (title, filters) => {
    if (process.env.GYM_TEST_OPEN_FILE) return process.env.GYM_TEST_OPEN_FILE;
    const r = await dialog.showOpenDialog(getWindow(), {
      title,
      filters,
      properties: ["openFile"],
    });
    return r.canceled ? null : r.filePaths[0];
  };
  const web = require("./web-import.cjs").createWebImporter(store, getWindow);
  const batch = require("./batch-import.cjs").createBatchImporter(store, web);
  const captureOpen = async ({brandId}) => {
    const file = await pick('选择浏览器采集文件', [{name:'浏览器采集文件', extensions:['json']}]);
    if (!file) return null;
    if (fs.statSync(file).size > 64 * 1024 ** 2) throw new Error('采集文件过大，请分批导入。');
    return web.capturePreview({brandId, bundle: JSON.parse(fs.readFileSync(file, 'utf8'))});
  };
  return {
    ...shared.createSharedCatalog(store, publicRelease.fetchPublicBytes),
    sharedStatus: () => ({ url: store.db?.settings?.sharedCatalogUrl || publicRelease.DEFAULT_SHARED_URL, defaultUrl: publicRelease.DEFAULT_SHARED_URL, issuesUrl: `${publicRelease.PUBLIC_REPOSITORY}/issues/new/choose`, lastSyncedAt: store.db?.settings?.sharedLastSyncedAt || null }),
    sharedSaveSettings: ({url}) => { store.require(); publicRelease.validatePublicUrl(url); const next=structuredClone(store.db); next.settings.sharedCatalogUrl=url; store.save(next); return true; },
    sharedExport: async ({includeImages=false}={}) => {
      store.require();
      const result=await dialog.showOpenDialog(getWindow(),{title:'选择共享库导出目录',properties:['openDirectory','createDirectory']});
      if(result.canceled || !result.filePaths[0])return null;
      return shared.exportShared(store,{destination:result.filePaths[0],includeImages});
    },
    ...web,
    ...batch,
    captureOpen,
    captureHelp: async () => {
      const folder = app.isPackaged ? path.join(process.resourcesPath, 'browser-capture') : path.join(app.getAppPath(), 'browser-capture');
      const error = await shell.openPath(folder);
      if (error) throw new Error(error);
      return true;
    },
    batchCapture: async ({brandId}) => {
      const capture = await captureOpen({brandId});
      if (!capture) return null;
      return batch.batchScan({brandId, url: capture.productUrl || capture.products[0].url, capture});
    },
    ...require("./pdf-import.cjs").createPdfImporter(store, getWindow),
    saveGym: (row) => catalog.upsert(store, "gyms", row),
    saveEquipment: async (row) => {
      const root = store.root;
      const fingerprint = JSON.stringify(store.db);
      let created = "";
      try {
        if (row.pendingWebImage && row.imageSource) {
          const result = await web.productImage(row);
          created = result.image || "";
          if (!created) throw new Error(result.warning || "图片保存失败，请重试或取消选择网站图片。");
          row = {...row, image: created};
        }
        if (store.root !== root || JSON.stringify(store.db) !== fingerprint)
          throw new Error("数据已变化，请重新保存。");
        return catalog.upsert(store, "equipment", row);
      } catch (error) {
        if (created) fs.rmSync(path.join(root, created), {force: true});
        throw error;
      }
    },
    saveBrand: (row) => catalog.upsert(store, "brands", row),
    delete: (input) => catalog.remove(store, input),
    link: (input) => catalog.link(store, input),
    linkBatch: ({ gymId, rows }) => {
      store.require();
      if (!Array.isArray(rows) || !rows.length)
        throw new Error("请先选择器械。");
      const next = structuredClone(store.db);
      for (const input of rows) {
        const old = next.links.find(
          (l) => l.gymId === gymId && l.equipmentId === input.equipmentId,
        );
        const row = {
          ...input,
          gymId,
          id: old?.id || require("node:crypto").randomUUID(),
          quantity: Number(input.quantity),
          status: input.status || "正常",
          notes: input.notes || "",
        };
        next.links = next.links.filter((l) => l.id !== row.id);
        next.links.push(row);
      }
      store.save(next);
      return { count: rows.length };
    },
    unlink: (target) => catalog.unlink(store, target),
    uploadImage: async (category) => {
      store.require();
      const file = await pick("选择照片", [
        {
          name: "照片",
          extensions: ["jpg", "jpeg", "png", "webp", "gif", "avif", "avifs"],
        },
      ]);
      if (!file) return null;
      if (fs.statSync(file).size > 20 * 1024 ** 2)
        throw new Error("单张照片不能超过 20 兆字节。");
      return catalog.saveImage(store, fs.readFileSync(file), category);
    },
    previewImport: async (kind) => {
      store.require();
      const file = await pick("选择导入文件", [
        { name: "结构化数据", extensions: ["json"] },
      ]);
      if (!file) return null;
      if (fs.statSync(file).size > 30 * 1024 ** 2)
        throw new Error("导入文件不能超过 30 兆字节。");
      const bytes = fs.readFileSync(file);
      const raw = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
      pending = {
        ...catalog.prepareImport(store, { kind, raw }),
        sourceName: path.basename(file),
        sourceBytes: bytes,
      };
      return { ...pending, sourceBytes: undefined };
    },
    commitImport: (input) => {
      if (!pending) throw new Error("导入预览已过期，请重新选择文件。");
      const draft = { ...pending };
      if (draft.kind === "review") {
        const current = input?.targetId
          ? store.db.gyms.find((g) => g.id === input.targetId)
          : null;
        if (input?.targetId && !current) throw new Error("目标健身房不存在。");
        draft.rows = [
          {
            ...current,
            ...draft.rows[0],
            ...input?.row,
            id: current?.id || draft.rows[0].id,
          },
        ];
        if (current)
          draft.rows[0] = {
            ...draft.rows[0],
            visited: current.visited,
            visitDate: current.visitDate,
            lat: current.lat,
            lng: current.lng,
            cover: current.cover,
            photos: current.photos,
            tags: current.tags,
            address: current.address || draft.rows[0].address,
            province: current.province || draft.rows[0].province,
            district: current.district || draft.rows[0].district,
          };
      }
      const result = catalog.commitImport(store, draft);
      let archiveWarning = "";
      try {
        atomic(
          path.join(
            store.root,
            "imports",
            `${Date.now()}-${pending.sourceName.replace(/[^a-zA-Z0-9_.\u4e00-\u9fff-]/g, "_")}`,
          ),
          pending.sourceBytes,
        );
      } catch (e) {
        archiveWarning = `导入已保存，但原文件归档失败：${e.message}。原始测评内容已随档案保存。`;
      }
      pending = null;
      return { ...result, archiveWarning };
    },
    export: async (kind) => {
      store.require();
      if (!["gyms", "equipment", "all"].includes(kind))
        throw new Error("导出类型无效。");
      const r = await dialog.showSaveDialog(getWindow(), {
        title: "导出数据",
        defaultPath: path.join(
          store.root,
          "exports",
          `${kind}-${Date.now()}.json`,
        ),
        filters: [{ name: "结构化数据", extensions: ["json"] }],
      });
      if (r.canceled) return null;
      const db = store.db;
      const data =
        kind === "all"
          ? db
          : {
              schemaVersion: db.schemaVersion,
              [kind]: db[kind],
              brands: db.brands,
              links: db.links,
            };
      atomic(r.filePath, JSON.stringify(data, null, 2));
      return r.filePath;
    },
    exportReview: async (target) => {
      store.require();
      const row = store.db.gyms.find((g) => g.id === target);
      if (!row?.rawReview) throw new Error("此档案没有原始测评数据。");
      const r = await dialog.showSaveDialog(getWindow(), {
        title: "导出原始测评",
        defaultPath: `review-${target}.json`,
        filters: [{ name: "结构化数据", extensions: ["json"] }],
      });
      if (r.canceled) return null;
      atomic(r.filePath, JSON.stringify(row.rawReview, null, 2));
      return r.filePath;
    },
    saveSettings: (input) => {
      const next = structuredClone(store.db);
      if (input.updateFeed) {
        const url = new URL(input.updateFeed);
        if (url.protocol !== "https:")
          throw new Error("更新源必须使用加密网页地址。");
      }
      next.settings = { ...next.settings, ...input };
      store.save(next);
      return next.settings;
    },
  };
}
function configureUpdater(store, getWindow) {
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  let downloaded = false;
  let available = false;
  let state = { phase: "idle", message: "尚未检查更新" };
  autoUpdater.on("error", (e) => {
    state = { phase: "error", message: e.message };
  });
  autoUpdater.on("download-progress", (p) => {
    state = {
      phase: "downloading",
      message: `正在下载 ${Math.round(p.percent)}%`,
    };
  });
  autoUpdater.on("update-downloaded", () => {
    downloaded = true;
    state = { phase: "downloaded", message: "更新已下载，安装前将自动备份。" };
  });
  return {
    updateStatus: () => state,
    checkUpdate: async () => {
      store.require();
      const feed = store.db.settings.updateFeed || require('./public-release.cjs').DEFAULT_UPDATE_FEED;
      if (!feed)
        return (state = {
          phase: "unconfigured",
          message:
            "尚未配置更新发布源。可安装新版安装包升级，用户数据独立保留。",
        });
      if (!app.isPackaged) throw new Error("请在已安装的正式程序中检查更新。");
      autoUpdater.setFeedURL({ provider: "generic", url: feed });
      state = { phase: "checking", message: "正在检查更新" };
      const result = await autoUpdater.checkForUpdates();
      available = !!result?.isUpdateAvailable;
      return (state = {
        phase: available ? "available" : "current",
        message: available
          ? `发现版本 ${result.updateInfo.version}`
          : "当前已是最新版本",
      });
    },
    downloadUpdate: async () => {
      if (!available) throw new Error("请先检查可用更新。");
      await autoUpdater.downloadUpdate();
      return state;
    },
    installUpdate: async () => {
      if (!downloaded) throw new Error("更新尚未下载完成。");
      const result = await dialog.showMessageBox(getWindow(), {
        type: "question",
        buttons: ["备份并安装", "取消"],
        defaultId: 1,
        cancelId: 1,
        message: "安装更新将关闭程序，是否继续？",
      });
      if (result.response !== 0) return null;
      await store.backup();
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return true;
    },
  };
}
module.exports = { createHandlers, configureUpdater };
