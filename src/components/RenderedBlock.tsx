import { memo, useEffect, useRef } from "react";
import { MarkdownEditor } from "./MarkdownEditor";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
import { MarkdownPreviewLazy as MarkdownPreview } from "../features/markdown/MarkdownPreviewLazy";
import type { MarkdownBlock } from "../features/markdown/markdownBlocks";

export interface RenderedBlockProps {
  block: MarkdownBlock;
  isEditing: boolean;
  onFocus: () => void;
  onChange: (newSource: string) => void;
  onBlur: () => void;
  fontSize: number;
  /** 外部 http(s) 链接点击回调，透传给 MarkdownPreview。 */
  onExternalLink?: (href: string) => void;
}

/**
 * 块列表项 memo：每次按键整篇重新解析时，块对象引用都会变化（值相等），
 * 自定义比较器按值比较，未编辑的块跳过 re-render 与 markdown 重解析。
 */
function blocksEqual(prev: RenderedBlockProps, next: RenderedBlockProps): boolean {
  return (
    prev.block.source === next.block.source &&
    prev.block.type === next.block.type &&
    prev.isEditing === next.isEditing &&
    prev.fontSize === next.fontSize &&
    prev.onExternalLink === next.onExternalLink
  );
}

export const RenderedBlock = memo(function RenderedBlock({
  block,
  isEditing,
  onFocus,
  onChange,
  onBlur,
  fontSize,
  onExternalLink,
}: RenderedBlockProps) {
  const editorRef = useRef<MarkdownEditorHandle>(null);

  // Auto-focus the inline editor when entering editing mode
  useEffect(() => {
    if (isEditing) {
      const timer = setTimeout(() => {
        editorRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div className="rendered-block rendered-block--editing py-0.5">
        <MarkdownEditor
          ref={editorRef}
          value={block.source}
          onChange={onChange}
          fontSize={fontSize}
          autoHeight
          onBlur={onBlur}
        />
      </div>
    );
  }

  return (
    <div
      className="rendered-block cursor-text py-0.5 rounded transition-colors hover:bg-paper-warm/40"
      onClick={onFocus}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onFocus();
        }
      }}
    >
      <MarkdownPreview content={block.source} fontSize={fontSize} onExternalLink={onExternalLink} />
    </div>
  );
}, blocksEqual);
