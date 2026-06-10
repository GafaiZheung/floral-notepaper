import { useEffect, useRef } from "react";
import { MarkdownEditor } from "./MarkdownEditor";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
import { MarkdownPreview } from "../features/markdown/MarkdownPreview";
import type { MarkdownBlock } from "../features/markdown/markdownBlocks";

export interface RenderedBlockProps {
  block: MarkdownBlock;
  isEditing: boolean;
  onFocus: () => void;
  onChange: (newSource: string) => void;
  onBlur: () => void;
  fontSize: number;
  onLinkClick?: (url: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
}

export function RenderedBlock({
  block,
  isEditing,
  onFocus,
  onChange,
  onBlur,
  fontSize,
  onLinkClick,
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
      <MarkdownPreview content={block.source} fontSize={fontSize} onLinkClick={onLinkClick} />
    </div>
  );
}
