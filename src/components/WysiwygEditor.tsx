import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { MarkdownEditor } from "./MarkdownEditor";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
import { RenderedBlock } from "./RenderedBlock";
import { MarkdownPreview } from "../features/markdown/MarkdownPreview";
import { parseBlocks, updateBlock } from "../features/markdown/markdownBlocks";
import { applyFormat } from "../features/editor/formatActions";
import type { FormatAction } from "../features/editor/formatActions";
import { extractHeadings } from "../features/markdown/extractHeadings";
import type { Heading } from "../features/markdown/extractHeadings";

type WysiwygMode = "wysiwyg" | "source" | "read";

interface ToolbarButton {
  label: string;
  title: string;
  style: string;
  action: FormatAction;
}

export interface WysiwygEditorHandle {
  scrollToHeading(lineNumber: number): void;
}

export interface WysiwygEditorProps {
  content: string;
  onChange: (value: string) => void;
  fontSize?: number;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  onDirty?: () => void;
  hideFirstHeading?: boolean;
  onActiveHeadingChange?: (lineNumber: number | null) => void;
  /** Called with scrollTop (px) when the reading content is scrolled */
  onScrollTop?: (scrollTop: number) => void;
  /** Initial editor mode — defaults to "wysiwyg" when undefined */
  initialMode?: WysiwygMode;
  /** Called when user clicks an external link in rendered content */
  onLinkClick?: (url: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
}

/** Compute which heading is at or above the top of the scroll container */
function computeActiveHeadingFromDOM(container: HTMLElement, headings: Heading[]): number | null {
  const headingEls = container.querySelectorAll("h1, h2, h3, h4");
  if (headingEls.length === 0 || headings.length === 0) return null;

  const scrollTop = container.scrollTop;

  // Find the last heading element whose top is at or above the scroll position
  let activeEl: Element | null = null;
  for (const el of headingEls) {
    const elTop = (el as HTMLElement).offsetTop;
    if (elTop <= scrollTop + 8) {
      // +8px tolerance
      activeEl = el;
    } else {
      break;
    }
  }

  if (!activeEl) {
    // All headings are below — use the first one
    return headings[0]?.lineNumber ?? null;
  }

  // Match DOM heading text to extractHeadings result
  const activeText = activeEl.textContent?.trim() ?? "";
  const match = headings.find((h) => h.text === activeText);
  return match?.lineNumber ?? null;
}

export const WysiwygEditor = forwardRef<WysiwygEditorHandle, WysiwygEditorProps>(
  function WysiwygEditor(
    {
      content,
      onChange,
      fontSize = 14,
      disabled = false,
      className,
      placeholder,
      onDirty,
      hideFirstHeading = false,
      onActiveHeadingChange,
      onScrollTop,
      initialMode = "wysiwyg",
      onLinkClick,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<WysiwygMode>(initialMode);
    const [editingBlockIndex, setEditingBlockIndex] = useState<number | null>(null);
    const sourceEditorRef = useRef<MarkdownEditorHandle>(null);
    const readingScrollRef = useRef<HTMLDivElement>(null);

    const allBlocks = useMemo(() => parseBlocks(content), [content]);
    const blocks = useMemo(() => {
      if (hideFirstHeading && allBlocks.length > 0 && allBlocks[0].type === "heading") {
        return allBlocks.slice(1);
      }
      return allBlocks;
    }, [allBlocks, hideFirstHeading]);

    const headings = useMemo(() => extractHeadings(content), [content]);

    // Track active heading from scroll position
    const headingsRef = useRef(headings);
    headingsRef.current = headings;
    const onActiveHeadingChangeRef = useRef(onActiveHeadingChange);
    onActiveHeadingChangeRef.current = onActiveHeadingChange;
    const onScrollTopRef = useRef(onScrollTop);
    onScrollTopRef.current = onScrollTop;

    // Wysiwyg / read mode: listen to scroll events on the reading container
    useEffect(() => {
      if (mode !== "wysiwyg" && mode !== "read") return;
      const container = readingScrollRef.current;
      if (!container) return;

      const handleScroll = () => {
        const active = computeActiveHeadingFromDOM(container, headingsRef.current);
        onActiveHeadingChangeRef.current?.(active);
        onScrollTopRef.current?.(container.scrollTop);
      };

      // Compute initial active heading
      handleScroll();

      container.addEventListener("scroll", handleScroll, { passive: true });
      return () => container.removeEventListener("scroll", handleScroll);
    }, [mode, content]);

    // Source mode: listen to scroll events via onScroll prop
    const handleSourceScroll = useCallback(() => {
      const editor = sourceEditorRef.current;
      if (!editor) return;
      const maxScroll = editor.getMaxScrollTop();
      if (maxScroll <= 0) return;
      const ratio = editor.getScrollTop() / maxScroll;
      const lines = content.split("\n");
      const estimatedLine = Math.floor(ratio * (lines.length - 1));
      const hds = headingsRef.current;
      let active: number | null = hds[0]?.lineNumber ?? null;
      for (const h of hds) {
        if (h.lineNumber <= estimatedLine) {
          active = h.lineNumber;
        } else {
          break;
        }
      }
      onActiveHeadingChangeRef.current?.(active);
      onScrollTopRef.current?.(editor.getScrollTop());
    }, [content]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToHeading(lineNumber: number) {
          if (mode === "source") {
            sourceEditorRef.current?.scrollToLine(lineNumber);
            return;
          }

          const container = readingScrollRef.current;
          if (!container) return;

          // Find heading by lineNumber in the flat headings list, then match
          // by index to the corresponding DOM element (robust against text
          // differences between raw Markdown and rendered HTML).
          const targetIndex = headings.findIndex((h) => h.lineNumber === lineNumber);
          if (targetIndex === -1) return;

          // When the first heading is hidden (wysiwyg mode), headings[0] has no DOM element.
          const hiddenOffset =
            mode === "wysiwyg" &&
            hideFirstHeading &&
            allBlocks.length > 0 &&
            allBlocks[0].type === "heading"
              ? 1
              : 0;
          const domIndex = targetIndex - hiddenOffset;
          if (domIndex < 0) return;

          const headingEls = container.querySelectorAll("h1, h2, h3, h4");
          const el = headingEls[domIndex] as HTMLElement | undefined;
          if (!el) return;

          const containerRect = container.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const scrollTarget = container.scrollTop + elRect.top - containerRect.top - 16;
          container.scrollTo({ top: Math.max(0, scrollTarget), behavior: "smooth" });
        },
      }),
      [mode, headings, hideFirstHeading, allBlocks],
    );

    const toolbarButtons = useMemo<ToolbarButton[]>(
      () => [
        {
          label: "B",
          title: t("main.toolbar.bold", { defaultValue: "粗体" }),
          style: "font-bold",
          action: "bold",
        },
        {
          label: "I",
          title: t("main.toolbar.italic", { defaultValue: "斜体" }),
          style: "italic",
          action: "italic",
        },
        {
          label: "H",
          title: t("main.toolbar.heading", { defaultValue: "标题" }),
          style: "font-bold",
          action: "heading",
        },
        {
          label: "—",
          title: t("main.toolbar.hr", { defaultValue: "分割线" }),
          style: "",
          action: "hr",
        },
        {
          label: "•",
          title: t("main.toolbar.ul", { defaultValue: "无序列表" }),
          style: "",
          action: "ul",
        },
        {
          label: "1.",
          title: t("main.toolbar.ol", { defaultValue: "有序列表" }),
          style: "font-mono text-[9px]",
          action: "ol",
        },
        {
          label: "<>",
          title: t("main.toolbar.code", { defaultValue: "代码" }),
          style: "font-mono text-[9px]",
          action: "code",
        },
        {
          label: "❝",
          title: t("main.toolbar.quote", { defaultValue: "引用" }),
          style: "",
          action: "quote",
        },
        {
          label: "∑",
          title: t("main.toolbar.inlineMath", { defaultValue: "行内公式" }),
          style: "font-mono text-[11px]",
          action: "inlineMath",
        },
        {
          label: "∫",
          title: t("main.toolbar.blockMath", { defaultValue: "块级公式" }),
          style: "font-mono text-[11px]",
          action: "blockMath",
        },
      ],
      [t],
    );

    const handleBlockChange = useCallback(
      (index: number, newSource: string) => {
        const updated = updateBlock(content, index, newSource, blocks);
        onChange(updated);
        onDirty?.();
      },
      [content, blocks, onChange, onDirty],
    );

    const handleSourceChange = useCallback(
      (newValue: string) => {
        onChange(newValue);
        onDirty?.();
      },
      [onChange, onDirty],
    );

    const handleToolbarAction = useCallback(
      (action: FormatAction) => {
        if (mode === "source") {
          const editor = sourceEditorRef.current;
          if (!editor) return;
          // applyFormat directly dispatches to CodeMirror; the editor's own
          // update-listener will call onChange, so we only need to mark dirty.
          applyFormat(editor, content, action, t, () => undefined);
          onDirty?.();
        }
      },
      [mode, content, onDirty, t],
    );

    return (
      <div className={`flex flex-col flex-1 min-h-0 ${className ?? ""}`}>
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 pt-2 pb-1 shrink-0">
          <div className="flex items-center gap-0.5">
            {toolbarButtons.map((button) => (
              <button
                key={button.label}
                title={button.title}
                onClick={() => handleToolbarAction(button.action)}
                className={`w-6 h-6 flex items-center justify-center rounded text-[11px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer ${button.style}`}
              >
                {button.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-0.5">
            {/* WYSIWYG mode */}
            <button
              onClick={() => setMode("wysiwyg")}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-all cursor-pointer ${
                mode === "wysiwyg"
                  ? "text-bamboo bg-bamboo-mist/60 shadow-sm"
                  : "text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
              }`}
              title={t("settings.defaultView.wysiwyg", { defaultValue: "阅读编辑" })}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            {/* Source mode */}
            <button
              onClick={() => setMode("source")}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-all cursor-pointer ${
                mode === "source"
                  ? "text-bamboo bg-bamboo-mist/60 shadow-sm"
                  : "text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
              }`}
              title={t("settings.defaultView.source", { defaultValue: "源码编辑" })}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </button>
            {/* Read-only mode */}
            <button
              onClick={() => setMode("read")}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-all cursor-pointer ${
                mode === "read"
                  ? "text-bamboo bg-bamboo-mist/60 shadow-sm"
                  : "text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
              }`}
              title={t("settings.defaultView.read", { defaultValue: "阅读" })}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-hidden px-5 pb-4">
          {mode === "source" ? (
            <MarkdownEditor
              ref={sourceEditorRef}
              value={content}
              onScroll={handleSourceScroll}
              onChange={handleSourceChange}
              placeholder={placeholder}
              disabled={disabled}
              fontSize={fontSize}
            />
          ) : mode === "read" ? (
            <div ref={readingScrollRef} className="overflow-y-auto h-full">
              {content ? (
                <MarkdownPreview content={content} fontSize={fontSize} />
              ) : (
                <p className="text-ink-ghost leading-[1.9] text-center pt-8">
                  {placeholder ||
                    t("main.editor.contentPlaceholder", { defaultValue: "开始写作……" })}
                </p>
              )}
            </div>
          ) : (
            <div ref={readingScrollRef} className="overflow-y-auto h-full">
              {blocks.length === 0 ? (
                <p className="text-ink-ghost leading-[1.9] text-center pt-8">
                  {placeholder ||
                    t("main.editor.contentPlaceholder", { defaultValue: "开始写作……" })}
                </p>
              ) : (
                blocks.map((block, index) => (
                  <RenderedBlock
                    key={index}
                    block={block}
                    isEditing={editingBlockIndex === index}
                    onFocus={() => setEditingBlockIndex(index)}
                    onChange={(newSource) => handleBlockChange(index, newSource)}
                    onBlur={() => setEditingBlockIndex(null)}
                    fontSize={fontSize}
                    onLinkClick={onLinkClick}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);
