import React, { useEffect, useRef, useState } from "react";
import { X, LoaderCircle, ImagePlus, Dumbbell, MapPin } from "lucide-react";
import { asset } from "./constants";
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
export function Modal({ title, children, onClose, wide = false, footer }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  function key(e) {
    if (e.key === "Escape") onClose();
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
  return (
    <div className="modal-backdrop">
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
        onKeyDown={key}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <IconButton icon={X} label="关闭弹窗" onClick={onClose} />
        </header>
        <div className="modal-content">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </section>
    </div>
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
export function Tags({ values = [] }) {
  return (
    <div className="tags">
      {values.map((t) => (
        <span key={t}>{t}</span>
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
export function Picture({ src, alt, type = "equipment", className = "" }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return src && !broken ? (
    <img
      className={`picture ${className}`}
      src={asset(src)}
      alt={alt}
      onError={() => setBroken(true)}
    />
  ) : (
    <div className={`image-placeholder ${className}`}>
      {type === "equipment" ? (
        <Dumbbell size={38} strokeWidth={1.2} />
      ) : (
        <MapPin size={32} strokeWidth={1.2} />
      )}
      <span>{broken ? "照片读取失败" : "暂无照片"}</span>
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
