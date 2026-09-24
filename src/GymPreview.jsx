import { gymLocation } from "../electron/gym-location.mjs";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Dumbbell, MapPin } from "lucide-react";
import { Picture } from "./components";
import { isWeb } from "./data-service.js";

export const gymAccent = (value) =>
  typeof value === "string" && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value)
    ? value
    : "#397c70";

// One owner for both surfaces: timers never belong to individual list rows/markers.
export function useGymPreview(disabled) {
  const [preview, setPreview] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [revision, setRevision] = useState(0);
  const current = useRef(null),
    trigger = useRef(null),
    inside = useRef(false);
  const openTimer = useRef(),
    closeTimer = useRef();
  const blocked = useRef(disabled);
  blocked.current = disabled;
  const close = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    current.current = null;
    trigger.current = null;
    inside.current = false;
    setPreview(null);
    setHoveredId(null);
  }, []);
  const scheduleClose = useCallback(() => {
    clearTimeout(closeTimer.current);
    if (!trigger.current && !inside.current)
      closeTimer.current = setTimeout(close, 180);
  }, [close]);
  const enter = useCallback((id, source, anchor) => {
    if (blocked.current || !anchor || (isWeb && !window.matchMedia("(any-hover: hover)").matches)) return;
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    trigger.current = { id, source };
    setHoveredId(id);
    const next = { id, source, anchor };
    if (current.current?.id === id) {
      current.current = next;
      setPreview(next);
      return;
    }
    current.current = null;
    inside.current = false;
    setPreview(null);
    openTimer.current = setTimeout(() => {
      if (
        blocked.current ||
        trigger.current?.id !== id ||
        trigger.current?.source !== source ||
        !anchor.isConnected
      )
        return;
      current.current = next;
      setPreview(next);
    }, 200);
  }, []);
  const leave = useCallback(
    (id, source) => {
      if (trigger.current?.id !== id || trigger.current?.source !== source)
        return;
      trigger.current = null;
      clearTimeout(openTimer.current);
      scheduleClose();
    },
    [scheduleClose],
  );
  const enterCard = useCallback(() => {
    inside.current = true;
    clearTimeout(closeTimer.current);
  }, []);
  const leaveCard = useCallback(() => {
    inside.current = false;
    scheduleClose();
  }, [scheduleClose]);
  const geometry = useCallback(
    (id, visible) => {
      if (current.current?.id !== id && trigger.current?.id !== id) return;
      if (!visible) close();
      else if (current.current?.source === "map")
        setRevision((value) => value + 1);
    },
    [close],
  );
  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);
  useEffect(() => {
    const key = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
    };
  }, [close]);
  return {
    preview,
    hoveredId,
    revision,
    enter,
    leave,
    enterCard,
    leaveCard,
    close,
    geometry,
  };
}

function visibleAnchor(element) {
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  const clip = element.closest(".gym-list, .map")?.getBoundingClientRect();
  const left = Math.max(0, clip?.left ?? 0),
    top = Math.max(0, clip?.top ?? 0);
  const right = Math.min(window.innerWidth, clip?.right ?? window.innerWidth);
  const bottom = Math.min(
    window.innerHeight,
    clip?.bottom ?? window.innerHeight,
  );
  if (
    !rect.width ||
    !rect.height ||
    rect.right <= left ||
    rect.left >= right ||
    rect.bottom <= top ||
    rect.top >= bottom
  )
    return null;
  return rect;
}

export default function GymPreview({ controller, gym, count, onSelect }) {
  const ref = useRef();
  const [position, setPosition] = useState(null);
  const { preview, revision, close } = controller;
  useLayoutEffect(() => {
    if (!preview || !gym) {
      setPosition(null);
      return;
    }
    const place = () => {
      const anchor = visibleAnchor(preview.anchor);
      if (!anchor || !ref.current) {
        close();
        return;
      }
      const { width, height } = ref.current.getBoundingClientRect();
      const margin = 12,
        gap = 12,
        vw = window.innerWidth,
        vh = window.innerHeight;
      const clampX = (x) => Math.max(margin, Math.min(x, vw - width - margin));
      const clampY = (y) => Math.max(margin, Math.min(y, vh - height - margin));
      const candidates = [
        { left: anchor.right + gap, top: clampY(anchor.top) },
        { left: anchor.left - width - gap, top: clampY(anchor.top) },
        {
          left: clampX(anchor.left + (anchor.width - width) / 2),
          top: anchor.top - height - gap,
        },
        {
          left: clampX(anchor.left + (anchor.width - width) / 2),
          top: anchor.bottom + gap,
        },
      ];
      const best = candidates.find(
        (p) =>
          p.left >= margin &&
          p.top >= margin &&
          p.left + width <= vw - margin &&
          p.top + height <= vh - margin,
      );
      // With the application's minimum window width a marker always has a free side.
      setPosition(
        best || { left: clampX(anchor.right + gap), top: clampY(anchor.top) },
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [preview, gym, revision, close]);
  if (!preview || !gym) return null;
  const reviewed =
    gym.score != null ||
    Boolean(
      gym.reviewUrl ||
      gym.reviewImportedAt ||
      gym.rawReview ||
      gym.reviewSummary?.length,
    );
  return createPortal(
    <button
      ref={ref}
      type="button"
      className="gym-preview"
      data-gym-id={gym.id}
      aria-label={`查看场馆摘要：${gym.name}`}
      style={{
        "--gym-accent": gymAccent(gym.themeColor),
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
      onMouseEnter={controller.enterCard}
      onMouseLeave={controller.leaveCard}
      onFocus={controller.enterCard}
      onBlur={controller.leaveCard}
      onClick={() => {
        close();
        onSelect(gym.id);
      }}
    >
      <Picture
        key={`${gym.id}:${gym.cover || ""}`}
        src={gym.cover || gym.photos?.[0]}
        alt={`${gym.name}封面`}
        type="gym"
        className="gym-preview-cover"
      />
      <div className="gym-preview-body">
        <div className="gym-preview-heading">
          <strong>{gym.name}</strong>
          <ArrowUpRight size={17} />
        </div>
        <p className="gym-preview-location">
          <MapPin size={13} />
          {gymLocation(gym) || "位置待补充"}
        </p>
        <div className="gym-preview-facts">
          {!isWeb && <span className="gym-preview-visit">
            {gym.visited ? "已去过" : "未去过"}
          </span>}
          <span>
            <Dumbbell size={13} />
            {count} 款器械
          </span>
        </div>
        <p className="gym-preview-review">
          {reviewed
            ? `已有测评${gym.score != null ? ` · ${gym.score} 分` : " · 评分待补充"}`
            : "暂无测评"}
        </p>
        <span className="gym-preview-link">
          查看完整档案 <ArrowUpRight size={13} />
        </span>
      </div>
    </button>,
    document.body,
  );
}
