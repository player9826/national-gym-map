import React, { useEffect, useRef, useState } from "react";
import { Modal, Field } from "./components";
import EquipmentClassification from "./EquipmentClassification";
import { EQUIPMENT_TYPES, equipmentSummary } from "./constants";
import "./batch-import.css";

const STATES = {
  pending: "待导入",
  imported: "已导入",
  deferred: "暂缓",
  ignored: "忽略",
  fetch_failed: "读取失败",
  possible_duplicate: "疑似重复",
  incomplete: "资料不足",
};
const call = (method, payload) => window.desktop.call(method, payload);
const emptyClass = {
  equipmentType: "",
  freeWeightType: "",
  parts: [],
  tags: [],
  loading: "",
};

function CandidateEditor({ candidate, disabled, onSave, onCancel }) {
  const [row, setRow] = useState({ ...candidate });
  return (
    <section className="batch-editor" aria-label="编辑候选器械">
      <h3>整理候选 · {candidate.name || "未命名"}</h3>
      <div className="form-grid">
        <Field label="候选名称">
          <input
            value={row.name || ""}
            onChange={(e) => setRow({ ...row, name: e.target.value })}
          />
        </Field>
        <Field label="候选型号">
          <input
            value={row.model || ""}
            onChange={(e) => setRow({ ...row, model: e.target.value })}
          />
        </Field>
        <Field label="候选处理状态">
          <select
            value={row.status}
            onChange={(e) => setRow({ ...row, status: e.target.value })}
          >
            {Object.entries(STATES)
              .filter(([key]) => key !== "imported")
              .map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
          </select>
        </Field>
        <EquipmentClassification row={row} onChange={setRow} required={false} />
        <Field label="候选系列">
          <input
            value={row.series || ""}
            onChange={(e) => setRow({ ...row, series: e.target.value })}
          />
        </Field>
        <Field label="图片来源地址">
          <input
            value={row.imageSource || ""}
            onChange={(e) => setRow({ ...row, imageSource: e.target.value })}
          />
        </Field>
        <Field label="候选备注" full>
          <textarea
            value={row.notes || ""}
            onChange={(e) => setRow({ ...row, notes: e.target.value })}
          />
        </Field>
      </div>
      <div className="batch-actions">
        <button disabled={disabled} onClick={onCancel}>
          取消编辑
        </button>
        <button
          className="primary"
          disabled={disabled}
          onClick={() => onSave(row)}
        >
          保存候选修改
        </button>
      </div>
    </section>
  );
}

export default function BatchImport({ db, onClose, onSaved }) {
  const [brandId, setBrandId] = useState(db.brands[0]?.id || ""),
    [url, setUrl] = useState("");
  const [batches, setBatches] = useState([]),
    [batch, setBatch] = useState(null);
  const [selected, setSelected] = useState([]),
    [filter, setFilter] = useState(""),
    [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false),
    [queue, setQueue] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [bulk, setBulk] = useState(emptyClass),
    [editor, setEditor] = useState(null),
    [confirmation, setConfirmation] = useState(null),
    [assistedId, setAssistedId] = useState(null);
  const stopped = useRef(false),
    mounted = useRef(true),
    working = useRef(false);
  useEffect(() => {
    call("batchList")
      .then(setBatches)
      .catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
      stopped.current = true;
    };
  }, []);
  async function action(fn) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      return await fn();
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function adopt(next) {
    if (!mounted.current) return;
    setBatch(next);
    setConfirmation(null);
    setBatches((old) => [next, ...old.filter((b) => b.id !== next.id)]);
  }
  function close() {
    if (working.current) {
      stopped.current = true;
      setNotice("正在完成当前读取，完成后即可关闭；候选已自动保存。");
    } else onClose();
  }
  async function scan(browser = false) {
    await action(async () => {
      const result = await call("batchScan", { brandId, url, browser });
      adopt(result);
      setSelected([]);
      setEditor(null);
    });
  }
  async function update(ids, patch) {
    if (!ids.length) {
      setError("请先选择候选器械。");
      return;
    }
    await action(async () => {
      adopt(
        await call("batchUpdate", { id: batch.id, candidateIds: ids, patch }),
      );
      setEditor(null);
      setNotice("候选修改已保存，尚未正式入库。");
    });
  }
  async function fetchRows(ids) {
    if (!ids.length) {
      setNotice("没有需要读取的详情。");
      return;
    }
    await action(async () => {
      stopped.current = false;
      setQueue(true);
      try {
        for (let i = 0; i < ids.length && !stopped.current; i++) {
          setNotice(
            `正在读取详情 ${i + 1} / ${ids.length}，每项完成后自动保存。`,
          );
          adopt(
            await call("batchFetch", { id: batch.id, candidateId: ids[i] }),
          );
        }
        if (mounted.current)
          setNotice(
            stopped.current
              ? "已暂停，稍后可继续补全详情。"
              : "详情队列已完成，请检查分类建议和失败项。",
          );
      } finally {
        if (mounted.current) setQueue(false);
      }
    });
  }
  const candidates = batch?.candidates || [];
  const visible = candidates.filter(
    (c) =>
      (!filter || c.status === filter) &&
      (!search ||
        `${c.name} ${c.model}`.toLowerCase().includes(search.toLowerCase())),
  );
  const editable = visible.filter((c) => c.status !== "imported");
  const selectedIds = selected.filter((id) =>
    candidates.some((c) => c.id === id && c.status !== "imported"),
  );
  const counts = [...EQUIPMENT_TYPES, ["", "无法判断"]].map(
    ([type, label]) =>
      `${label}：${candidates.filter((c) => (c.equipmentType || "") === type).length}`,
  );
  return (
    <Modal
      title="批量器械导入工作台"
      wide
      onClose={close}
      footer={
        <>
          <span className="batch-footer-note">
            批次自动保存 · 正式入库前需确认
          </span>
          <button disabled={busy} onClick={close}>
            关闭工作台
          </button>
          <button
            className="primary"
            disabled={busy || !candidates.length}
            onClick={() =>
              action(async () => {
                const result = await call("batchPreview", { id: batch.id });
                adopt(result.batch);
                setConfirmation(result);
              })
            }
          >
            检查重复并预览入库
          </button>
        </>
      }
    >
      <div className="batch-workbench">
        <p>
          扫描目录后先整理候选，分类建议可以修改。暂缓和忽略会保留，下次扫描同一来源时沿用。
        </p>
        <div className="batch-source">
          <Field label="导入品牌">
            <select
              disabled={busy}
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
            >
              {db.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="目录或系列页地址">
            <input
              type="url"
              disabled={busy}
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <button
            className="primary"
            disabled={busy || !brandId || !url.trim()}
            onClick={() => scan()}
          >
            扫描页面
          </button>
        </div>
        <div className="batch-actions">
          <button
            disabled={busy || !url.trim()}
            onClick={() => action(() => call("browserOpen", { url }))}
          >
            打开辅助浏览器
          </button>
          <button disabled={busy || !brandId} onClick={() => scan(true)}>
            扫描辅助浏览器当前页
          </button>
          <label>
            继续已有批次{" "}
            <select
              aria-label="继续已有批次"
              disabled={busy}
              value={batch?.id || ""}
              onChange={(e) =>
                e.target.value &&
                action(async () => {
                  adopt(await call("batchRead", { id: e.target.value }));
                  setSelected([]);
                  setEditor(null);
                })
              }
            >
              <option value="">选择已保存批次</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {db.brands.find((x) => x.id === b.brandId)?.name || "品牌"} ·{" "}
                  {new Date(b.createdAt).toLocaleString()} ·{" "}
                  {b.totalFound ?? b.candidates?.length ?? 0} 项
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="batch-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {batch?.error && (
          <p className="batch-error" role="alert">
            {batch.error.status ? `状态 ${batch.error.status} · ` : ""}
            {batch.error.message || String(batch.error)}
          </p>
        )}
        {batch && (
          <>
            <div className="batch-stats">
              <strong>发现产品：{candidates.length}</strong>
              {counts.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <div className="batch-actions">
              <button
                disabled={busy}
                onClick={() =>
                  fetchRows(
                    candidates
                      .filter(
                        (c) =>
                          !c.detailFetched &&
                          !["ignored", "deferred", "imported"].includes(
                            c.status,
                          ),
                      )
                      .map((c) => c.id),
                  )
                }
              >
                补全未读取详情
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  fetchRows(
                    candidates
                      .filter(
                        (c) =>
                          c.status === "fetch_failed" &&
                          (!selectedIds.length || selectedIds.includes(c.id)),
                      )
                      .map((c) => c.id),
                  )
                }
              >
                重试失败项
              </button>
              {queue && (
                <button
                  onClick={() => {
                    stopped.current = true;
                    setNotice("将在当前详情完成后暂停。");
                  }}
                >
                  暂停详情队列
                </button>
              )}
              <Field label="候选状态">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="">全部状态</option>
                  {Object.entries(STATES).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="搜索候选">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="名称或型号"
                />
              </Field>
            </div>
            <details className="batch-bulk">
              <summary>批量整理 · 已选 {selectedIds.length} 项</summary>
              <div className="form-grid">
                <EquipmentClassification
                  row={bulk}
                  onChange={setBulk}
                  required={false}
                />
              </div>
              <div className="batch-actions">
                <button
                  disabled={busy || !selectedIds.length || !bulk.equipmentType}
                  onClick={() => update(selectedIds, bulk)}
                >
                  应用所选分类
                </button>
                {["pending", "deferred", "ignored"].map((status) => (
                  <button
                    key={status}
                    disabled={busy || !selectedIds.length}
                    onClick={() => update(selectedIds, { status })}
                  >
                    设为{STATES[status]}
                  </button>
                ))}
              </div>
            </details>
            <div className="batch-table-scroll">
              <table className="batch-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="选择当前列表全部候选"
                        disabled={busy || !editable.length}
                        checked={
                          !!editable.length &&
                          editable.every((c) => selectedIds.includes(c.id))
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [
                                  ...new Set([
                                    ...selected,
                                    ...editable.map((c) => c.id),
                                  ]),
                                ]
                              : selected.filter(
                                  (id) => !editable.some((c) => c.id === id),
                                ),
                          )
                        }
                      />
                    </th>
                    <th>图片</th>
                    <th>产品 / 型号</th>
                    <th>分类建议</th>
                    <th>来源</th>
                    <th>状态 / 重复检查</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.id} data-candidate-id={c.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择 ${c.name || "未命名"}`}
                          checked={selectedIds.includes(c.id)}
                          disabled={busy || c.status === "imported"}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked
                                ? [...old, c.id]
                                : old.filter((id) => id !== c.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        {c.thumbnail?.startsWith("data:image/") ? (
                          <img
                            className="batch-thumbnail"
                            src={c.thumbnail}
                            alt={c.name}
                            onError={(e) => {
                              e.currentTarget.style.visibility = "hidden";
                            }}
                          />
                        ) : (
                          <span className="batch-no-image">
                            {c.imageSource ? "待预览" : "暂无图片"}
                          </span>
                        )}
                      </td>
                      <td>
                        <strong>{c.name || "未命名"}</strong>
                        <small>{c.model || "型号待补充"}</small>
                        {c.series && <small>{c.series}</small>}
                      </td>
                      <td>
                        {equipmentSummary(c)}
                        <small>{(c.tags || []).join(" / ")}</small>
                      </td>
                      <td>
                        <button
                          className="batch-link"
                          disabled={busy}
                          onClick={() =>
                            action(() =>
                              call("external", c.sourceUrl || c.productUrl),
                            )
                          }
                        >
                          官网来源 ↗
                        </button>
                      </td>
                      <td>
                        <span className={`batch-status ${c.status}`}>
                          {STATES[c.status] || c.status}
                        </span>
                        {c.error && (
                          <small className="batch-error">
                            {c.error.status ? `${c.error.status} · ` : ""}
                            {c.error.message || String(c.error)}
                          </small>
                        )}
                        {c.duplicate?.kind !== "new" &&
                          c.duplicate?.equipmentId && (
                            <small>
                              {c.duplicate.kind === "exact"
                                ? "确定重复"
                                : "疑似重复"}
                              ：{c.duplicate.name}
                            </small>
                          )}
                        {c.status !== "imported" &&
                          c.duplicate?.equipmentId && (
                            <select
                              aria-label={`重复处理 ${c.name}`}
                              disabled={busy}
                              value={c.decision || ""}
                              onChange={(e) =>
                                update([c.id], { decision: e.target.value })
                              }
                            >
                              <option value="">请选择处理方式</option>
                              <option value="supplement">
                                仅补充已有空字段
                              </option>
                              <option value="new">明确作为新记录</option>
                              <option value="ignore">忽略</option>
                            </select>
                          )}
                      </td>
                      <td>
                        <div className="batch-row-actions">
                          <button
                            disabled={busy || c.status === "imported"}
                            onClick={() => {
                              setEditor(c.id);
                              setConfirmation(null);
                            }}
                          >
                            编辑
                          </button>
                          <button
                            disabled={busy || c.status === "imported"}
                            onClick={() => fetchRows([c.id])}
                          >
                            {c.detailFetched ? "重读" : "读取详情"}
                          </button>
                          {c.status === "fetch_failed" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                action(async () => {
                                  await call("browserOpen", {
                                    url: c.sourceUrl,
                                  });
                                  setAssistedId(c.id);
                                  setNotice(
                                    "请在辅助浏览器中查看该产品，页面加载完成后点击该行“读取辅助页”。",
                                  );
                                })
                              }
                            >
                              辅助打开
                            </button>
                          )}
                          {assistedId === c.id && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                action(async () => {
                                  adopt(
                                    await call("batchFetch", {
                                      id: batch.id,
                                      candidateId: c.id,
                                      browser: true,
                                    }),
                                  );
                                })
                              }
                            >
                              读取辅助页
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && <p>当前筛选下没有候选。</p>}
            </div>
            {editor && candidates.some((c) => c.id === editor) && (
              <CandidateEditor
                key={editor}
                candidate={candidates.find((c) => c.id === editor)}
                disabled={busy}
                onCancel={() => setEditor(null)}
                onSave={(row) =>
                  update([editor], {
                    name: row.name,
                    model: row.model,
                    series: row.series,
                    notes: row.notes,
                    imageSource: row.imageSource,
                    equipmentType: row.equipmentType,
                    freeWeightType: row.freeWeightType,
                    parts: row.parts,
                    tags: row.tags,
                    loading: row.loading,
                    status: row.status,
                  })
                }
              />
            )}
            {confirmation && (
              <section className="batch-confirm" aria-label="最终导入确认">
                <h3>本次入库预览</h3>
                <div className="batch-stats">
                  {[
                    ["added", "新增器械"],
                    ["supplemented", "补充已有"],
                    ["duplicates", "重复"],
                    ["deferred", "暂缓"],
                    ["ignored", "忽略"],
                    ["failed", "读取失败"],
                    ["images", "计划下载图片"],
                  ].map(([key, label]) => (
                    <span key={key}>
                      {label}：{confirmation.summary?.[key] || 0}
                    </span>
                  ))}
                </div>
                <p>
                  补充只填写已有记录的空字段；图片下载失败会保留基础资料并标记待补图。
                </p>
                {!!confirmation.issues?.length && (
                  <div role="alert" className="batch-error">
                    请先处理：
                    <ul>
                      {confirmation.issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="batch-actions">
                  <button disabled={busy} onClick={() => setConfirmation(null)}>
                    返回整理
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !!confirmation.issues?.length ||
                      !(
                        confirmation.summary?.added ||
                        confirmation.summary?.supplemented
                      )
                    }
                    onClick={() =>
                      action(async () => {
                        const result = await call("batchCommit", {
                          id: batch.id,
                          token: confirmation.token,
                        });
                        adopt(result.batch);
                        setSelected([]);
                        await onSaved();
                        setNotice(
                          `正式入库完成：新增 ${result.summary.added} 项，补充 ${result.summary.supplemented} 项。${result.summary.imageFailures ? `其中 ${result.summary.imageFailures} 项图片下载失败，可稍后编辑补图。` : ""}`,
                        );
                      })
                    }
                  >
                    确认批量导入
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
