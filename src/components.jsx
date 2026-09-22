import React, { useEffect, useRef, useState } from "react";
import { X, LoaderCircle, ImagePlus, Dumbbell, MapPin } from "lucide-react";
import { asset, PARTS, PART_TAGS, partName, tagLabel, isCustomPart } from "./constants";
import { createPortal } from "react-dom";
import { isWeb } from "./data-service.js";
const modalStack = [];
function syncModals() {
  modalStack.forEach((node, i) => {
    const top = i === modalStack.length - 1;
    node.inert = !top;
    node.setAttribute("aria-modal", String(top));
    node.setAttribute("aria-hidden", String(!top));
    node.parentElement.style.zIndex = String(1000 + i * 10);
  });
  const root = document.getElementById("root");
  if (root) root.inert = modalStack.length > 0;
  if (isWeb) document.body.classList.toggle("web-modal-open", modalStack.length > 0);
}
export function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button
      className="icon-button"
      type="button"
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={18} />
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  footer,
  className = "",
  closeLabel = "关闭弹窗",
  style,
}) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    const node = ref.current;
    modalStack.push(node);
    syncModals();
    node?.focus();
    return () => {
      const index = modalStack.indexOf(node);
      if (index !== -1) modalStack.splice(index, 1);
      syncModals();
      const top = modalStack.at(-1);
      if (prev?.isConnected && (!top || top.contains(prev))) prev.focus?.();
      else top?.focus();
    };
  }, []);
  function key(e) {
    if (modalStack.at(-1) !== ref.current) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    if (e.key === "Tab") {
      const items = [
        ...ref.current.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ),
      ].filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === items[0] ||
          document.activeElement === ref.current)
      ) {
        e.preventDefault();
        items.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
        e.preventDefault();
        items[0].focus();
      }
    }
  }
  return createPortal(
    <div
      className={`modal-backdrop${isWeb ? " web-modal-backdrop" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && modalStack.at(-1) === ref.current) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""} ${className}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
        onKeyDown={key}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <IconButton icon={X} label={closeLabel} onClick={onClose} />
        </header>
        <div className="modal-content">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
export function Field({ label, children, full, required }) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>
        {label}
        {required && <b className="required"> *</b>}
      </span>
      {children}
    </label>
  );
}
export function Tags({ values = [], colored = false }) {
  return (
    <div className="tags">
      {values.map((t) => (
        <span
          key={t}
          data-part={
            colored
              ? Object.keys(PART_TAGS).find((key) => PART_TAGS[key].includes(t))
              : undefined
          }
        >
          {tagLabel(t)}
        </span>
      ))}
    </div>
  );
}
export function PartTags({ parts = [] }) {
  return (
    <div className="tags part-tags">
      {[...new Set(parts)]
        .filter((key) => isCustomPart(key) || PARTS.some(([id]) => id === key))
        .map((key) => (
          <span key={key} data-part={isCustomPart(key) ? "OTHER" : key}>
            {partName(key)}
          </span>
        ))}
    </div>
  );
}
export function Status({ visited, onChange, disabled }) {
  return (
    <div className="segmented visit-switch" aria-label="打卡状态">
      {[false, true].map((value) => (
        <button
          type="button"
          key={String(value)}
          className={visited === value ? "selected" : ""}
          aria-pressed={visited === value}
          disabled={disabled}
          onClick={() => onChange(value)}
        >
          <i className={`dot ${value ? "blue" : "gray"}`} />
          {value ? "已去过" : "未去过"}
        </button>
      ))}
    </div>
  );
}
export function Picture({ src, alt, type = "equipment", className = "", thumbnail = true }) {
  const [failed, setFailed] = useState([]);
  useEffect(() => setFailed([]), [src]);
  const candidates = src ? [asset(src, { thumbnail: isWeb && thumbnail }), asset(src)] : [];
  const image = candidates.find((candidate) => !failed.includes(candidate));
  return image ? (
    <img
      className={`picture ${className}`}
      src={image}
      alt={alt}
      loading={isWeb ? "lazy" : undefined}
      decoding={isWeb ? "async" : undefined}
      onError={() => setFailed((previous) => [...previous, image])}
    />
  ) : (
    <div className={`image-placeholder ${className}`}>
      {type === "equipment" ? (
        <Dumbbell size={38} strokeWidth={1.2} />
      ) : (
        <MapPin size={32} strokeWidth={1.2} />
      )}
      <span>{src ? "照片读取失败" : "暂无照片"}</span>
    </div>
  );
}
export function PhotoInput({
  value,
  onChange,
  category,
  run,
  multiple = false,
}) {
  const values = multiple ? value || [] : value ? [value] : [];
  return (
    <div className="photo-input">
      <div className="photo-strip">
        {values.map((photo, i) => (
          <div className="photo-thumb" key={`${photo}-${i}`}>
            <img src={asset(photo)} alt={`照片 ${i + 1}`} />
            <IconButton
              icon={X}
              label={`移除照片 ${i + 1}`}
              onClick={() =>
                onChange(multiple ? values.filter((_, n) => n !== i) : "")
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="photo-add"
          onClick={() =>
            run(async () => {
              const photo = await window.desktop.call("uploadImage", category);
              if (photo) onChange(multiple ? [...values, photo] : photo);
            })
          }
        >
          <ImagePlus size={21} />
          <span>{values.length && !multiple ? "更换照片" : "添加照片"}</span>
        </button>
      </div>
    </div>
  );
}
export function Empty({ title, children, icon: Icon = MapPin }) {
  return (
    <div className="empty">
      <Icon size={34} strokeWidth={1.3} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Busy() {
  return (
    <div className="busy" role="status">
      <LoaderCircle className="spin" size={18} />
      正在处理
    </div>
  );
}
