const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, blank, hash } = require('../electron/storage.cjs');
const c = require('../electron/catalog.cjs');
function setup(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-equipment-model-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const config = path.join(base, 'location.json'), root = path.join(base, 'data');
  return { base, config, root, store: new Store(config) };
}
test('four types enforce applicable fields and clear stale classification while preserving identity and source', t => {
  const { store, root } = setup(t); store.configure(root);
  const base = { name: 'test', brandId: 'brand-1', parts: ['CHEST'], tags: ['推胸'], productUrl: 'https://example.com/product' };
  assert.throws(() => c.upsert(store, 'equipment', base), /顶级分类/);
  assert.throws(() => c.upsert(store, 'equipment', { ...base, equipmentType: 'fixed', tags: [] }), /应用标签/);
  assert.throws(() => c.upsert(store, 'equipment', { ...base, equipmentType: 'fixed', tags: ['二头'] }), /属于/);
  let row = c.upsert(store, 'equipment', { ...base, equipmentType: 'fixed' });
  const id = row.id;
  for (const equipmentType of ['cardio', 'cable_station', 'free_weight']) {
    if (equipmentType === 'free_weight') assert.throws(() => c.upsert(store, 'equipment', { ...row, equipmentType }), /子分类/);
    row = c.upsert(store, 'equipment', { ...row, equipmentType, freeWeightType: 'smith' });
    assert.deepEqual(row.parts, []); assert.deepEqual(row.tags, []); assert.equal(row.part, '');
    assert.equal(row.id, id); assert.equal(row.sourceUrl, base.productUrl);
    assert.equal(row.freeWeightType, equipmentType === 'free_weight' ? 'smith' : '');
  }
  for (const freeWeightType of ['dumbbell', 'barbell', 'smith', 'rack']) assert.equal(c.equipment({ ...base, equipmentType: 'free_weight', freeWeightType }).freeWeightType, freeWeightType);
});
test('legacy migration snapshots full original database and images, preserves links, is idempotent and supports reconnect', t => {
  const { root, config, store, base } = setup(t);
  const old = blank(); delete old.metadata.equipmentModelVersion;
  old.equipment = [{ id: 'old', name: 'old chest', brandId: 'brand-1', part: 'CHEST', tags: [], image: 'equipment/photo.jpg' }, { id: 'unknown', name: 'unknown', brandId: 'brand-1', tags: [] }];
  old.gyms = [{ id: 'gym', name: 'gym', visited: false }];
  old.links = [{ id: 'link', gymId: 'gym', equipmentId: 'old', quantity: 2 }];
  fs.mkdirSync(path.join(root, 'database'), { recursive: true }); fs.mkdirSync(path.join(root, 'equipment'));
  const original = JSON.stringify(old); fs.writeFileSync(path.join(root, 'database/data.json'), original); fs.writeFileSync(path.join(root, 'equipment/photo.jpg'), 'photo');
  store.configure(root);
  assert.equal(store.db.equipment[0].equipmentType, 'fixed'); assert.equal(store.db.equipment[0].verificationStatus, 'needs_review');
  assert.equal(store.db.equipment[1].equipmentType, ''); assert.equal(store.db.equipment[1].verificationStatus, 'needs_review');
  assert.deepEqual(store.db.links, old.links);
  const snapshot = store.db.metadata.equipmentMigrationBackup;
  assert.equal(fs.readFileSync(path.join(snapshot, 'database/data.json'), 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(snapshot, 'equipment/photo.jpg'), 'utf8'), 'photo');
  c.upsert(store, 'equipment', { id: 'old', notes: 'nonclassification edit' });
  assert.equal(new Store(config).db.equipment[0].id, 'old'); assert.equal(fs.readdirSync(path.join(root, 'backups')).length, 1);
  const recovered = new Store(path.join(base, 'reconnect.json')); recovered.reconnect(snapshot);
  assert.deepEqual(recovered.db.links, old.links); assert.equal(recovered.db.equipment[0].image, 'equipment/photo.jpg');
});
test('legacy backup restore migrates only after keeping original archive and retained assets', async t => {
  const { store, root } = setup(t); store.configure(root);
  const old = blank(); delete old.metadata.equipmentModelVersion;
  old.equipment.push({ id: 'legacy', name: 'old', brandId: 'brand-1', body: 'LEG', applicationTag: '近固蹬', image: 'equipment/old.jpg' });
  fs.mkdirSync(path.join(root, 'equipment')); fs.writeFileSync(path.join(root, 'equipment/old.jpg'), 'old photo');
  store.save(old); const backup = await store.backup(); const originalHash = hash(fs.readFileSync(backup.path));
  store.save(blank()); await store.restore(backup.path);
  assert.equal(store.db.equipment[0].equipmentType, 'fixed'); assert.deepEqual(store.db.equipment[0].parts, ['LEG']);
  assert.equal(hash(fs.readFileSync(store.db.metadata.equipmentMigrationBackup)), originalHash);
  assert.equal(fs.readFileSync(path.join(root, 'equipment/old.jpg'), 'utf8'), 'old photo');
});
test('legacy structured imports retain aliases and new candidate pool survives restart', t => {
  const { store, root, config } = setup(t); store.configure(root);
  const draft = c.prepareImport(store, { kind: 'equipment', raw: [{ name: 'old', brandId: 'brand-1', body: '手臂', applicationTag: '二头' }] });
  c.commitImport(store, draft); assert.deepEqual(store.db.equipment[0].parts, ['ARM']);
  const next = structuredClone(store.db); next.importBatches = [{ id: 'batch', brandId: 'brand-1', updatedAt: new Date().toISOString(), status: 'reviewing', candidates: [{ id: 'candidate', name: '待整理器械', status: 'deferred' }] }]; store.save(next);
  assert.deepEqual(new Store(config).db.importBatches, next.importBatches);
});
test('legacy Chinese body names map to existing canonical parts without changing original aliases', () => {
  for (const [body, part] of Object.entries(require('../electron/equipment-model.cjs').PART_ALIASES)) {
    const row = c.equipment({ name: 'old', brandId: 'brand-1', body }, { legacy: true });
    assert.deepEqual(row.parts, [part]); assert.equal(row.body, body); assert.equal(row.equipmentType, 'fixed');
  }
});
