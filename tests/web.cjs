const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { chromium, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 15000 });

const root = path.resolve(__dirname, '../dist-web');
const output = path.resolve(__dirname, '../test-results/web');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml' };

// Serve only the built website, on a private ephemeral port; never reuse a developer server.
function serve(req, res) {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const relative = path.relative(root, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403).end(); return;
    }
    const real = fs.realpathSync(filename);
    const realRelative = path.relative(fs.realpathSync(root), real);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative) || !fs.statSync(real).isFile()) {
      res.writeHead(403).end(); return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(real)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(real).pipe(res);
  } catch { res.writeHead(404).end('Not found'); }
}

async function launch() {
  const failures = [];
  for (const channel of [undefined, 'msedge', 'chrome']) {
    try { return await chromium.launch({ headless: true, ...(channel ? { channel } : {}) }); }
    catch (error) { failures.push(`${channel || 'bundled'}: ${error.message.split('\n')[0]}`); }
  }
  throw new Error(`No Chromium browser available: ${failures.join('; ')}`);
}

async function noWrites(page) {
  await expect(page.getByRole('button', { name: /新增健身房|新增器械|编辑|删除|解除关联|关联器械|品牌管理|导入|数据与设置|设置数据目录|已去过|未去过/ })).toHaveCount(0);
  assert.equal(await page.evaluate(() => typeof window.desktop), 'undefined');
}

async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page has horizontal overflow');
}

async function main() {
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Run the web build before this test');
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer(serve);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const errors = [];
  const passed = [];
  try {
    browser = await launch();
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    // National geometry is local. External street tiles are outside this deterministic check.
    await page.route('https://*.basemaps.cartocdn.com/**', route => route.abort());
    await page.goto(base);
    await expect(page.locator('.gym-item')).toHaveCount(catalog.gyms.length);
    await noWrites(page);
    await noOverflow(page);
    await page.screenshot({ path: path.join(output, 'desktop-map.png') });
    passed.push('map loads public data without desktop bridge');

    const link = catalog.links.find(link => catalog.equipment.some(e => e.id === link.equipmentId && e.image));
    assert.ok(link, 'Fixture needs a gym/equipment relation with an image');
    const gym = catalog.gyms.find(g => g.id === link.gymId);
    const equipment = catalog.equipment.find(e => e.id === link.equipmentId);
    await page.getByRole('textbox', { name: '搜索健身房', exact: true }).fill(gym.name);
    await expect(page.locator('.gym-item')).toHaveCount(catalog.gyms.filter(g => g.name.includes(gym.name)).length);
    await page.locator('.gym-item').filter({ hasText: gym.name }).first().locator('.gym-open').click();
    await page.locator('.linked-open').filter({ hasText: equipment.name }).first().click();
    await expect(page).toHaveURL(new RegExp(`#/equipment/${encodeURIComponent(equipment.id)}(?:\\?|$)`));
    const detail = page.getByRole('dialog').last();
    await expect(detail.getByRole('heading', { name: equipment.name, exact: true })).toBeVisible();
    await expect(detail.locator('.equipment-detail-image img')).toBeVisible();
    await expect.poll(() => detail.locator('.equipment-detail-image img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await noWrites(page);
    await detail.getByRole('button', { name: '复制链接', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), page.url());
    const sharedEquipmentUrl = page.url();
    await page.reload();
    await expect(detail.getByRole('heading', { name: equipment.name, exact: true })).toBeVisible();
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard permission denied'); }; });
    await detail.getByRole('button', { name: '复制链接', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '分享链接', exact: true })).toHaveValue(sharedEquipmentUrl);
    await page.getByRole('dialog').last().getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await detail.locator('.reverse-link').filter({ hasText: gym.name }).first().click();
    await expect(page).toHaveURL(new RegExp(`#/gym/${encodeURIComponent(gym.id)}(?:\\?|$)`));
    await page.reload();
    await expect(page.locator('.linked-open').first()).toBeVisible();
    await noWrites(page);
    passed.push('gym/equipment relations, loaded image, both detail deep-link refreshes, clipboard share and denied-permission fallback');

    await page.goto(`${base}/#/equipment`);
    const brand = catalog.brands.find(b => b.id === equipment.brandId);
    await page.locator('.equipment-sidebar .group-list').getByRole('button', { name: new RegExp(brand.name) }).first().click();
    const brandCount = catalog.equipment.filter(e => e.brandId === brand.id).length;
    await expect(page.locator('.equipment-card')).toHaveCount(brandCount);
    await expect(page.getByRole('combobox', { name: '搜索字段', exact: true })).not.toBeVisible();
    await page.locator('.equipment-advanced > summary').click();
    await page.getByRole('combobox', { name: '搜索字段', exact: true }).selectOption('name');
    await page.getByRole('combobox', { name: '选择器械类型', exact: true }).selectOption('fixed');
    await expect(page.locator('.equipment-card')).toHaveCount(catalog.equipment.filter(e => e.brandId === brand.id && e.equipmentType === 'fixed').length);
    await page.getByRole('combobox', { name: '选择器械类型', exact: true }).selectOption('');
    await page.getByRole('combobox', { name: '搜索字段', exact: true }).selectOption('all');
    await page.locator('.equipment-advanced > summary').click();
    const search = page.getByRole('textbox', { name: '搜索器械', exact: true });
    await search.fill(equipment.name);
    await expect(page.locator('.equipment-card').first()).toBeVisible();
    await page.locator('.equipment-card').filter({ hasText: equipment.name }).first().click();
    await expect(page).toHaveURL(new RegExp(`#/equipment/${encodeURIComponent(equipment.id)}$`));
    await page.getByRole('dialog').last().getByRole('button', { name: '关闭器械详情', exact: true }).click();
    await expect(search).toHaveValue(equipment.name);
    await expect(page.locator('.equipment-sidebar .group-list .group-item.selected')).toHaveAccessibleName(new RegExp(brand.name));
    await page.locator('.equipment-card').first().click();
    await page.goBack();
    await expect(search).toHaveValue(equipment.name);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await search.fill('不存在的器械__web_acceptance__');
    await expect(page.locator('.equipment-card')).toHaveCount(0);
    await search.fill('');
    await expect(page.locator('.equipment-card')).toHaveCount(brandCount);
    await noWrites(page);
    await page.screenshot({ path: path.join(output, 'desktop-equipment.png') });
    passed.push('brand/search filters, empty search, close/back preserve filters');

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${base}/#/map`);
      await expect(page.locator('.gym-item').first()).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: path.join(output, `mobile-${width}-map.png`), fullPage: true });
      await page.getByRole('button', { name: '器械库', exact: true }).click();
      await expect(page.locator('.equipment-card').first()).toBeVisible();
      await noOverflow(page);
      await page.locator('.equipment-card').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: path.join(output, `mobile-${width}-detail.png`) });
    }
    passed.push('390 and 320 pixel mobile map, equipment and detail have no horizontal overflow');

    // Simulate network failure without changing the release data or files.
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.route('**/data/catalog.json*', route => route.fulfill({ status: 503, body: 'temporarily unavailable' }));
    await page.goto(base);
    const retry = page.getByRole('button', { name: /重试|重新加载|重新载入/ });
    await expect(retry).toBeVisible();
    await page.unroute('**/data/catalog.json*');
    await retry.click();
    await expect(page.locator('.gym-item')).toHaveCount(catalog.gyms.length);
    passed.push('failed data request exposes retry and recovers');

    for (const hash of ['#/gym/__missing__', '#/equipment/__missing__', '#/invalid/route']) {
      await page.goto(`${base}/${hash}`);
      await expect(page.getByRole('alert')).toContainText('这条资料不存在或已撤下');
      await page.getByRole('button', { name: '返回浏览', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.locator(hash.includes('equipment') ? '.equipment-card' : '.gym-item').first()).toBeVisible();
    }
    passed.push('missing gym, missing equipment and invalid routes recover to browsing');

    const emptyBody = JSON.stringify({ gyms: [], equipment: [], brands: [], links: [] });
    await page.route('**/data/catalog.json*', route => route.fulfill({ contentType: 'application/json', body: emptyBody }));
    await page.goto(base);
    await expect(page.getByRole('button', { name: /重试|重新加载|重新载入/ })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('资料正在更新');
    passed.push('catalog checksum mismatch is rejected before displaying partial data');

    const emptyManifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));
    emptyManifest.catalog.size = Buffer.byteLength(emptyBody);
    emptyManifest.catalog.sha256 = createHash('sha256').update(emptyBody).digest('hex');
    await page.route('**/data/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(emptyManifest) }));
    await page.goto(base);
    await expect(page.locator('.storage-state')).toContainText('公开资料');
    await expect(page.locator('.gym-item')).toHaveCount(0);
    await expect(page.locator('.setup-banner')).toHaveCount(0);
    await page.getByRole('button', { name: '器械库', exact: true }).click();
    await expect(page.locator('.equipment-card')).toHaveCount(0);
    await noWrites(page);
    passed.push('empty catalog remains navigable');
    assert.deepEqual(errors, [], 'Uncaught browser errors');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks: passed, errors }, null, 2));
    console.log(`PASS browser acceptance: ${passed.length} groups; screenshots in test-results/web`);
  } catch (error) {
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks: passed, errors, failure: error.stack }, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
