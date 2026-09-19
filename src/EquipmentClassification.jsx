import React, { useState } from "react";
import { Field } from "./components";
import {
  EQUIPMENT_TYPES,
  FREE_WEIGHT_TYPES,
  PARTS,
  TAGS,
  PART_TAGS,
  tagLabel,
  isCustomPart,
  partName,
} from "./constants";

export function classificationChange(row, equipmentType) {
  return {
    ...row,
    equipmentType,
    freeWeightType: "",
    part: "",
    parts: [],
    tags: [],
    loading: "",
  };
}

export default function EquipmentClassification({
  row,
  onChange,
  required = true,
  knownParts = [],
}) {
  const [showOther, setShowOther] = useState(false), [other, setOther] = useState("");
  const parts = row.parts ?? (row.part ? [row.part] : []);
  const customParts = [...new Set([...knownParts, ...parts].filter(isCustomPart))];
  const selectParts = (next) => onChange({ ...row, parts: next, part: next[0] || "", tags: (row.tags || []).filter(tag => next.some(part => PART_TAGS[part]?.includes(tag))) });
  const addOther = () => {
    const name = other.trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").slice(0, 30);
    if (!name || parts.length >= 20) return;
    const existing = PARTS.find(([, label]) => label === name)?.[0];
    selectParts([...new Set([...parts, existing || `CUSTOM:${name}`])]);
    setOther("");
  };
  const available = TAGS.filter((tag) =>
    parts.some((part) => PART_TAGS[part]?.includes(tag)),
  );
  return (
    <>
      <Field label="器械类型" required={required} full>
        <select
          aria-label="器械类型"
          required={required}
          value={row.equipmentType || ""}
          onChange={(e) => onChange(classificationChange(row, e.target.value))}
        >
          <option value="">请选择器械类型</option>
          {EQUIPMENT_TYPES.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      {row.equipmentType === "free_weight" && (
        <Field label="自由力量子类" required={required} full>
          <select
            aria-label="自由力量子类"
            required={required}
            value={row.freeWeightType || ""}
            onChange={(e) =>
              onChange({ ...row, freeWeightType: e.target.value })
            }
          >
            <option value="">请选择子类</option>
            {FREE_WEIGHT_TYPES.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {row.equipmentType === "fixed" && (
        <>
          <div className="field full">
            <span>部位（多选）{required ? " *" : ""}</span>
            <div className="tag-checks">
              {PARTS.map(([code, name]) => (
                <label key={code}>
                  <input
                    type="checkbox"
                    checked={parts.includes(code)}
                    disabled={!parts.includes(code) && parts.length >= 20}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...parts, code]
                        : parts.filter((p) => p !== code);
                      onChange({
                        ...row,
                        parts: next,
                        part: next[0] || "",
                        tags: (row.tags || []).filter((tag) =>
                          next.some((part) => PART_TAGS[part]?.includes(tag)),
                        ),
                      });
                    }}
                  />
                  {name}
                </label>
              ))}
              {customParts.map(code => <label key={code}><input type="checkbox" checked={parts.includes(code)} disabled={!parts.includes(code) && parts.length >= 20} onChange={event => selectParts(event.target.checked ? [...parts, code] : parts.filter(part => part !== code))} />{partName(code)}</label>)}
              <label><input type="checkbox" checked={showOther} onChange={event => setShowOther(event.target.checked)} />其他</label>
            </div>
            {showOther && <div className="custom-part-entry">
              <input aria-label="其他部位名称" placeholder="例如：颈部" maxLength={30} value={other} onChange={event => setOther(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addOther(); } }} />
              <button type="button" disabled={!other.trim() || parts.length >= 20} onClick={addOther}>添加部位</button>
              <small>添加后可重复选择；仅选自定义部位时可以不填应用标签。</small>
            </div>}
          </div>
          <div className="field full">
            <span>应用标签{required && parts.some(part => PART_TAGS[part]) ? " *" : ""}</span>
            <div className="tag-checks">
              {available.map((tag) => (
                <label key={tag}>
                  <input
                    type="checkbox"
                    checked={(row.tags || []).includes(tag)}
                    onChange={(e) =>
                      onChange({
                        ...row,
                        tags: e.target.checked
                          ? [...(row.tags || []), tag]
                          : (row.tags || []).filter((t) => t !== tag),
                      })
                    }
                  />
                  {tagLabel(tag)}
                </label>
              ))}
            </div>
            {!parts.length && <small>请先选择部位，再选择对应应用标签。</small>}
          </div>
          <Field label="负重类型">
          <select
            aria-label="负重类型"
            value={row.loading || ""}
              onChange={(e) => onChange({ ...row, loading: e.target.value })}
            >
              <option value="">未分类</option>
              <option>插片</option>
              <option>挂片</option>
            </select>
          </Field>
        </>
      )}
    </>
  );
}
