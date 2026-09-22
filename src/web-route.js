export function readRoute(hash) {
  try {
    const [pathname, search = ""] = hash.replace(/^#/, "").split("?");
    const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const params = new URLSearchParams(search);
    if (parts.length > 2) return { page: "map", invalid: true };
    if (parts[0] === "gym" && parts[1]) return { page: params.get("from") === "equipment" ? "equipment" : "map", gym: parts[1] };
    if (parts[0] === "equipment") return { page: params.get("from") === "map" ? "map" : "equipment", equipment: parts[1] || null, gym: parts[1] ? params.get("gym") : null };
    return { page: "map", invalid: !!parts.length && parts[0] !== "map" };
  } catch {
    return { page: "map", invalid: true };
  }
}

export function routeHash({ page, gym, equipment }) {
  const params = new URLSearchParams();
  let route;
  if (equipment) {
    route = `/equipment/${encodeURIComponent(equipment)}`;
    if (page === "map") params.set("from", "map");
    if (gym) params.set("gym", gym);
  } else if (gym) {
    route = `/gym/${encodeURIComponent(gym)}`;
    if (page === "equipment") params.set("from", "equipment");
  } else route = page === "equipment" ? "/equipment" : "/map";
  return `#${route}${params.size ? `?${params}` : ""}`;
}
