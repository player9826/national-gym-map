const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { Store } = require('../electron/storage.cjs');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-equipment-filters-'));
  const profile = path.join(temp, 'profile');
  const out = path.resolve('test-results/equipment-filters');
  fs.mkdirSync(out, { recursive: true });
  const store = new Store(path.join(profile, 'location.json'));
  store.configure(path.join(temp, 'data'));
  const fixed = (id, name, brandId, part, tag, model, series) => ({ id, name, brandId, equipmentType: 'fixed', parts: [part], part, tags: [tag], model, series, loading: '挂片' });
  const rows = [
    fixed('a-push', '甲推胸名称词', 'fixture-a', 'CHEST', '推胸', 'MODEL-A', '共同系列'),
    fixed('a-fly', '甲夹胸', 'fixture-a', 'CHEST', '夹胸', 'FLY-A', '甲独有系列'),
    fixed('a-back', '甲背下拉', 'fixture-a', 'BACK', '背下拉', 'BACK-A', ''),
    ...['cardio', 'free_weight', 'cable_station'].map((equipmentType, i) => ({ id: `a-type-${i}`, name: `甲类型${i}`, brandId: 'fixture-a', equipmentType, freeWeightType: equipmentType === 'free_weight' ? 'dumbbell' : '', parts: [], tags: [], series: '' })),
    fixed('b-push', '乙推胸', 'fixture-b', 'CHEST', '推胸', 'MODEL-B', '共同系列'),
    ...Array.from({ length: 40 }, (_, i) => fixed(`b-fill-${i}`, `乙背部填充${String(i).padStart(2, '0')}`, 'fixture-b', 'BACK', '背后拉', `FILL-${i}`, '乙独有系列')),
  ];
  store.save({ ...store.db, brands: [{ id: 'fixture-a', name: '测试甲牌' }, { id: 'fixture-b', name: '测试乙牌' }], equipment: rows,
    gyms: [{ id: 'fixture-gym', name: '筛选测试场馆', city: '上海', visited: false, lat: 31.23, lng: 121.47, brandIds: ['fixture-a', 'fixture-b'] }],
    links: ['a-push', 'a-fly', 'b-push'].map((equipmentId, i) => ({ id: `link-${i}`, gymId: 'fixture-gym', equipmentId, quantity: 1, status: '正常' })) });
  let app;
  const checks = [], errors = [];
  try {
    app = await electron.launch({ ...(process.env.GYM_INSTALLED_EXE ? {executablePath:process.env.GYM_INSTALLED_EXE,args:[]} : {args:['.']}), env: { ...process.env, GYM_TEST_PROFILE: profile, GYM_TEST_CONFIRM: '1' } });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    // All assets and data come from this isolated local fixture. Block external renderer traffic.
    await page.route(/^https?:/, route => route.abort());
    await page.getByRole('button', { name: '器械库', exact: true }).click();
    const cards = page.locator('.equipment-card');
    const main = page.locator('.equipment-main');
    const brand = name => page.locator('.equipment-sidebar .group-item').filter({ has: page.locator(`[title="${name}"]`) });
    const typeTab = name => page.locator('.equipment-type-tabs button').filter({ hasText: name });
    const sub = scope => scope.getByRole('group', { name: '器械二级分类' });
    const series = scope => scope.getByLabel('器械系列筛选', { exact: true });
    const field = scope => scope.getByLabel('搜索字段', { exact: true });
    const query = main.getByLabel('搜索器械', { exact: true });
    await main.locator('.equipment-advanced > summary').click();
    const type = main.getByLabel('选择器械类型', { exact: true });
    await brand('测试甲牌').click();
    await expect(cards).toHaveCount(6);
    await expect(typeTab('全部').locator('span')).toHaveText('6');
    await expect(typeTab('固定器械')).toHaveCount(0);
    await query.fill('不存在的搜索词');
    await expect(cards).toHaveCount(0);
    await expect(typeTab('全部').locator('span')).toHaveText('6');
    await query.fill('');
    checks.push('Top-level counts stay within selected brand and ignore text search');
    await type.selectOption('fixed');
    await main.getByLabel('器械部位筛选', { exact: true }).selectOption('CHEST');
    await expect(cards).toHaveCount(2);
    await expect(sub(main).getByRole('button')).toHaveCount(3);
    await sub(main).getByRole('button', { name: '推胸', exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('甲推胸名称词');
    await sub(main).getByRole('button', { name: '夹胸', exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('甲夹胸');
    await sub(main).getByRole('button', { name: '全部', exact: true }).click();
    checks.push('Brand and part combine; CHEST secondary buttons filter push and fly');
    for (const [label, text, count] of [['all', 'MODEL-A', 1], ['name', 'MODEL-A', 0], ['name', '名称词', 1], ['model', 'MODEL-A', 1], ['series', '甲独有系列', 1]]) {
      await field(main).selectOption(label);
      await query.fill(text);
      await expect(cards).toHaveCount(count);
    }
    await query.fill('');
    await field(main).selectOption('all');
    const opts = await series(main).locator('option').allTextContents();
    assert.ok(opts.includes('共同系列') && opts.includes('甲独有系列'));
    assert.ok(!opts.some(x => x.includes('乙独有系列')));
    assert.equal(opts.filter(x => x.trim() === '').length, 0);
    await series(main).selectOption(JSON.stringify(['fixture-a', '共同系列']));
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('甲推胸名称词');
    checks.push('Field-specific search; series options scoped to brand with empty values excluded');
    // Create classifications through the real form, not directly through a handler.
    for (const [name, partLabel, tag] of [['保存小臂', '手臂', '小臂'], ['保存小腿', '腿', '小腿'], ['保存颈部', '其他', '']]) {
      await page.getByRole('button', { name: '新增器械', exact: true }).first().click();
      const form = page.getByRole('dialog', { name: '新增器械', exact: true });
      await form.getByLabel('品牌', { exact: false }).first().selectOption('fixture-a');
      await form.getByLabel('器械名称', { exact: false }).fill(name);
      await form.getByLabel('器械类型', { exact: true }).selectOption('fixed');
      await form.getByLabel(partLabel, { exact: true }).check();
      if (tag) await form.getByLabel(tag, { exact: true }).check();
      else {
        await form.getByLabel('其他部位名称').fill('颈部');
        await form.getByRole('button', { name: '添加部位', exact: true }).click();
      }
      const seriesInput = form.getByLabel('系列（可留空）', { exact: true });
      const suggestions = form.locator('#equipment-series-suggestions option');
      const suggested = await suggestions.evaluateAll(a => a.map(e => e.value));
      assert.ok(suggested.includes('甲独有系列'));
      assert.ok(!suggested.includes('乙独有系列'));
      await seriesInput.fill('临时系列');
      await form.getByLabel('品牌', { exact: false }).first().selectOption('fixture-b');
      await expect(seriesInput).toHaveValue('');
      assert.ok((await suggestions.evaluateAll(a => a.map(e => e.value))).includes('乙独有系列'));
      await form.getByLabel('品牌', { exact: false }).first().selectOption('fixture-a');
      await seriesInput.fill(`新系列 ${name}`);
      await form.getByRole('button', { name: '保存器械', exact: true }).click();
      await expect(form).toHaveCount(0);
      const saved = (await page.evaluate(() => window.desktop.call('state'))).equipment.find(e => e.name === name);
      assert.ok(saved);
      assert.equal(saved.series, `新系列 ${name}`);
      assert.ok(saved.parts.includes(tag === '小臂' ? 'ARM' : tag === '小腿' ? 'LEG' : 'CUSTOM:颈部'));
      if (tag) assert.ok(saved.tags.includes(tag));
      await page.getByRole('dialog', { name: '器械详情', exact: true }).getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    checks.push('ARM forearm, LEG calf and CUSTOM:neck persist; series suggestions and reset respect brand');
    await brand('测试乙牌').click();
    await main.getByLabel('器械部位筛选', { exact: true }).selectOption('BACK');
    await query.fill('填充');
    await expect(cards).toHaveCount(40);
    await cards.last().scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: '返回器械列表顶部', exact: true }).click();
    await expect(query).toHaveValue('填充');
    await expect(main.getByLabel('器械部位筛选', { exact: true })).toHaveValue('BACK');
    await expect(cards).toHaveCount(40);
    await expect(cards.first()).toBeInViewport();
    checks.push('Return-to-top preserves brand, part and search filters');
    await page.getByRole('button', { name: '健身房地图', exact: true }).click();
    await page.locator('.gym-item').filter({ hasText: '筛选测试场馆' }).click();
    const gym = page.getByRole('dialog', { name: '健身房详情', exact: true });
    await gym.getByRole('button', { name: '关联器械', exact: true }).click();
    // Link entry may open an intermediate choice form.
    const libraryChoice = page.getByRole('button', { name: /从器械库/ });
    if (await libraryChoice.count()) await libraryChoice.click();
    const picker = page.getByRole('dialog', { name: '器械库选取 · 筛选测试场馆', exact: true });
    await picker.getByLabel('选择器械品牌', { exact: true }).selectOption('fixture-a');
    await picker.getByLabel('选择器械类型', { exact: true }).selectOption('fixed');
    await picker.getByLabel('器械部位筛选', { exact: true }).selectOption('CHEST');
    await sub(picker).getByRole('button', { name: '推胸', exact: true }).click();
    await expect(picker.locator('.picker-card')).toHaveCount(1);
    await picker.locator('.picker-card').click();
    await sub(picker).getByRole('button', { name: '夹胸', exact: true }).click();
    await expect(picker.locator('.picker-card')).toHaveCount(1);
    await picker.locator('.picker-card').click();
    await sub(picker).getByRole('button', { name: '全部', exact: true }).click();
    await expect(picker.locator('.picker-card[aria-pressed="true"]')).toHaveCount(2);
    await field(picker).selectOption('model');
    await picker.getByLabel('搜索待关联器械').fill('MODEL-A');
    await expect(picker.locator('.picker-card')).toHaveCount(1);
    await expect(picker.locator('.picker-card')).toHaveAttribute('aria-pressed', 'true');
    await picker.getByRole('button', { name: '保存关联', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await gym.getByLabel('选择器械品牌', { exact: true }).selectOption('fixture-a');
    await gym.getByLabel('器械部位筛选', { exact: true }).selectOption('CHEST');
    await sub(gym).getByRole('button', { name: '夹胸', exact: true }).click();
    await expect(gym.locator('.linked-item')).toHaveCount(1);
    await expect(gym.locator('.linked-item')).toContainText('甲夹胸');
    checks.push('Picker filtering retains selections; linked gym list uses equivalent filters');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(out, 'final.png') });
    await app.close();
    app = await electron.launch({ ...(process.env.GYM_INSTALLED_EXE ? {executablePath:process.env.GYM_INSTALLED_EXE,args:[]} : {args:['.']}), env: {...process.env, GYM_TEST_PROFILE:profile} });
    const reopened = await app.firstWindow();
    await reopened.waitForFunction(() => !!window.desktop);
    const persisted = await reopened.evaluate(() => window.desktop.call('state'));
    const custom = persisted.equipment.find(e => e.name === '保存颈部');
    assert.equal(custom.series, '新系列 保存颈部');
    assert.deepEqual(custom.parts, ['CUSTOM:颈部']);
    checks.push('Series and custom part survive an actual application restart');
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ passed: true, checks, errors, temp }, null, 2));
    console.log(JSON.stringify({ passed: true, checks, temp }, null, 2));
  } catch (error) {
    if (app) await (await app.firstWindow()).screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ passed: false, checks, errors, error: error.stack, temp }, null, 2));
    throw error;
  } finally { if (app) await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
