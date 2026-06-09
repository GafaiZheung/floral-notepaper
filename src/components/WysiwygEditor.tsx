import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownEditor } from "./MarkdownEditor";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
import { RenderedBlock } from "./RenderedBlock";
import { SlidingButtonGroup } from "./SlidingButtonGroup";
import { parseBlocks, updateBlock } from "../features/markdown/markdownBlocks";
import { applyFormat } from "../features/editor/formatActions";
import type { FormatAction } from "../features/editor/formatActions";

type WysiwygMode = "reading" | "source";

interface ToolbarButton {
  label: string;
  title: string;
  style: string;
  action: FormatAction;
}

export interface WysiwygEditorProps {
  content: string;
  onChange: (value: string) => void;
  fontSize?: number;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** Called when content changes (for dirty tracking in parent) */
  onDirty?: () => void;
  /** Hide the first heading block (used when title is shown in a separate input) */
  hideFirstHeading?: boolean;
}

export function WysiwygEditor({
  content,
  onChange,
  fontSize = 14,
  disabled = false,
  className,
  placeholder,
  onDirty,
  hideFirstHeading = false,
}: WysiwygEditorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<WysiwygMode>("reading");
  const [editingBlockIndex, setEditingBlockIndex] = useState<number | null>(null);
  const sourceEditorRef = useRef<MarkdownEditorHandle>(null);

  const allBlocks = useMemo(() => parseBlocks(content), [content]);
  const blocks = useMemo(() => {
    if (hideFirstHeading && allBlocks.length > 0 && allBlocks[0].type === "heading") {
      return allBlocks.slice(1);
    }
    return allBlocks;
  }, [allBlocks, hideFirstHeading]);

  const modeSwitchOptions = useMemo(
    () => [
      { value: "reading" as WysiwygMode, label: t("settings.defaultView.wysiwyg", { defaultValue: "阅读编辑" }) },
      { value: "source" as WysiwygMode, label: t("settings.defaultView.source", { defaultValue: "源码编辑" }) },
    ],
    [t],
  );

  const toolbarButtons = useMemo<ToolbarButton[]>(
    () => [
      { label: "B", title: t("main.toolbar.bold", { defaultValue: "粗体" }), style: "font-bold", action: "bold" },
      { label: "I", title: t("main.toolbar.italic", { defaultValue: "斜体" }), style: "italic", action: "italic" },
      { label: "H", title: t("main.toolbar.heading", { defaultValue: "标题" }), style: "font-bold", action: "heading" },
      { label: "—", title: t("main.toolbar.hr", { defaultValue: "分割线" }), style: "", action: "hr" },
      { label: "•", title: t("main.toolbar.ul", { defaultValue: "无序列表" }), style: "", action: "ul" },
      { label: "1.", title: t("main.toolbar.ol", { defaultValue: "有序列表" }), style: "font-mono text-[9px]", action: "ol" },
      { label: "<>", title: t("main.toolbar.code", { defaultValue: "代码" }), style: "font-mono text-[9px]", action: "code" },
      { label: "❝", title: t("main.toolbar.quote", { defaultValue: "引用" }), style: "", action: "quote" },
      { label: "∑", title: t("main.toolbar.inlineMath", { defaultValue: "行内公式" }), style: "font-mono text-[11px]", action: "inlineMath" },
      { label: "∫", title: t("main.toolbar.blockMath", { defaultValue: "块级公式" }), style: "font-mono text-[11px]", action: "blockMath" },
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
        applyFormat(editor, content, action, t, (newValue) => {
          onChange(newValue);
          onDirty?.();
        });
      }
      // In reading mode without active editing, toolbar actions are a no-op
    },
    [mode, content, onChange, onDirty, t],
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

        <SlidingButtonGroup
          options={modeSwitchOptions}
          value={mode}
          onChange={setMode}
          buttonClassName="px-3 py-1"
        />
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden px-5 pb-4">
        {mode === "source" ? (
          <MarkdownEditor
            ref={sourceEditorRef}
            value={content}
            onChange={handleSourceChange}
            placeholder={placeholder}
            disabled={disabled}
            fontSize={fontSize}
          />
        ) : (
          <div className="overflow-y-auto h-full">
            {blocks.length === 0 ? (
              <p className="text-ink-ghost leading-[1.9] text-center pt-8">
                {placeholder || t("main.editor.contentPlaceholder", { defaultValue: "开始写作……" })}
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
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
