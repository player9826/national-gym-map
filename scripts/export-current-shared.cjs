const fs = require('node:fs');
const path = require('node:path');
const { exportShared, publicCatalog, checkCatalog } = require('../electron/shared-catalog.cjs');
const { hash } = require('../electron/storage.cjs');

function exportCurrent(dataRoot, destination) {
  const file = path.join(dataRoot, 'database', 'data.json');
  const original = fs.readFileSync(file);
  const db = JSON.parse(original);
  const published = fs.existsSync(path.join(destination, 'catalog.json'))
    ? JSON.parse(fs.readFileSync(path.join(destination, 'catalog.json'))) : null;
  const manifestFile = path.join(destination, 'manifest.json');
  const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile)) : null;
  const catalog = checkCatalog(publicCatalog(db));
  // Reuse the existing public identity in memory; never initialize or migrate the private Store.
  const copy = structuredClone(db);
  if (!copy.metadata?.sharedPublisherId && previous?.sourceId)
    copy.metadata = { ...copy.metadata, sharedPublisherId: previous.sourceId };
  const store = {
    root: path.resolve(dataRoot), db: copy, require() {},
    save(next) { this.db = next; }, // exportShared only assigns a publisher identity here.
  };
  const result = exportShared(store, { destination, includeImages: true });
  const exported = JSON.parse(fs.readFileSync(path.join(destination, 'catalog.json')));
  if (JSON.stringify(exported) !== JSON.stringify(catalog)) throw new Error('公开导出与当前资料不一致。');
  const sourceUnchanged = hash(fs.readFileSync(file)) === hash(original);
  const counts = Object.fromEntries(Object.keys(catalog).map(key => [key, {
    current: catalog[key].length, previous: published?.[key]?.length || 0,
  }]));
  const report = { counts, images: result.images, sourceUnchanged };
  if (!sourceUnchanged) throw new Error('桌面资料在导出期间发生变化；本次快照已生成，请重新导出后再发布。');
  return report;
}

if (require.main === module) {
  try {
    const dataRoot = process.argv[2] || JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'national-gym-map', 'location.json'), 'utf8')).dataRoot;
    if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error('请提供桌面资料目录的绝对路径。');
    console.log(JSON.stringify(exportCurrent(dataRoot, path.resolve(__dirname, '../shared')), null, 2));
    console.log('当前公开快照已导出，私人数据库未修改。核对数量后运行网站构建并发布。');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { exportCurrent };
