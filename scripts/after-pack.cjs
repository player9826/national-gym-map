const path = require("node:path");
module.exports = async (context) => {
  const { rcedit } = await import("rcedit");
  await rcedit(
    path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.exe`,
    ),
    {
      icon: path.resolve("build/icon.ico"),
      "file-version": context.packager.appInfo.version,
      "product-version": context.packager.appInfo.version,
      "version-string": {
        ProductName: "全国健身房地图",
        FileDescription: "全国健身房地图",
        CompanyName: "National Gym Map",
        OriginalFilename: "全国健身房地图.exe",
      },
    },
  );
};
