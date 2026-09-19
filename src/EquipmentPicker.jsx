import React, { useState } from "react";
import EquipmentFilters from "./EquipmentFilters";
import {matchesEquipment} from "./equipment-filtering";
import { Modal, Picture, Tags, Field } from "./components";
import {
  PARTS,
  EQUIPMENT_TYPES,
  FREE_WEIGHT_TYPES,
  equipmentType,
  equipmentSummary,
} from "./constants";
export default function EquipmentPicker({
  gym,
  equipment,
  brands,
  links,
  onClose,
  onSave,
}) {
  const [filters, setFilters] = useState({});
  const [selection, setSelection] = useState({});
  const existing = links.filter(l => l.gymId === gym.id);
  const visible = equipment.filter(e => matchesEquipment(e, filters, brands));
  function change(id, key, value) {
    setSelection({ ...selection, [id]: { ...selection[id], [key]: value } });
  }
  return (
    <Modal
      title={`器械库选取 · ${gym.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="muted">已选 {Object.keys(selection).length} 款</span>
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            form="batch-links"
            disabled={!Object.keys(selection).length}
          >
            保存关联
          </button>
        </>
      }
    >
      <div className="picker-filters"><EquipmentFilters value={filters} onChange={setFilters} equipment={equipment} brands={brands} searchLabel="搜索待关联器械" /></div>
      <p className="linked-filter-results">匹配 {visible.length} 款</p>
      <div className="picker-grid">
        {visible.map((e) => {
          const old = existing.find((l) => l.equipmentId === e.id);
          return (
            <button
              type="button"
              className={`picker-card ${selection[e.id] ? "chosen" : ""}`}
              aria-pressed={!!selection[e.id]}
              key={e.id}
              onClick={() => {
                const next = { ...selection };
                if (next[e.id]) delete next[e.id];
                else
                  next[e.id] = old
                    ? { ...old }
                    : {
                        equipmentId: e.id,
                        quantity: 1,
                        status: "正常",
                        notes: "",
                        verifiedAt: "",
                      };
                setSelection(next);
              }}
            >
              <Picture src={e.image} alt={e.name} />
              <strong>{e.name}</strong>
              {e.series && <small>系列 · {e.series}</small>}
              <small>
                {brands.find((b) => b.id === e.brandId)?.name} ·{" "}
                {equipmentSummary(e)}
              </small>
              <small>
                {old
                  ? "已关联，选择可编辑"
                  : selection[e.id]
                    ? "已选择"
                    : "未关联"}
              </small>
              <Tags values={equipmentType(e) === "fixed" ? e.tags : []} />
            </button>
          );
        })}
      </div>
      {!visible.length && <p className="muted">没有符合条件的器械</p>}
      <form
        id="batch-links"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ gymId: gym.id, rows: Object.values(selection) });
        }}
      >
        {Object.entries(selection).map(([id, row]) => (
          <section className="detail-section" key={id}>
            <h3>{equipment.find((e) => e.id === id)?.name}</h3>
            <div className="form-grid">
              <Field label="数量">
                <input
                  required
                  min="1"
                  step="1"
                  type="number"
                  value={row.quantity}
                  onChange={(e) => change(id, "quantity", e.target.value)}
                />
              </Field>
              <Field label="器械状态">
                <select
                  value={row.status}
                  onChange={(e) => change(id, "status", e.target.value)}
                >
                  {["正常", "维修中", "待核实"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="备注">
                <input
                  value={row.notes}
                  onChange={(e) => change(id, "notes", e.target.value)}
                />
              </Field>
              <Field label="最后核实日期">
                <input
                  type="date"
                  value={row.verifiedAt || ""}
                  onChange={(e) => change(id, "verifiedAt", e.target.value)}
                />
              </Field>
            </div>
          </section>
        ))}
      </form>
    </Modal>
  );
}
