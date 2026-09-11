const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { Store, inside } = require("./storage.cjs");
const { createHandlers, configureUpdater } = require("./business.cjs");
if (process.env.GYM_TEST_PROFILE)
  app.setPath("userData", process.env.GYM_TEST_PROFILE);
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "gymasset",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let win,
  store,
  activeOperations = 0;
function chooseDirectory() {
  if (process.env.GYM_TEST_PICK_DIRECTORY)
    return Promise.resolve(process.env.GYM_TEST_PICK_DIRECTORY);
  return dialog
    .showOpenDialog(win, {
      title: "选择用户数据根目录",
      properties: ["openDirectory", "createDirectory"],
    })
    .then((r) => (r.canceled ? null : r.filePaths[0]));
}
const handlers = {
  status: () => ({
    ...store.status(),
    version: app.getVersion(),
    packaged: app.isPackaged,
  }),
  state: () => {
    store.require();
    return store.db;
  },
  configure: async () => {
    const dir = await chooseDirectory();
    if (!dir) return null;
    if (
      inside(path.dirname(app.getPath("exe")), dir) ||
      inside(app.getAppPath(), dir)
    )
      throw new Error("用户数据不能保存在程序安装目录内。");
    return store.configure(dir);
  },
  migrate: async () => {
    const dir = await chooseDirectory();
    if (!dir) return null;
    if (
      inside(path.dirname(app.getPath("exe")), dir) ||
      inside(app.getAppPath(), dir)
    )
      throw new Error("用户数据不能保存在程序安装目录内。");
    const r = process.env.GYM_TEST_CONFIRM
      ? { response: 0 }
      : await dialog.showMessageBox(win, {
          type: "question",
          buttons: ["确认复制并迁移", "取消"],
          defaultId: 1,
          cancelId: 1,
          message: "将完整复制并校验全部数据后切换目录。旧目录会保留。",
          detail: `旧目录：${store.root}\n新目录：${dir}`,
        });
    return r.response === 0 ? store.migrate(dir) : null;
  },
  reconnect: async () => {
    const dir = await chooseDirectory();
    return dir ? store.reconnect(dir) : null;
  },
  backup: () => store.backup(),
  restore: async () => {
    const r = process.env.GYM_TEST_RESTORE_FILE
      ? { filePaths: [process.env.GYM_TEST_RESTORE_FILE] }
      : await dialog.showOpenDialog(win, {
          title: "选择备份恢复",
          filters: [{ name: "备份文件", extensions: ["zip"] }],
          properties: ["openFile"],
        });
    if (!r.filePaths?.[0]) return null;
    const confirm = process.env.GYM_TEST_CONFIRM
      ? { response: 0 }
      : await dialog.showMessageBox(win, {
          type: "warning",
          buttons: ["备份当前数据并恢复", "取消"],
          defaultId: 1,
          cancelId: 1,
          message: "恢复将替换当前数据，恢复前会自动备份当前有效数据。",
        });
    return confirm.response === 0 ? store.restore(r.filePaths[0]) : null;
  },
  openData: async () => {
    if (!store.root) throw new Error("尚未设置数据目录。");
    const error = await shell.openPath(store.root);
    if (error) throw new Error(error);
    return true;
  },
  external: async (url) => {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol))
      throw new Error("只允许打开网页链接。");
    await shell.openExternal(u.toString());
    return true;
  },
};
app.whenReady().then(async () => {
  if (!ownsInstance) return;
  store = new Store(path.join(app.getPath("userData"), "location.json"));
  if (store.db && store.db.appVersion !== app.getVersion()) {
    try {
      await store.backup();
      const next = structuredClone(store.db);
      next.appVersion = app.getVersion();
      store.save(next);
    } catch (e) {
      store.error = `升级前备份失败：${e.message}`;
      store.db = null;
    }
  }
  Object.assign(
    handlers,
    createHandlers(store, () => win),
    configureUpdater(store, () => win),
  );
  protocol.handle("gymasset", (request) => {
    try {
      const u = new URL(request.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\//, "");
      if (
        u.host !== "local" ||
        !/^(equipment|gyms)\/[a-zA-Z0-9_.-]+$/.test(rel) ||
        !store.root
      )
        return new Response("Forbidden", { status: 403 });
      return net.fetch(pathToFileURL(path.join(store.root, rel)).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  ipcMain.handle("desktop:call", async (event, method, payload) => {
    let acquired = false;
    try {
      if (event.sender !== win.webContents || !Object.hasOwn(handlers, method))
        throw new Error("不支持的操作。");
      if (
        ![
          "status",
          "state",
          "updateStatus",
          "browserClose",
          "pdfCancel",
        ].includes(method)
      ) {
        if (activeOperations)
          throw new Error("另一项数据操作正在进行，请稍后重试。");
        activeOperations++;
        acquired = true;
      }
      return { ok: true, value: await handlers[method](payload) };
    } catch (e) {
      return {
        ok: false,
        error: `操作失败${store.root ? `\n数据目录：${store.root}` : ""}\n原因：${e.message}`,
      };
    } finally {
      if (acquired) activeOperations--;
    }
  });
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 820,
    minHeight: 620,
    backgroundColor: "#f6f8f8",
    title: "全国健身房地图",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "icon.ico")
      : path.join(__dirname, "../build/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.loadFile(path.join(__dirname, "../dist/index.html"));
  win.on("close", (event) => {
    if (activeOperations) {
      event.preventDefault();
      dialog.showMessageBox(win, {
        message: "正在保存或处理数据，请完成后再关闭程序。",
        buttons: ["知道了"],
      });
      return;
    }
    if (store?.db) {
      try {
        const next = structuredClone(store.db);
        next.metadata.lastClosedAt = new Date().toISOString();
        store.save(next);
      } catch (e) {
        dialog.showErrorBox("关闭前保存失败", e.message);
      }
    }
  });
});
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
app.on("window-all-closed", () => app.quit());
process.on("uncaughtException", (error) => {
  dialog.showErrorBox("全国健身房地图发生错误", error.message);
});
module.exports = { handlers, getStore: () => store };
