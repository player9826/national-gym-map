import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  MapPin,
  Map,
  Dumbbell,
  Settings2,
  Plus,
  Search,
  SlidersHorizontal,
  X,
  ArrowUpRight,
  ExternalLink,
  Pencil,
  Trash2,
  Download,
  Upload,
  Globe,
  Link2,
  ArrowLeft,
  ChevronRight,
  Check,
  AlertCircle,
  Building2,
  Library,
  FolderOpen,
} from "lucide-react";
import MapView from "./MapView";
import GymPreview, { useGymPreview } from "./GymPreview";
import EquipmentPicker from "./EquipmentPicker";
import BatchImport from "./BatchImport";
import "./equipment-classification.css";
import {
  IconButton,
  Modal,
  Tags,
  Picture,
  Status,
  Empty,
  Busy,
} from "./components";
import {
  GymForm,
  EquipmentForm,
  BrandManager,
  ImportDialog,
  Settings,
} from "./Forms";
import {
  EQUIPMENT_TYPES,
  FREE_WEIGHT_TYPES,
  equipmentType,
  equipmentSummary,
  CITIES,
  PARTS,
  TAGS,
  partName,
  asset,
  emptyGym,
  emptyEquipment,
} from "./constants";

const empty = { gyms: [], equipment: [], brands: [], links: [], settings: {} };
export default function App() {
  const [db, setDb] = useState(empty),
    [status, setStatus] = useState({}),
    [page, setPage] = useState("map");
  const [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [confirm, setConfirm] = useState(null);
  const [selected, setSelected] = useState(null),
    [equipmentId, setEquipmentId] = useState(null),
    [query, setQuery] = useState(""),
    [visitFilter, setVisitFilter] = useState("all"),
    [city, setCity] = useState(""),
    [tag, setTag] = useState(""),
    [sort, setSort] = useState("updated"),
    [filters, setFilters] = useState(false),
    [focus, setFocus] = useState(null),
    [pickDraft, setPickDraft] = useState(null);
  const [eqType, setEqType] = useState(""),
    [eqFreeType, setEqFreeType] = useState(""),
    [eqApplication, setEqApplication] = useState("");
  const [eqMode, setEqMode] = useState("brand"),
    [eqGroup, setEqGroup] = useState(""),
    [eqQuery, setEqQuery] = useState(""),
    [eqTag, setEqTag] = useState(""),
    [eqLoading, setEqLoading] = useState(""),
    [eqSort, setEqSort] = useState("name");
  const running = useRef(false),
    notification = useRef();
  function notice(message) {
    clearTimeout(notification.current);
    setToast(message);
    notification.current = setTimeout(() => setToast(""), 6500);
  }
  async function refresh() {
    if (!window.desktop) {
      setStatus({ ready: false, browser: true });
      return;
    }
    const s = await window.desktop.call("status");
    setStatus(s);
    if (s.ready) setDb(await window.desktop.call("state"));
    else setDb(empty);
  }
  async function run(task, message) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await task();
      if (message && result !== null) notice(message);
      return result;
    } catch (e) {
      setError(e.message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    return () => clearTimeout(notification.current);
  }, []);
  function requireData(action) {
    if (!status.ready) {
      setModal({ type: "settings" });
      if (status.browser) setError("请使用已安装的桌面程序管理本地数据。");
    } else action();
  }
  function ask(message, action) {
    setConfirm({ message, action });
  }
  const gym = db.gyms.find((g) => g.id === selected),
    eq = db.equipment.find((e) => e.id === equipmentId);
  const hover = useGymPreview(
    page !== "map" || !!modal || !!confirm || !!error || busy || !!pickDraft,
  );
  const visibleGyms = useMemo(
    () =>
      db.gyms
        .filter(
          (g) =>
            `${g.name} ${g.province} ${g.city} ${g.district} ${g.address} ${g.tags?.join(" ")}`
              .toLowerCase()
              .includes(query.toLowerCase()) &&
            (!city || g.city.replace(/市$/, "") === city.replace(/市$/, "")) &&
            (visitFilter === "all" ||
              g.visited === (visitFilter === "visited")) &&
            (!tag || g.tags?.includes(tag)),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, "zh-CN")
            : sort === "score"
              ? (b.score ?? -1) - (a.score ?? -1)
              : (b.updatedAt || "").localeCompare(a.updatedAt || ""),
        ),
    [db.gyms, query, city, visitFilter, tag, sort],
  );
  const equipment = useMemo(
    () =>
      db.equipment
        .filter(
          (e) =>
            (!eqType || equipmentType(e) === eqType) &&
            (!eqFreeType || e.freeWeightType === eqFreeType) &&
            (!eqApplication || e.tags?.includes(eqApplication)) &&
            (!eqGroup ||
              (eqMode === "brand"
                ? e.brandId === eqGroup
                : (e.parts ?? [e.part]).includes(eqGroup))) &&
            `${e.name} ${e.model} ${db.brands.find((b) => b.id === e.brandId)?.name}`
              .toLowerCase()
              .includes(eqQuery.toLowerCase()) &&
            (!eqTag || (e.parts ?? [e.part]).includes(eqTag)) &&
            (!eqLoading || e.loading === eqLoading),
        )
        .sort((a, b) =>
          eqSort === "updated"
            ? (b.updatedAt || "").localeCompare(a.updatedAt || "")
            : a.name.localeCompare(b.name, "zh-CN"),
        ),
    [
      db,
      eqGroup,
      eqMode,
      eqQuery,
      eqTag,
      eqLoading,
      eqSort,
      eqType,
      eqFreeType,
      eqApplication,
    ],
  );
  const previewGym = visibleGyms.find((g) => g.id === hover.preview?.id);
  const equipmentCounts = useMemo(() => {
    const counts = new globalThis.Map();
    for (const link of db.links)
      counts.set(link.gymId, (counts.get(link.gymId) || 0) + 1);
    return counts;
  }, [db.links]);
  useEffect(() => {
    if (hover.hoveredId && !visibleGyms.some((g) => g.id === hover.hoveredId))
      hover.close();
  }, [visibleGyms, hover.hoveredId, hover.close]);
  const cities = [
    ...new Set([
      ...CITIES.map((c) => c[0]),
      ...db.gyms.map((g) => g.city).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const gymTags = [...new Set(db.gyms.flatMap((g) => g.tags || []))];
  function showGym(id, clear = false) {
    hover.close();
    const target = db.gyms.find((g) => g.id === id);
    if (!target) return;
    setPage("map");
    setEquipmentId(null);
    setSelected(id);
    if (clear) {
      setQuery("");
      setCity("");
      setVisitFilter("all");
      setTag("");
    }
    if (target.lat != null)
      setFocus({
        lat: target.lat,
        lng: target.lng,
        label: target.city || target.name,
        token: Date.now(),
      });
    else notice("此健身房尚未设置地图位置，可在编辑中地图选点。");
  }
  function chooseCity(value) {
    setCity(value);
    const c = CITIES.find((c) => c[0] === value.replace(/市$/, ""));
    const g = db.gyms.find((g) => g.city === value && g.lat != null);
    if (c) setFocus({ lat: c[1], lng: c[2], zoom: 11, label: value });
    else if (g) setFocus({ lat: g.lat, lng: g.lng, zoom: 11, label: value });
    else if (!value)
      setFocus({ lat: 35.4, lng: 104.2, zoom: 4, label: "全国视野" });
  }
  async function save(method, row) {
    const saved = await window.desktop.call(method, row);
    await refresh();
    setModal(null);
    notice("已保存");
    if (method === "saveGym") {
      setSelected(saved.id);
      if (saved.lat != null)
        setFocus({
          lat: saved.lat,
          lng: saved.lng,
          label: saved.city || saved.name,
        });
    } else if (method === "saveEquipment") setEquipmentId(saved.id);
  }
  async function changeVisit(g, visited) {
    await window.desktop.call("saveGym", {
      ...g,
      visited,
      visitDate: visited
        ? g.visitDate || new Date().toLocaleDateString("en-CA")
        : "",
    });
    await refresh();
  }
  function remove(collection, row) {
    ask(`删除「${row.name}」？对应的器械关联也会解除。`, async () => {
      await window.desktop.call("delete", { collection, id: row.id });
      await refresh();
      if (collection === "gyms") setSelected(null);
      else setEquipmentId(null);
      notice("已删除");
    });
  }
  function importFile(kind) {
    requireData(() =>
      run(async () => {
        const result = await window.desktop.call("previewImport", kind);
        if (result) setModal({ type: "import", draft: result });
      }),
    );
  }
  const linked = gym ? db.links.filter((l) => l.gymId === gym.id) : [];
  function brandTags(g) {
    return (
      <div className="brand-tags">
        {(g.brandIds || []).map((id) => {
          const b = db.brands.find((b) => b.id === id);
          return (
            b && (
              <button
                key={id}
                onClick={() => {
                  setPage("equipment");
                  setEqType("");
                  setEqFreeType("");
                  setEqApplication("");
                  setEqMode("brand");
                  setEqGroup(id);
                  setEqTag("");
                  setEqLoading("");
                  setEqQuery("");
                  setEquipmentId(null);
                }}
              >
                {b.name}
                <ArrowUpRight size={12} />
              </button>
            )
          );
        })}
      </div>
    );
  }
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-symbol">
            <MapPin size={25} strokeWidth={1.8} />
          </div>
          <div>
            <h1>全国健身房地图</h1>
            <span>我的训练足迹</span>
          </div>
        </div>
        <nav className="main-nav" aria-label="主导航">
          <button
            className={page === "map" ? "active" : ""}
            onClick={() => setPage("map")}
          >
            <Map size={18} />
            健身房地图
          </button>
          <button
            className={page === "equipment" ? "active" : ""}
            onClick={() => {
              setPage("equipment");
              setPickDraft(null);
            }}
          >
            <Dumbbell size={19} />
            器械库
          </button>
        </nav>
        <div className="header-end">
          <span className={`storage-state ${status.ready ? "" : "unready"}`}>
            <i />
            {status.ready ? "本地档案" : "数据未就绪"}
          </span>
          <IconButton
            icon={Settings2}
            label="数据与设置"
            onClick={() => setModal({ type: "settings" })}
          />
        </div>
      </header>
      {(!status.ready || status.error) && (
        <div className="setup-banner">
          <FolderOpen size={18} />
          <span>
            {status.error
              ? `本地数据读取失败：${status.error}`
              : status.browser
                ? "桌面程序预览"
                : "尚未设置用户数据目录"}
          </span>
          <button onClick={() => setModal({ type: "settings" })}>
            {status.dataRoot ? "检查数据目录" : "设置数据目录"}
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      <main className={`map-page ${page !== "map" ? "hidden" : ""}`}>
        <aside className="gym-sidebar">
          <div className="sidebar-heading">
            <div>
              <span className="eyebrow">我的场馆</span>
              <h2>
                健身房档案<span>{db.gyms.length}</span>
              </h2>
            </div>
            <IconButton
              icon={Plus}
              label="新增健身房"
              onClick={() =>
                requireData(() => setModal({ type: "gym", row: emptyGym() }))
              }
            />
          </div>
          <div className="stats">
            <div>
              <strong>
                {db.gyms
                  .filter((g) => g.visited)
                  .length.toString()
                  .padStart(2, "0")}
              </strong>
              <span>
                <i className="dot blue" />
                已去过
              </span>
            </div>
            <div>
              <strong>
                {db.gyms
                  .filter((g) => !g.visited)
                  .length.toString()
                  .padStart(2, "0")}
              </strong>
              <span>
                <i className="dot gray" />
                未去过
              </span>
            </div>
            <div>
              <strong>
                {new Set(
                  db.gyms.filter((g) => g.visited && g.city).map((g) => g.city),
                ).size
                  .toString()
                  .padStart(2, "0")}
              </strong>
              <span>到访城市</span>
            </div>
          </div>
          <div className="gym-search">
            <div className="search-input">
              <Search size={17} />
              <input
                aria-label="搜索健身房"
                placeholder="搜索场馆、城市、标签"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <IconButton
                  icon={X}
                  label="清空搜索"
                  onClick={() => setQuery("")}
                />
              )}
            </div>
            <div className="filter-line">
              <select
                aria-label="城市筛选"
                value={city}
                onChange={(e) => chooseCity(e.target.value)}
              >
                <option value="">全国城市</option>
                {cities.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <IconButton
                icon={SlidersHorizontal}
                label="更多筛选"
                aria-pressed={filters}
                onClick={() => setFilters(!filters)}
              />
            </div>
            <div className="segmented filter-status">
              {[
                ["all", "全部"],
                ["visited", "已去过"],
                ["unvisited", "未去过"],
              ].map(([value, label]) => (
                <button
                  className={visitFilter === value ? "selected" : ""}
                  key={value}
                  onClick={() => setVisitFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {filters && (
              <div className="extra-filters">
                <select
                  aria-label="标签筛选"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                >
                  <option value="">全部标签</option>
                  {gymTags.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery("");
                    chooseCity("");
                    setVisitFilter("all");
                    setTag("");
                  }}
                >
                  重置筛选
                </button>
              </div>
            )}
          </div>
          <div className="list-heading">
            <span>{visibleGyms.length} 个场馆</span>
            <select
              aria-label="健身房排序"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="updated">最近更新</option>
              <option value="name">名称排序</option>
              <option value="score">评分排序</option>
            </select>
          </div>
          <div className="gym-list">
            {visibleGyms.map((g) => (
              <article
                className={`gym-item ${selected === g.id ? "selected" : ""} ${hover.hoveredId === g.id ? "is-hovered" : ""}`}
                key={g.id}
                data-gym-id={g.id}
                onClick={(event) => {
                  if (!event.target.closest("button, a, input, select"))
                    showGym(g.id);
                }}
                onMouseEnter={(event) =>
                  hover.enter(g.id, "list", event.currentTarget)
                }
                onMouseLeave={() => hover.leave(g.id, "list")}
              >
                <button className="gym-open" onClick={() => showGym(g.id)}>
                  <div className="gym-item-heading">
                    <h3>{g.name}</h3>
                    <ArrowUpRight size={17} />
                  </div>
                  <p className="location-line">
                    <MapPin size={13} />
                    {[g.city, g.district].filter(Boolean).join(" / ") ||
                      "位置待补充"}
                    <span className="score">{g.score ?? "待评分"}</span>
                  </p>
                  <p className="one-line">{g.description || "暂无简介"}</p>
                </button>
                <div className="parallel-tags">
                  <Tags values={(g.tags || []).slice(0, 3)} />
                  {brandTags(g)}
                </div>
                <div className="gym-item-foot">
                  <button
                    className={`visit-pill ${g.visited ? "visited" : ""}`}
                    disabled={busy}
                    onClick={() => run(() => changeVisit(g, !g.visited))}
                  >
                    <i className={`dot ${g.visited ? "blue" : "gray"}`} />
                    {g.visited ? "已去过" : "未去过"}
                  </button>
                  <span>
                    <Dumbbell size={13} />
                    {db.links.filter((l) => l.gymId === g.id).length} 款器械
                  </span>
                </div>
                {g.reviewUrl && (
                  <button
                    className="text-button review-inline"
                    onClick={() =>
                      run(() => window.desktop.call("external", g.reviewUrl))
                    }
                  >
                    查看详细测评
                    <ExternalLink size={13} />
                  </button>
                )}
              </article>
            ))}
            {!visibleGyms.length && (
              <Empty
                title={
                  db.gyms.length ? "没有符合条件的场馆" : "还没有健身房档案"
                }
              >
                {db.gyms.length ? (
                  <button
                    className="text-button"
                    onClick={() => {
                      setQuery("");
                      setCity("");
                      setVisitFilter("all");
                      setTag("");
                    }}
                  >
                    清除筛选
                  </button>
                ) : (
                  <button
                    className="primary"
                    onClick={() =>
                      requireData(() =>
                        setModal({ type: "gym", row: emptyGym() }),
                      )
                    }
                  >
                    <Plus size={16} />
                    新增健身房
                  </button>
                )}
              </Empty>
            )}
          </div>
          <footer className="sidebar-foot">
            <button onClick={() => importFile("gyms")}>
              <Upload size={15} />
              导入档案
            </button>
            <button
              className="text-button"
              onClick={() => importFile("review")}
            >
              <Upload size={15} />
              测评导入
            </button>
            <IconButton
              icon={Download}
              label="导出健身房"
              onClick={() =>
                requireData(() =>
                  run(async () => {
                    const file = await window.desktop.call("export", "gyms");
                    if (file) notice(`已导出\n${file}`);
                  }),
                )
              }
            />
          </footer>
        </aside>
        <MapView
          gyms={visibleGyms}
          hoveredId={hover.hoveredId}
          onHover={hover.enter}
          onHoverLeave={hover.leave}
          onHoverGeometry={hover.geometry}
          selected={selected}
          onSelect={(id) => showGym(id)}
          pick={!!pickDraft}
          onPick={(position) => {
            if (!pickDraft) return;
            setModal({ type: "gym", row: { ...pickDraft, ...position } });
            setPickDraft(null);
          }}
          focus={focus}
        />
        {pickDraft && (
          <button
            className="cancel-pick"
            onClick={() => {
              setModal({ type: "gym", row: pickDraft });
              setPickDraft(null);
            }}
          >
            <X size={16} />
            取消选点
          </button>
        )}
        {gym && !pickDraft && (
          <aside className="detail-panel" aria-label="健身房详情">
            <div className="detail-head">
              <span>场馆档案</span>
              <div className="actions">
                <IconButton
                  icon={Pencil}
                  label="编辑健身房"
                  onClick={() => setModal({ type: "gym", row: gym })}
                />
                <IconButton
                  icon={Trash2}
                  label="删除健身房"
                  onClick={() => remove("gyms", gym)}
                />
                <IconButton
                  icon={X}
                  label="关闭健身房详情"
                  onClick={() => setSelected(null)}
                />
              </div>
            </div>
            {gym.cover && (
              <Picture
                src={gym.cover}
                alt={gym.name}
                type="gym"
                className="gym-cover"
              />
            )}
            <div className="detail-body">
              <span className="eyebrow">
                {[gym.province, gym.city, gym.district]
                  .filter(Boolean)
                  .join(" / ") || "位置待补充"}
              </span>
              <h2>{gym.name}</h2>
              <Status
                visited={gym.visited}
                disabled={busy}
                onChange={(visited) => run(() => changeVisit(gym, visited))}
              />
              {gym.visitDate && (
                <p className="muted">到访日期 · {gym.visitDate}</p>
              )}
              <p className="address">
                <MapPin size={16} />
                {gym.address || "地址待补充"}
              </p>
              {gym.lat == null && (
                <button
                  className="text-button"
                  onClick={() => {
                    setPickDraft(gym);
                    setSelected(null);
                  }}
                >
                  补充地图位置
                  <ArrowUpRight size={15} />
                </button>
              )}
              <Tags values={gym.tags} />
              {brandTags(gym)}
              <p className="description">{gym.description || "暂无简介"}</p>
              {gym.photos?.length > 0 && (
                <div className="gallery">
                  {gym.photos.map((p, i) => (
                    <button
                      key={p}
                      title={`查看照片 ${i + 1}`}
                      onClick={() =>
                        setModal({ type: "photo", src: p, name: gym.name })
                      }
                    >
                      <img src={asset(p)} alt={`${gym.name} 照片 ${i + 1}`} />
                    </button>
                  ))}
                </div>
              )}
              <section className="detail-section">
                <div className="section-label">
                  <h3>测评档案</h3>
                  <button
                    className="text-button"
                    onClick={() => importFile("review")}
                  >
                    <Upload size={14} />
                    导入测评
                  </button>
                </div>
                <div className="review-score">
                  <strong>{gym.score ?? "待补充"}</strong>
                  <span>{gym.reviewSource || "外部测评评分"}</span>
                </div>
                {gym.reviewUrl ? (
                  <button
                    className="outline full-width"
                    onClick={() =>
                      run(() => window.desktop.call("external", gym.reviewUrl))
                    }
                  >
                    查看详细测评
                    <ExternalLink size={15} />
                  </button>
                ) : (
                  <p className="muted">尚未添加测评链接</p>
                )}
                {gym.area != null && (
                  <p>
                    面积 · {String(gym.area)} · {gym.areaType || "未说明"}
                  </p>
                )}
                {gym.reviewSummary?.length > 0 && (
                  <details>
                    <summary>测评摘要</summary>
                    <dl className="summary-table">
                      {gym.reviewSummary.map((s) => (
                        <React.Fragment key={s.label}>
                          <dt>{s.label}</dt>
                          <dd>{s.value || "未提供"}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  </details>
                )}
                {gym.reviewVersion && (
                  <p className="muted">测评版本 · {gym.reviewVersion}</p>
                )}
                {gym.reviewDate && (
                  <p className="muted">测评时间 · {gym.reviewDate}</p>
                )}
                {gym.reviewImportedAt && (
                  <p className="muted">
                    导入时间 ·{" "}
                    {new Date(gym.reviewImportedAt).toLocaleString("zh-CN")}
                  </p>
                )}
                {gym.rawReview && (
                  <details>
                    <summary>原始测评</summary>
                    <pre>{JSON.stringify(gym.rawReview, null, 2)}</pre>
                    <button
                      className="text-button"
                      onClick={() =>
                        run(async () => {
                          const file = await window.desktop.call(
                            "exportReview",
                            gym.id,
                          );
                          if (file) notice(`已导出原始测评\n${file}`);
                        })
                      }
                    >
                      <Download size={15} />
                      导出原始测评
                    </button>
                  </details>
                )}
              </section>
              <section className="detail-section">
                <div className="section-label">
                  <h3>
                    关联器械 <span>{linked.length}</span>
                  </h3>
                  <IconButton
                    icon={Plus}
                    label="关联器械"
                    onClick={() => setModal({ type: "link", gym })}
                  />
                </div>
                {!linked.length && <p className="muted">暂无关联器械</p>}
                {linked.map((l) => {
                  const e = db.equipment.find((e) => e.id === l.equipmentId);
                  return (
                    <div className="linked-item" key={l.id}>
                      <button
                        className="linked-open"
                        onClick={() => {
                          setPage("equipment");
                          setEquipmentId(e.id);
                        }}
                      >
                        <strong>{e.name}</strong>
                        <small>
                          {db.brands.find((b) => b.id === e.brandId)?.name} ·{" "}
                          {l.quantity} 台 · {l.status}
                        </small>
                        {l.notes && <small>{l.notes}</small>}
                      </button>
                      <IconButton
                        icon={X}
                        label={`解除关联 ${e.name}`}
                        onClick={() =>
                          ask(`解除「${e.name}」的关联？`, async () => {
                            await window.desktop.call("unlink", l.id);
                            await refresh();
                          })
                        }
                      />
                    </div>
                  );
                })}
              </section>
            </div>
          </aside>
        )}
      </main>
      {page === "equipment" && (
        <main className="equipment-page">
          <div className="equipment-header">
            <div>
              <span className="eyebrow">我的器械档案</span>
              <h2>
                器械库 <span>{db.equipment.length}</span>
              </h2>
            </div>
            <div className="actions">
              <button
                onClick={() => requireData(() => setModal({ type: "brands" }))}
              >
                <Building2 size={16} />
                品牌管理
              </button>
              <button
                onClick={() =>
                  requireData(() =>
                    setModal({
                      type: "equipment",
                      row: emptyEquipment(eqMode === "brand" ? eqGroup : ""),
                      official: true,
                    }),
                  )
                }
              >
                <Globe size={16} />
                官网导入
              </button>
              <button
                onClick={() =>
                  requireData(() => setModal({ type: "batch-import" }))
                }
              >
                <Download size={16} />
                批量网页导入
              </button>
              <button
                className="primary"
                onClick={() =>
                  requireData(() =>
                    setModal({
                      type: "equipment",
                      row: emptyEquipment(eqMode === "brand" ? eqGroup : ""),
                    }),
                  )
                }
              >
                <Plus size={17} />
                新增器械
              </button>
            </div>
          </div>
          <div className="equipment-type-tabs" aria-label="器械顶级分类">
            {[["", "全部"], ...EQUIPMENT_TYPES].map(([type, label]) => (
              <button
                key={type}
                className={eqType === type ? "selected" : ""}
                onClick={() => {
                  setEqType(type);
                  setEqFreeType("");
                  setEqApplication("");
                  setEqTag("");
                  setEqLoading("");
                  if (type !== "fixed" && eqMode === "part") {
                    setEqMode("brand");
                    setEqGroup("");
                  }
                }}
              >
                {label}
                <span>
                  {
                    db.equipment.filter(
                      (e) => !type || equipmentType(e) === type,
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
          <div className="equipment-layout">
            <aside className="equipment-sidebar">
              <div className="segmented">
                <button
                  className={eqMode === "brand" ? "selected" : ""}
                  onClick={() => {
                    setEqMode("brand");
                    setEqGroup("");
                  }}
                >
                  按品牌
                </button>
                {(eqType === "fixed" || !eqType) && (
                  <button
                    className={eqMode === "part" ? "selected" : ""}
                    onClick={() => {
                      setEqMode("part");
                      setEqGroup("");
                    }}
                  >
                    按部位
                  </button>
                )}
              </div>
              <button
                className={`group-item ${!eqGroup ? "selected" : ""}`}
                onClick={() => setEqGroup("")}
              >
                <span>全部器械</span>
                <span>{db.equipment.length}</span>
              </button>
              <div className="group-list">
                {(eqMode === "brand"
                  ? db.brands.map((b) => [b.id, b.name])
                  : PARTS
                ).map(([id, name]) => (
                  <button
                    className={`group-item ${eqGroup === id ? "selected" : ""}`}
                    key={id}
                    onClick={() => setEqGroup(id)}
                  >
                    <span>{name}</span>
                    <span>
                      {
                        db.equipment.filter(
                          (e) =>
                            (!eqType || equipmentType(e) === eqType) &&
                            (eqMode === "brand"
                              ? e.brandId === id
                              : (e.parts ?? [e.part]).includes(id)),
                        ).length
                      }
                    </span>
                  </button>
                ))}
              </div>
              <div className="equipment-import">
                <button onClick={() => importFile("equipment")}>
                  <Upload size={15} />
                  导入器械
                </button>
                <IconButton
                  icon={Download}
                  label="导出器械"
                  onClick={() =>
                    requireData(() =>
                      run(async () => {
                        const file = await window.desktop.call(
                          "export",
                          "equipment",
                        );
                        if (file) notice(`已导出\n${file}`);
                      }),
                    )
                  }
                />
              </div>
            </aside>
            <section className="equipment-main">
              <div className="equipment-toolbar">
                <div className="search-input">
                  <Search size={17} />
                  <input
                    aria-label="搜索器械"
                    placeholder="搜索器械、型号、品牌"
                    value={eqQuery}
                    onChange={(e) => setEqQuery(e.target.value)}
                  />
                </div>
                {(eqType === "fixed" || !eqType) && (
                  <select
                    aria-label="器械部位筛选"
                    value={eqTag}
                    onChange={(e) => setEqTag(e.target.value)}
                  >
                    <option value="">全部部位</option>
                    {PARTS.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
                {eqType === "fixed" && (
                  <select
                    aria-label="应用标签筛选"
                    value={eqApplication}
                    onChange={(e) => setEqApplication(e.target.value)}
                  >
                    <option value="">全部应用标签</option>
                    {TAGS.map((tag) => (
                      <option key={tag}>{tag}</option>
                    ))}
                  </select>
                )}
                {eqType === "free_weight" && (
                  <select
                    aria-label="自由力量子类筛选"
                    value={eqFreeType}
                    onChange={(e) => setEqFreeType(e.target.value)}
                  >
                    <option value="">全部自由力量</option>
                    {FREE_WEIGHT_TYPES.map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  aria-label="器械排序"
                  value={eqSort}
                  onChange={(e) => setEqSort(e.target.value)}
                >
                  <option value="name">名称排序</option>
                  <option value="updated">最近更新</option>
                </select>
                {(eqType === "fixed" || !eqType) && (
                  <select
                    aria-label="器械负重类型筛选"
                    value={eqLoading}
                    onChange={(e) => setEqLoading(e.target.value)}
                  >
                    <option value="">全部负重类型</option>
                    <option>插片</option>
                    <option>挂片</option>
                  </select>
                )}
              </div>
              <div className="equipment-count">
                <span>
                  {eqGroup
                    ? eqMode === "brand"
                      ? db.brands.find((b) => b.id === eqGroup)?.name
                      : partName(eqGroup)
                    : "全部器械"}
                </span>
                <span>{equipment.length} 款器械</span>
              </div>
              <div className="equipment-grid">
                {equipment.map((e) => (
                  <button
                    className="equipment-card"
                    key={e.id}
                    onClick={() => setEquipmentId(e.id)}
                  >
                    <Picture src={e.image} alt={e.name} />
                    <div className="equipment-card-body">
                      <span className="eyebrow">
                        {db.brands.find((b) => b.id === e.brandId)?.name}
                      </span>
                      <h3>{e.name}</h3>
                      <p>
                        {equipmentSummary(e)}
                        <span>{e.model || "型号未填写"}</span>
                      </p>
                      <Tags
                        values={equipmentType(e) === "fixed" ? e.tags : []}
                      />
                      <div className="equipment-card-foot">
                        <span>
                          <MapPin size={13} />
                          {
                            db.links.filter((l) => l.equipmentId === e.id)
                              .length
                          }{" "}
                          家健身房
                        </span>
                        <ArrowUpRight size={16} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {!equipment.length && (
                <Empty
                  title={
                    db.equipment.length
                      ? "没有符合条件的器械"
                      : "还没有器械档案"
                  }
                  icon={Dumbbell}
                >
                  <button
                    className="primary"
                    onClick={() =>
                      requireData(() =>
                        setModal({ type: "equipment", row: emptyEquipment() }),
                      )
                    }
                  >
                    <Plus size={16} />
                    新增器械
                  </button>
                </Empty>
              )}
            </section>
          </div>
        </main>
      )}
      {page === "equipment" && eq && (
        <Modal
          title="器械详情"
          wide
          onClose={() => setEquipmentId(null)}
          footer={
            <>
              <button
                className="danger text-button"
                onClick={() => remove("equipment", eq)}
              >
                <Trash2 size={16} />
                删除器械
              </button>
              <button
                className="primary"
                onClick={() => setModal({ type: "equipment", row: eq })}
              >
                <Pencil size={16} />
                编辑器械
              </button>
            </>
          }
        >
          <div className="equipment-detail">
            <Picture src={eq.image} alt={eq.name} />
            <div>
              <span className="eyebrow">
                {db.brands.find((b) => b.id === eq.brandId)?.name}
              </span>
              <h2>{eq.name}</h2>
              <p className="muted">
                {equipmentSummary(eq)} · {eq.model || "型号未填写"}
              </p>
              <Tags values={equipmentType(eq) === "fixed" ? eq.tags : []} />
              <p className="description">{eq.notes || "暂无备注"}</p>
              {eq.productUrl && (
                <button
                  className="text-button"
                  onClick={() =>
                    run(() => window.desktop.call("external", eq.productUrl))
                  }
                >
                  官网产品页
                  <ExternalLink size={15} />
                </button>
              )}
              {eq.imageSource && (
                <button
                  className="text-button"
                  onClick={() =>
                    run(() => window.desktop.call("external", eq.imageSource))
                  }
                >
                  图片来源
                  <ExternalLink size={15} />
                </button>
              )}
              {eq.image && <p className="local-path">本地图片 · {eq.image}</p>}
            </div>
          </div>
          <section className="detail-section">
            <div className="section-label">
              <h3>关联健身房</h3>
              <span>
                {db.links.filter((l) => l.equipmentId === eq.id).length} 家
              </span>
            </div>
            {db.links
              .filter((l) => l.equipmentId === eq.id)
              .map((l) => {
                const g = db.gyms.find((g) => g.id === l.gymId);
                return (
                  <button
                    className="reverse-link"
                    key={l.id}
                    onClick={() => showGym(g.id, true)}
                  >
                    <MapPin size={18} />
                    <div>
                      <strong>{g.name}</strong>
                      <small>
                        {g.city || "城市待补充"} · {l.quantity} 台 · {l.status}
                      </small>
                    </div>
                    <ArrowUpRight size={18} />
                  </button>
                );
              })}
            {!db.links.some((l) => l.equipmentId === eq.id) && (
              <p className="muted">暂无关联健身房</p>
            )}
          </section>
        </Modal>
      )}
      {modal?.type === "gym" && (
        <GymForm
          brands={db.brands}
          initial={modal.row}
          onClose={() => setModal(null)}
          onSave={(row) => run(() => save("saveGym", row))}
          run={run}
          onPick={(draft) => {
            setPickDraft(draft);
            setModal(null);
            setPage("map");
          }}
        />
      )}
      {modal?.type === "equipment" && (
        <EquipmentForm
          initial={modal.row}
          brands={db.brands}
          official={modal.official}
          onClose={() => setModal(null)}
          onSave={(row) => run(() => save("saveEquipment", row))}
          run={run}
        />
      )}
      {modal?.type === "batch-import" && (
        <BatchImport
          db={db}
          onClose={() => setModal(null)}
          onSaved={refresh}
          run={run}
        />
      )}
      {modal?.type === "brands" && (
        <BrandManager
          brands={db.brands}
          equipment={db.equipment}
          onClose={() => setModal(null)}
          refresh={refresh}
          run={run}
          ask={ask}
        />
      )}
      {modal?.type === "link" && (
        <EquipmentPicker
          gym={modal.gym}
          equipment={db.equipment}
          brands={db.brands}
          links={db.links}
          onClose={() => setModal(null)}
          onSave={(row) =>
            run(async () => {
              await window.desktop.call("linkBatch", row);
              await refresh();
              setModal(null);
              notice("器械关联已保存");
            })
          }
        />
      )}
      {modal?.type === "import" && (
        <ImportDialog
          draft={modal.draft}
          gyms={db.gyms}
          onClose={() => setModal(null)}
          onCommit={(input) =>
            run(async () => {
              const result = await window.desktop.call("commitImport", input);
              await refresh();
              setModal(null);
              notice(result.archiveWarning || "导入已完成");
              if (modal.draft.kind === "review") {
                setSelected(result.id);
                setPage("map");
              }
            })
          }
        />
      )}
      {modal?.type === "settings" && (
        <Settings
          status={status}
          settings={db.settings}
          onClose={() => setModal(null)}
          run={run}
          refresh={refresh}
          notice={notice}
        />
      )}
      {modal?.type === "photo" && (
        <Modal title={modal.name} wide onClose={() => setModal(null)}>
          <img className="full-photo" src={asset(modal.src)} alt={modal.name} />
        </Modal>
      )}
      {confirm && (
        <Modal
          title="确认操作"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button onClick={() => setConfirm(null)}>取消</button>
              <button
                className="danger-button"
                onClick={() =>
                  run(async () => {
                    await confirm.action();
                    setConfirm(null);
                  })
                }
              >
                确认
              </button>
            </>
          }
        >
          <p>{confirm.message}</p>
        </Modal>
      )}
      {error && (
        <Modal
          title="操作未完成"
          onClose={() => setError("")}
          footer={
            <button className="primary" onClick={() => setError("")}>
              知道了
            </button>
          }
        >
          <div className="error-message">
            <AlertCircle size={23} />
            <pre>{error}</pre>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <IconButton icon={X} label="关闭提示" onClick={() => setToast("")} />
        </div>
      )}
      <GymPreview
        controller={hover}
        gym={previewGym}
        count={equipmentCounts.get(previewGym?.id) || 0}
        onSelect={showGym}
      />
      {busy && <Busy />}
    </div>
  );
}
