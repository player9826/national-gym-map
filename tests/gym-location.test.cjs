const { test } = require('node:test');
const assert = require('node:assert/strict');
const { countryOf, countryName, gymLocation, COUNTRIES } = require('../electron/gym-location.mjs');
const { gym } = require('../electron/catalog.cjs');

test('legacy country defaults and the exact Singapore exception do not infer other countries', () => {
  assert.equal(countryOf({ city: '上海' }), 'CN');
  assert.equal(countryOf({ province: ' sInGaPoRe ' }), 'SG');
  assert.equal(countryOf({ name: 'Iron House Singapore', city: 'Singapore' }), 'SG');
  assert.equal(countryOf({ name: 'Singapore gym', city: 'Singapore Road' }), 'CN');
  assert.equal(countryOf({ name: 'Tokyo gym', city: 'Tokyo' }), 'CN');
  assert.equal(countryOf({ country: 'JP', city: 'Singapore' }), 'JP');
  assert.equal(countryOf({ country: '自定义地区' }), '自定义地区');
});

test('Hong Kong Macao and Taiwan use China and are not separate country choices', () => {
  for (const country of ['HK', 'MO', 'TW', '香港', '澳门', '台湾']) {
    assert.equal(countryOf({ country }), 'CN');
    assert.equal(COUNTRIES.some(([code, name]) => code === country || name === country), false);
  }
  assert.equal(COUNTRIES[0][0], 'CN');
  assert.equal(COUNTRIES.length, 246);
  assert.equal(new Set(COUNTRIES.map(([code]) => code)).size, 246);
  assert.equal(countryName('SG'), '新加坡');
});

test('location display uses the country and address overseas without discarding domestic fields', () => {
  const source = { name: 'Legacy gym', city: 'Singapore', province: '', district: 'Original district', address: '17 Example Road' };
  const normalized = gym(source);
  assert.equal(normalized.country, 'SG');
  assert.equal(normalized.city, 'Singapore');
  assert.equal(normalized.district, 'Original district');
  assert.equal(source.country, undefined);
  assert.equal(gymLocation(normalized), '新加坡 · 17 Example Road');
  assert.equal(gymLocation({ country: 'JP' }), '日本');
  assert.equal(gymLocation({ province: '四川', city: '成都', district: '武侯区' }), '四川 · 成都 · 武侯区');
  assert.equal(gym({ ...normalized, country: 'CN' }).city, 'Singapore');
  assert.equal(normalized.lat, null);
  assert.equal(normalized.lng, null);
});
