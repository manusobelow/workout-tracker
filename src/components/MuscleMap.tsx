// ==============================
// FILE: src/components/MuscleMap.tsx
// FULL FILE REPLACEMENT ✅
// ==============================

import React, { useEffect, useMemo, useRef, useState } from "react";

type Side = "full" | "front" | "back";

type MuscleMapProps = {
  side?: Side;

  /** Called with the token found in SVG (inkscape:label, id, aria-label, etc.) */
  onMuscleClick?: (token: string) => void;

  /** Return a color for this token (ex: based on set count). If omitted, overlay stays invisible. */
  getColorForToken?: (token: string) => string | null;

  /** Return true if this token should look “selected”. */
  isTokenSelected?: (token: string) => boolean;

  /** Public URLs (served from /public) */
  detailedUrl?: string;
  clickmapUrl?: string;

  className?: string;
};

export default function MuscleMap({
  side = "full",
  onMuscleClick,
  getColorForToken,
  isTokenSelected,
  detailedUrl = "/avatars/Muscles_detailed.svg",
  clickmapUrl = "/avatars/Muscles_clickmap.svg",
  className,
}: MuscleMapProps) {
  const overlayHostRef = useRef<HTMLDivElement | null>(null);
  const [rawClickmap, setRawClickmap] = useState<string>("");

  // Load the clickmap SVG as text from public URL
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await fetch(clickmapUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to fetch clickmap: ${res.status}`);
        const txt = await res.text();
        if (!alive) return;
        setRawClickmap(txt);
      } catch {
        if (!alive) return;
        setRawClickmap(""); // overlay disabled, base still shows
      }
    })();

    return () => {
      alive = false;
    };
  }, [clickmapUrl]);

  const cleanedClickmapSvg = useMemo(() => {
    const s = String(rawClickmap || "").trim();
    if (!s) return "";
    return s
      .replace(/<\?xml[\s\S]*?\?>/gi, "")
      .replace(/<!doctype[\s\S]*?>/gi, "")
      .trim();
  }, [rawClickmap]);

  // If your SVG contains front+back side-by-side, crop by scaling inner content to 200% width
  // and shifting left for the back side.
  const cropMode = side;
  const innerScale = cropMode === "full" ? 1 : 2;
  const innerTranslateX = cropMode === "back" ? "-50%" : "0%";

  function extractToken(target: Element, svgRoot: SVGElement): string | null {
    let el: Element | null = target;

    while (el && el !== svgRoot) {
      const dataMuscle = el.getAttribute("data-muscle");
      if (dataMuscle && dataMuscle.trim()) return dataMuscle.trim();

      const inkscapeLabel = el.getAttribute("inkscape:label");
      if (inkscapeLabel && inkscapeLabel.trim()) return inkscapeLabel.trim();

      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

      const id = el.getAttribute("id");
      if (id && id.trim()) return id.trim();

      el = el.parentElement;
    }

    return null;
  }

  function handleClick(e: React.MouseEvent) {
    if (!onMuscleClick) return;

    const host = overlayHostRef.current;
    if (!host) return;

    const svg = host.querySelector("svg");
    if (!svg) return;

    const target = e.target as Element | null;
    if (!target) return;

    const token = extractToken(target, svg);
    onMuscleClick(token ?? "UNKNOWN");
  }

  const dynamicStyleTag = useMemo(() => {
    if (!cleanedClickmapSvg) return "";

    // If no coloring callbacks, keep overlay invisible but clickable
    if (!getColorForToken && !isTokenSelected) {
      return `
        <style>
          svg { width: 100%; height: 100%; display:block; pointer-events:none; }
          svg path, svg g, svg use, svg polygon, svg rect, svg circle, svg ellipse {
            pointer-events:auto;
            cursor:pointer;
          }
          svg path, svg polygon, svg rect, svg circle, svg ellipse {
            fill: transparent !important;
            stroke: transparent !important;
            fill-opacity: 0 !important;
            stroke-opacity: 0 !important;
          }
        </style>
      `;
    }

    // Parse tokens and generate per-token rules
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleanedClickmapSvg, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg) throw new Error("No svg root");

      const tokens = new Set<string>();
      const all = Array.from(svg.querySelectorAll("*"));
      for (const el of all) {
        const t =
          el.getAttribute("inkscape:label") ||
          el.getAttribute("data-muscle") ||
          el.getAttribute("aria-label") ||
          el.getAttribute("id");
        if (t && t.trim()) tokens.add(t.trim());
      }

      let rules = `
        svg { width: 100%; height: 100%; display:block; pointer-events:none; }
        svg path, svg g, svg use, svg polygon, svg rect, svg circle, svg ellipse {
          pointer-events:auto;
          cursor:pointer;
        }
        /* default invisible */
        svg path, svg polygon, svg rect, svg circle, svg ellipse {
          fill: transparent;
          stroke: transparent;
          fill-opacity: 0;
          stroke-opacity: 0;
        }
      `;

      for (const token of tokens) {
        const color = getColorForToken ? getColorForToken(token) : null;
        const selected = isTokenSelected ? !!isTokenSelected(token) : false;
        if (!color) continue;

        const safe = token.replace(/"/g, '\\"');

        rules += `
          path[inkscape\\:label="${safe}"],
          polygon[inkscape\\:label="${safe}"],
          rect[inkscape\\:label="${safe}"],
          circle[inkscape\\:label="${safe}"],
          ellipse[inkscape\\:label="${safe}"],
          *[id="${safe}"] {
            fill: ${color} !important;
            stroke: transparent !important;
            fill-opacity: ${selected ? 0.85 : 0.65} !important;
            stroke-opacity: 0 !important;
          }
        `;
      }

      return `<style>${rules}</style>`;
    } catch {
      // If parsing fails, still allow click-through
      return `
        <style>
          svg { width: 100%; height: 100%; display:block; pointer-events:none; }
          svg path, svg g, svg use, svg polygon, svg rect, svg circle, svg ellipse {
            pointer-events:auto;
            cursor:pointer;
          }
          svg path, svg polygon, svg rect, svg circle, svg ellipse {
            fill: transparent !important;
            stroke: transparent !important;
            fill-opacity: 0 !important;
            stroke-opacity: 0 !important;
          }
        </style>
      `;
    }
  }, [cleanedClickmapSvg, getColorForToken, isTokenSelected]);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        overflow: cropMode === "full" ? "visible" : "hidden",
      }}
    >
      {/* Pretty base */}
      <img
        src={detailedUrl}
        alt="Muscle map"
        style={{
          width: `${innerScale * 100}%`,
          height: "auto",
          display: "block",
          userSelect: "none",
          WebkitUserDrag: "none",
          transform: cropMode === "full" ? undefined : `translateX(${innerTranslateX})`,
        }}
        draggable={false}
      />

      {/* Click + color overlay (only if loaded) */}
      {cleanedClickmapSvg ? (
        <div
          ref={overlayHostRef}
          onClick={handleClick}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          dangerouslySetInnerHTML={{
            __html: `
              <div style="width:${innerScale * 100}%; height:100%; transform:${cropMode === "full" ? "none" : `translateX(${innerTranslateX})`};">
                ${cleanedClickmapSvg}
              </div>
              ${dynamicStyleTag}
            `,
          }}
        />
      ) : null}
    </div>
  );
}
