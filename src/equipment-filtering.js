import {PARTS, partName, equipmentType} from './constants';

export function matchesEquipment(row, filters = {}, brands = []) {
  const {type, freeType, brand, part, application, loading, series, query = '', field = 'all'} = filters;
  if ((type && equipmentType(row) !== type) || (freeType && row.freeWeightType !== freeType) ||
      (brand && row.brandId !== brand) || (part && !(row.parts ?? [row.part]).includes(part)) ||
      (loading && row.loading !== loading) ||
      (application && !(row.tags || []).map(t => t === '推肩' ? '肩推' : t).includes(application))) return false;
  if (series && JSON.stringify([row.brandId, (row.series || '').trim()]) !== series) return false;
  const fields = {name:row.name || '', model:row.model || '', series:row.series || ''};
  const text = field === 'all' ? [...Object.values(fields), brands.find(b => b.id === row.brandId)?.name || ''].join(' ') : fields[field] || '';
  return text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function seriesOptions(equipment, brands, brand = '') {
  const values = new Map();
  for (const row of equipment) {
    const series = (row.series || '').trim();
    if (!series || (brand && row.brandId !== brand)) continue;
    const key = JSON.stringify([row.brandId, series]);
    const name = brands.find(b => b.id === row.brandId)?.name || '';
    values.set(key, brand ? series : `${name} · ${series}`);
  }
  return [...values].sort((a,b) => a[1].localeCompare(b[1], 'zh-CN'));
}

export function partOptions(equipment) {
  const custom = [...new Set(equipment.flatMap(row => row.parts || [row.part]).filter(p => typeof p === 'string' && p.startsWith('CUSTOM:')))];
  return [...PARTS, ...custom.sort((a,b) => a.localeCompare(b,'zh-CN')).map(p => [p, partName(p)])];
}
