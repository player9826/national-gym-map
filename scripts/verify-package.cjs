const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const yaml = require('js-yaml');
const archive = path.resolve('release/win-unpacked/resources/app.asar');
const version = require('../package.json').version;
assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, version);
let compared = 0;
function check(dir, extra = false) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file, extra);
    else {
      const packed = extra ? fs.readFileSync(path.join('release/win-unpacked/resources', file)) : asar.extractFile(archive, file);
      assert.ok(packed.equals(fs.readFileSync(file)), `Packaged file differs: ${file}`);
      compared++;
    }
  }
}
check('electron'); check('dist'); check('browser-capture', true);
const installer = fs.readFileSync('release/NationalGymMap-Setup.exe');
const manifest = yaml.load(fs.readFileSync('release/latest.yml', 'utf8'));
assert.equal(manifest.version, version);
assert.equal(manifest.sha512, crypto.createHash('sha512').update(installer).digest('base64'));
const sha256 = crypto.createHash('sha256').update(installer).digest('hex');
assert.ok(fs.readFileSync('release/checksums.txt','utf8').startsWith(sha256));
const report = {version, date:new Date().toISOString(), installer:'release/NationalGymMap-Setup.exe', bytes:installer.length, sha256,
  manifestVerified:true, packageContent:{passed:true,filesCompared:compared,browserCaptureIncluded:true},
  packagedRuntimeVerified:false, published:false, existingInstallationReplaced:false};
fs.writeFileSync('release/verification.json', JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
