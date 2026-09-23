const {_electron: electron, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {Store} = require('../electron/storage.cjs');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-layout-'));
  const profile = path.join(temp, 'profile');
  const out = path.resolve('test-results/layout-density');
  fs.mkdirSync(out, {recursive:true});
  const store = new Store(path.join(profile, 'location.json'));
  store.configure(path.join(temp, 'data'));
  const brands = Array.from({length:12}, (_, i) => ({id:`brand-${i}`, name:`示例长名称器械品牌 ${i}`}));
  const tags = ['力量训练','专业场馆','私教课程','有氧训练','交通方便','器械种类丰富'];
  store.save({...store.db, brands, equipment:brands.map(b => ({id:`eq-${b.id}`, name:`器械 ${b.id}`, brandId:b.id, equipmentType:'fixed', part:'CHEST', parts:['CHEST'], tags:['推胸'], series:'示例系列'})),
    gyms:Array.from({length:6}, (_, i) => ({id:`gym-${i}`, name:`紧凑场馆 ${i}`, city:'上海', district:'浦东', lat:31.23+i*.01, lng:121.47, visited:false, tags, brandIds:brands.map(b => b.id), description:'完整简介留在详情与预览中'})), links:[]});
  let app;
  const errors = [], checks = [];
  try {
    app = await electron.launch({...(process.env.GYM_INSTALLED_EXE ? {executablePath:process.env.GYM_INSTALLED_EXE,args:[]} : {args:['.']}), env:{...process.env,GYM_TEST_PROFILE:profile,GYM_TEST_CONFIRM:'1'}});
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    for (const width of [1280,1024,820]) {
      await page.setViewportSize({width,height:800});
      await page.getByRole('button', {name:'健身房地图',exact:true}).click();
      const card = page.locator('.gym-item').first();
      await expect(card).toBeVisible();
      await expect(card.locator('.gym-tags-toggle')).toBeVisible();
      const metrics = await page.evaluate(() => {
        const card = document.querySelector('.gym-item');
        const tags = card.querySelector('.gym-list-tags');
        const items = [...tags.children].filter(el => !el.classList.contains('gym-tag-measure'));
        return {rows:new Set(items.map(el => Math.round(el.getBoundingClientRect().top))).size,
          cardHeight:card.getBoundingClientRect().height,
          listHeight:document.querySelector('.gym-list').getBoundingClientRect().height,
          overflow:items.some(el => el.getBoundingClientRect().right > tags.getBoundingClientRect().right+1)};
      });
      assert.ok(metrics.rows<=2, JSON.stringify(metrics));
      assert.equal(metrics.overflow,false);
      assert.ok(metrics.cardHeight<180, JSON.stringify(metrics));
      assert.ok(metrics.listHeight/metrics.cardHeight>2, JSON.stringify(metrics));
      await card.locator('.gym-tags-toggle').click();
      const detail = page.getByRole('dialog',{name:'健身房详情',exact:true});
      await expect(detail).toBeVisible();
      await expect(detail.locator('.brand-tags button')).toHaveCount(brands.length);
      await detail.locator('.brand-tags button').last().click();
      await expect(page.locator('.equipment-card')).toHaveCount(1);
      const equipmentMetrics = await page.evaluate(() => {
        const search = document.querySelector('.equipment-search-row');
        const input = search.querySelector('input').getBoundingClientRect();
        const sort = search.querySelector('[aria-label="器械排序"]').getBoundingClientRect();
        const filters = [...document.querySelectorAll('.equipment-filter-fields select')];
        const header = document.querySelector('.equipment-header').getBoundingClientRect();
        return {inputWidth:input.width, sameSearchRow:Math.abs(input.top-sort.top)<2, headerHeight:header.height,
          visibleFilters:filters.length, overflow:filters.some(el => el.getBoundingClientRect().right>innerWidth)};
      });
      assert.ok(equipmentMetrics.inputWidth<=280, JSON.stringify(equipmentMetrics));
      assert.equal(equipmentMetrics.sameSearchRow,true);
      assert.equal(equipmentMetrics.overflow,false);
      assert.ok(equipmentMetrics.visibleFilters>=4);
      assert.ok(equipmentMetrics.headerHeight<85);
      await page.screenshot({path:path.join(out,`equipment-${width}.png`)});
      await page.getByRole('button',{name:'健身房地图',exact:true}).click();
      await card.hover();
      await expect(page.locator('.gym-preview')).toBeVisible();
      await page.mouse.move(width-10,10);
      await page.screenshot({path:path.join(out,`map-${width}.png`)});
      checks.push(`${width}px: two tag rows, overflow details and brand navigation, compact search/filters, retained hover preview`);
    }
    assert.deepEqual(errors,[]);
    const result = {passed:true,checks,temp};
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } catch(error) {
    if(app) await (await app.firstWindow()).screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
    throw error;
  } finally { if(app) await app.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
