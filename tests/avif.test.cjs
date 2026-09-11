const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { Store } = require('../electron/storage.cjs');
const { saveImage } = require('../electron/catalog.cjs');

test('AVIF bytes preserve their original encoding and survive backup restore', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-avif-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const store = new Store(path.join(temp, 'location.json'));
  store.configure(path.join(temp, 'data'));
  const canvas = createCanvas(24, 16);
  canvas.getContext('2d').fillRect(0, 0, 24, 16);
  const bytes = canvas.encodeSync('avif');
  const rel = saveImage(store, bytes, 'equipment');
  assert.match(rel, /^equipment\/.+\.avif$/);
  assert.deepEqual(fs.readFileSync(path.join(store.root, rel)), bytes);
  const backup = await store.backup();
  fs.unlinkSync(path.join(store.root, rel));
  await store.restore(backup.path);
  assert.deepEqual(fs.readFileSync(path.join(store.root, rel)), bytes);
  const compatible = Buffer.from(bytes);
  compatible.write('mif1', 8, 'ascii');
  assert.match(saveImage(store, compatible, 'gyms'), /\.avif$/);
  for (const bad of [Buffer.from('avif'), Buffer.from('<html>avif</html>'), Buffer.from(bytes.subarray(0, 18))])
    assert.throws(() => saveImage(store, bad, 'equipment'), /格式/);
});
