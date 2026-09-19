import React from "react";
import { gymAccent } from "./GymPreview";
import "./gym-theme-picker.css";

const PRESETS = [
  ["松绿", "#397c70"],
  ["湖蓝", "#297aa3"],
  ["靛蓝", "#5868b0"],
  ["紫罗兰", "#8b5eab"],
  ["玫瑰", "#b34e77"],
  ["珊瑚", "#c6644c"],
  ["琥珀", "#ab8028"],
  ["石墨", "#52606b"],
];

export default function GymThemePicker({ value, onChange }) {
  const accent = gymAccent(value).toLowerCase();
  const color = accent.length === 4
    ? `#${accent.slice(1).split("").map((part) => part + part).join("")}`
    : accent;
  return (
    <div className="field full gym-theme-picker">
      <span id="gym-theme-label">场馆主题色</span>
      <div className="gym-theme-presets" role="group" aria-labelledby="gym-theme-label">
        {PRESETS.map(([name, preset]) => (
          <button
            key={preset}
            type="button"
            className="gym-theme-swatch"
            style={{ "--swatch-color": preset }}
            aria-label={`主题色：${name}`}
            aria-pressed={color === preset}
            title={name}
            onClick={() => onChange(preset)}
          >
            <span aria-hidden="true">{color === preset ? "✓" : ""}</span>
          </button>
        ))}
      </div>
      <div className="gym-theme-custom">
        <label>
          <span>自定义颜色</span>
          <input
            type="color"
            aria-label="自定义场馆主题色"
            value={color}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        <span className="gym-theme-value">{color.toUpperCase()}</span>
        <button type="button" onClick={() => onChange("")}>恢复默认</button>
      </div>
      <small>仅用于场馆详情和悬停预览的边框；未设置时使用默认松绿色。</small>
    </div>
  );
}
