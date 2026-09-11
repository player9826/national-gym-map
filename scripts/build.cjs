const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const toolRoot = path.join(root, ".build-tools");
const seven = require("7zip-bin").path7za;
function run(executable, args, env = process.env) {
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `构建步骤失败：${path.basename(executable)}，退出代码 ${result.status}`,
    );
}
async function tool(name, checksum, marker) {
  const dest = path.join(toolRoot, name);
  if (fs.existsSync(path.join(dest, marker))) return dest;
  fs.mkdirSync(toolRoot, { recursive: true });
  const archive = path.join(toolRoot, `${name}.7z`);
  if (
    !fs.existsSync(archive) ||
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(archive))
      .digest("hex") !== checksum
  ) {
    const urls = [`https://github.com/electron-userland/electron-builder-binaries/releases/download/${name}/${name}.7z`, `https://npmmirror.com/mirrors/electron-builder-binaries/${name}/${name}.7z`];
    let lastError;
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`安装器组件下载失败：${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error(`安装器组件校验失败：${name}`);
        fs.writeFileSync(archive, bytes); lastError=null;break;
      } catch(error){lastError=error;}
    }
    if(lastError)throw lastError;
  }
  run(seven, ["x", archive, `-o${dest}`, "-y"]);
  return dest;
}
async function main() {
  if (process.platform !== "win32")
    throw new Error("请在 Windows 上构建正式安装包。");
  const nsis = await tool(
    "nsis-3.0.4.1",
    "9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa",
    "Bin/makensis.exe",
  );
  const resources = await tool(
    "nsis-resources-3.4.1",
    "593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103",
    "plugins/x86-unicode/nsis7z.dll",
  );
  require("electron");
  // Keep user data while replacing binaries. The upstream --updated rename
  // transaction fails on this machine; ordinary retained-data uninstall works.
  const templates = path.join(root, "node_modules/app-builder-lib/templates/nsis");
  const originalUtil = fs.readFileSync(path.join(templates, "include/installUtil.nsh"), "utf8");
  const needle = "    ifErrors TryInPlace CheckResult";
  if (!originalUtil.includes(needle)) throw new Error("安装器模板已改变，请重新检查卸载回退处理。");
  const updatedFlag = 'StrCpy $0 "$0 --updated"';
  if (!originalUtil.includes(updatedFlag)) throw new Error("安装器升级模板已改变。");
  const patchedUtil = originalUtil.replace(needle, "    ifErrors TryInPlace\n    StrCmp $R0 2 TryInPlace CheckResult").replace(updatedFlag, 'StrCpy $0 "$0"');
  const utilFile = path.join(templates, "include/installUtil.nsh");
  run(process.execPath, [
    path.join(root, "node_modules/vite/bin/vite.js"),
    "build",
  ]);
  fs.writeFileSync(utilFile, patchedUtil);
  try { run(
    process.execPath,
    [require.resolve("electron-builder/cli.js"), "--win", "nsis", "--x64", "--publish", "never", ...(process.argv.includes("--repack") ? ["--prepackaged", "release/win-unpacked"] : [])],
    {
      ...process.env,
      ELECTRON_BUILDER_7ZIP_PATH: seven,
      ELECTRON_BUILDER_NSIS_DIR: nsis,
      ELECTRON_BUILDER_NSIS_RESOURCES_DIR: resources,
    },
  ); } finally { fs.writeFileSync(utilFile, originalUtil); }
  const installer = path.join(root, "release/NationalGymMap-Setup.exe");
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(installer))
    .digest("hex");
  fs.writeFileSync(
    path.join(root, "release/checksums.txt"),
    `${hash}  NationalGymMap-Setup.exe\n`,
  );
  console.log(`安装包已生成：${installer}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
