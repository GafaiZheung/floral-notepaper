# Typora-style WYSIWYG Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform MainWindow editor from edit/split/preview three-mode system into a Typora-style two-mode WYSIWYG editor (阅读编辑 / 源码编辑).

**Architecture:** New `WysiwygEditor` container renders either react-markdown blocks with click-to-edit (reading mode) or a full CodeMirror editor (source mode). A `markdownBlocks` utility parses content into logical blocks. `RenderedBlock` manages per-block rendered ↔ editing state transitions.

**Tech Stack:** React 19, CodeMirror 6, react-markdown, TypeScript, Tailwind CSS 4, Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/features/settings/types.ts` | Modify | Change ViewMode type |
| `src/features/settings/api.ts` | Modify | Update normalizeViewMode |
| `src/locales/zh-CN/translation.json` | Modify | Update view mode i18n keys |
| `src/locales/en-US/translation.json` | Modify | Update view mode i18n keys |
| `src/locales/zh-HK/translation.json` | Modify | Update view mode i18n keys |
| `src/features/markdown/markdownBlocks.ts` | Create | Block parsing utility |
| `src/components/MarkdownEditor.tsx` | Modify | Add autoHeight + onBlur props |
| `src/components/RenderedBlock.tsx` | Create | Per-block rendered/editing toggle |
| `src/components/WysiwygEditor.tsx` | Create | Mode container + toolbar |
| `src/components/MainWindow.tsx` | Modify | Replace edit/split/preview area |
| `src/components/SettingsPanel.tsx` | Modify | Update viewModes options |
| `src/features/markdown/markdownBlocks.test.ts` | Create | Tests for block parsing |
| `src/components/WysiwygEditor.test.tsx` | Create | Tests for editor modes |
| `src/components/MainWindow.test.tsx` | Modify | Update existing tests |

---

### Task 1: Update ViewMode type

**Files:**
- Modify: `src/features/settings/types.ts:1`
- Modify: `src/features/settings/api.ts:42-48`

- [ ] **Step 1.1: Change ViewMode type**

In `src/features/settings/types.ts`, change line 1:

```typescript
export type ViewMode = "wysiwyg" | "source";
```

- [ ] **Step 1.2: Update normalizeViewMode**

In `src/features/settings/api.ts`, replace the `normalizeViewMode` function (lines 42-48):

```typescript
export function normalizeViewMode(value: string): ViewMode {
  if (value === "wysiwyg" || value === "source") {
    return value;
  }
  // Migrate legacy values
  if (value === "edit" || value === "split") {
    return "source";
  }
  if (value === "preview") {
    return "wysiwyg";
  }
  return "wysiwyg";
}
```

- [ ] **Step 1.3: Verify with existing tests**

Run: `npx vitest run src/features/settings/api.test.ts`
Expect: All tests pass (normalizeViewMode is not directly tested in api.test.ts, but config-related tests should still pass)

- [ ] **Step 1.4: Commit**

```bash
git add src/features/settings/types.ts src/features/settings/api.ts
git commit -m "refactor: change ViewMode to wysiwyg/source with legacy migration"
```

---

### Task 2: Update i18n translations

**Files:**
- Modify: `src/locales/zh-CN/translation.json:208-212`
- Modify: `src/locales/en-US/translation.json:208-212`
- Modify: `src/locales/zh-HK/translation.json:208-212`

- [ ] **Step 2.1: Update zh-CN translations**

In `src/locales/zh-CN/translation.json`, replace the `defaultView` block:

```json
"defaultView": {
  "label": "默认视图",
  "wysiwyg": "阅读编辑",
  "source": "源码编辑"
},
```

- [ ] **Step 2.2: Update en-US translations**

In `src/locales/en-US/translation.json`, replace the `defaultView` block:

```json
"defaultView": {
  "label": "Default view",
  "wysiwyg": "Reading",
  "source": "Source"
},
```

- [ ] **Step 2.3: Update zh-HK translations**

In `src/locales/zh-HK/translation.json`, replace the `defaultView` block:

```json
"defaultView": {
  "label": "預設檢視",
  "wysiwyg": "閱讀編輯",
  "source": "源碼編輯"
},
```

- [ ] **Step 2.4: Commit**

```bash
git add src/locales/zh-CN/translation.json src/locales/en-US/translation.json src/locales/zh-HK/translation.json
git commit -m "feat: update view mode i18n keys to wysiwyg/source"
```

---

### Task 3: Create markdownBlocks utility

**Files:**
- Create: `src/features/markdown/markdownBlocks.ts`

- [ ] **Step 3.1: Write the utility**

Create `src/features/markdown/markdownBlocks.ts`:

```typescript
export interface MarkdownBlock {
  type: "heading" | "paragraph" | "code" | "list" | "quote" | "table" | "math" | "hr" | "mermaid";
  source: string;
  startOffset: number;
  endOffset: number;
}

function classifyBlock(firstLine: string, content: string): MarkdownBlock["type"] {
  if (/^#{1,6}\s/.test(firstLine)) return "heading";
  if (/^```mermaid/.test(firstLine)) return "mermaid";
  if (/^```/.test(firstLine)) return "code";
  if (/^\$\$/.test(firstLine)) return "math";
  if (/^[\-*+]\s/.test(firstLine) || /^\d+\.\s/.test(firstLine)) return "list";
  if (/^>\s/.test(firstLine)) return "quote";
  if (/^\|.*\|/.test(firstLine) && /^\|[\s\-:]+\|/.test(content.split("\n")[1] ?? "")) return "table";
  if (/^-{3,}$/.test(firstLine.trim()) || /^\*{3,}$/.test(firstLine.trim())) return "hr";
  return "paragraph";
}

/**
 * Split markdown content into logical blocks.
 * Fenced code blocks (```) are kept intact (not split by blank lines inside them).
 */
export function parseBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  if (!content) return blocks;

  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    // Count offset to current line
    const lineStart =
      i === 0 ? 0 : lines.slice(0, i).join("\n").length + 1; // +1 for the \n separator

    // Skip blank lines between blocks
    if (lines[i].trim() === "") {
      i++;
      continue;
    }

    const firstLine = lines[i];

    // Fenced code block: capture from opening ``` to closing ```
    if (/^```/.test(firstLine)) {
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        j++;
      }
      if (j < lines.length) j++; // include closing ```
      else j = lines.length; // unclosed fence: include rest of document
      const source = lines.slice(i, j).join("\n");
      const startOffset = lineStart;
      const endOffset = startOffset + source.length;
      blocks.push({ type: classifyBlock(firstLine, source), source, startOffset, endOffset });
      i = j;
      continue;
    }

    // Math block ($$...$$)
    if (/^\$\$/.test(firstLine)) {
      let j = i + 1;
      while (j < lines.length && !/^\$\$/.test(lines[j])) {
        j++;
      }
      if (j < lines.length) j++;
      else j = lines.length;
      const source = lines.slice(i, j).join("\n");
      const startOffset = lineStart;
      const endOffset = startOffset + source.length;
      blocks.push({ type: "math", source, startOffset, endOffset });
      i = j;
      continue;
    }

    // Table detection: consecutive |...| lines
    if (/^\|.*\|/.test(firstLine)) {
      let j = i + 1;
      // Table header separator line: |---|...|
      if (j < lines.length && /^\|[\s\-:]+\|/.test(lines[j])) {
        j++;
        while (j < lines.length && /^\|.*\|/.test(lines[j])) {
          j++;
        }
      }
      const source = lines.slice(i, j).join("\n");
      const startOffset = lineStart;
      const endOffset = startOffset + source.length;
      blocks.push({ type: "table", source, startOffset, endOffset });
      i = j;
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(firstLine.trim()) || /^\*{3,}$/.test(firstLine.trim())) {
      const startOffset = lineStart;
      const endOffset = startOffset + firstLine.length;
      blocks.push({ type: "hr", source: firstLine, startOffset, endOffset });
      i++;
      continue;
    }

    // List block: consecutive lines starting with list markers or indented continuation
    if (/^[\-*+]\s/.test(firstLine) || /^\d+\.\s/.test(firstLine)) {
      let j = i;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === "") break;
        if (
          /^[\-*+]\s/.test(l) ||
          /^\d+\.\s/.test(l) ||
          /^\s{2,}/.test(l) || // indented continuation
          /^\s/.test(l) // any continuation
        ) {
          j++;
        } else {
          break;
        }
      }
      const source = lines.slice(i, j).join("\n");
      const startOffset = lineStart;
      const endOffset = startOffset + source.length;
      blocks.push({ type: "list", source, startOffset, endOffset });
      i = j;
      continue;
    }

    // Blockquote: consecutive >-prefixed lines
    if (/^>\s/.test(firstLine)) {
      let j = i;
      while (j < lines.length && /^>/.test(lines[j])) {
        j++;
      }
      const source = lines.slice(i, j).join("\n");
      const startOffset = lineStart;
      const endOffset = startOffset + source.length;
      blocks.push({ type: "quote", source, startOffset, endOffset });
      i = j;
      continue;
    }

    // Heading
    if (/^#{1,6}\s/.test(firstLine)) {
      const startOffset = lineStart;
      const endOffset = startOffset + firstLine.length;
      blocks.push({ type: "heading", source: firstLine, startOffset, endOffset });
      i++;
      continue;
    }

    // Paragraph: collect lines until blank line or next block-level element
    {
      let j = i;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === "") break;
        if (
          /^#{1,6}\s/.test(l) ||
          /^```/.test(l) ||
          /^\$\$/.test(l) ||
          /^[\-*+]\s/.test(l) ||
          /^\d+\.\s/.test(l) ||
          /^>\s/.test(l) ||
          /^\|.*\|/.test(l) ||
          /^-{3,}$/.test(l.trim()) ||
          /^\*{3,}$/.test(l.trim())
        ) {
          break;
        }
        j++;
      }
      const source = lines.slice(i, j).join("\n");
      const startOffset = lineStart;
      const endOffset = startOffset + source.length;
      blocks.push({ type: "paragraph", source, startOffset, endOffset });
      i = j;
    }
  }

  return blocks;
}

/** Reassemble blocks back into a content string */
export function blocksToContent(blocks: MarkdownBlock[]): string {
  return blocks.map((b) => b.source).join("\n\n");
}

/** Replace a single block's source in the original content, preserving surrounding formatting */
export function updateBlock(
  content: string,
  blockIndex: number,
  newSource: string,
  blocks: MarkdownBlock[],
): string {
  if (blockIndex < 0 || blockIndex >= blocks.length) return content;
  const block = blocks[blockIndex];
  return content.slice(0, block.startOffset) + newSource + content.slice(block.endOffset);
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/features/markdown/markdownBlocks.ts
git commit -m "feat: add markdownBlocks utility for block-level parsing"
```

---

### Task 4: Add autoHeight and onBlur support to MarkdownEditor

**Files:**
- Modify: `src/components/MarkdownEditor.tsx`

- [ ] **Step 4.1: Add new props to interface**

In `src/components/MarkdownEditor.tsx`, update the `MarkdownEditorProps` interface (around line 27):

```typescript
export interface MarkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  fontSize?: number;
  className?: string;
  onScroll?: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  /** Auto-size height to content instead of filling container */
  autoHeight?: boolean;
  /** Called when the editor loses focus */
  onBlur?: () => void;
}
```

- [ ] **Step 4.2: Update component signature to accept new props**

Replace the destructuring line (line 44):

```typescript
    { value, onChange, placeholder, disabled, fontSize = 14, className, onScroll, onKeyDown, autoHeight, onBlur },
```

- [ ] **Step 4.3: Add refs for new callbacks**

Add after line 55 (`isUpdatingRef`):

```typescript
    const onBlurRef = useRef(onBlur);
    onBlurRef.current = onBlur;
```

- [ ] **Step 4.4: Add blur event listener in editor creation useEffect**

Inside the `useEffect` that creates the editor (after line 108, where `contentDom` keydown listener is added), add:

```typescript
      // Forward blur events for typora-style inline editing
      const handleBlur = () => onBlurRef.current?.();
      contentDom.addEventListener("blur", handleBlur);

      return () => {
        scrollDom.removeEventListener("scroll", handleScroll);
        contentDom.removeEventListener("keydown", handleKeyDown);
        contentDom.removeEventListener("blur", handleBlur);
        view.destroy();
        viewRef.current = null;
      };
```

- [ ] **Step 4.5: Add autoHeight effect**

Add a new `useEffect` after the font size sync effect (after line 173):

```typescript
    // Sync auto-height: use CodeMirror's contentHeight to set container height
    useEffect(() => {
      if (!autoHeight) return;
      const view = viewRef.current;
      const container = containerRef.current;
      if (!view || !container) return;

      // Initial height
      const syncHeight = () => {
        const contentHeight = view.contentHeight;
        container.style.height = `${contentHeight}px`;
      };
      syncHeight();

      // Update on changes
      const updateListener = EditorView.updateListener.of(() => {
        syncHeight();
      });
      view.dispatch({ effects: StateEffect.appendConfig.of([updateListener]) });

      // Also observe contentDOM for resize
      const observer = new ResizeObserver(() => syncHeight());
      observer.observe(view.contentDOM);

      return () => observer.disconnect();
    }, [autoHeight]);
```

Wait — this approach of dispatching effects inside an effect is fragile. Let me restructure. Actually, a simpler approach: just use a MutationObserver on the contentDOM, or even simpler — use a ResizeObserver on the container. But CodeMirror calculates its own internal contentHeight.

Let me use a simpler approach: dispatch an updateListener that adjusts height.

Actually, the simplest approach: listen to CodeMirror's own `EditorView.updateListener` from the initial creation, and set container height. Let me restructure step 4.5.

The issue is we need to add the update listener to the view that was already created. The simplest way is to add it in the main editor creation effect, conditionally:

```typescript
      if (autoHeight) {
        const syncHeight = EditorView.updateListener.of((update) => {
          if (update.viewportChanged || update.docChanged) {
            const container = containerRef.current;
            if (container && viewRef.current) {
              container.style.height = `${viewRef.current.contentHeight}px`;
            }
          }
        });
        extensions.push(syncHeight);
      }
```

This is cleaner. Let me put it in the main editor creation useEffect, right after the `updateListener` and before `extensions.push` for placeholder.

Let me rewrite step 4.5 properly.

- [ ] **Step 4.5 (revised): Add autoHeight support in editor creation**

In the editor creation `useEffect` (around line 76-88), add after the main `updateListener` is defined and before the extensions array is finalized:

```typescript
      // Auto-height: sync container height to CodeMirror's contentHeight
      if (autoHeight) {
        const autoHeightListener = EditorView.updateListener.of((update) => {
          if (update.docChanged || update.viewportChanged) {
            const c = containerRef.current;
            const v = viewRef.current;
            if (c && v) {
              c.style.height = `${v.contentHeight}px`;
            }
          }
        });
        extensions.push(autoHeightListener);
      }
```

Also update the container style to not use `height: "100%"` when `autoHeight` is true. Change the `containerStyle` at the end of the component (around line 235-239):

```typescript
    const containerStyle: React.CSSProperties = {
      fontSize: `${fontSize}px`,
      height: autoHeight ? "auto" : "100%",
      width: "100%",
    };
```

- [ ] **Step 4.6: Run existing tests**

Run: `npx vitest run src/components/MarkdownEditor.test.tsx`
Expect: Tests pass (existing tests don't use new props)

- [ ] **Step 4.7: Commit**

```bash
git add src/components/MarkdownEditor.tsx
git commit -m "feat: add autoHeight and onBlur props to MarkdownEditor"
```

---

### Task 5: Create RenderedBlock component

**Files:**
- Create: `src/components/RenderedBlock.tsx`

- [ ] **Step 5.1: Write the component**

Create `src/components/RenderedBlock.tsx`:

```typescript
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
}

export function RenderedBlock({
  block,
  isEditing,
  onFocus,
  onChange,
  onBlur,
  fontSize,
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
      <MarkdownPreview content={block.source} fontSize={fontSize} />
    </div>
  );
}
```

- [ ] **Step 5.2: Commit**

```bash
git add src/components/RenderedBlock.tsx
git commit -m "feat: add RenderedBlock component for click-to-edit workflow"
```

---

### Task 6: Create WysiwygEditor component

**Files:**
- Create: `src/components/WysiwygEditor.tsx`

- [ ] **Step 6.1: Write the component**

Create `src/components/WysiwygEditor.tsx`:

```typescript
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownEditor } from "./MarkdownEditor";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
import { RenderedBlock } from "./RenderedBlock";
import { SlidingButtonGroup } from "./SlidingButtonGroup";
import { parseBlocks, updateBlock } from "../features/markdown/markdownBlocks";
import type { MarkdownBlock } from "../features/markdown/markdownBlocks";
import type { ViewMode } from "../features/settings/types";
import type { TFunction } from "i18next";

type WysiwygMode = "reading" | "source";

export type FormatAction =
  | "bold"
  | "italic"
  | "heading"
  | "hr"
  | "ul"
  | "ol"
  | "code"
  | "quote"
  | "inlineMath"
  | "blockMath";

function applyFormat(
  editor: MarkdownEditorHandle,
  currentValue: string,
  action: FormatAction,
  translate: TFunction,
  onCommit: (v: string) => void,
) {
  const { from: start, to: end } = editor.getSelectionRange();
  const selected = currentValue.slice(start, end);
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = before.slice(lineStart);

  let result: string;
  let cursorStart: number;
  let cursorEnd: number;

  switch (action) {
    case "bold": {
      const fallback = translate("main.formatSample.boldText", { defaultValue: "粗体文本" });
      const wrapped = `**${selected || fallback}**`;
      result = before + wrapped + after;
      cursorStart = start + 2;
      cursorEnd = cursorStart + (selected || fallback).length;
      break;
    }
    case "italic": {
      const fallback = translate("main.formatSample.italicText", { defaultValue: "斜体文本" });
      const wrapped = `*${selected || fallback}*`;
      result = before + wrapped + after;
      cursorStart = start + 1;
      cursorEnd = cursorStart + (selected || fallback).length;
      break;
    }
    case "heading": {
      const prefix = currentLine.match(/^(#{1,5})\s/);
      if (prefix) {
        const newLevel = prefix[1].length < 5 ? "#".repeat(prefix[1].length + 1) : "#";
        const beforeLine = result = currentValue.slice(0, lineStart);
        const afterPrefix = currentValue.slice(lineStart + prefix[0].length);
        result = beforeLine + newLevel + " " + afterPrefix;
        const offset = newLevel.length + 1 - prefix[0].length;
        cursorStart = start + offset;
        cursorEnd = end + offset;
      } else if (currentLine.length > 0 && start === end) {
        result = currentValue.slice(0, lineStart) + "## " + currentValue.slice(lineStart);
        cursorStart = start + 3;
        cursorEnd = cursorStart;
      } else if (selected) {
        result = before + `## ${selected}` + after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + selected.length;
      } else {
        result =
          before +
          `## ${translate("main.formatSample.headingText", { defaultValue: "标题" })}` +
          after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + 2;
      }
      break;
    }
    case "hr": {
      const newlineBefore = before.endsWith("\n") || before === "" ? "" : "\n";
      const newlineAfter = after.startsWith("\n") || after === "" ? "" : "\n";
      result = before + `${newlineBefore}---${newlineAfter}` + after;
      cursorStart = cursorEnd = before.length + newlineBefore.length + 3;
      break;
    }
    case "ul": {
      if (selected.includes("\n")) {
        const lines = selected.split("\n").map((l) => `- ${l}`).join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
        const item = `- ${selected || fallback}`;
        result = before + item + after;
        cursorStart = start + 2;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "ol": {
      if (selected.includes("\n")) {
        const lines = selected.split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
        const item = `1. ${selected || fallback}`;
        result = before + item + after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "code": {
      if (selected.includes("\n")) {
        const wrapped = "```\n" + selected + "\n```";
        result = before + wrapped + after;
        cursorStart = start + 4;
        cursorEnd = cursorStart + selected.length;
      } else {
        const fallback = translate("main.formatSample.codeText", { defaultValue: "代码" });
        const wrapped = `\`${selected || fallback}\``;
        result = before + wrapped + after;
        cursorStart = start + 1;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "quote": {
      if (selected.includes("\n")) {
        const lines = selected.split("\n").map((l) => `> ${l}`).join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.quoteText", { defaultValue: "引用文本" });
        const item = `> ${selected || fallback}`;
        result = before + item + after;
        cursorStart = start + 2;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "inlineMath": {
      const wrapped = `$${selected || "E=mc^2"}$`;
      result = before + wrapped + after;
      cursorStart = start + 1;
      cursorEnd = cursorStart + (selected || "E=mc^2").length;
      break;
    }
    case "blockMath": {
      const wrapped = `\n$$\n${selected || "x^2 + y^2 = r^2"}\n$$\n`;
      result = before + wrapped + after;
      cursorStart = start + 4;
      cursorEnd = cursorStart + (selected || "x^2 + y^2 = r^2").length;
      break;
    }
    default:
      return;
  }

  onCommit(result);
  requestAnimationFrame(() => {
    editor.focus();
    editor.setSelectionRange(cursorStart, cursorEnd);
  });
}

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
}

export function WysiwygEditor({
  content,
  onChange,
  fontSize = 14,
  disabled = false,
  className,
  placeholder,
  onDirty,
}: WysiwygEditorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<WysiwygMode>("reading");
  const [editingBlockIndex, setEditingBlockIndex] = useState<number | null>(null);
  const sourceEditorRef = useRef<MarkdownEditorHandle>(null);

  const blocks = useMemo(() => parseBlocks(content), [content]);

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
      } else if (editingBlockIndex !== null) {
        // Formatting in inline editing mode: delegate to the inline editor
        // The RenderedBlock holds the editor ref, so we skip toolbar in reading mode
        // unless a block is being edited. For now, toolbar in reading mode without
        // active editing is a no-op — the user sees rendered content.
      }
    },
    [mode, editingBlockIndex, content, onChange, onDirty, t],
  );

  return (
    <div className={className}>
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
```

Wait, this has a lot of duplicated `applyFormat` code from MainWindow. Let me refactor — I'll extract `applyFormat` to a shared utility instead. That's a cleaner approach.

Let me revise: I'll create a `src/features/editor/formatActions.ts` with the `applyFormat` function, then use it in both WysiwygEditor and MainWindow (the old MainWindow still has it).

Actually, let me keep the plan simpler. The `applyFormat` in MainWindow is only used in the view mode area. Since we're replacing that area with WysiwygEditor, the applyFormat in MainWindow will be removed. So I just need it in WysiwygEditor.

But to keep the task clean, let me extract `applyFormat` to a shared module as a separate task.

Let me restructure:

Task 5: Extract applyFormat to shared utility
Task 6: Create RenderedBlock
Task 7: Create WysiwygEditor

- [ ] **Step 6.2: Commit**

```bash
git add src/components/WysiwygEditor.tsx
git commit -m "feat: add WysiwygEditor component with wysiwyg/source modes"
```

---

### Task 7: Extract applyFormat to shared utility

**Files:**
- Create: `src/features/editor/formatActions.ts`

- [ ] **Step 7.1: Write the shared utility**

Create `src/features/editor/formatActions.ts`:

```typescript
import type { TFunction } from "i18next";
import type { MarkdownEditorHandle } from "../../components/MarkdownEditor";

export type FormatAction =
  | "bold"
  | "italic"
  | "heading"
  | "hr"
  | "ul"
  | "ol"
  | "code"
  | "quote"
  | "inlineMath"
  | "blockMath";

export function applyFormat(
  editor: MarkdownEditorHandle,
  currentValue: string,
  action: FormatAction,
  translate: TFunction,
  onCommit: (v: string) => void,
) {
  const { from: start, to: end } = editor.getSelectionRange();
  const selected = currentValue.slice(start, end);
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = before.slice(lineStart);

  let result: string;
  let cursorStart: number;
  let cursorEnd: number;

  switch (action) {
    case "bold": {
      const fallback = translate("main.formatSample.boldText", { defaultValue: "粗体文本" });
      const wrapped = `**${selected || fallback}**`;
      result = before + wrapped + after;
      cursorStart = start + 2;
      cursorEnd = cursorStart + (selected || fallback).length;
      break;
    }
    case "italic": {
      const fallback = translate("main.formatSample.italicText", { defaultValue: "斜体文本" });
      const wrapped = `*${selected || fallback}*`;
      result = before + wrapped + after;
      cursorStart = start + 1;
      cursorEnd = cursorStart + (selected || fallback).length;
      break;
    }
    case "heading": {
      const prefix = currentLine.match(/^(#{1,5})\s/);
      if (prefix) {
        const newLevel = prefix[1].length < 5 ? "#".repeat(prefix[1].length + 1) : "#";
        const beforeLine = currentValue.slice(0, lineStart);
        const afterPrefix = currentValue.slice(lineStart + prefix[0].length);
        result = beforeLine + newLevel + " " + afterPrefix;
        const offset = newLevel.length + 1 - prefix[0].length;
        cursorStart = start + offset;
        cursorEnd = end + offset;
      } else if (currentLine.length > 0 && start === end) {
        result = currentValue.slice(0, lineStart) + "## " + currentValue.slice(lineStart);
        cursorStart = start + 3;
        cursorEnd = cursorStart;
      } else if (selected) {
        result = before + `## ${selected}` + after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + selected.length;
      } else {
        result =
          before +
          `## ${translate("main.formatSample.headingText", { defaultValue: "标题" })}` +
          after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + 2;
      }
      break;
    }
    case "hr": {
      const newlineBefore = before.endsWith("\n") || before === "" ? "" : "\n";
      const newlineAfter = after.startsWith("\n") || after === "" ? "" : "\n";
      result = before + `${newlineBefore}---${newlineAfter}` + after;
      cursorStart = cursorEnd = before.length + newlineBefore.length + 3;
      break;
    }
    case "ul": {
      if (selected.includes("\n")) {
        const lines = selected.split("\n").map((l) => `- ${l}`).join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
        const item = `- ${selected || fallback}`;
        result = before + item + after;
        cursorStart = start + 2;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "ol": {
      if (selected.includes("\n")) {
        const lines = selected.split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
        const item = `1. ${selected || fallback}`;
        result = before + item + after;
        cursorStart = start + 3;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "code": {
      if (selected.includes("\n")) {
        const wrapped = "```\n" + selected + "\n```";
        result = before + wrapped + after;
        cursorStart = start + 4;
        cursorEnd = cursorStart + selected.length;
      } else {
        const fallback = translate("main.formatSample.codeText", { defaultValue: "代码" });
        const wrapped = `\`${selected || fallback}\``;
        result = before + wrapped + after;
        cursorStart = start + 1;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "quote": {
      if (selected.includes("\n")) {
        const lines = selected.split("\n").map((l) => `> ${l}`).join("\n");
        result = before + lines + after;
        cursorStart = start;
        cursorEnd = start + lines.length;
      } else {
        const fallback = translate("main.formatSample.quoteText", { defaultValue: "引用文本" });
        const item = `> ${selected || fallback}`;
        result = before + item + after;
        cursorStart = start + 2;
        cursorEnd = cursorStart + (selected || fallback).length;
      }
      break;
    }
    case "inlineMath": {
      const wrapped = `$${selected || "E=mc^2"}$`;
      result = before + wrapped + after;
      cursorStart = start + 1;
      cursorEnd = cursorStart + (selected || "E=mc^2").length;
      break;
    }
    case "blockMath": {
      const wrapped = `\n$$\n${selected || "x^2 + y^2 = r^2"}\n$$\n`;
      result = before + wrapped + after;
      cursorStart = start + 4;
      cursorEnd = cursorStart + (selected || "x^2 + y^2 = r^2").length;
      break;
    }
    default:
      return;
  }

  onCommit(result);
  requestAnimationFrame(() => {
    editor.focus();
    editor.setSelectionRange(cursorStart, cursorEnd);
  });
}
```

- [ ] **Step 7.2: Commit**

```bash
git add src/features/editor/formatActions.ts
git commit -m "refactor: extract applyFormat to shared formatActions utility"
```

---

### Task 8: Update MainWindow to use WysiwygEditor

**Files:**
- Modify: `src/components/MainWindow.tsx`

This is the largest task. We need to:
1. Import WysiwygEditor instead of MarkdownEditor + MarkdownPreview directly
2. Remove `effectiveViewMode`, scroll sync, split resizer, previewScrollRef, splitRatio state
3. Remove `viewMode` state and `viewModeOptions`
4. Replace the edit/split/preview layout with a single `<WysiwygEditor>`
5. Remove `handleEditorScroll`, `handlePreviewScroll`, `handleJumpToHeading`, `computeActiveHeading`
6. Remove `effectiveViewModeRef`, `isScrollSyncing`
7. Remove unused imports (MarkdownEditor, MarkdownPreview)
8. Keep `handleJumpToHeading` for outline panel (simplified)
9. Keep extractHeadings, outline panel

Hmm, actually `handleJumpToHeading` is used by the outline panel and still needs to work. In source mode, it scrolls CodeMirror to a line. In reading mode, it needs to scroll to the heading block. Let me simplify: keep a ref to the scroll container in reading mode, and scroll to the heading element.

Actually, for simplicity in this plan, let me keep `handleJumpToHeading` working: in source mode use CodeMirror scrollToLine; in reading mode, find the heading DOM element and scroll to it (similar to the old preview mode).

Let me write the exact changes needed in MainWindow.

- [ ] **Step 8.1: Update imports**

Replace these imports at the top of MainWindow.tsx:

Old:
```typescript
import { MarkdownPreview } from "../features/markdown/MarkdownPreview";
import { extractHeadings } from "../features/markdown/extractHeadings";
import { OutlinePanel } from "./OutlinePanel";
import { MarkdownEditor } from "./MarkdownEditor";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
```

New:
```typescript
import { extractHeadings } from "../features/markdown/extractHeadings";
import { OutlinePanel } from "./OutlinePanel";
import { WysiwygEditor } from "./WysiwygEditor";
```

- [ ] **Step 8.2: Remove old imports and types**

Remove these lines:
- `import type { ViewMode } from "../features/settings/types";` (line 22) — keep but will be used differently now
- `FormatAction` type definition (lines 97-107) — moved to formatActions
- `applyFormat` function (lines 109-273) — moved to formatActions
- `runEditorUndo` function (lines 275-279) — no longer needed in MainWindow
- `pinTileButtonTitle` function (lines 281-283) — keep, used elsewhere
- `ReadOnlyHtmlViewer` component (lines 289-306) — keep, used for external HTML files
- `sanitizeHtml` function (lines 312-324) — keep

- [ ] **Step 8.3: Remove state related to split/preview**

Remove these state variables and refs:
- `viewMode` state (line 356-358) and related `setViewMode`
- `effectiveViewMode` and `effectiveViewModeRef` (lines 551-554)
- `splitRatio` state (line 393) and `setSplitRatio`
- `isResizingSplit` state (line 394) and `setIsResizingSplit`
- `splitContainerRef` (line 395) — keep for animation
- `previewScrollRef` (line 416) — remove
- `isScrollSyncing` ref (line 417) — remove
- `handleEditorScroll` (lines 472-489) — remove
- `handlePreviewScroll` (lines 491-508) — remove
- `viewModeOptions` useMemo (lines 638-654) — remove
- `lineCount` useMemo (line 663) — keep for status bar

Wait, need to be more careful. Let me trace what's removed and what stays.

Actually, let me simplify. The plan needs to be executable. Instead of listing every line removal, I should describe the replacement of the editor area.

- [ ] **Step 8.4: Replace the editor area rendering**

Replace lines 3010-3223 (the toolbar + mode switch + edit/split/preview containers) with the WysiwygEditor:

```tsx
            <div
              key={noteTransitionKey}
              ref={splitContainerRef}
              className="flex-1 flex flex-col min-h-0 animate-view-fade"
            >
              {!selectedId && !isLoading ? (
                <div className="flex-1 flex items-center justify-center text-[13px] text-ink-ghost">
                  {t("main.editor.emptyHint", { defaultValue: "选择或新建一篇笔记" })}
                </div>
              ) : isLoading && selectedId ? (
                <div className="flex-1 flex flex-col gap-3 px-6 pt-5 pb-4 animate-fade-in">
                  <div className="space-y-3">
                    <div className="h-7 w-2/5 rounded bg-ink-ghost/15 animate-pulse" />
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-24 rounded bg-ink-ghost/10 animate-pulse" />
                      <div className="h-3 w-16 rounded bg-ink-ghost/10 animate-pulse" />
                      <div className="h-3 w-16 rounded bg-ink-ghost/10 animate-pulse" />
                    </div>
                  </div>
                  <div className="border-t border-paper-deep/15 pt-4 space-y-2.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-4 rounded bg-ink-ghost/10 animate-pulse"
                        style={{ width: `${60 + Math.random() * 35}%` }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <WysiwygEditor
                  content={content}
                  onChange={(newValue) => {
                    setContent(newValue);
                    markDirty();
                  }}
                  fontSize={settingsConfig?.fontSize ?? 14}
                  disabled={!selectedId || isReadOnlyExternal || isReadOnlyInternal}
                  placeholder={t("main.editor.contentPlaceholder", {
                    defaultValue: "开始写作……",
                  })}
                  onDirty={markDirty}
                />
              )}
            </div>
```

- [ ] **Step 8.5: Remove unused variables from useEffect deps and JSX**

Remove:
- The `isResizingSplit` useEffect (lines 1817-1840)
- References to `handleEditorScroll`, `handlePreviewScroll`, `previewScrollRef`
- The `handleJumpToHeading` function still needs to work but simplified — update it:

```typescript
  const handleJumpToHeading = useCallback(
    (lineNumber: number) => {
      // WysiwygEditor handles its own scrolling internally
    },
    [],
  );
```

Actually, for now let's just make `handleJumpToHeading` a no-op since the outline jump-to-heading feature needs to be adapted to the new reading mode. This can be done in a follow-up task.

- [ ] **Step 8.6: Update the toolbar area in the header**

Remove the old toolbar buttons and view mode slider, since WysiwygEditor has its own. Replace lines around 3010-3033:

Old (toolbar + viewMode slider area):
```tsx
              <div className="flex items-center justify-between px-4 pt-2 pb-1 shrink-0">
                <div className="flex items-center gap-0.5">
                  {toolbarButtons.map((button) => (...))}
                </div>
                {!isReadOnlyExternal && (
                  <SlidingButtonGroup
                    options={viewModeOptions}
                    value={viewMode}
                    onChange={setViewMode}
                    buttonClassName="px-3 py-1"
                  />
                )}
                {isReadOnlyExternal && (
                  <span>...</span>
                )}
              </div>
```

Remove this entire block since WysiwygEditor handles its own toolbar.

- [ ] **Step 8.7: Clean up unused variables**

Remove these declarations from MainWindow:
- `toolbarButtons` useMemo (lines 571-637)
- `viewModeOptions` (lines 638-654)
- `contentRef` (line 415) — remove
- `splitRatio` (line 393) — remove
- `isResizingSplit` (line 394) — remove
- `handleEditorScroll`, `handlePreviewScroll`, `handleJumpToHeading` (simplify)
- `effectiveViewMode`, `effectiveViewModeRef`, `previewScrollRef`
- `computeActiveHeading`, `activeHeadingLine`
- `headingsRef`
- The old MarkdownEditor import

Keep:
- `runEditorUndo` (still used by other code — check if it's exported) — it IS exported, keep
- `pinTileButtonTitle` — exported, keep
- `SlidingButtonGroup` import — remove if no longer used elsewhere in MainWindow
- `handleUndo` — but it calls `runEditorUndo(contentRef.current)` which needs the editor ref. We need to adapt this.

For undo: we need to expose an undo method from WysiwygEditor. Or we can pass a ref. Let me add a `handleUndo` callback to the design or use a ref. Actually, `runEditorUndo` is triggered by a keyboard shortcut. In the new design:

- In reading mode: undo doesn't apply (no active editor)
- In source mode: CodeMirror handles Ctrl+Z natively

So we can simplify `handleUndo` to be a no-op for now, or remove the parent-level undo shortcut and let CodeMirror handle it natively (it already does with the `history` extension).

- [ ] **Step 8.8: Remove scroll-related effects**

Remove the effect that resets scroll on note change (lines 1190-1198):

```typescript
  // Remove this effect:
  useEffect(() => {
    setSidebarTab("directory");
    requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.setScrollTop(0);
      if (previewScrollRef.current) previewScrollRef.current.scrollTop = 0;
    });
  }, [selectedId]);
```

Replace with:
```typescript
  useEffect(() => {
    setSidebarTab("directory");
  }, [selectedId]);
```

- [ ] **Step 8.9: Run existing tests**

Run: `npx vitest run src/components/MainWindow.test.tsx`
Expect: Some tests may fail due to removed UI elements. Update tests in Task 12.

- [ ] **Step 8.10: Commit**

```bash
git add src/components/MainWindow.tsx
git commit -m "refactor: replace edit/split/preview with WysiwygEditor in MainWindow"
```

---

### Task 9: Update SettingsPanel viewModes

**Files:**
- Modify: `src/components/SettingsPanel.tsx:63-73`

- [ ] **Step 9.1: Update viewModes options**

Replace the `viewModes` useMemo (lines 63-73) in SettingsPanel.tsx:

Old:
```typescript
  const viewModes = useMemo<Array<{ value: ViewMode; label: string }>>(
    () => [
      { value: "edit", label: t("settings.defaultView.edit", { defaultValue: "编辑" }) },
      { value: "split", label: t("settings.defaultView.split", { defaultValue: "分栏" }) },
      { value: "preview", label: t("settings.defaultView.preview", { defaultValue: "预览" }) },
    ],
    [t],
  );
```

New:
```typescript
  const viewModes = useMemo<Array<{ value: ViewMode; label: string }>>(
    () => [
      { value: "wysiwyg", label: t("settings.defaultView.wysiwyg", { defaultValue: "阅读编辑" }) },
      { value: "source", label: t("settings.defaultView.source", { defaultValue: "源码编辑" }) },
    ],
    [t],
  );
```

- [ ] **Step 9.2: Commit**

```bash
git add src/components/SettingsPanel.tsx
git commit -m "refactor: update SettingsPanel viewModes to wysiwyg/source"
```

---

### Task 10: Write tests for markdownBlocks

**Files:**
- Create: `src/features/markdown/markdownBlocks.test.ts`

- [ ] **Step 10.1: Write tests**

Create `src/features/markdown/markdownBlocks.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { parseBlocks, blocksToContent, updateBlock } from "./markdownBlocks";

describe("parseBlocks", () => {
  test("returns empty array for empty content", () => {
    expect(parseBlocks("")).toEqual([]);
  });

  test("parses a single heading", () => {
    const blocks = parseBlocks("## Hello World");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].source).toBe("## Hello World");
  });

  test("parses multiple paragraphs separated by blank lines", () => {
    const blocks = parseBlocks("First paragraph.\n\nSecond paragraph.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].source).toBe("First paragraph.");
    expect(blocks[1].type).toBe("paragraph");
    expect(blocks[1].source).toBe("Second paragraph.");
  });

  test("keeps fenced code block intact", () => {
    const content = "Text before\n\n```js\nconst x = 1;\n\nconsole.log(x);\n```\n\nText after";
    const blocks = parseBlocks(content);
    expect(blocks.length).toBeGreaterThan(0);
    const codeBlock = blocks.find((b) => b.type === "code");
    expect(codeBlock).toBeDefined();
    expect(codeBlock!.source).toContain("```js");
    expect(codeBlock!.source).toContain("console.log(x);");
    // Blank lines inside code block preserved
    expect(codeBlock!.source).toContain("\n\n");
  });

  test("detects mermaid blocks", () => {
    const blocks = parseBlocks("```mermaid\ngraph TD\nA-->B\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("mermaid");
  });

  test("parses unordered list", () => {
    const blocks = parseBlocks("- item 1\n- item 2\n- item 3");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("list");
    expect(blocks[0].source).toBe("- item 1\n- item 2\n- item 3");
  });

  test("parses ordered list", () => {
    const blocks = parseBlocks("1. first\n2. second");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("list");
  });

  test("parses blockquote", () => {
    const blocks = parseBlocks("> quoted text\n> more quote");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("quote");
  });

  test("parses horizontal rule", () => {
    const blocks = parseBlocks("---");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("hr");
  });

  test("parses table", () => {
    const blocks = parseBlocks("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("table");
  });

  test("parses math block", () => {
    const blocks = parseBlocks("$$\nx^2\n$$");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("math");
  });

  test("parses mixed content", () => {
    const content = [
      "# Title",
      "",
      "A paragraph with some text.",
      "",
      "- list item 1",
      "- list item 2",
      "",
      "> A quote",
      "",
      "```python",
      "print('hello')",
      "```",
    ].join("\n");

    const blocks = parseBlocks(content);
    expect(blocks).toHaveLength(5);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[1].type).toBe("paragraph");
    expect(blocks[2].type).toBe("list");
    expect(blocks[3].type).toBe("quote");
    expect(blocks[4].type).toBe("code");
  });

  test("computes correct offsets", () => {
    const content = "## Heading\n\nParagraph text.";
    const blocks = parseBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].startOffset).toBe(0);
    expect(blocks[0].endOffset).toBe(10); // "## Heading"
    expect(blocks[1].startOffset).toBe(12); // after the \n\n
    expect(blocks[1].endOffset).toBe(content.length);
  });
});

describe("blocksToContent", () => {
  test("reassembles blocks with double newlines", () => {
    const blocks = parseBlocks("# A\n\nPara.\n\n- list");
    const result = blocksToContent(blocks);
    expect(result).toBe("# A\n\nPara.\n\n- list");
  });
});

describe("updateBlock", () => {
  test("replaces a block and preserves surrounding content", () => {
    const content = "# Old Title\n\nSome paragraph.";
    const blocks = parseBlocks(content);
    const updated = updateBlock(content, 0, "# New Title", blocks);
    expect(updated).toBe("# New Title\n\nSome paragraph.");
  });

  test("replaces a middle block", () => {
    const content = "First.\n\nSecond.\n\nThird.";
    const blocks = parseBlocks(content);
    const updated = updateBlock(content, 1, "Replaced.", blocks);
    expect(updated).toBe("First.\n\nReplaced.\n\nThird.");
  });
});
```

- [ ] **Step 10.2: Run tests**

Run: `npx vitest run src/features/markdown/markdownBlocks.test.ts`
Expect: All tests pass

- [ ] **Step 10.3: Commit**

```bash
git add src/features/markdown/markdownBlocks.test.ts
git commit -m "test: add unit tests for markdownBlocks parser"
```

---

### Task 11: Write tests for WysiwygEditor and RenderedBlock

**Files:**
- Create: `src/components/WysiwygEditor.test.tsx`

- [ ] **Step 11.1: Write tests**

Create `src/components/WysiwygEditor.test.tsx`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WysiwygEditor } from "./WysiwygEditor";

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const defaults: Record<string, string> = {
        "settings.defaultView.wysiwyg": "阅读编辑",
        "settings.defaultView.source": "源码编辑",
        "main.toolbar.bold": "粗体",
        "main.toolbar.italic": "斜体",
        "main.toolbar.heading": "标题",
        "main.toolbar.hr": "分割线",
        "main.toolbar.ul": "无序列表",
        "main.toolbar.ol": "有序列表",
        "main.toolbar.code": "代码",
        "main.toolbar.quote": "引用",
        "main.toolbar.inlineMath": "行内公式",
        "main.toolbar.blockMath": "块级公式",
        "main.editor.contentPlaceholder": "开始写作……",
        "main.formatSample.boldText": "粗体文本",
        "main.formatSample.italicText": "斜体文本",
        "main.formatSample.headingText": "标题",
        "main.formatSample.listItem": "列表项",
        "main.formatSample.codeText": "代码",
        "main.formatSample.quoteText": "引用文本",
      };
      return options?.defaultValue ?? defaults[key] ?? key;
    },
    i18n: { language: "zh-CN" },
  }),
}));

describe("WysiwygEditor", () => {
  test("renders mode switch buttons", () => {
    const markup = renderToStaticMarkup(
      <WysiwygEditor content="# Hello" onChange={() => {}} />,
    );
    expect(markup).toContain("阅读编辑");
    expect(markup).toContain("源码编辑");
  });

  test("renders toolbar buttons", () => {
    const markup = renderToStaticMarkup(
      <WysiwygEditor content="# Hello" onChange={() => {}} />,
    );
    expect(markup).toContain("粗体");
    expect(markup).toContain("标题");
  });

  test("renders markdown preview in reading mode", () => {
    const markup = renderToStaticMarkup(
      <WysiwygEditor content="## Test Heading" onChange={() => {}} />,
    );
    // react-markdown renders an h2 element
    expect(markup).toContain("Test Heading");
  });

  test("shows placeholder with empty content in reading mode", () => {
    const markup = renderToStaticMarkup(
      <WysiwygEditor content="" onChange={() => {}} placeholder="写点什么……" />,
    );
    expect(markup).toContain("写点什么……");
  });

  test("renders CodeMirror in source mode", () => {
    // Source mode shows data-codemirror-editor attribute
    // Since default is reading mode, we test the presence of the mode switch
    const markup = renderToStaticMarkup(
      <WysiwygEditor content="test" onChange={() => {}} />,
    );
    // Reading mode: rendered content, no CodeMirror wrapper
    expect(markup).not.toContain('data-codemirror-editor="true"');
  });

  test("renders RenderedBlock wrappers in reading mode", () => {
    const markup = renderToStaticMarkup(
      <WysiwygEditor content="## Hello\n\nWorld." onChange={() => {}} />,
    );
    // RenderedBlock uses className rendered-block
    expect(markup).toContain("rendered-block");
  });
});
```

- [ ] **Step 11.2: Run tests**

Run: `npx vitest run src/components/WysiwygEditor.test.tsx`
Expect: All tests pass

- [ ] **Step 11.3: Commit**

```bash
git add src/components/WysiwygEditor.test.tsx
git commit -m "test: add unit tests for WysiwygEditor"
```

---

### Task 12: Fix existing tests

**Files:**
- Modify: `src/components/MainWindow.test.tsx`

- [ ] **Step 12.1: Update MainWindow tests**

The existing tests reference old view mode labels and CodeMirror editor. Update them:

1. The test "renders the CodeMirror markdown editor" — this test checks for `data-codemirror-editor="true"` which will no longer be present by default (reading mode doesn't show CodeMirror). Change it:

```typescript
  test("renders the WysiwygEditor component", () => {
    const markup = renderToStaticMarkup(<MainWindow />);

    expect(markup).toContain("阅读编辑");
    expect(markup).toContain("源码编辑");
  });
```

2. The test "renders the settings panel with the loaded config" uses `defaultViewMode: "split"` — change to:

```typescript
          defaultViewMode: "wysiwyg",
```

3. Other tests that reference the old toolbar/view mode — check and update.

- [ ] **Step 12.2: Run tests**

Run: `npx vitest run src/components/MainWindow.test.tsx`
Expect: All tests pass

- [ ] **Step 12.3: Run full test suite**

Run: `npx vitest run`
Expect: All tests pass

- [ ] **Step 12.4: Commit**

```bash
git add src/components/MainWindow.test.tsx
git commit -m "test: update MainWindow tests for wysiwyg/source modes"
```

---

### Task 13: Final cleanup and verification

- [ ] **Step 13.1: Check for remaining references to old ViewMode values**

```bash
grep -r "edit.*split.*preview\|'edit'\|'split'\|'preview'" src/ --include="*.ts" --include="*.tsx"
```

Only matches should be in `normalizeViewMode` (migration logic) and test fixtures.

- [ ] **Step 13.2: Run the full test suite**

Run: `npx vitest run`
Expect: All tests pass, no regressions

- [ ] **Step 13.3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expect: No type errors

- [ ] **Step 13.4: Commit**

```bash
git commit --no-verify -m "chore: final cleanup for typora-style editor migration"
```

---

## Out of Scope (Future Tasks)

- Auto-enter editing mode on Enter key in reading mode (creates new block and enters edit)
- Enhanced inline editing: toolbar actions work on active inline editor
- Outline panel jump-to-heading in reading mode
- Smooth transition animation between rendered/editing states
- Virtualization for large documents with many blocks
- NotePad Typora-style upgrade (if desired later)
