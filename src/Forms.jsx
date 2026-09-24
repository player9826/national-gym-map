import React, { useEffect, useRef, useState } from "react";
import {
  Save,
  MapPin,
  Globe,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Download,
  FolderOpen,
  FolderSync,
  ArchiveRestore,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import {
  Modal,
  Field,
  PhotoInput,
  Status,
  IconButton,
  Picture,
  Tags,
  Empty,
} from "./components";
import {
  PARTS,
  TAGS,
  CITIES,
  partName,
  equipmentType,
  equipmentSummary,
  PART_TAGS,
} from "./constants";
import EquipmentClassification from "./EquipmentClassification";
import SharedCatalogSettings from "./SharedCatalogSettings";
import BrandLogo from "./BrandLogo";
import GymThemePicker from "./GymThemePicker";
import { COUNTRIES, countryOf, countryName } from "../electron/gym-location.mjs";

export function GymForm({
  initial,
  onSave,
  onClose,
  onPick,
  run,
  brands = [],
}) {
  const [row, setRow] = useState(() => ({ ...initial, country: countryOf(initial) })),
    [tagText, setTagText] = useState((initial.tags || []).join("，"));
  const set = (key) => (e) => setRow({ ...row, [key]: e.target.value });
  const draft = () => ({
    ...row,
    tags: [
      ...new Set(
        tagText
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ],
  });
  return (
    <Modal
      title={row.id ? "编辑健身房" : "新增健身房"}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button form="gym-form" className="primary">
            <Save size={17} />
            保存健身房
          </button>
        </>
      }
    >
      <form
        id="gym-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft());
        }}
        className="form-grid"
      >
        <Field label="名称" required full>
          <input
            required
            maxLength={150}
            value={row.name}
            onChange={set("name")}
          />
        </Field>
        <GymThemePicker
          value={row.themeColor}
          onChange={(themeColor) => setRow((current) => ({ ...current, themeColor }))}
        />
        <Field label="国家/地区" full>
          <select value={row.country} onChange={set("country")}>
            {!COUNTRIES.some(([code]) => code === row.country) &&
              <option value={row.country}>{countryName(row.country)}</option>}
            {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </Field>
        {row.country === "CN" && <>
        <Field label="省份">
          <input value={row.province} onChange={set("province")} />
        </Field>
        <Field label="城市">
          <input list="cities" value={row.city} onChange={set("city")} />
          <datalist id="cities">
            {CITIES.map((c) => (
              <option key={c[0]} value={c[0]} />
            ))}
          </datalist>
        </Field>
        <Field label="区县">
          <input value={row.district} onChange={set("district")} />
        </Field>
        </>}
        <Field label="详细地址" full={row.country !== "CN"}>
          <input value={row.address} onChange={set("address")} />
        </Field>
        <div className="field full">
          <div className="section-label">
            地图位置
            <button
              type="button"
              className="text-button"
              onClick={() => onPick(draft())}
            >
              <MapPin size={16} />
              地图选点
            </button>
          </div>
          <div className="form-grid">
            <Field label="纬度">
              <input
                type="number"
                min="-90"
                max="90"
                step="any"
                value={row.lat ?? ""}
                onChange={set("lat")}
              />
            </Field>
            <Field label="经度">
              <input
                type="number"
                min="-180"
                max="180"
                step="any"
                value={row.lng ?? ""}
                onChange={set("lng")}
              />
            </Field>
          </div>
          <small>
            坐标采用 WGS84（World Geodetic System 1984，1984 世界大地坐标系）。
            可以稍后定位；仅填写地址不会自动生成地图位置。
          </small>
        </div>
        <div className="field">
          <span>打卡状态</span>
          <Status
            visited={row.visited}
            onChange={(visited) =>
              setRow({
                ...row,
                visited,
                visitDate: visited
                  ? row.visitDate || new Date().toLocaleDateString("en-CA")
                  : "",
              })
            }
          />
        </div>
        <Field label="去过日期">
          <input
            type="date"
            disabled={!row.visited}
            value={row.visitDate || ""}
            onChange={set("visitDate")}
          />
        </Field>
        <Field label="标签" full>
          <input
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="力量训练，全天营业"
          />
        </Field>
        <div className="field full">
          <span>器械品牌标签</span>
          <div className="tag-checks">
            {brands.map((b) => (
              <label key={b.id}>
                <input
                  type="checkbox"
                  checked={(row.brandIds || []).includes(b.id)}
                  onChange={(e) =>
                    setRow({
                      ...row,
                      brandIds: e.target.checked
                        ? [...(row.brandIds || []), b.id]
                        : row.brandIds.filter((id) => id !== b.id),
                    })
                  }
                />
                {b.name}
              </label>
            ))}
          </div>
        </div>
        <Field label="简介" full>
          <textarea
            rows="3"
            value={row.description}
            onChange={set("description")}
            maxLength={3000}
          />
        </Field>
        <div className="field full">
          <span>封面照片</span>
          <PhotoInput
            value={row.cover}
            onChange={(cover) => setRow({ ...row, cover })}
            category="gyms"
            run={run}
          />
        </div>
        <div className="field full">
          <span>其他照片</span>
          <PhotoInput
            multiple
            value={row.photos}
            onChange={(photos) => setRow({ ...row, photos })}
            category="gyms"
            run={run}
          />
        </div>
        <h3 className="form-section full">外部测评</h3>
        <Field label="测评评分">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="待补充"
            value={row.score ?? ""}
            onChange={set("score")}
          />
        </Field>
        <Field label="测评来源">
          <input
            value={row.reviewSource || ""}
            onChange={set("reviewSource")}
          />
        </Field>
        <Field label="测评链接" full>
          <input
            type="url"
            value={row.reviewUrl || ""}
            onChange={set("reviewUrl")}
            placeholder="https://"
          />
        </Field>
        <Field label="测评版本">
          <input
            value={row.reviewVersion || ""}
            onChange={set("reviewVersion")}
          />
        </Field>
        <Field label="测评时间">
          <input value={row.reviewDate || ""} onChange={set("reviewDate")} />
        </Field>
      </form>
    </Modal>
  );
}
export function WebsiteImageChoices({ options = [], selected = "", disabled = false, onChange }) {
  const choices = options.filter((option) => option.source && /^data:image\//.test(option.preview || "")).slice(0, 4);
  if (!choices.length) return null;
  return (
    <section className="website-image-choices field full" aria-label="网站候选图片">
      <strong>选择网站封面图片</strong>
      <div className="website-image-options">
        {choices.map((option, index) => (
          <button type="button" key={option.source} disabled={disabled}
            aria-label={`选择网站图片 ${index + 1}`} aria-pressed={selected === option.source}
            onClick={() => onChange(option)}>
            <img src={option.preview} alt={`网站候选图片 ${index + 1}`} onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
            <span>{option.origin === 'listing' ? '列表页' : '详情页'} · {selected === option.source ? "已选封面" : `图片 ${index + 1}`}</span>
          </button>
        ))}
      </div>
      <button type="button" className="website-image-skip" disabled={disabled} aria-pressed={!selected} onClick={() => onChange(null)}>不使用网站图片</button>
      <small>这里只预览候选图片；保存器械或确认批量导入时，才保存所选图片。不使用网站图片会保留已有照片。</small>
    </section>
  );
}

export function EquipmentForm({
  initial,
  brands,
  onSave,
  onClose,
  run,
  official = false,
  equipment = [],
}) {
  const [row, setRow] = useState(() => ({
      ...initial,
      equipmentType: equipmentType(initial),
      tags: initial.tags || [],
    })),
    [url, setUrl] = useState(initial.productUrl || ""),
    [warning, setWarning] = useState(""),
    [importError, setImportError] = useState(""),
    [busy, setBusy] = useState(false),
    [browserReady, setBrowserReady] = useState(false),
    [products, setProducts] = useState([]),
    [selectedProduct, setSelectedProduct] = useState(""),
    [pdf, setPdf] = useState(null),
    [page, setPage] = useState(1);
  const active = useRef(true),
    request = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current += 1;
      if (official) {
        window.desktop.call("browserClose").catch(() => {});
        window.desktop.call("captureDiscard").catch(() => {});
        window.desktop.call("pdfCancel").catch(() => {});
      }
    };
  }, [official]);
  function accept(result) {
    if (!result) return;
    if (result.kind === "listing") {
      setProducts((result.products || []).map((product) => result.captured ? { ...product, captured: true } : product));
      setSelectedProduct(result.products?.[0]?.url || "");
      setWarning(
        result.warning || "已识别产品列表，请选择一款器械后读取详情。",
      );
      return;
    }
    const { warning: resultWarning, kind, ...data } = result;
    const website = Array.isArray(result.imageOptions);
    setRow((current) => ({
      ...current,
      ...data,
      ...(website ? {
        image: current.image,
        imageOptions: result.imageOptions.slice(0, 4),
        imageSource: result.imageSource || result.imageOptions[0]?.source || "",
        thumbnail: result.thumbnail || result.imageOptions[0]?.preview || "",
        pendingWebImage: !!result.imageOptions[0]?.preview && result.pendingWebImage !== false,
      } : { imageOptions: [], thumbnail: "", pendingWebImage: false }),
      id: current.id,
      brandId: current.brandId,
      equipmentType: current.equipmentType,
      freeWeightType: current.freeWeightType,
      part: current.part,
      parts: current.parts,
      loading: current.loading,
      tags: current.tags,
    }));
    setProducts([]);
    setWarning(
      resultWarning ||
        "已读取产品预览，请检查名称、型号与图片后保存。原有分类已保留。",
    );
  }
  async function importAction(action) {
    if (busy) return;
    const token = ++request.current;
    setBusy(true);
    setImportError("");
    setWarning("");
    try {
      const result = await action();
      if (active.current && request.current === token) result?.();
    } catch (error) {
      if (active.current && request.current === token)
        setImportError(
          error.message || "读取失败，请尝试浏览器辅助导入或本地文档。",
        );
    } finally {
      if (active.current && request.current === token) setBusy(false);
    }
  }
  const readProduct = (mode = "auto", source = url) =>
    importAction(async () => {
      const result = await window.desktop.call("productPreview", {
        url: source,
        brandId: row.brandId,
        mode,
      });
      return () => accept(result);
    });
  const set = (key) => (e) => setRow({ ...row, [key]: e.target.value });
  return (
    <Modal
      title={row.id ? "编辑器械" : official ? "官网导入器械" : "新增器械"}
      wide
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button form="equipment-form" className="primary" disabled={busy}>
            <Save size={17} />
            保存器械
          </button>
        </>
      }
    >
      <form
        id="equipment-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (
            row.equipmentType === "fixed" &&
            (!(row.parts?.length || row.part) || ((row.parts ?? [row.part]).some(part => PART_TAGS[part]) && !row.tags?.length))
          ) {
            setImportError("固定器械请至少选择一个部位及对应应用标签。");
            return;
          }
          setImportError("");
          onSave(row);
        }}
      >
        <Field label="品牌" required full>
          <select required value={row.brandId} onChange={(event) => setRow({ ...row, brandId: event.target.value, series: "" })}>
            <option value="">选择品牌</option>
            {brands.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        {official && (
          <div className="catalog-import full" aria-busy={busy}>
            <Field label="官方产品页或产品列表">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
              />
            </Field>
            <div className="actions">
              <button
                type="button"
                disabled={busy || !row.brandId}
                onClick={() => importAction(async () => {
                  const result = await window.desktop.call("captureOpen", { brandId: row.brandId });
                  return () => accept(result);
                })}
              >
                导入浏览器采集文件
              </button>
              <button type="button" disabled={busy} onClick={() => importAction(async () => { await window.desktop.call('captureHelp'); })}>
                获取浏览器采集扩展
              </button>
              <button
                type="button"
                disabled={busy || !url.trim()}
                onClick={() => readProduct()}
              >
                <Globe size={17} />
                读取产品
              </button>
              <button
                type="button"
                disabled={busy || !url.trim()}
                onClick={() => readProduct("browser")}
              >
                浏览器读取
              </button>
            </div>
            <small>
              自动读取失败时，可先试浏览器读取；需要验证或登录时使用下方辅助窗口。
            </small>
            <div className="actions">
              <button
                type="button"
                disabled={busy || !url.trim()}
                onClick={() =>
                  importAction(async () => {
                    await window.desktop.call("browserOpen", { url });
                    return () => {
                      setBrowserReady(true);
                      setWarning(
                        "请在浏览器窗口完成验证并打开产品页，再点击读取当前页。",
                      );
                    };
                  })
                }
              >
                <ExternalLink size={17} />
                打开辅助浏览器
              </button>
              <button
                type="button"
                disabled={busy || !browserReady}
                onClick={() =>
                  importAction(async () => {
                    const result = await window.desktop.call("browserRead", {
                      brandId: row.brandId,
                    });
                    return () => accept(result);
                  })
                }
              >
                读取当前页
              </button>
              {browserReady && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    importAction(async () => {
                      await window.desktop.call("browserClose");
                      return () => setBrowserReady(false);
                    })
                  }
                >
                  关闭辅助浏览器
                </button>
              )}
            </div>
            {products.length > 0 && (
              <div className="catalog-listing">
                <Field label={`选择产品（${products.length} 款）`}>
                  <select
                    value={selectedProduct}
                    onChange={(e) => setSelectedProduct(e.target.value)}
                  >
                    {products.map((product) => (
                      <option key={product.url} value={product.url}>
                        {product.name || product.url}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="button"
                  disabled={busy || !selectedProduct}
                  onClick={() => {
                    const product = products.find((item) => item.url === selectedProduct);
                    if (product?.captured) {
                      accept(product);
                      return;
                    }
                    setUrl(selectedProduct);
                    readProduct("auto", selectedProduct);
                  }}
                >
                  读取所选产品
                </button>
              </div>
            )}
            <div className="catalog-document">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  importAction(async () => {
                    const result = await window.desktop.call("pdfOpen");
                    return () => {
                      if (result) {
                        setPdf(result);
                        setPage(1);
                        setWarning(
                          "请选择器械所在页，读取后可修改文字与图片。",
                        );
                      }
                    };
                  })
                }
              >
                <FolderOpen size={17} />
                选择 PDF（Portable Document Format，便携式文档格式）
              </button>
              {pdf && (
                <div className="actions">
                  <Field label={`页码（共 ${pdf.pageCount} 页）`}>
                    <input
                      type="number"
                      min="1"
                      max={pdf.pageCount}
                      step="1"
                      value={page}
                      onChange={(e) => setPage(e.target.value)}
                    />
                  </Field>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !Number.isInteger(Number(page)) ||
                      Number(page) < 1 ||
                      Number(page) > pdf.pageCount
                    }
                    onClick={() =>
                      importAction(async () => {
                        const result = await window.desktop.call("pdfPage", {
                          token: pdf.token,
                          page: Number(page),
                          brandId: row.brandId,
                        });
                        return () => accept(result);
                      })
                    }
                  >
                    读取所选页
                  </button>
                </div>
              )}
              <small>
                网站无法访问时，可导入本地产品手册或浏览器保存的文档。所有结果先预览，保存后才进入器械库。
              </small>
            </div>
            {busy && (
              <p role="status">正在读取，请稍候；可取消此表单结束本次导入。</p>
            )}
            {importError && (
              <div className="inline-error" role="alert">
                {importError}
                <p>
                  可尝试浏览器读取、打开辅助浏览器完成验证，或导入本地产品文档。
                </p>
              </div>
            )}
          </div>
        )}
        {warning && (
          <p className="inline-note full" role="status">
            {warning}
          </p>
        )}
        <Field label="器械名称" required full>
          <input
            required
            maxLength={300}
            value={row.name}
            onChange={set("name")}
          />
        </Field>
        <EquipmentClassification row={row} onChange={setRow} knownParts={equipment.flatMap(item => item.parts ?? [item.part])} />
        {!official && importError && (
          <p className="inline-error full" role="alert">
            {importError}
          </p>
        )}
        <Field label="型号">
          <input value={row.model || ""} onChange={set("model")} />
        </Field>
        <Field label="系列（可留空）">
          <input list="equipment-series-suggestions" value={row.series || ""} onChange={set("series")} maxLength={100} placeholder="选择已有系列或填写新系列" />
          <datalist id="equipment-series-suggestions">{[...new Set(equipment.filter(item => item.brandId === row.brandId).map(item => item.series?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")).map(series => <option value={series} key={series} />)}</datalist>
        </Field>
        <div className="field full">
          <span>器械照片</span>
          <PhotoInput
            value={row.image}
            onChange={(image) => setRow({ ...row, image, imageSource: "", thumbnail: "", pendingWebImage: false })}
            category="equipment"
            run={run}
          />
        </div>
        <WebsiteImageChoices
          options={row.imageOptions}
          selected={row.pendingWebImage ? row.imageSource : ""}
          disabled={busy}
          onChange={(option) => setRow((current) => ({
            ...current,
            imageSource: option?.source || (current.image === initial.image ? initial.imageSource || "" : ""),
            thumbnail: option?.preview || "",
            pendingWebImage: !!option,
          }))}
        />
        <Field label="官网产品页" full>
          <input
            type="url"
            value={row.productUrl || ""}
            onChange={set("productUrl")}
          />
        </Field>
        <Field label="图片来源" full>
          <input
            type="url"
            value={row.imageSource || ""}
            onChange={set("imageSource")}
          />
        </Field>
        <Field label="备注" full>
          <textarea rows="3" value={row.notes} onChange={set("notes")} />
        </Field>
      </form>
    </Modal>
  );
}
export function BrandManager({
  brands,
  equipment,
  onClose,
  run,
  refresh,
  ask,
}) {
  const [row, setRow] = useState({ name: "", website: "", notes: "" }),
    [query, setQuery] = useState("");
  return (
    <Modal title="品牌管理" wide onClose={onClose}>
      <div className="brand-manager">
        <div className="brand-list">
          <input
            aria-label="搜索品牌"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索品牌"
          />
          {brands
            .filter((b) => b.name.toLowerCase().includes(query.toLowerCase()))
            .map((b) => (
              <div
                className={`brand-row ${row.id === b.id ? "active" : ""}`}
                key={b.id}
              >
                <button className="brand-select" onClick={() => setRow(b)}>
                  <BrandLogo brand={b} />
                  <small>
                    {equipment.filter((e) => e.brandId === b.id).length} 台器械
                  </small>
                </button>
                <IconButton
                  icon={Pencil}
                  label={`编辑品牌 ${b.name}`}
                  onClick={() => setRow(b)}
                />
                <IconButton
                  icon={Trash2}
                  label={`删除品牌 ${b.name}`}
                  onClick={() =>
                    ask(`删除品牌「${b.name}」？`, async () => {
                      await window.desktop.call("delete", {
                        collection: "brands",
                        id: b.id,
                      });
                      await refresh();
                      if (row.id === b.id)
                        setRow({ name: "", website: "", notes: "" });
                    })
                  }
                />
              </div>
            ))}
        </div>
        <form
          className="brand-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await window.desktop.call("saveBrand", row);
              await refresh();
              setRow({ name: "", website: "", notes: "" });
            }, "品牌已保存");
          }}
        >
          <div className="section-label">
            <h3>{row.id ? "编辑品牌" : "新增品牌"}</h3>
            <IconButton
              icon={Plus}
              label="新增品牌"
              onClick={() => setRow({ name: "", website: "", notes: "" })}
            />
          </div>
          <Field label="品牌名称" required>
            <input
              required
              value={row.name}
              onChange={(e) => setRow({ ...row, name: e.target.value })}
            />
          </Field>
          <div className="field" role="group" aria-label="品牌标识"><span>品牌标识</span>
            <BrandLogo brand={row} />
            <PhotoInput value={row.logo || ""} category="brands" run={run}
              onChange={(logo) => setRow((current) => ({ ...current, logo }))} />
            <small>上传后替换内置标识；移除上传图片后恢复内置标识，没有图片时显示品牌名称。</small>
          </div>
          <div className="field" role="group" aria-label="品牌展示图"><span>品牌展示图</span>
            <PhotoInput value={row.bannerImage || ""} category="brands" run={run}
              onChange={(bannerImage) => setRow((current) => ({ ...current, bannerImage }))} />
            {row.bannerImage && <div className="brand-banner-preview"><Picture src={row.bannerImage} alt="品牌展示图预览" thumbnail={false} /></div>}
            <small>仅在器械库选中该品牌时横向铺满展示区，与品牌标识分别管理；图片会裁切为横向展示。</small>
          </div>
          <Field label="公开品牌介绍">
            <textarea rows="4" value={row.publicDescription || ""} onChange={(e) => setRow({ ...row, publicDescription: e.target.value })} />
            <small>介绍会随共享资料显示在公开网页；留空时不显示介绍文字。</small>
          </Field>
          <Field label="官网地址">
            <input
              type="url"
              placeholder="可留空"
              value={row.website || ""}
              onChange={(e) => setRow({ ...row, website: e.target.value })}
            />
          </Field>
          <Field label="品牌备注（仅本机）">
            <textarea
              rows="5"
              value={row.notes || ""}
              onChange={(e) => setRow({ ...row, notes: e.target.value })}
            />
          </Field>
          <button className="primary">
            <Save size={17} />
            保存品牌
          </button>
        </form>
      </div>
    </Modal>
  );
}
export function LinkForm({ gym, equipment, brands, links, onClose, onSave }) {
  const [row, setRow] = useState({
    gymId: gym.id,
    equipmentId: "",
    quantity: 1,
    status: "正常",
    notes: "",
    verifiedAt: "",
  });
  return (
    <Modal
      title={`关联器械 · ${gym.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button form="link-form" className="primary">
            <Save size={17} />
            保存关联
          </button>
        </>
      }
    >
      <form
        id="link-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(row);
        }}
      >
        <Field label="器械" required full>
          <select
            required
            value={row.equipmentId}
            onChange={(e) => {
              const old = links.find(
                (l) => l.gymId === gym.id && l.equipmentId === e.target.value,
              );
              setRow(
                old || {
                  ...row,
                  equipmentId: e.target.value,
                  quantity: 1,
                  status: "正常",
                  notes: "",
                },
              );
            }}
          >
            <option value="">选择器械</option>
            {equipment.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {brands.find((b) => b.id === eq.brandId)?.name} · {eq.name}
                {links.some(
                  (l) => l.gymId === gym.id && l.equipmentId === eq.id,
                )
                  ? "（已关联，可修改）"
                  : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="数量" required>
          <input
            required
            type="number"
            min="1"
            step="1"
            value={row.quantity}
            onChange={(e) => setRow({ ...row, quantity: e.target.value })}
          />
        </Field>
        <Field label="器械状态">
          <select
            value={row.status}
            onChange={(e) => setRow({ ...row, status: e.target.value })}
          >
            {["正常", "维修中", "待核实"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="最后核实日期" full>
          <input
            type="date"
            value={row.verifiedAt || ""}
            onChange={(e) => setRow({ ...row, verifiedAt: e.target.value })}
          />
        </Field>
        <Field label="备注" full>
          <textarea
            value={row.notes}
            onChange={(e) => setRow({ ...row, notes: e.target.value })}
          />
        </Field>
        {!equipment.length && (
          <p className="inline-note full">器械库暂无器械，请先添加器械。</p>
        )}
      </form>
    </Modal>
  );
}
export function ImportDialog({ draft, gyms, onClose, onCommit }) {
  const [targetId, setTarget] = useState(""),
    [row, setRow] = useState(draft.rows[0]);
  const review = draft.kind === "review";
  return (
    <Modal
      title={review ? "测评导入预览" : "数据导入预览"}
      wide
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" form="import-form">
            <Download size={17} />
            确认导入
          </button>
        </>
      }
    >
      <form
        id="import-form"
        onSubmit={(e) => {
          e.preventDefault();
          onCommit({ targetId, row });
        }}
      >
        <p className="source-name">
          {draft.sourceName} · {draft.rows.length} 条记录
        </p>
        {draft.warnings.map((w) => (
          <p className="inline-note" key={w}>
            {w}
          </p>
        ))}
        {review ? (
          <>
            <div className="form-grid">
              <Field label="导入目标" full>
                <select
                  value={targetId}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">新建健身房档案</option>
                  {gyms.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="名称" required>
                <input
                  required
                  value={row.name}
                  onChange={(e) => setRow({ ...row, name: e.target.value })}
                />
              </Field>
              <Field label="城市">
                <input
                  value={row.city}
                  onChange={(e) => setRow({ ...row, city: e.target.value })}
                />
              </Field>
              <Field label="评分">
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="待补充"
                  value={row.score ?? ""}
                  onChange={(e) => setRow({ ...row, score: e.target.value })}
                />
              </Field>
              <Field label="面积">
                <input
                  value={row.area ?? ""}
                  onChange={(e) => setRow({ ...row, area: e.target.value })}
                />
              </Field>
              <Field label="测评来源">
                <input
                  value={row.reviewSource}
                  onChange={(e) =>
                    setRow({ ...row, reviewSource: e.target.value })
                  }
                />
              </Field>
              <Field label="测评链接">
                <input
                  type="url"
                  value={row.reviewUrl}
                  onChange={(e) =>
                    setRow({ ...row, reviewUrl: e.target.value })
                  }
                />
              </Field>
            </div>
            <p className="muted">
              面积类型：{row.areaType} · 评分：{row.score ?? "待补充"}
            </p>
            <dl className="summary-table">
              {row.reviewSummary?.map((s) => (
                <React.Fragment key={s.label}>
                  <dt>{s.label}</dt>
                  <dd>{s.value || "未提供"}</dd>
                </React.Fragment>
              ))}
            </dl>
            <details>
              <summary>
                原始测评 JSON（JavaScript Object Notation，JavaScript
                对象表示法）
              </summary>
              <pre>{JSON.stringify(row.rawReview, null, 2)}</pre>
            </details>
          </>
        ) : (
          <div className="import-table">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>{draft.kind === "gyms" ? "城市" : "部位"}</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.slice(0, 200).map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.city || equipmentSummary(r)}</td>
                    <td>新增或更新</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {draft.rows.length > 200 && (
              <p>仅预览前 200 条，确认后导入全部 {draft.rows.length} 条。</p>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
export function Settings({ status, settings, onClose, run, refresh, notice }) {
  const [feed, setFeed] = useState(settings?.updateFeed || ""),
    [update, setUpdate] = useState({});
  async function dataAction(method, message) {
    const result = await window.desktop.call(method);
    if (result) {
      await refresh();
      notice(message + (result.path ? `\n${result.path}` : ""));
    }
  }
  return (
    <Modal title="数据与设置" wide onClose={onClose}>
      <section className="settings-section">
        <div className="settings-title">
          <HardDrive size={20} />
          <h3>用户数据目录</h3>
        </div>
        <div className="data-path">{status.dataRoot || "尚未设置"}</div>
        {status.error && <p className="inline-error">{status.error}</p>}
        <div className="actions">
          {!status.dataRoot ? (
            <button
              className="primary"
              onClick={() =>
                run(() => dataAction("configure", "数据目录已设置"))
              }
            >
              <FolderOpen size={17} />
              设置数据目录
            </button>
          ) : (
            <>
              <button
                disabled={!status.ready}
                onClick={() =>
                  run(() => dataAction("migrate", "迁移完成，旧目录已保留"))
                }
              >
                <FolderSync size={17} />
                更换数据目录
              </button>
              <button
                onClick={() => run(() => window.desktop.call("openData"))}
              >
                <FolderOpen size={17} />
                打开数据目录
              </button>
              {!status.ready && (
                <button
                  onClick={() =>
                    run(() => dataAction("reconnect", "已重新连接数据目录"))
                  }
                >
                  重新连接数据目录
                </button>
              )}
            </>
          )}
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-title">
          <ArchiveRestore size={20} />
          <h3>备份与恢复</h3>
        </div>
        <div className="actions">
          <button
            disabled={!status.ready}
            onClick={() => run(() => dataAction("backup", "完整备份已保存"))}
          >
            <Download size={17} />
            立即备份
          </button>
          <button
            disabled={!status.dataRoot}
            onClick={() => run(() => dataAction("restore", "备份已恢复"))}
          >
            <ArchiveRestore size={17} />
            选择备份恢复
          </button>
        </div>
      </section>
      <SharedCatalogSettings ready={status.ready} refresh={refresh} />
      <section className="settings-section">
        <div className="settings-title">
          <RefreshCw size={20} />
          <h3>版本与更新</h3>
          <span className="badge">{status.version || "1.0.0"}</span>
        </div>
        <p className="muted">全国健身房地图</p>
        <details>
          <summary>更新发布源</summary>
          <Field label="更新服务器地址">
            <input
              type="url"
              placeholder="https://"
              value={feed}
              onChange={(e) => setFeed(e.target.value)}
            />
          </Field>
          <button
            disabled={!status.ready}
            onClick={() =>
              run(async () => {
                await window.desktop.call("saveSettings", { updateFeed: feed });
                await refresh();
              }, "更新源已保存")
            }
          >
            <Save size={17} />
            保存更新源
          </button>
        </details>
        <div className="actions">
          <button
            disabled={!status.ready}
            onClick={() =>
              run(async () =>
                setUpdate(await window.desktop.call("checkUpdate")),
              )
            }
          >
            <RefreshCw size={17} />
            检查更新
          </button>
          {update.phase === "available" && (
            <button
              onClick={() =>
                run(async () =>
                  setUpdate(await window.desktop.call("downloadUpdate")),
                )
              }
            >
              <Download size={17} />
              下载更新
            </button>
          )}
          {update.phase === "downloaded" && (
            <button
              onClick={() => run(() => window.desktop.call("installUpdate"))}
            >
              备份并安装更新
            </button>
          )}
        </div>
        {update.message && <p className="inline-note">{update.message}</p>}
      </section>
    </Modal>
  );
}
