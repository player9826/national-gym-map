import React, { useState } from "react";
import { asset } from "./constants";
import builtInLogos from "../public/brand-logos/index.json";
import logoSources from "../public/brand-logos/sources.json";

const backgrounds = Object.fromEntries(Object.entries(logoSources).map(([name, source]) => [name.trim().toUpperCase(), source.background]));

// Bundled logos need no network request and remain available offline. A user's
// uploaded logo takes precedence, with the official built-in as a fallback.
export default function BrandLogo({ brand, className = "" }) {
  const [failed, setFailed] = useState([]);
  const name = brand?.name || "未指定品牌";
  const bundled = builtInLogos[name.trim().toUpperCase()];
  const candidates = [brand?.logo ? asset(brand.logo) : "", bundled ? `${import.meta.env.BASE_URL}${bundled}` : ""].filter(Boolean);
  const src = candidates.find((candidate) => !failed.includes(candidate));
  const background = bundled && src === `${import.meta.env.BASE_URL}${bundled}` ? backgrounds[name.trim().toUpperCase()] : undefined;
  return (
    <span className={`brand-logo ${className}`} title={name}>
      {src ? <img src={src} alt={name} style={background ? { backgroundColor: background } : undefined} onError={() => setFailed((previous) => [...previous, src])} />
        : <span className="brand-logo-fallback">{name}</span>}
    </span>
  );
}
