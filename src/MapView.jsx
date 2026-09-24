import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import gcoord from "gcoord";
import "leaflet/dist/leaflet.css";
import { LocateFixed, Plus, Minus, MapPin } from "lucide-react";
import { CITIES } from "./constants";
import { isWeb } from "./data-service.js";
const WORLD_BOUNDS = [
  [-60, -180],
  [80, 180],
];

export default function MapView({
  gyms,
  selected,
  onSelect,
  pick,
  onPick,
  focus,
  hoveredId,
  onHover,
  onHoverLeave,
  onHoverGeometry,
}) {
  const container = useRef(),
    mapRef = useRef(),
    markers = useRef(),
    markerIndex = useRef(new Map()),
    props = useRef({});
  props.current = {
    onSelect,
    onPick,
    pick,
    hoveredId,
    onHover,
    onHoverLeave,
    onHoverGeometry,
  };
  const [mapError, setMapError] = useState(""),
    [zoom, setZoom] = useState(4);
  useEffect(() => {
    const map = L.map(container.current, {
      zoomControl: false,
      minZoom: 1,
      maxBounds: [
        [-85, -180],
        [85, 180],
      ],
      maxBoundsViscosity: 1,
      maxZoom: 19,
      zoomSnap: 0.25,
      preferCanvas: true,
      attributionControl: true,
    }).fitBounds(WORLD_BOUNDS, { padding: [24, 24], maxZoom: 3 });
    mapRef.current = map;
    setZoom(map.getZoom());
    const reportHover = () => {
      const id = props.current.hoveredId;
      const marker = markerIndex.current.get(id);
      if (!marker) return;
      const point = map.latLngToContainerPoint(marker.getLatLng()),
        size = map.getSize();
      props.current.onHoverGeometry?.(
        id,
        point.x >= 0 && point.x <= size.x && point.y >= 0 && point.y <= size.y,
      );
    };
    map.on("move zoom viewreset resize", reportHover);
    const base = L.layerGroup().addTo(map);
    markers.current = L.layerGroup().addTo(map);
    const cityLayer = L.layerGroup();
    const loadLocal = async (file) => {
      const response = await fetch(`${import.meta.env.BASE_URL}${file}`);
      if (!response.ok) throw new Error("离线底图加载失败，请重新启动程序。");
      return response.json();
    };
    Promise.all([
      loadLocal("world.json"),
      loadLocal("china.json"),
      loadLocal("world-cities.json"),
    ])
      .then(([world, china, cities]) => {
        if (mapRef.current !== map) return;
        // Only the existing China source uses offset coordinates.
        gcoord.transform(china, gcoord.GCJ02, gcoord.WGS84);
        for (const data of [world, china]) {
          L.geoJSON(data, {
            style: {
              color: "#a6babc",
              weight: 1,
              fillColor: "#f5f7f3",
              fillOpacity: 1,
            },
            onEachFeature(feature, layer) {
              const name = feature.properties?.name;
              if (name) {
                const label = document.createElement("span");
                label.textContent = name;
                layer.bindTooltip(label, {
                  sticky: true,
                  className: "province-tip",
                });
              }
              layer.on("click", (event) => {
                if (props.current.pick) {
                  L.DomEvent.stopPropagation(event);
                  props.current.onPick({
                    lat: Number(event.latlng.lat.toFixed(6)),
                    lng: Number(event.latlng.wrap().lng.toFixed(6)),
                  });
                } else if (map.getZoom() < 6) {
                  map.fitBounds(layer.getBounds(), {
                    maxZoom: 7,
                    padding: [30, 30],
                  });
                }
              });
            },
          }).addTo(base);
        }
        for (const feature of china.features) {
          const center =
            feature.properties?.centroid || feature.properties?.center;
          if (center && feature.properties.name) {
            const label = document.createElement("span");
            label.textContent = feature.properties.name.replace(
              /维吾尔自治区|壮族自治区|回族自治区|自治区|特别行政区|省|市/g,
              "",
            );
            const point = gcoord.transform(center, gcoord.GCJ02, gcoord.WGS84);
            L.marker([point[1], point[0]], {
              interactive: false,
              icon: L.divIcon({
                className: "province-label",
                html: label,
                iconSize: [70, 22],
                iconAnchor: [35, 11],
              }),
            }).addTo(base);
          }
        }
        const extraCities = cities.filter(
          ([, lat, lng]) =>
            !CITIES.some(
              ([, existingLat, existingLng]) =>
                Math.abs(lat - existingLat) < 0.25 &&
                Math.abs(lng - existingLng) < 0.25,
            ),
        );
        for (const [name, lat, lng] of [...CITIES, ...extraCities]) {
          const label = document.createElement("div");
          label.append(
            document.createElement("span"),
            document.createTextNode(name),
          );
          L.marker([lat, lng], {
            interactive: false,
            icon: L.divIcon({
              className: "city-label",
              html: label,
              iconSize: [100, 20],
              iconAnchor: [3, 10],
            }),
          }).addTo(cityLayer);
        }
        if (map.getZoom() >= 6) cityLayer.addTo(map);
        map.attributionControl.addAttribution(
          "世界轮廓与城市：Natural Earth · 中国省界：阿里云 DataV（Data Visualization，数据可视化）",
        );
      })
      .catch((error) => {
        if (mapRef.current === map) setMapError(error.message);
      });
    map.on("zoomend", () => {
      const z = map.getZoom();
      setZoom(z);
      if (z >= 6 && !map.hasLayer(cityLayer)) cityLayer.addTo(map);
      else if (z < 6) map.removeLayer(cityLayer);
      container.current.classList.toggle("city-zoom", z >= 6);
    });
    map.on("click", (e) => {
      if (props.current.pick)
        props.current.onPick({
          lat: Number(e.latlng.lat.toFixed(6)),
          lng: Number(e.latlng.wrap().lng.toFixed(6)),
        });
    });
    map.on("zoomend", () =>
      container.current.classList.toggle("low-zoom", map.getZoom() < 4),
    );
    container.current.classList.toggle("low-zoom", map.getZoom() < 4);
    const resize = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!markers.current) return;
    markers.current.clearLayers();
    markerIndex.current.clear();
    for (const gym of gyms)
      if (gym.lat != null && gym.lng != null) {
        const marker = L.marker([gym.lat, gym.lng], {
          title: gym.name,
          keyboard: true,
          icon: L.divIcon({
            className: `gym-marker ${gym.visited ? "visited" : ""} ${selected === gym.id ? "selected" : ""}`,
            html: "<span></span>",
            iconSize: [28, 34],
            iconAnchor: [14, 32],
          }),
        });
        marker.on("click", () => props.current.onSelect(gym.id));
        marker.on("mouseover", () => {
          if (!props.current.pick)
            props.current.onHover?.(gym.id, "map", marker.getElement());
        });
        marker.on("mouseout", () =>
          props.current.onHoverLeave?.(gym.id, "map"),
        );
        marker.addTo(markers.current);
        marker.getElement().dataset.gymId = gym.id;
        // Accessible name without a second native hover tooltip.
        marker.getElement().removeAttribute("title");
        marker.getElement().setAttribute("aria-label", gym.name);
        markerIndex.current.set(gym.id, marker);
      }
  }, [gyms]);
  useEffect(() => {
    for (const [id, marker] of markerIndex.current) {
      marker.getElement()?.classList.toggle("selected", id === selected);
      marker.getElement()?.classList.toggle("is-hovered", id === hoveredId);
      marker.setZIndexOffset(id === hoveredId ? 1000 : 0);
    }
  }, [gyms, selected, hoveredId]);
  useEffect(() => {
    if (focus && mapRef.current)
      mapRef.current.setView([focus.lat, focus.lng], focus.zoom || 13, {
        animate: true,
      });
  }, [focus]);
  return (
    <div className={`map-shell ${pick ? "picking" : ""}`}>
      <div className="map" ref={container} data-testid="map" />
      <div className="map-caption">
        <span className="eyebrow">{isWeb ? "全球 · 健身场馆" : "全球 · 健身足迹"}</span>
        <strong>{zoom <= 5 ? "全球视野" : focus?.label || "城市视野"}</strong>
      </div>
      {pick && (
        <div className="pick-banner">
          <MapPin size={17} />
          点击地图，选择健身房位置
        </div>
      )}
      {mapError && (
        <div className="map-alert" role="status">
          {mapError}
        </div>
      )}
      <div className="map-tools">
        <button
          title="回到全球"
          aria-label="回到全球"
          onClick={() =>
            mapRef.current?.fitBounds(WORLD_BOUNDS, {
              padding: [24, 24],
              maxZoom: 3,
            })
          }
        >
          <LocateFixed />
        </button>
        <button
          title="放大地图"
          aria-label="放大地图"
          onClick={() => mapRef.current?.zoomIn()}
        >
          <Plus />
        </button>
        <button
          title="缩小地图"
          aria-label="缩小地图"
          onClick={() => mapRef.current?.zoomOut()}
        >
          <Minus />
        </button>
      </div>
      <div className="map-legend">
        {!isWeb && <><span>
          <i className="dot blue" />
          已去过
        </span>
        <span>
          <i className="dot gray" />
          未去过
        </span>
        <span className="legend-divider" /></>}
        {isWeb && <><span><i className="dot gray" />已收录场馆</span><span className="legend-divider" /></>}
        全球离线底图
      </div>
      <div className="map-coordinate">
        {zoom <= 5 ? "国家轮廓 · 中国省界" : `缩放级别 ${zoom}`}
        <span>{isWeb ? "共享场馆资料" : "个人健身档案"}</span>
      </div>
    </div>
  );
}
