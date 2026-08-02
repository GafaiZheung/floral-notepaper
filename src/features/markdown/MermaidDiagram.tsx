import { memo, useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import mermaid from "mermaid";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

let mermaidInitialized = false;
const MERMAID_FONT_STACK =
  '"HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Segoe UI", Arial';
const MERMAID_MONO_FONT_STACK = '"Consolas", "Courier New", "HarmonyOS Sans SC"';

// 按图表内容缓存渲染结果：同一文档内多处出现、模式切换、tab 切换
// 时避免重复执行昂贵的 mermaid.render()。
const mermaidSvgCache = new Map<string, Promise<string>>();

function renderMermaidSvg(chart: string): Promise<string> {
  let promise = mermaidSvgCache.get(chart);
  if (!promise) {
    const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
    promise = mermaid.render(id, chart).then(({ svg }) => svg);
    mermaidSvgCache.set(chart, promise);
    // 渲染失败时移除缓存，下次重试
    promise.catch(() => {
      mermaidSvgCache.delete(chart);
    });
  }
  return promise;
}

/**
 * Mermaid may still emit HTML-style void elements inside SVG foreignObject
 * when a diagram or directive enables HTML labels.
 *
 * Also, mermaid uses CSS custom properties like var(--font-body) for fonts.
 * usvg cannot resolve CSS variables, so we replace them with concrete
 * system fonts that exist on all platforms.
 */
function sanitizeSvgForXml(svg: string): string {
  return (
    svg
      .replace(/<br\b([^>]*?)(?<!\/)>/gi, "<br$1/>")
      .replace(/<hr\b([^>]*?)(?<!\/)>/gi, "<hr$1/>")
      .replace(/<img\b([^>]*?)(?<!\/)>/gi, "<img$1/>")
      // Replace CSS custom properties with concrete system fonts for usvg
      .replace(/var\(--font-body\)/g, MERMAID_FONT_STACK)
      .replace(/var\(--font-display\)/g, MERMAID_FONT_STACK)
      .replace(/var\(--font-mono\)/g, MERMAID_MONO_FONT_STACK)
  );
}

function ensureMermaidInit(fontSize: number) {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    // Use SVG text instead of foreignObject HTML so usvg/resvg can export PNG text.
    htmlLabels: false,
    themeVariables: {
      primaryColor: "#c8b88a",
      primaryBorderColor: "#8b7a5e",
      primaryTextColor: "#3c3a32",
      secondaryColor: "#e8ded0",
      secondaryBorderColor: "#c0b8a0",
      secondaryTextColor: "#5c5a52",
      tertiaryColor: "#f5f0e8",
      tertiaryBorderColor: "#d8d0c0",
      tertiaryTextColor: "#4c4a42",
      lineColor: "#8b7a5e",
      fontSize: `${fontSize}px`,
      fontFamily: "var(--font-body), sans-serif",
    },
  });
  mermaidInitialized = true;
}

interface MermaidDiagramProps {
  chart: string;
  fontSize?: number;
}

/** 按 chart 内容（值比较）memo：文档其他部分重渲染时已渲染的图跳过。 */
function mermaidPropsEqual(prev: MermaidDiagramProps, next: MermaidDiagramProps): boolean {
  return prev.chart === next.chart && prev.fontSize === next.fontSize;
}

export const MermaidDiagram = memo(function MermaidDiagram({
  chart,
  fontSize = 14,
}: MermaidDiagramProps) {
  const { t } = useTranslation();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const svgRef = useRef<string | null>(null);
  const lightboxContentRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    ensureMermaidInit(fontSize);
    let cancelled = false;

    renderMermaidSvg(chart)
      .then((result) => {
        if (!cancelled) {
          setSvg(result);
          svgRef.current = result;
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setSvg(null);
          svgRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chart, fontSize]);

  const handleZoomOpen = useCallback(() => {
    setZoomOpen(true);
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    panOffsetRef.current = { x: 0, y: 0 };
  }, []);

  const handleZoomClose = useCallback(() => {
    setZoomOpen(false);
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    panOffsetRef.current = { x: 0, y: 0 };
  }, []);

  const handleSvgDownload = useCallback(async () => {
    if (!svgRef.current) return;
    const filePath = await save({
      defaultPath: "diagram.svg",
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    if (typeof filePath !== "string") return;
    const sanitized = sanitizeSvgForXml(svgRef.current);
    await invoke("save_external_file", { path: filePath, content: sanitized });
  }, []);

  const handlePngDownload = useCallback(async () => {
    if (!svgRef.current) return;
    const filePath = await save({
      defaultPath: "diagram.png",
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (typeof filePath !== "string") return;
    const sanitized = sanitizeSvgForXml(svgRef.current);
    try {
      await invoke("convert_svg_to_png", { svg: sanitized, path: filePath });
    } catch (err) {
      console.error("PNG conversion failed:", err);
    }
  }, []);

  // Zoom in/out via buttons
  const handleZoomIn = useCallback(() => {
    setZoomScale((prev) => Math.min(5, prev + 0.25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomScale((prev) => Math.max(0.25, prev - 0.25));
  }, []);

  // Drag to pan in lightbox
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    // Only pan with left mouse button
    if (e.button !== 0) return;
    e.stopPropagation();
    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    e.stopPropagation();
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    const next = {
      x: panOffsetRef.current.x + dx,
      y: panOffsetRef.current.y + dy,
    };
    panOffsetRef.current = next;
    setPanOffset(next);
    panStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePanEnd = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // Keyboard: Escape to close zoom
  useEffect(() => {
    if (!zoomOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [zoomOpen]);

  if (error) {
    return (
      <div className="my-3 p-3 rounded border border-red-300/40 bg-red-50/30">
        <p className="text-[11px] font-mono text-red-600/80 leading-relaxed break-all">
          {t("mermaid.renderError", { defaultValue: "Mermaid render error" })}: {error}
        </p>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 p-3 rounded bg-paper-warm/80">
        <p className="text-[11px] font-mono text-ink-ghost">
          {t("mermaid.rendering", { defaultValue: "Rendering diagram…" })}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mermaid-wrapper my-3 group relative">
        <div
          className="mermaid-container flex justify-center rounded bg-white/60 p-4 border border-paper-deep/20 cursor-zoom-in hover:shadow-md transition-shadow"
          onClick={handleZoomOpen}
          title={t("mermaid.clickToZoom", { defaultValue: "Click to enlarge" })}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVG from mermaid
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={handleZoomOpen}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-paper-deep/30 text-ink-ghost hover:bg-paper-deep/50 hover:text-ink-soft transition-all cursor-pointer"
            title={t("mermaid.zoomIn", { defaultValue: "Enlarge" })}
          >
            {t("mermaid.zoomIn", { defaultValue: "🔍" })}
          </button>
          <button
            type="button"
            onClick={handleSvgDownload}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-paper-deep/30 text-ink-ghost hover:bg-paper-deep/50 hover:text-ink-soft transition-all cursor-pointer"
            title={t("mermaid.downloadSvg", { defaultValue: "Download SVG" })}
          >
            SVG
          </button>
          <button
            type="button"
            onClick={handlePngDownload}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-paper-deep/30 text-ink-ghost hover:bg-paper-deep/50 hover:text-ink-soft transition-all cursor-pointer"
            title={t("mermaid.downloadPng", { defaultValue: "Download PNG" })}
          >
            PNG
          </button>
        </div>
      </div>

      {zoomOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm"
            onClick={handleZoomClose}
          >
            <div
              ref={lightboxContentRef}
              className="relative w-[96vw] h-[96vh] overflow-auto rounded-xl bg-white p-8 shadow-2xl select-none"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={handlePanStart}
              onMouseMove={handlePanMove}
              onMouseUp={handlePanEnd}
              onMouseLeave={handlePanEnd}
              style={{ cursor: zoomScale > 1 ? "grab" : "default" }}
            >
              <div className="absolute top-3 right-3 flex gap-2 z-10">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  className="w-7 h-7 flex items-center justify-center rounded text-[14px] font-mono bg-paper-deep/40 text-ink-soft hover:bg-paper-deep/60 transition-all cursor-pointer"
                  title={t("mermaid.zoomOut", { defaultValue: "缩小" })}
                >
                  −
                </button>
                <span className="px-1.5 py-1 rounded text-[11px] font-mono text-ink-ghost select-none leading-snug">
                  {Math.round(zoomScale * 100)}%
                </span>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  className="w-7 h-7 flex items-center justify-center rounded text-[14px] font-mono bg-paper-deep/40 text-ink-soft hover:bg-paper-deep/60 transition-all cursor-pointer"
                  title={t("mermaid.zoomIn", { defaultValue: "放大" })}
                >
                  +
                </button>
                <div className="w-px h-5 bg-paper-deep/30 self-center mx-0.5" />
                <button
                  type="button"
                  onClick={handleSvgDownload}
                  className="px-2 py-1 rounded text-[11px] font-mono bg-paper-deep/30 text-ink-soft hover:bg-paper-deep/50 transition-all cursor-pointer"
                >
                  {t("mermaid.downloadSvg", { defaultValue: "SVG" })}
                </button>
                <button
                  type="button"
                  onClick={handlePngDownload}
                  className="px-2 py-1 rounded text-[11px] font-mono bg-paper-deep/30 text-ink-soft hover:bg-paper-deep/50 transition-all cursor-pointer"
                >
                  {t("mermaid.downloadPng", { defaultValue: "PNG" })}
                </button>
                <button
                  type="button"
                  onClick={handleZoomClose}
                  className="px-2 py-1 rounded text-[11px] font-mono bg-paper-deep/30 text-ink-soft hover:bg-paper-deep/50 transition-all cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <div
                className="flex justify-center"
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                  transformOrigin: "center center",
                  minWidth: zoomScale > 1 ? "max-content" : "100%",
                  minHeight: zoomScale > 1 ? "max-content" : "100%",
                }}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVG from mermaid
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}, mermaidPropsEqual);
