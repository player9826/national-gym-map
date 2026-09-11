import React, { useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FolderSync,
  RefreshCw,
  Save,
} from "lucide-react";
import { Field } from "./components";

const LABELS = {
  gyms: "场馆",
  equipment: "器械",
  brands: "品牌",
  links: "场馆器械关联",
  added: "新增",
  updated: "更新",
  unchanged: "无变化",
  conflicts: "本地修改冲突",
  skipped: "跳过",
  images: "图片",
  total: "总计",
  new: "新增",
  name: "名称",
  city: "城市",
  district: "区域",
  address: "地址",
  lat: "纬度",
  lng: "经度",
  website: "官网",
  image: "图片",
  cover: "封面",
  photos: "照片",
  brandId: "品牌",
  brandIds: "品牌",
  equipmentType: "器械类型",
  freeWeightType: "自由力量类型",
  model: "型号",
  parts: "训练部位",
  tags: "训练标签",
  loading: "配重方式",
  quantity: "数量",
  productUrl: "产品来源",
  sourceUrl: "来源地址",
  themeColor: "场馆主题色",
};
function Counts({ counts }) {
  if (!counts || typeof counts !== "object") return null;
  return (
    <dl className="summary-table">
      {Object.entries(counts).map(([key, value]) => (
        <React.Fragment key={key}>
          <dt>{LABELS[key] || key}</dt>
          <dd>
            {value && typeof value === "object"
              ? Object.entries(value)
                  .map(([field, count]) => `${LABELS[field] || field} ${count}`)
                  .join(" · ")
              : String(value ?? 0)}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export default function SharedCatalogSettings({ ready, refresh }) {
  const [info, setInfo] = useState({});
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [includeImages, setIncludeImages] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    if (ready)
      window.desktop
        .call("sharedStatus")
        .then((result) => {
          if (active) {
            setInfo(result);
            setUrl(result.url || result.defaultUrl || "");
          }
        })
        .catch((e) => {
          if (active) setError(e.message || String(e));
        });
    return () => {
      active = false;
    };
  }, [ready]);

  async function action(label, work) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  const disabled = !ready || !!busy;
  return (
    <section className="settings-section" aria-label="共享资料库">
      <div className="settings-title">
        <FolderSync size={20} />
        <h3>共享资料库</h3>
      </div>
      <p className="muted">
        订阅维护者发布的场馆、器械和关联资料，检查变更后再确认同步。个人去过状态、私人备注和原始测评保留在本地。
      </p>
      <Field label="共享库地址">
        <input
          type="url"
          value={url}
          disabled={disabled}
          placeholder={info.defaultUrl || "https://"}
          onChange={(event) => {
            setUrl(event.target.value);
            setPreview(null);
            setMessage("");
          }}
        />
      </Field>
      <div className="actions">
        <button
          disabled={disabled || !url.trim()}
          onClick={() =>
            action("保存订阅地址", async () => {
              await window.desktop.call("sharedSaveSettings", {
                url: url.trim(),
              });
              await refresh();
              setMessage("订阅地址已保存。");
            })
          }
        >
          <Save size={17} />
          保存订阅地址
        </button>
        <button
          disabled={disabled || !url.trim()}
          onClick={() =>
            action("检查共享数据", async () => {
              setPreview(null);
              const result = await window.desktop.call("sharedPreview", {
                url: url.trim(),
              });
              setPreview(result);
            })
          }
        >
          <RefreshCw size={17} />
          检查共享数据
        </button>
        {info.issuesUrl && (
          <button
            disabled={disabled}
            onClick={() =>
              action("打开修改建议", async () => {
                await window.desktop.call("external", info.issuesUrl);
              })
            }
          >
            <ExternalLink size={17} />
            提交数据修改建议
          </button>
        )}
      </div>
      {info.lastSyncedAt && (
        <p className="muted">
          上次同步：{new Date(info.lastSyncedAt).toLocaleString()}
        </p>
      )}
      {preview && (
        <div aria-label="共享数据变更预览">
          <h4>同步预览</h4>
          {preview.sourceId && <p>资料库：{preview.sourceId}</p>}
          {preview.updatedAt && (
            <p className="muted">
              资料发布时间：{new Date(preview.updatedAt).toLocaleString()}
            </p>
          )}
          <Counts counts={preview.counts} />
          {Number.isFinite(preview.images) && (
            <p className="muted">
              共享图片：{preview.images} 张
              {Number.isFinite(preview.downloadImages)
                ? `，本次需下载 ${preview.downloadImages} 张`
                : ""}
            </p>
          )}
          {Array.isArray(preview.conflicts) && preview.conflicts.length > 0 && (
            <>
              <p className="inline-note">
                以下资料与本地修改冲突，将保留本地内容；可向维护者提交修改建议。
              </p>
              <ul>
                {preview.conflicts.slice(0, 20).map((item, index) => (
                  <li key={index}>
                    {typeof item === "string"
                      ? item
                      : [
                          item.name || item.id,
                          LABELS[item.field] || item.field,
                          item.message,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </li>
                ))}
              </ul>
              {preview.conflicts.length > 20 && (
                <p>另有 {preview.conflicts.length - 20} 项冲突。</p>
              )}
            </>
          )}
          <p className="muted">确认后写入本地资料库，同步前会自动备份。</p>
          <div className="actions">
            <button
              className="primary"
              disabled={disabled || !preview.token}
              onClick={() =>
                action("同步共享数据", async () => {
                  await window.desktop.call("sharedApply", {
                    token: preview.token,
                  });
                  setPreview(null);
                  await refresh();
                  setInfo(await window.desktop.call("sharedStatus"));
                  setMessage("共享数据同步完成，个人资料已保留。");
                })
              }
            >
              <FolderSync size={17} />
              确认同步
            </button>
            <button disabled={disabled} onClick={() => setPreview(null)}>
              取消本次同步
            </button>
          </div>
        </div>
      )}
      <details>
        <summary>维护者导出共享库</summary>
        <p className="muted">
          导出基础资料供发布到项目仓库。个人去过状态、私人备注和原始测评不导出。
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={includeImages}
            disabled={disabled}
            onChange={(event) => setIncludeImages(event.target.checked)}
          />
          我确认导出的图片可公开分享，并将图片一并导出
        </label>
        <div className="actions">
          <button
            disabled={disabled}
            onClick={() =>
              action("导出共享库", async () => {
                const result = await window.desktop.call("sharedExport", {
                  includeImages,
                });
                if (result)
                  setMessage(
                    `共享库已导出${result.path ? `：${result.path}` : "。"}请检查内容后发布到项目仓库。`,
                  );
              })
            }
          >
            <Download size={17} />
            导出共享库
          </button>
        </div>
      </details>
      {busy && <p role="status">{busy}…</p>}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-note" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
