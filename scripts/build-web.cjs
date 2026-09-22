const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { publicCatalog, checkCatalog } = require('../electron/shared-catalog.cjs');
const { hash, inside } = require('../electron/storage.cjs');

const root = path.resolve(__dirname, '..');
const imagePath = /^images\/(equipment|gyms|brands)\/[a-zA-Z0-9_.-]+$/;
const maxBytes = 20 * 1024 * 1024;

function checkedFile(source, descriptor) {
  if (!descriptor || !Number.isInteger(descriptor.size) || descriptor.size < 0 || descriptor.size > maxBytes || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) {
    throw new Error('共享文件校验信息无效。');
  }
  const file = path.join(source, descriptor.path);
  if (!inside(fs.realpathSync(source), fs.realpathSync(file))) throw new Error('共享文件不能指向资料目录之外。');
  if (fs.statSync(file).size !== descriptor.size) throw new Error(`共享文件校验失败：${descriptor.path}。请重新导出完整共享快照。`);
  const bytes = fs.readFileSync(file);
  if (hash(bytes) !== descriptor.sha256) throw new Error(`共享文件校验失败：${descriptor.path}。请重新导出完整共享快照。`);
  return bytes;
}

function readSnapshot(source) {
  const manifestFile = path.join(source, 'manifest.json');
  if (!inside(fs.realpathSync(source), fs.realpathSync(manifestFile)) || fs.statSync(manifestFile).size > 2 * 1024 * 1024) throw new Error('共享清单路径或大小无效。');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.format !== 'national-gym-map-shared' || manifest.version !== 1 || manifest.catalog?.path !== 'catalog.json' || !Array.isArray(manifest.images) || manifest.images.length > 10000 || !Number.isFinite(Date.parse(manifest.updatedAt))) throw new Error('共享清单格式无效。');
  const catalog = checkCatalog(publicCatalog(JSON.parse(checkedFile(source, manifest.catalog).toString('utf8'))));
  const descriptors = new Map();
  for (const descriptor of manifest.images) {
    if (!imagePath.test(descriptor.path) || descriptor.path.includes('..') || descriptors.has(descriptor.path.slice(7))) throw new Error('共享图片清单包含无效或重复路径。');
    checkedFile(source, descriptor);
    descriptors.set(descriptor.path.slice(7), descriptor);
  }
  const refs = [...new Set([
    ...catalog.gyms.flatMap(row => [row.cover, ...(row.photos || [])]),
    ...catalog.equipment.map(row => row.image),
    ...catalog.brands.map(row => row.logo),
  ].filter(Boolean))];
  for (const ref of refs) if (!descriptors.has(ref)) throw new Error(`共享图片未在清单中：${ref}`);
  return { manifest, catalog, descriptors, refs };
}

async function writeWebData(source, output, snapshot = readSnapshot(source)) {
  // Re-encode public images to remove source metadata and avoid shipping full-size originals.
  const images = {};
  const converted = new Map();
  for (const ref of snapshot.refs) {
    const descriptor = snapshot.descriptors.get(ref);
    if (!converted.has(descriptor.sha256)) {
      const image = await loadImage(checkedFile(source, descriptor));
      if (!image.width || !image.height || image.width * image.height > 100000000) throw new Error(`共享图片尺寸无效或过大：${ref}`);
      const variants = {};
      for (const [name, limit, quality] of [['thumbnail', 480, 78], ['detail', 1600, 84]]) {
        const ratio = Math.min(1, limit / Math.max(image.width, image.height));
        const canvas = createCanvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const bytes = await canvas.encode('webp', quality);
        const relative = `images/${name === 'thumbnail' ? 'thumb' : 'detail'}/${hash(bytes)}.webp`;
        const file = path.join(output, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
        variants[name] = relative;
      }
      converted.set(descriptor.sha256, variants);
    }
    images[ref] = converted.get(descriptor.sha256);
  }
  const dataDir = path.join(output, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const files = {};
  for (const [name, data] of [['catalog', snapshot.catalog], ['images', images]]) {
    const bytes = Buffer.from(JSON.stringify(data));
    fs.writeFileSync(path.join(dataDir, `${name}.json`), bytes);
    files[name] = { path: `${name}.json`, sha256: hash(bytes), size: bytes.length };
  }
  const manifest = {
    format: 'national-gym-map-web', version: 1,
    updatedAt: snapshot.manifest.updatedAt,
    revision: hash(Buffer.from(files.catalog.sha256 + files.images.sha256)),
    ...files,
  };
  fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, imageCount: snapshot.refs.length };
}

async function main() {
  const source = path.join(root, 'shared');
  const output = path.join(root, 'dist-web');
  // Validate before Vite clears its output; never repair or mutate the source snapshot.
  const snapshot = readSnapshot(source);
  if (fs.existsSync(output) && (!inside(root, fs.realpathSync(output)) || fs.lstatSync(output).isSymbolicLink())) throw new Error('网站输出目录不能使用符号链接。');
  const { build } = await import('vite');
  await build({ root, mode: 'web' });
  const result = await writeWebData(source, output, snapshot);
  fs.writeFileSync(path.join(output, '.nojekyll'), '');
  console.log(`网站已生成：dist-web；公开图片 ${result.imageCount} 张；资料更新时间 ${result.manifest.updatedAt}`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readSnapshot, writeWebData };
