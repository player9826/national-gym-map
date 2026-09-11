const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const yazl = require('yazl');
const yauzl = require('yauzl');

function filesUnder(root, prefix = '', excludeBackups = false) {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    if (!prefix && (entry.name.startsWith('.restore-') || (excludeBackups && entry.name === 'backups'))) continue;
    const rel = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`数据目录包含符号链接：${rel}`);
    if (entry.isDirectory()) files.push(...filesUnder(root, rel));
    else if (entry.isFile()) files.push(rel.replaceAll('\\', '/'));
  }
  return files;
}
function hashFileSync(file) {
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024); const fd = fs.openSync(file, 'r');
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, n)); } finally { fs.closeSync(fd); }
  return digest.digest('hex');
}
async function hashFile(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function backup(store, allowDamaged = false) {
  if (!allowDamaged) store.require();
  if (!store.root) throw new Error('尚未设置数据目录。');
  const files = filesUnder(store.root, '', true).filter(name => name !== 'metadata/backup-manifest.json');
  const manifest = { format: 1, createdAt: new Date().toISOString(), files: {} };
  for (const rel of files) manifest.files[rel] = await hashFile(path.join(store.root, rel));
  const dest = path.join(store.root, 'backups', `backup-${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomUUID().slice(0, 6)}.zip`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const temp = `${dest}.tmp`;
  const zip = new yazl.ZipFile();
  const output = fs.createWriteStream(temp, { flags: 'wx' });
  const completion = pipeline(zip.outputStream, output);
  zip.on('error', error => zip.outputStream.destroy(error));
  try {
    for (const rel of files) zip.addFile(path.join(store.root, rel), rel, { compress: !/\.(jpg|png|webp|gif|zip)$/i.test(rel) });
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'metadata/backup-manifest.json');
    zip.end(); await completion;
    fs.renameSync(temp, dest);
  } catch (error) { zip.outputStream.destroy(); output.destroy(); await completion.catch(() => {}); fs.rmSync(temp, { force: true }); throw error; }
  return { path: dest, fileCount: files.length + 1 };
}
async function unpack(file, destination) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (e, z) => e ? reject(e) : resolve(z)));
  const hashes = {}; const seen = new Set();
  return new Promise((resolve, reject) => {
    const fail = error => { zip.close(); reject(error); };
    zip.on('error', fail); zip.on('end', () => resolve(hashes));
    zip.on('entry', entry => {
      (async () => {
        const rel = entry.fileName;
        if (rel.endsWith('/')) { zip.readEntry(); return; }
        const parts = rel.split('/');
        if (rel.includes('\\') || rel.includes(':') || rel.startsWith('/') || parts.some(p => !p || p === '..' || p.startsWith('.') || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || parts[0] === 'backups' || seen.has(rel.toLowerCase())) throw new Error('备份包含不安全、重复或保留路径。');
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('备份不支持符号链接。');
        seen.add(rel.toLowerCase());
        if (seen.size > 1000000) throw new Error('备份条目数量过多。');
        if (['metadata/backup-manifest.json', 'database/data.json'].includes(rel) && entry.uncompressedSize > 256 * 1024 ** 2) throw new Error('备份元数据超过支持大小。');
        const stat = fs.statfsSync(destination);
        if (entry.uncompressedSize > stat.bavail * stat.bsize) throw new Error('恢复目录磁盘剩余空间不足。');
        const output = path.join(destination, ...parts); fs.mkdirSync(path.dirname(output), { recursive: true });
        const stream = await new Promise((res, rej) => zip.openReadStream(entry, (e, s) => e ? rej(e) : res(s)));
        const digest = crypto.createHash('sha256');
        const checksum = new Transform({ transform(chunk, encoding, callback) { digest.update(chunk); callback(null, chunk); } });
        await pipeline(stream, checksum, fs.createWriteStream(output, { flags: 'wx' }));
        hashes[rel] = digest.digest('hex'); zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}
async function restore(store, file) {
  if (!store.root) throw new Error('请先设置数据目录。');
  const { validate, atomic } = require('./storage.cjs');
  const { migrateEquipmentDatabase } = require('./equipment-model.cjs');
  const stage = path.join(store.root, `.restore-${crypto.randomUUID()}`), rollback = `${stage}-old`;
  fs.mkdirSync(stage); fs.mkdirSync(rollback);
  const moved = [], installed = []; let committed = false;
  try {
    const hashes = await unpack(file, stage);
    const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'metadata/backup-manifest.json'), 'utf8'));
    if (manifest.format !== 1 || !manifest.files || typeof manifest.files !== 'object') throw new Error('备份清单无效。');
    for (const [name, hash] of Object.entries(hashes)) if (name !== 'metadata/backup-manifest.json' && manifest.files[name] !== hash) throw new Error(`备份完整性校验失败：${name}`);
    for (const name of Object.keys(manifest.files)) if (!(name in hashes)) throw new Error(`备份缺少文件：${name}`);
    const original = validate(JSON.parse(fs.readFileSync(path.join(stage, 'database/data.json'), 'utf8')));
    const migration = migrateEquipmentDatabase(original);
    const next = validate(migration.db);
    const safety = await backup(store, true);
    if (migration.changed) {
      const sourceBackup = path.join(store.root, 'backups', `equipment-model-source-${crypto.randomUUID()}.zip`);
      fs.copyFileSync(file, sourceBackup, fs.constants.COPYFILE_EXCL);
      if (hashFileSync(file) !== hashFileSync(sourceBackup)) throw new Error('迁移前原始备份校验失败。');
      next.metadata.equipmentMigrationBackup = sourceBackup;
      atomic(path.join(stage, 'database/data.json'), JSON.stringify(next, null, 2));
    }
    const names = new Set([...fs.readdirSync(stage), ...fs.readdirSync(store.root).filter(n => n !== 'backups' && !n.startsWith('.restore-'))]);
    for (const name of names) {
      const old = path.join(store.root, name);
      if (fs.existsSync(old)) { fs.renameSync(old, path.join(rollback, name)); moved.push(name); }
      if (fs.existsSync(path.join(stage, name))) { fs.renameSync(path.join(stage, name), old); installed.push(name); }
    }
    store.db = next; store.error = null; committed = true;
    return { safetyBackup: safety.path, state: next };
  } catch (e) {
    for (const name of installed.reverse()) fs.rmSync(path.join(store.root, name), { force: true, recursive: true });
    for (const name of moved.reverse()) fs.renameSync(path.join(rollback, name), path.join(store.root, name));
    throw e;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    if (committed || !fs.readdirSync(rollback).length) fs.rmSync(rollback, { recursive: true, force: true });
  }
}
module.exports = { filesUnder, hashFileSync, backup, restore };
