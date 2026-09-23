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
import GymPreview, { useGymPreview, gymAccent } from "./GymPreview";
import BrandLogo from "./BrandLogo";
import GymListTags from "./GymListTags";
import { countryOf, countryName, gymLocation } from "../electron/gym-location.mjs";
import "./detail-refresh.css";
import EquipmentPicker from "./EquipmentPicker";
import EquipmentFilters from "./EquipmentFilters";
import {matchesEquipment, partOptions} from "./equipment-filtering";
import BatchImport from "./BatchImport";
import "./equipment-classification.css";
import { isWeb, loadSnapshot, openExternal } from "./data-service";
import { readRoute, routeHash } from "./web-route";
import {
  IconButton,
  Modal,
  Tags,
  PartTags,
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
  const [initialRoute] = useState(() => isWeb ? readRoute(location.hash) : { page: "map" });
  const [db, setDb] = useState(empty),
    [status, setStatus] = useState({ loading: isWeb }),
    [page, setPage] = useState(initialRoute.page);
  const [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [confirm, setConfirm] = useState(null);
  const [selected, setSelected] = useState(initialRoute.gym || null),
    [equipmentId, setEquipmentId] = useState(initialRoute.equipment || null),
    [query, setQuery] = useState(""),
    [visitFilter, setVisitFilter] = useState("all"),
    [city, setCity] = useState(""),
    [tag, setTag] = useState(""),
    [sort, setSort] = useState(isWeb ? "name" : "updated"),
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
    [eqSort, setEqSort] = useState("name"),
    [eqSeries, setEqSeries] = useState(""),
    [eqField, setEqField] = useState("all"),
    [linkedFilters, setLinkedFilters] = useState({}),
    [backTop, setBackTop] = useState(false);
  const equipmentScroll = useRef(null);
  const [routeInvalid, setRouteInvalid] = useState(!!initialRoute.invalid);
  useEffect(() => {
    if (!isWeb) return;
    const navigate = () => {
      const route = readRoute(location.hash);
      setPage(route.page); setSelected(route.gym || null); setEquipmentId(route.equipment || null);
      setRouteInvalid(!!route.invalid); setModal(null);
    };
    window.addEventListener("popstate", navigate);
    window.addEventListener("hashchange", navigate);
    return () => {
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("hashchange", navigate);
    };
  }, []);
  useEffect(() => {
    if (!isWeb || routeInvalid) return;
    const hash = routeHash({ page, gym: selected, equipment: equipmentId });
    if (location.hash !== hash) {
      if (!location.hash) history.replaceState(null, "", hash);
      else history.pushState(null, "", hash);
    }
  }, [page, selected, equipmentId, routeInvalid]);
  useEffect(() => { setLinkedFilters({}); }, [selected]);
  useEffect(() => { setBackTop(false); }, [page]);
  const running = useRef(false),
    notification = useRef();
  function notice(message) {
    clearTimeout(notification.current);
    setToast(message);
    notification.current = setTimeout(() => setToast(""), 6500);
  }
  async function refresh() {
    if (isWeb) setStatus((s) => ({ ...s, loading: true, error: "" }));
    try {
      const result = await loadSnapshot();
      setDb(result.db || empty);
      setStatus(result.status);
    } catch (e) {
      if (!isWeb) throw e;
      setStatus((s) => ({ ...s, loading: false, error: e.message }));
    }
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
    if (isWeb) return;
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
  const missingRoute = isWeb && status.ready && (routeInvalid || (selected && !gym) || (equipmentId && !eq));
  useEffect(() => {
    if (isWeb) document.title = `${eq?.name || gym?.name || (page === "equipment" ? "器械图鉴" : "探索场馆")} · 全国健身房地图`;
  }, [page, eq?.name, gym?.name]);
  async function share() {
    const url = location.href;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      notice("链接已复制，可以分享给朋友");
    } catch {
      setModal({ type: "share", url });
    }
  }
  const hover = useGymPreview(
    page !== "map" ||
      !!gym ||
      !!eq ||
      !!modal ||
      !!confirm ||
      !!error ||
      busy ||
      !!pickDraft,
  );
  const visibleGyms = useMemo(
    () =>
      db.gyms
        .filter(
          (g) =>
            `${g.name} ${countryName(countryOf(g))} ${g.province} ${g.city} ${g.district} ${g.address} ${g.tags?.join(" ")}`
              .toLowerCase()
              .includes(query.toLowerCase()) &&
            (!city || (g.city || "").replace(/市$/, "") === city.replace(/市$/, "")) &&
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
  const eqFilters = {type:eqType, freeType:eqFreeType, brand:eqGroup, part:eqTag, application:eqApplication, loading:eqLoading, series:eqSeries, field:eqField, query:eqQuery};
  function changeEqFilters(next) {
    setEqType(next.type || ''); setEqFreeType(next.freeType || '');
    setEqGroup(next.brand || ''); setEqTag(next.part || '');
    setEqApplication(next.application || ''); setEqLoading(next.loading || '');
    setEqSeries(next.series || ''); setEqField(next.field || 'all'); setEqQuery(next.query || '');
  }
  const equipment = db.equipment.filter(e => matchesEquipment(e, eqFilters, db.brands)).sort((a,b) => eqSort === 'updated' ? (b.updatedAt || '').localeCompare(a.updatedAt || '') : a.name.localeCompare(b.name,'zh-CN'));
  const brandEquipment = db.equipment.filter(e => !eqGroup || e.brandId === eqGroup);
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
  function showGym(id) {
    hover.close();
    if (!db.gyms.some((g) => g.id === id)) return;
    if (isWeb) setRouteInvalid(false);
    setEquipmentId(null);
    setSelected(id);
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
    const previousGym = method === "saveGym" ? db.gyms.find(g => g.id === row.id) : null;
    const saved = await window.desktop.call(method, row);
    await refresh();
    setModal(null);
    notice("已保存");
    if (method === "saveGym") {
      setSelected(saved.id);
      if (saved.lat != null && (!previousGym || previousGym.lat !== saved.lat || previousGym.lng !== saved.lng))
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
  function showBrand(id) {
    if (isWeb) setRouteInvalid(false);
    setSelected(null);
    setPage("equipment");
    setEqType("");
    setEqFreeType("");
    setEqApplication("");
    setEqMode("brand");
    setEqGroup(id);
    setEqSeries("");
    setEqTag("");
    setEqLoading("");
    setEqQuery("");
    setEquipmentId(null);
  }
  function brandTags(g) {
    return (
      <div className="brand-tags">
        {(g.brandIds || []).map((id) => {
          const b = db.brands.find((b) => b.id === id);
          return (
            b && (
              <button
                key={id}
                onClick={() => showBrand(id)}
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
    <div className={`app${isWeb ? " web-app" : ""}`}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-symbol">
            <MapPin size={25} strokeWidth={1.8} />
          </div>
          <div>
            <h1>全国健身房地图</h1>
            <span>{isWeb ? "探索场馆与器械" : "我的训练足迹"}</span>
          </div>
        </div>
        <nav className="main-nav" aria-label="主导航">
          <button
            className={page === "map" ? "active" : ""}
            onClick={() => { setPage("map"); if (isWeb) { setSelected(null); setEquipmentId(null); setRouteInvalid(false); } }}
          >
            <Map size={18} />
            健身房地图
          </button>
          <button
            className={page === "equipment" ? "active" : ""}
            onClick={() => {
              setPage("equipment");
              setPickDraft(null);
              if (isWeb) { setSelected(null); setEquipmentId(null); setRouteInvalid(false); }
            }}
          >
            <Dumbbell size={19} />
            器械库
          </button>
        </nav>
        <div className="header-end">
          <span className={`storage-state ${status.ready ? "" : "unready"}`}>
            <i />
            {status.ready ? (isWeb ? "公开资料" : "本地档案") : (status.loading ? "正在加载" : "数据未就绪")}
          </span>
          {!isWeb && <IconButton
            icon={Settings2}
            label="数据与设置"
            onClick={() => setModal({ type: "settings" })}
          />}
          {isWeb && <button className="text-button" disabled={status.loading} onClick={() => run(refresh)}>更新资料</button>}
        </div>
      </header>
      {isWeb && (status.loading || status.error) && <div className="setup-banner" role={status.error ? "alert" : "status"}>
        <span>{status.error || "正在加载公开场馆与器械资料…"}</span>
        {status.error && <button onClick={refresh}>重新加载</button>}
      </div>}
      {missingRoute && <div className="setup-banner" role="alert"><span>这条资料不存在或已撤下。</span><button onClick={() => { setSelected(null); setEquipmentId(null); setRouteInvalid(false); }}>返回浏览</button></div>}
      {!isWeb && (!status.ready || status.error) && (
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
              <h2>
                健身房档案<span>{db.gyms.length}</span>
              </h2>
            </div>
            {!isWeb && <IconButton
              icon={Plus}
              label="新增健身房"
              onClick={() =>
                requireData(() => setModal({ type: "gym", row: emptyGym() }))
              }
            />}
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
                <option value="">全部城市</option>
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
            {!isWeb && <div className="segmented filter-status">
              {[
                ["all", "全部", db.gyms.length],
                ["visited", "已去过", db.gyms.filter(g => g.visited).length],
                ["unvisited", "未去过", db.gyms.filter(g => !g.visited).length],
              ].map(([value, label, count]) => (
                <button
                  className={visitFilter === value ? "selected" : ""}
                  aria-label={label}
                  key={value}
                  onClick={() => setVisitFilter(value)}
                >
                  {label} <span>{count}</span>
                </button>
              ))}
            </div>}
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
            <span>{visibleGyms.length} 个场馆 · {isWeb ? "覆盖" : "到访"} {new Set(db.gyms.filter(g => (isWeb || g.visited) && g.city).map(g => g.city)).size} 城市</span>
            <select
              aria-label="健身房排序"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {!isWeb && <option value="updated">最近更新</option>}
              <option value="name">名称排序</option>
              {!isWeb && <option value="score">评分排序</option>}
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
                    <span className="gym-location" title={gymLocation(g)}>{gymLocation(g) || "位置待补充"}</span>
                    {!isWeb && <span className="score">{g.score ?? "待评分"}</span>}
                  </p>
                </button>
                <GymListTags tags={g.tags || []} brands={(g.brandIds || []).map(id => db.brands.find(b => b.id === id)).filter(Boolean)} onBrand={showBrand} onMore={() => showGym(g.id)}/>
                <div className="gym-item-foot">
                  {!isWeb && <button
                    className={`visit-pill ${g.visited ? "visited" : ""}`}
                    disabled={busy}
                    onClick={() => run(() => changeVisit(g, !g.visited))}
                  >
                    <i className={`dot ${g.visited ? "blue" : "gray"}`} />
                    {g.visited ? "已去过" : "未去过"}
                  </button>}
                  <span>
                    <Dumbbell size={13} />
                    {db.links.filter((l) => l.gymId === g.id).length} 款器械
                  </span>
                </div>
                {g.reviewUrl && (
                  <button
                    className="text-button review-inline"
                    onClick={() =>
                      run(() => openExternal(g.reviewUrl))
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
                ) : !isWeb ? (
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
                ) : <p>资料整理中，请稍后再来。</p>}
              </Empty>
            )}
          </div>
          {!isWeb && <footer className="sidebar-foot">
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
          </footer>}
          {isWeb && <footer className="sidebar-foot web-source-note">
            <span>{status.updatedAt ? `资料更新于 ${new Date(status.updatedAt).toLocaleDateString("zh-CN")}` : "公开场馆资料"}</span>
            <a href="https://github.com/player9826/national-gym-map/issues/new/choose" target="_blank" rel="noopener noreferrer">资料纠错 ↗</a>
          </footer>}
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
      </main>
      {page === "equipment" && (
        <main className="equipment-page">
          <div className="equipment-header">
            <div>
              <h2>
                器械库 <span>{db.equipment.length}</span>
              </h2>
            </div>
            {!isWeb && <div className="actions">
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
                      row: emptyEquipment(eqGroup),
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
                      row: emptyEquipment(eqGroup),
                    }),
                  )
                }
              >
                <Plus size={17} />
                新增器械
              </button>
            </div>}
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
                  if (type && type !== "fixed" && eqMode === "part") {
                    setEqMode("brand");
                  }
                }}
              >
                {label}
                <span>
                  {
                    db.equipment.filter(
                      (e) => (!eqGroup || e.brandId === eqGroup) && (!type || equipmentType(e) === type),
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
                  }}
                >
                  按品牌
                </button>
                {(eqType === "fixed" || !eqType) && (
                  <button
                    className={eqMode === "part" ? "selected" : ""}
                    onClick={() => {
                      setEqMode("part");
                    }}
                  >
                    按部位
                  </button>
                )}
              </div>
              <button
                className={`group-item ${!(eqMode === "brand" ? eqGroup : eqTag) ? "selected" : ""}`}
                onClick={() => eqMode === "brand" ? (setEqGroup(""), setEqSeries("")) : (setEqTag(""), setEqApplication(""))}
              >
                <span>全部器械</span>
                <span>{eqMode === "brand" ? db.equipment.length : brandEquipment.length}</span>
              </button>
              <div className="group-list">
                {(eqMode === "brand"
                  ? db.brands.map((b) => [b.id, b.name])
                  : partOptions(db.equipment)
                ).map(([id, name]) => (
                  <button
                    className={`group-item ${(eqMode === "brand" ? eqGroup : eqTag) === id ? "selected" : ""}`}
                    key={id}
                    onClick={() => eqMode === "brand" ? (setEqGroup(id), setEqSeries("")) : (setEqTag(id), setEqApplication(""))}
                  >
                    {eqMode === "brand" ? (
                      <BrandLogo brand={db.brands.find((b) => b.id === id)} />
                    ) : (
                      <span className="part-filter-label" data-part={id}>
                        {name}
                      </span>
                    )}
                    <span>
                      {
                        db.equipment.filter(
                          (e) =>
                            (!eqType || equipmentType(e) === eqType) &&
                            (eqMode === "brand"
                              ? e.brandId === id
                              : (!eqGroup || e.brandId === eqGroup) && (e.parts ?? [e.part]).includes(id)),
                        ).length
                      }
                    </span>
                  </button>
                ))}
              </div>
              {!isWeb && <div className="equipment-import">
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
              </div>}
            </aside>
            <section className="equipment-main" ref={equipmentScroll} onScroll={event => setBackTop(event.currentTarget.scrollTop > event.currentTarget.clientHeight)}>
              <div className="equipment-toolbar">
                <EquipmentFilters value={eqFilters} onChange={changeEqFilters} equipment={db.equipment} brands={db.brands} showType={false} showBrand={eqMode === 'part'} sortControl={<select
                  aria-label="器械排序"
                  value={eqSort}
                  onChange={(e) => setEqSort(e.target.value)}
                >
                  <option value="name">名称排序</option>
                  {!isWeb && <option value="updated">最近更新</option>}
                </select>} />
              </div>
              <div className="equipment-count">
                <span>
                  {[db.brands.find(b => b.id === eqGroup)?.name, eqTag && partName(eqTag)].filter(Boolean).join(' · ') || '全部器械'}
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
                      <div className="equipment-card-brand">
                        <BrandLogo brand={db.brands.find((b) => b.id === e.brandId)} />
                        {e.series && <span className="equipment-series" title={e.series}>— {e.series}</span>}
                      </div>
                      <h3 title={e.name}>{e.name}</h3>
                      <div className="equipment-card-tags" title={[...(e.parts ?? [e.part]).filter(Boolean).map(partName), ...(e.tags || []), e.loading].filter(Boolean).join(" · ")}>
                        <PartTags parts={equipmentType(e) === "fixed" ? (e.parts ?? [e.part]).slice(0, 1) : []} />
                        <Tags colored values={equipmentType(e) === "fixed" ? (e.tags || []).slice(0, 1) : [equipmentSummary(e)]} />
                        {equipmentType(e) === "fixed" && e.loading && <span className="equipment-loading">{e.loading}</span>}
                        {equipmentType(e) === "fixed" && ((e.parts ?? [e.part]).length + (e.tags || []).length > 2) && <small>更多</small>}
                      </div>
                      <div className="equipment-card-foot">
                        <span className="equipment-model" title={e.model || ""}>{e.model || ""}</span>
                        <span><MapPin size={12} />{db.links.filter((l) => l.equipmentId === e.id).length} 家健身房</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {backTop && <button className="equipment-back-top" aria-label="返回器械列表顶部" onClick={() => equipmentScroll.current?.scrollTo({top:0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"})}>↑ 返回顶部</button>}
              {!equipment.length && (
                <Empty
                  title={
                    db.equipment.length
                      ? "没有符合条件的器械"
                      : "还没有器械档案"
                  }
                  icon={Dumbbell}
                >
                  {!isWeb ? <button
                    className="primary"
                    onClick={() =>
                      requireData(() =>
                        setModal({ type: "equipment", row: emptyEquipment() }),
                      )
                    }
                  >
                    <Plus size={16} />
                    新增器械
                  </button> : db.equipment.length > 0 ? <button className="text-button" onClick={() => changeEqFilters({})}>清除筛选</button> : <p>资料整理中，请稍后再来。</p>}
                </Empty>
              )}
            </section>
          </div>
        </main>
      )}
      {gym && !pickDraft && !missingRoute && (
        <Modal
          title="健身房详情"
            closeLabel="关闭健身房详情"
          wide
          className="gym-detail-modal"
          style={{ "--gym-accent": gymAccent(gym.themeColor) }}
          onClose={() => setSelected(null)}
        >
          <div className="detail-head">
            <span>场馆档案</span>
            {isWeb ? <button className="text-button" onClick={share}><Link2 size={16} />复制链接</button> : <div className="actions">
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
            </div>}
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
              {gymLocation(gym) || "位置待补充"}
            </span>
            <h2>{gym.name}</h2>
            {!isWeb && <Status
              visited={gym.visited}
              disabled={busy}
              onChange={(visited) => run(() => changeVisit(gym, visited))}
            />}
            {gym.visitDate && (
              <p className="muted">到访日期 · {gym.visitDate}</p>
            )}
            <p className="address">
              <MapPin size={16} />
              {gym.address || "地址待补充"}
            </p>
            {!isWeb && gym.lat == null && (
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
            {!isWeb && <p className="description">{gym.description || "暂无简介"}</p>}
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
                    <Picture src={p} alt={`${gym.name} 照片 ${i + 1}`} type="gym" />
                  </button>
                ))}
              </div>
            )}
            {!isWeb && <section className="detail-section">
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
                    run(() => openExternal(gym.reviewUrl))
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
            </section>}
            <section className="detail-section">
              <div className="section-label">
                <h3>
                  关联器械 <span>{linked.length}</span>
                </h3>
                {!isWeb && <IconButton
                  icon={Plus}
                  label="关联器械"
                  onClick={() => setModal({ type: "link", gym })}
                />}
              </div>
              {!linked.length && <p className="muted">暂无关联器械</p>}
              {linked.length > 0 && <>
                <EquipmentFilters value={linkedFilters} onChange={setLinkedFilters} equipment={db.equipment.filter(e => linked.some(l => l.equipmentId === e.id))} brands={db.brands} />
                <p className="linked-filter-results">匹配 {linked.filter(l => { const e = db.equipment.find(e => e.id === l.equipmentId); return e && matchesEquipment(e, linkedFilters, db.brands); }).length} 款 / 已关联 {linked.length} 款</p>
              </>}
              {linked.filter(l => { const e = db.equipment.find(e => e.id === l.equipmentId); return e && matchesEquipment(e, linkedFilters, db.brands); }).map((l) => {
                const e = db.equipment.find((e) => e.id === l.equipmentId);
                if (!e) return null;
                return (
                  <div className="linked-item" key={l.id}>
                    <button
                      className="linked-image"
                      disabled={!e.image}
                      aria-label={`放大 ${e.name} 图片`}
                      onClick={() =>
                        setModal({ type: "photo", src: e.image, name: e.name })
                      }
                    >
                      <Picture src={e.image} alt={e.name} />
                    </button>
                    <button
                      className="linked-open"
                      onClick={() => {
                        setEquipmentId(e.id);
                      }}
                    >
                      <strong>{e.name}</strong>
                      {e.series && <small>系列 · {e.series}</small>}
                      <small>
                        <BrandLogo
                          brand={db.brands.find((b) => b.id === e.brandId)}
                        />{" "}
                        · {l.quantity} 台 · {l.status}
                      </small>
                      {l.notes && <small>{l.notes}</small>}
                    </button>
                    {!isWeb && <IconButton
                      icon={X}
                      label={`解除关联 ${e.name}`}
                      onClick={() =>
                        ask(`解除「${e.name}」的关联？`, async () => {
                          await window.desktop.call("unlink", l.id);
                          await refresh();
                        })
                      }
                    />}
                  </div>
                );
              })}
            </section>
          </div>
        </Modal>
      )}
      {eq && !missingRoute && (
        <Modal
          title="器械详情"
          closeLabel={isWeb ? "关闭器械详情" : "关闭弹窗"}
          wide
          onClose={() => setEquipmentId(null)}
          footer={isWeb ? <button className="text-button" onClick={share}><Link2 size={16} />复制链接</button> :
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
            <button
              className="equipment-detail-image"
              disabled={!eq.image}
              aria-label={`放大 ${eq.name} 图片`}
              onClick={() =>
                setModal({ type: "photo", src: eq.image, name: eq.name })
              }
            >
              <Picture src={eq.image} alt={eq.name} />
            </button>
            <div>
              <span className="eyebrow">
                <BrandLogo brand={db.brands.find((b) => b.id === eq.brandId)} />
              </span>
              <h2>{eq.name}</h2>
              {eq.series && <p className="equipment-series">系列 · {eq.series}</p>}
              <p className="muted">
                {equipmentType(eq) === "fixed" ? ["固定器械", eq.loading].filter(Boolean).join(" · ") : equipmentSummary(eq)} · {eq.model || "型号未填写"}
              </p>
              <PartTags
                parts={
                  equipmentType(eq) === "fixed" ? (eq.parts ?? [eq.part]) : []
                }
              />
              <Tags
                colored
                values={equipmentType(eq) === "fixed" ? eq.tags : []}
              />
              {!isWeb && <p className="description">{eq.notes || "暂无备注"}</p>}
              {eq.productUrl && (
                <button
                  className="text-button"
                  onClick={() =>
                    run(() => openExternal(eq.productUrl))
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
                    run(() => openExternal(eq.imageSource))
                  }
                >
                  图片来源
                  <ExternalLink size={15} />
                </button>
              )}
              {!isWeb && eq.image && <p className="local-path">本地图片 · {eq.image}</p>}
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
                        {gymLocation(g) || "位置待补充"} · {l.quantity} 台 · {l.status}
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
      {!isWeb && modal?.type === "gym" && (
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
      {!isWeb && modal?.type === "equipment" && (
        <EquipmentForm
          initial={modal.row}
          brands={db.brands}
          equipment={db.equipment}
          official={modal.official}
          onClose={() => setModal(null)}
          onSave={(row) => run(() => save("saveEquipment", row))}
          run={run}
        />
      )}
      {!isWeb && modal?.type === "batch-import" && (
        <BatchImport
          db={db}
          onClose={() => setModal(null)}
          onSaved={refresh}
          run={run}
        />
      )}
      {!isWeb && modal?.type === "brands" && (
        <BrandManager
          brands={db.brands}
          equipment={db.equipment}
          onClose={() => setModal(null)}
          refresh={refresh}
          run={run}
          ask={ask}
        />
      )}
      {!isWeb && modal?.type === "link" && (
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
      {!isWeb && modal?.type === "import" && (
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
      {!isWeb && modal?.type === "settings" && (
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
          <Picture className="full-photo" src={modal.src} alt={modal.name} thumbnail={false} />
        </Modal>
      )}
      {modal?.type === "share" && <Modal title="分享资料" onClose={() => setModal(null)}>
        <p>复制下面的链接，朋友即可直接查看这条资料。</p>
        <input aria-label="分享链接" readOnly value={modal.url} onFocus={event => event.target.select()} style={{ width: "100%" }} />
      </Modal>}
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
