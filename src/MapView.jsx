import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import gcoord from "gcoord";
import "leaflet/dist/leaflet.css";
import { LocateFixed, Plus, Minus, Layers, MapPin } from "lucide-react";
import { CITIES } from "./constants";
import { isWeb } from "./data-service.js";
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
    tiles = useRef(),
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
  const [street, setStreet] = useState(false),
    [mapError, setMapError] = useState(""),
    [zoom, setZoom] = useState(4);
  useEffect(() => {
    const map = L.map(container.current, {
      zoomControl: false,
      minZoom: 2,
      maxZoom: 19,
      zoomSnap: 0.25,
      preferCanvas: true,
      attributionControl: true,
    }).fitBounds(
      [
        [17, 73],
        [54, 136],
      ],
      { padding: [40, 50], maxZoom: 4 },
    );
    mapRef.current = map;
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
    fetch(`${import.meta.env.BASE_URL}china.json`)
      .then((r) => {
        if (!r.ok) throw new Error("全国离线底图加载失败");
        return r.json();
      })
      .then((data) => {
        if (!mapRef.current) return;
        gcoord.transform(data, gcoord.GCJ02, gcoord.WGS84);
        L.geoJSON(data, {
          style: {
            color: "#a6babc",
            weight: 1,
            fillColor: "#f5f7f3",
            fillOpacity: 1,
          },
          onEachFeature(feature, layer) {
            const name = feature.properties?.name;
            if (name)
              layer.bindTooltip(name, {
                sticky: true,
                className: "province-tip",
              });
            layer.on("click", (event) => {
              if (props.current.pick) {
                L.DomEvent.stopPropagation(event);
                props.current.onPick({
                  lat: Number(event.latlng.lat.toFixed(6)),
                  lng: Number(event.latlng.lng.toFixed(6)),
                });
              } else if (map.getZoom() < 6)
                map.fitBounds(layer.getBounds(), {
                  maxZoom: 7,
                  padding: [30, 30],
                });
            });
          },
        }).addTo(base);
        for (const feature of data.features) {
          const center =
            feature.properties?.centroid || feature.properties?.center;
          if (center && feature.properties.name)
            L.marker([center[1], center[0]], {
              interactive: false,
              icon: L.divIcon({
                className: "province-label",
                html: feature.properties.name.replace(
                  /维吾尔自治区|壮族自治区|回族自治区|自治区|特别行政区|省|市/g,
                  "",
                ),
                iconSize: [70, 22],
                iconAnchor: [35, 11],
              }),
            }).addTo(base);
        }
        map.attributionControl.addAttribution(
          "行政区轮廓：阿里云 DataV（Data Visualization，数据可视化）",
        );
      })
      .catch((e) => setMapError(e.message));
    const cityLayer = L.layerGroup();
    for (const [name, lat, lng] of CITIES)
      L.marker([lat, lng], {
        interactive: false,
        icon: L.divIcon({
          className: "city-label",
          html: `<span></span>${name}`,
          iconSize: [72, 20],
          iconAnchor: [3, 10],
        }),
      }).addTo(cityLayer);
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
          lng: Number(e.latlng.lng.toFixed(6)),
        });
    });
    map.on("zoomend", () =>
      container.current.classList.toggle("low-zoom", map.getZoom() < 4),
    );
    container.current.classList.toggle("low-zoom", map.getZoom() < 4);
    const resize = new ResizeObserver(() => {
      map.invalidateSize();
      if (map.getZoom() < 5)
        map.fitBounds(
          [
            [17, 73],
            [54, 136],
          ],
          { padding: [25, 50], maxZoom: 4 },
        );
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
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (street) {
      let failures = 0;
      tiles.current = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        {
          attribution:
            "&copy; OpenStreetMap（开放街图） &copy; CARTO（地图平台）",
          maxZoom: 19,
          subdomains: "abcd",
        },
      ).addTo(map);
      tiles.current.on("tileerror", () => {
        failures++;
        if (failures > 2)
          setMapError("街道地图暂时无法连接，仍可使用全国离线底图。");
      });
      tiles.current.on("tileload", () => setMapError(""));
    } else {
      if (tiles.current) {
        map.removeLayer(tiles.current);
        tiles.current = null;
      }
      setMapError("");
    }
  }, [street]);
  return (
    <div className={`map-shell ${pick ? "picking" : ""}`}>
      <div className="map" ref={container} data-testid="map" />
      <div className="map-caption">
        <span className="eyebrow">{isWeb ? "中国 · 健身场馆" : "中国 · 健身足迹"}</span>
        <strong>{zoom <= 5 ? "全国视野" : focus?.label || "城市视野"}</strong>
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
          title="回到全国"
          aria-label="回到全国"
          onClick={() =>
            mapRef.current?.fitBounds(
              [
                [17, 73],
                [54, 136],
              ],
              { padding: [25, 50], maxZoom: 4 },
            )
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
        <button
          title={street ? "切换离线底图" : "切换街道地图"}
          aria-label="切换街道地图"
          className={street ? "active" : ""}
          onClick={() => setStreet(!street)}
        >
          <Layers />
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
        {street ? "街道底图" : "全国离线底图"}
      </div>
      <div className="map-coordinate">
        {zoom <= 5 ? "34 个省级行政区" : `缩放级别 ${zoom}`}
        <span>{isWeb ? "共享场馆资料" : "个人健身档案"}</span>
      </div>
    </div>
  );
}
