import React, {useLayoutEffect, useRef, useState} from 'react';
import {ArrowUpRight} from 'lucide-react';

// Measure the actual labels so long brand names cannot make a collapsed card taller.
export default function GymListTags({tags = [], brands = [], onBrand, onMore}) {
  const container = useRef(null);
  const measure = useRef(null);
  const [limit, setLimit] = useState(0);
  const items = [...tags.map((name, i) => ({key:`tag-${i}`, name})), ...brands.map(b => ({key:b.id, name:b.name, brand:b.id}))];
  const signature = JSON.stringify(items);
  useLayoutEffect(() => {
    const update = () => {
      const width = container.current.clientWidth;
      const widths = [...measure.current.children].map(el => Math.min(el.getBoundingClientRect().width, width));
      let row = 1, used = 0, count = 0;
      for (const itemWidth of widths) {
        if (used && used + 5 + itemWidth > width) { row++; used = 0; }
        if (row > 2) break;
        used += (used ? 5 : 0) + itemWidth;
        count++;
      }
      if (count < widths.length) {
        // Reserve room for the overflow control on the second line.
        row = 1; used = 0; count = 0;
        for (const itemWidth of widths) {
          if (used && used + 5 + itemWidth > width) { row++; used = 0; }
          if (row > 2 || (row === 2 && used + (used ? 5 : 0) + itemWidth > width - 65)) break;
          used += (used ? 5 : 0) + itemWidth;
          count++;
        }
      }
      setLimit(count);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [signature]);
  const hidden = items.length - limit;
  return <div className="gym-list-tags" ref={container}>
    <div className="gym-tag-measure" ref={measure} aria-hidden="true">
      {items.map(item => <span key={item.key} className={item.brand ? 'gym-brand-tag' : 'gym-label-tag'}>{item.name}{item.brand && <ArrowUpRight size={12}/>}</span>)}
    </div>
    {items.slice(0, limit).map(item => item.brand
      ? <button key={item.key} className="gym-brand-tag" title={item.name} onClick={() => onBrand(item.brand)}><span>{item.name}</span><ArrowUpRight size={12}/></button>
      : <span key={item.key} className="gym-label-tag" title={item.name}>{item.name}</span>)}
    {hidden > 0 && <button className="gym-tags-toggle" aria-label={`查看其余 ${hidden} 个标签`} onClick={onMore}>{`+${hidden}`}</button>}
  </div>;
}
