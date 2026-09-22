const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { hash } = require('../electron/storage.cjs');
const { readSnapshot, writeWebData } = require('../scripts/build-web.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-web-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'shared');
  const output = path.join(root, 'site');
  fs.mkdirSync(path.join(source, 'images/gyms'), { recursive: true });
  const image = createCanvas(2000, 1000);
  image.getContext('2d').fillRect(0, 0, 2000, 1000);
  const imageBytes = image.encodeSync('png');
  fs.writeFileSync(path.join(source, 'images/gyms/cover.png'), imageBytes);
  const catalog = {
    brands: [{ id: 'brand', name: 'Public brand', notes: 'PRIVATE' }],
    gyms: [{ id: 'gym', name: 'Public gym', lat: null, lng: null, cover: 'gyms/cover.png', photos: [], visited: true, notes: 'PRIVATE', description: 'PRIVATE', reviewUrl: 'https://private.test', visitDate: '2026-01-01' }],
    equipment: [{ id: 'eq', name: 'Public bike', brandId: 'brand', equipmentType: 'cardio', parts: [], tags: [], notes: 'PRIVATE' }],
    links: [{ id: 'link', gymId: 'gym', equipmentId: 'eq', quantity: 1, notes: 'PRIVATE' }],
    settings: { secret: 'PRIVATE' }, metadata: { localRoot: 'PRIVATE' },
  };
  const catalogBytes = Buffer.from(JSON.stringify(catalog));
  fs.writeFileSync(path.join(source, 'catalog.json'), catalogBytes);
  const manifest = {
    format: 'national-gym-map-shared', version: 1, sourceId: 'publisher', updatedAt: '2026-09-21T00:00:00.000Z',
    catalog: { path: 'catalog.json', size: catalogBytes.length, sha256: hash(catalogBytes) },
    images: [{ path: 'images/gyms/cover.png', size: imageBytes.length, sha256: hash(imageBytes) }],
  };
  const saveManifest = () => fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  saveManifest();
  return { root, source, output, manifest, saveManifest };
}

test('website exports only public facts, verified indexes and smaller metadata-free images', async t => {
  const { source, output, manifest } = fixture(t);
  const before = fs.readFileSync(path.join(source, 'catalog.json'));
  const result = await writeWebData(source, output);
  const catalogText = fs.readFileSync(path.join(output, 'data/catalog.json'), 'utf8');
  assert.ok(!catalogText.includes('PRIVATE'));
  for (const field of ['visited', 'visitDate', 'notes', 'description', 'reviewUrl', 'settings', 'metadata']) assert.ok(!catalogText.includes(`"${field}"`));
  assert.deepEqual(fs.readFileSync(path.join(source, 'catalog.json')), before);
  assert.equal(result.manifest.updatedAt, manifest.updatedAt);
  assert.match(result.manifest.revision, /^[a-f0-9]{64}$/);
  for (const key of ['catalog', 'images']) {
    const bytes = fs.readFileSync(path.join(output, 'data', result.manifest[key].path));
    assert.equal(result.manifest[key].size, bytes.length);
    assert.equal(result.manifest[key].sha256, hash(bytes));
  }
  const images = JSON.parse(fs.readFileSync(path.join(output, 'data/images.json')));
  const thumb = await loadImage(path.join(output, images['gyms/cover.png'].thumbnail));
  const detail = await loadImage(path.join(output, images['gyms/cover.png'].detail));
  assert.deepEqual([thumb.width, thumb.height], [480, 240]);
  assert.deepEqual([detail.width, detail.height], [1600, 800]);
  assert.equal(fs.existsSync(path.join(output, 'images/gyms/cover.png')), false);
  assert.equal((await writeWebData(source, output)).manifest.revision, result.manifest.revision);
});

test('an edited catalog without a matching manifest cannot become a website', async t => {
  const { source, output } = fixture(t);
  fs.appendFileSync(path.join(source, 'catalog.json'), '\n');
  await assert.rejects(writeWebData(source, output), /校验失败/);
  assert.equal(fs.existsSync(output), false);
});

test('image hash, declared size and catalog image membership are enforced', t => {
  const { source, manifest, saveManifest } = fixture(t);
  const original = structuredClone(manifest.images[0]);
  manifest.images[0].sha256 = '0'.repeat(64); saveManifest();
  assert.throws(() => readSnapshot(source), /校验失败/);
  manifest.images[0] = { ...original, size: original.size + 1 }; saveManifest();
  assert.throws(() => readSnapshot(source), /校验失败/);
  manifest.images = []; saveManifest();
  assert.throws(() => readSnapshot(source), /未在清单/);
});

test('duplicate and traversal paths are rejected before reading external files', t => {
  const { source, manifest, saveManifest } = fixture(t);
  const original = structuredClone(manifest.images[0]);
  for (const unsafe of ['images/gyms/../../secret.png', 'images/gyms/cover..png', 'C:/private.png', 'images\\gyms\\cover.png']) {
    manifest.images = [{ ...original, path: unsafe }]; saveManifest();
    assert.throws(() => readSnapshot(source), /无效或重复路径/);
  }
  manifest.images = [original, original]; saveManifest();
  assert.throws(() => readSnapshot(source), /无效或重复路径/);
});

test('a directory link cannot redirect shared images outside the snapshot', t => {
  const { root, source } = fixture(t);
  const images = path.join(source, 'images');
  const outside = path.join(root, 'outside-images');
  fs.renameSync(images, outside);
  fs.symlinkSync(outside, images, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readSnapshot(source), /目录之外/);
});
