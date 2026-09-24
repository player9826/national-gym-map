const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomic, validate, blank, inside, hash } = require('./storage.cjs');
const { normalizeClassification } = require('./equipment-model.cjs');
const { countryOf } = require('./gym-location.mjs');
const FORMAT = 'national-gym-map-shared';
const reserved = value => ['__proto__', 'constructor', 'prototype'].includes(value);
const CLASSIFICATION = ['equipmentType', 'freeWeightType', 'part', 'parts', 'tags', 'loading'];
// Only these public facts are ever exported or accepted from a publisher.
const FIELDS = {
  brands: ['id', 'name', 'website', 'logo', 'bannerImage', 'publicDescription'],
  gyms: ['id', 'name', 'country', 'province', 'city', 'district', 'address', 'lat', 'lng', 'brandIds', 'cover', 'photos', 'themeColor'],
  equipment: ['id', 'name', 'brandId', 'equipmentType', 'freeWeightType', 'part', 'parts', 'tags', 'loading', 'model', 'series', 'image', 'imageSource', 'productUrl', 'sourceType', 'sourceUrl', 'sourceDate', 'verificationStatus'],
  links: ['id', 'gymId', 'equipmentId', 'quantity'],
};
const pick = (row, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(row, k)).map(k => [k, structuredClone(row[k])]));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const asset = value => typeof value === 'string' && /^(equipment|gyms|brands)\/[a-zA-Z0-9_.-]+$/.test(value) && !value.includes('..');
function publicCatalog(db) {
  return Object.fromEntries(Object.entries(FIELDS).map(([key, fields]) => [key, db[key].map(row => pick(row, fields))]));
}
function imageRefs(data) {
  return [...new Set([...data.gyms.flatMap(r => [r.cover, ...(r.photos || [])]), ...data.equipment.map(r => r.image), ...data.brands.flatMap(r => [r.logo, r.bannerImage])].filter(Boolean))];
}
function checkCatalog(data) {
  if (!data || typeof data !== 'object') throw new Error('共享资料格式无效。');
  for (const key of Object.keys(FIELDS)) {
    if (!Array.isArray(data[key])) throw new Error('共享资料缺少集合。');
    if (data[key].some(r => !r || reserved(r.id))) throw new Error('共享记录标识无效。');
  }
  const clean = publicCatalog(data);
  clean.gyms = clean.gyms.map(row => ({ ...row, country: countryOf(row) }));
  clean.equipment = clean.equipment.map(row => normalizeClassification(row, { legacy: !row.equipmentType }));
  for (const ref of imageRefs(clean)) if (!asset(ref)) throw new Error('共享图片路径无效。');
  validate({ ...blank(), ...clean, gyms: clean.gyms.map(r => ({ ...r, visited: false })) });
  return clean;
}
function exportShared(store, { destination, includeImages = false }) {
  store.require();
  const dest = path.resolve(destination);
  if (inside(store.root, dest) || inside(dest, store.root)) throw new Error('共享导出目录不能与个人数据库目录重叠。');
  const data = checkCatalog(publicCatalog(store.db));
  let oldImages = [];
  let previousSourceId;
  const previousManifest = path.join(dest, 'manifest.json');
  if (fs.existsSync(previousManifest)) {
    const previous = JSON.parse(fs.readFileSync(previousManifest, 'utf8'));
    if (previous.format !== FORMAT || previous.version !== 1 || typeof previous.sourceId !== 'string' || reserved(previous.sourceId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(previous.sourceId)) throw new Error('目标目录存在其他共享清单，请选择新的目录。');
    previousSourceId = previous.sourceId;
    if (store.db.metadata?.sharedPublisherId && store.db.metadata.sharedPublisherId !== previousSourceId) throw new Error('目标目录属于其他共享库，不能覆盖。');
    oldImages = (previous.images || []).map(item => item.path).filter(ref => typeof ref === 'string' && ref.startsWith('images/') && asset(ref.slice(7)));
  }
  if (!includeImages) {
    for (const row of data.gyms) { delete row.cover; delete row.photos; }
    for (const row of data.equipment) delete row.image;
    for (const row of data.brands) { delete row.logo; delete row.bannerImage; }
  }
  const buffers = imageRefs(data).map(ref => {
    const source = path.join(store.root, ref);
    if (!inside(fs.realpathSync(store.root), fs.realpathSync(source))) throw new Error('共享图片不在数据目录中。');
    const bytes = fs.readFileSync(source);
    if (bytes.length > 20 * 1024 * 1024) throw new Error('单张共享图片超过 20 MB（Megabyte）。');
    return { ref, bytes };
  });
  let sourceId = store.db.metadata?.sharedPublisherId;
  if (!sourceId) {
    sourceId = previousSourceId || crypto.randomUUID();
    const next = structuredClone(store.db);
    next.metadata = { ...next.metadata, sharedPublisherId: sourceId };
    store.save(next);
  }
  const catalogBytes = Buffer.from(JSON.stringify(data, null, 2));
  const manifest = { format: FORMAT, version: 1, sourceId, updatedAt: new Date().toISOString(), catalog: { path: 'catalog.json', sha256: hash(catalogBytes), size: catalogBytes.length }, images: buffers.map(({ ref, bytes }) => ({ path: `images/${ref}`, sha256: hash(bytes), size: bytes.length })) };
  // Manifest is replaced last, so an interrupted export is never a valid new release.
  for (const { ref, bytes } of buffers) atomic(path.join(dest, 'images', ref), bytes);
  atomic(path.join(dest, 'catalog.json'), catalogBytes);
  atomic(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const retained = new Set(manifest.images.map(item => item.path));
  for (const old of oldImages) if (!retained.has(old)) fs.rmSync(path.join(dest, old), { force: true });
  return { manifest: path.join(dest, 'manifest.json'), sourceId, counts: Object.fromEntries(Object.keys(FIELDS).map(k => [k, data[k].length])), images: buffers.length };
}
function createSharedCatalog(store, fetchBytes) {
  let pending;
  async function fetchChecked(url, descriptor, maxBytes) {
    if (!descriptor || !Number.isInteger(descriptor.size) || descriptor.size < 0 || descriptor.size > maxBytes || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error('共享文件校验信息无效。');
    const bytes = Buffer.from(await fetchBytes(url, { maxBytes }));
    if (bytes.length !== descriptor.size || hash(bytes) !== descriptor.sha256) throw new Error('共享文件校验失败，未修改本地资料。');
    return bytes;
  }
  function merge(data, sourceId, images) {
    const next = structuredClone(store.db);
    const previous = next.metadata?.sharedCatalogs?.[sourceId] || { mappings: {}, snapshot: {} };
    const mappings = structuredClone(previous.mappings);
    const snapshot = {};
    const counts = { added: 0, updated: 0, unchanged: 0, conflicts: 0 };
    const conflicts = [];
    for (const key of ['brands', 'gyms', 'equipment', 'links']) {
      mappings[key] ||= {};
      snapshot[key] = {};
      for (const source of data[key]) {
        const row = structuredClone(source);
        const map = (kind, id) => mappings[kind][id];
        if (row.brandId) row.brandId = map('brands', row.brandId);
        if (row.brandIds) row.brandIds = row.brandIds.map(id => map('brands', id));
        if (key === 'links') { row.gymId = map('gyms', row.gymId); row.equipmentId = map('equipment', row.equipmentId); }
        for (const field of ['image', 'cover', 'logo', 'bannerImage']) if (row[field]) row[field] = images[row[field]];
        if (row.photos) row.photos = row.photos.map(ref => images[ref]);
        let local = next[key].find(r => r.id === mappings[key][source.id]);
        if (!local && sourceId === store.db.metadata?.sharedPublisherId) local = next[key].find(r => r.id === source.id);
        if (!local && !mappings[key][source.id] && key === 'brands') local = next.brands.find(r => r.name.trim().toLocaleLowerCase() === row.name.trim().toLocaleLowerCase());
        if (!local && key === 'links') local = next.links.find(r => r.gymId === row.gymId && r.equipmentId === row.equipmentId);
        const localId = local?.id || crypto.randomUUID();
        row.id = localId;
        mappings[key][source.id] = localId;
        const old = previous.snapshot[key]?.[source.id];
        snapshot[key][source.id] = structuredClone(row);
        if (!local) {
          next[key].push(key === 'gyms' ? { ...row, visited: false, visitDate: '', description: '', score: null, reviewUrl: '' } : row);
          counts.added++;
          continue;
        }
        let changed = false;
        const keepClassification = key === 'equipment' && old && CLASSIFICATION.some(field => !equal(local[field], old[field]));
        if (keepClassification && CLASSIFICATION.some(field => !equal(row[field], old[field])) && CLASSIFICATION.some(field => !equal(row[field], local[field]))) {
          conflicts.push({ collection: key, name: local.name || local.id, field: 'classification' });
          counts.conflicts++;
        }
        for (const field of FIELDS[key].filter(f => f !== 'id')) {
          if (keepClassification && CLASSIFICATION.includes(field)) continue;
          const remote = row[field];
          if (equal(local[field], remote)) continue;
          const untouched = old ? equal(local[field], old[field]) : local[field] == null || local[field] === '';
          if (untouched) {
            if (remote === undefined) delete local[field]; else local[field] = remote;
            changed = true;
          } else if (!old || !equal(remote, old[field])) {
            conflicts.push({ collection: key, name: local.name || local.id, field });
            counts.conflicts++;
          }
        }
        counts[changed ? 'updated' : 'unchanged']++;
      }
    }
    next.metadata = { ...next.metadata, sharedCatalogs: { ...next.metadata?.sharedCatalogs, [sourceId]: { mappings, snapshot, updatedAt: new Date().toISOString() } } };
    validate(next);
    return { next, counts, conflicts };
  }
  return {
    async sharedPreview({ url }) {
      store.require(); pending = undefined;
      const base = new URL(url);
      const localFixture = process.env.GYM_TEST_ALLOW_LOCAL === '1' && base.protocol === 'http:' && base.hostname === '127.0.0.1';
      if ((!localFixture && base.protocol !== 'https:') || base.username || base.password || base.hash) throw new Error('共享清单必须使用无凭据的 HTTPS（Hypertext Transfer Protocol Secure）网址。');
      const manifestBytes = Buffer.from(await fetchBytes(base.href, { maxBytes: 2 * 1024 * 1024 }));
      if (manifestBytes.length > 2 * 1024 * 1024) throw new Error('共享清单过大。');
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      if (manifest.format !== FORMAT || manifest.version !== 1 || typeof manifest.sourceId !== 'string' || reserved(manifest.sourceId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(manifest.sourceId) || manifest.catalog?.path !== 'catalog.json' || !Array.isArray(manifest.images) || manifest.images.length > 10000) throw new Error('共享清单格式无效。');
      const raw = await fetchChecked(new URL('catalog.json', base).href, manifest.catalog, 20 * 1024 * 1024);
      const data = checkCatalog(JSON.parse(raw.toString('utf8')));
      const refs = imageRefs(data);
      const descriptors = new Map();
      for (const descriptor of manifest.images) {
        if (typeof descriptor.path !== 'string' || !descriptor.path.startsWith('images/') || !asset(descriptor.path.slice(7)) || descriptors.has(descriptor.path.slice(7))) throw new Error('共享图片清单包含无效或重复路径。');
        descriptors.set(descriptor.path.slice(7), descriptor);
      }
      const imageMap = {}, files = [];
      let total = raw.length;
      for (const ref of refs) {
        const descriptor = descriptors.get(ref);
        if (!descriptor || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error('共享图片校验信息无效。');
        const local = `${ref.split('/')[0]}/shared-${descriptor.sha256}${path.extname(ref).toLowerCase()}`;
        const existing = path.join(store.root, local);
        if (fs.existsSync(existing) && fs.statSync(existing).size === descriptor.size && hash(fs.readFileSync(existing)) === descriptor.sha256) {
          imageMap[ref] = local;
          continue;
        }
        const bytes = await fetchChecked(new URL(`images/${ref}`, base).href, descriptor, 20 * 1024 * 1024);
        total += bytes.length;
        if (total > 1024 * 1024 * 1024) throw new Error('共享更新超过 1 GB（Gigabyte），请维护者拆分。');
        imageMap[ref] = local;
        files.push({ local, bytes });
      }
      const result = merge(data, manifest.sourceId, imageMap);
      const token = crypto.randomUUID();
      pending = { token, root: store.root, baseline: hash(Buffer.from(JSON.stringify(store.db))), ...result, files, url: base.href, sourceId: manifest.sourceId, expires: Date.now() + 30 * 60 * 1000 };
      return { token, sourceId: manifest.sourceId, updatedAt: manifest.updatedAt, counts: result.counts, conflicts: result.conflicts.slice(0, 100), images: refs.length, downloadImages: files.length };
    },
    async sharedApply({ token }) {
      store.require();
      const draft = pending;
      if (!draft || draft.token !== token || draft.root !== store.root || Date.now() > draft.expires) throw new Error('共享预览已失效，请重新读取。');
      if (draft.baseline !== hash(Buffer.from(JSON.stringify(store.db)))) throw new Error('本地数据已变化，请重新预览共享更新。');
      pending = undefined;
      await store.backup();
      const created = [];
      try {
        for (const { local, bytes } of draft.files) {
          const target = path.join(store.root, local);
          if (fs.existsSync(target)) {
            if (hash(fs.readFileSync(target)) !== hash(bytes)) throw new Error('共享图片与本地文件冲突。');
          } else { atomic(target, bytes); created.push(target); }
        }
        draft.next.metadata.sharedCatalogs[draft.sourceId].url = draft.url;
        draft.next.settings = { ...draft.next.settings, sharedCatalogUrl: draft.url, sharedLastSyncedAt: new Date().toISOString() };
        store.save(draft.next);
      } catch (error) {
        for (const file of created) fs.rmSync(file, { force: true });
        throw error;
      }
      return { counts: draft.counts, conflicts: draft.conflicts, db: store.db };
    },
  };
}
module.exports = { exportShared, createSharedCatalog, publicCatalog, checkCatalog };
