import React from 'react';
import {EQUIPMENT_TYPES, FREE_WEIGHT_TYPES, PART_TAGS, TAGS} from './constants';
import {partOptions, seriesOptions} from './equipment-filtering';
import './equipment-filters.css';

export default function EquipmentFilters({value, onChange, equipment, brands, showType = true, showBrand = true, searchLabel = '搜索器械', sortControl, collapsible = false}) {
  const update = patch => onChange({...value, ...patch});
  const fixed = !value.type || value.type === 'fixed';
  const applications = PART_TAGS[value.part] || [];
  const searchField = <select aria-label="搜索字段" value={value.field || 'all'} onChange={e => update({field:e.target.value})}>
        <option value="all">综合搜索</option><option value="series">仅系列</option><option value="name">仅名称</option><option value="model">仅型号</option>
      </select>;
  const fields = <div className="equipment-filter-fields">
      {showType && <select aria-label="选择器械类型" value={value.type || ''} onChange={e => update({type:e.target.value,freeType:'',part:'',application:'',loading:''})}>
        <option value="">全部类型</option>{EQUIPMENT_TYPES.map(([id,label]) => <option key={id} value={id}>{label}</option>)}
      </select>}
      {showBrand && <select aria-label="选择器械品牌" value={value.brand || ''} onChange={e => update({brand:e.target.value,series:''})}>
        <option value="">全部品牌</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>}
      <select aria-label="器械系列筛选" value={value.series || ''} onChange={e => update({series:e.target.value})}>
        <option value="">全部系列</option>{seriesOptions(equipment,brands,value.brand).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      {fixed && <select aria-label="器械部位筛选" value={value.part || ''} onChange={e => update({part:e.target.value,application:''})}>
        <option value="">全部部位</option>{partOptions(equipment).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
      </select>}
      {fixed && !value.part && <select aria-label="应用标签筛选" value={value.application || ''} onChange={e => update({application:e.target.value})}>
        <option value="">全部应用标签</option>{TAGS.map(tag => <option key={tag} value={tag}>{tag === '肩推' ? '推肩' : tag}</option>)}
      </select>}
      {fixed && <select aria-label="器械负重类型筛选" value={value.loading || ''} onChange={e => update({loading:e.target.value})}>
        <option value="">全部负重</option><option>插片</option><option>挂片</option>
      </select>}
      {value.type === 'free_weight' && <select aria-label="自由力量子类筛选" value={value.freeType || ''} onChange={e => update({freeType:e.target.value})}>
        <option value="">全部自由力量</option>{FREE_WEIGHT_TYPES.map(([id,label]) => <option key={id} value={id}>{label}</option>)}
      </select>}
    </div>;
  const secondary = fixed && applications.length > 0 && <div className="equipment-secondary" role="group" aria-label="器械二级分类">
      {['',...applications].map(tag => <button type="button" key={tag} aria-pressed={(value.application || '') === tag} className={(value.application || '') === tag ? 'selected' : ''} onClick={() => update({application:tag})}>{tag ? (tag === '肩推' ? '推肩' : tag) : '全部'}</button>)}
    </div>;
  return <div className={`equipment-filters${collapsible ? ' collapsible' : ''}`}>
    <div className="equipment-search-row">
      {!collapsible && searchField}
      <input aria-label={searchLabel} placeholder="输入搜索内容" value={value.query || ''} onChange={e => update({query:e.target.value})}/>
      {!collapsible && sortControl}
      {collapsible && <details className="equipment-advanced">
        <summary>筛选与排序</summary>
        <div className="equipment-advanced-content">
          {searchField}{sortControl}{fields}{secondary}
        </div>
      </details>}
    </div>
    {!collapsible && fields}
    {!collapsible && secondary}
  </div>;
}
