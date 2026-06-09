# Typora-style WYSIWYG Editor Design

**Date**: 2026-06-09
**Status**: Design approved, pending implementation plan

## Overview

Transform the main editor (MainWindow) from a three-mode system (edit/split/preview) into a Typora-style two-mode system:

- **阅读编辑模式 (Reading-Editing Mode)**: Default mode. Markdown is rendered as HTML. Clicking on any element reveals its raw markdown source inline. Blur (clicking elsewhere) returns it to rendered state.
- **源码编辑模式 (Source Code Mode)**: Full CodeMirror editor with syntax highlighting, equivalent to the current "edit" mode.

The floating notepad (NotePad) is **not** affected by this change.

## Current State

The editor currently has three `ViewMode` values: `edit`, `split`, `preview`.

- **edit**: CodeMirror 6 editor showing raw markdown
- **split**: Side-by-side CodeMirror + react-markdown preview with scroll sync
- **preview**: react-markdown rendered HTML only

These modes are toggled via a sliding button group in the toolbar area.

## Target State

### Two modes instead of three

```
阅读编辑 (default)  ←→  源码编辑
```

- `ViewMode` type changes from `"edit" | "split" | "preview"` to `"wysiwyg" | "source"`
- Mode switch is a two-option sliding button group
- The formatting toolbar (B, I, H, —, •, 1., <>, ❝, ∑, ∫) remains visible in both modes

### 阅读编辑模式 (WYSIWYG Mode)

Content is rendered as HTML via react-markdown. The content is split into logical blocks. Each block is clickable. When a block receives focus, it is replaced inline with a mini CodeMirror instance showing its raw markdown source.

**Block types and their editing granularity:**

| Block Type | Editing Scope |
|---|---|
| Heading (h1-h6) | Single heading line |
| Paragraph | Entire paragraph (until blank line) |
| List (ul/ol) | Entire list block |
| Code block / Mermaid / Math block | Full fenced block |
| Blockquote | Entire quote block |
| Table | Full pipe table |
| Horizontal rule | Single line |
| Image / Link | Inline editing showing `![alt](url)` / `[text](url)` |

**Editing lifecycle:**

1. Default: Block is rendered as HTML (react-markdown)
2. User clicks a block → Block swaps to inline CodeMirror showing raw source
3. User edits the content
4. User clicks outside (blur) → Inline editor closes, block re-renders
5. Content string is updated with the edited block's new text

**Key behaviors:**

- Only one block can be edited at a time (clicking another block auto-completes the current one)
- Pressing Enter at the end of a paragraph creates a new empty block, which auto-enters editing mode
- All inline formatting (`**bold**`, `*italic*`, `` `code` ``, `$math$`) markers become visible only when the block is in editing state
- Animated transition: CSS fade/height transition when switching between rendered and editing states (150-200ms)

### 源码编辑模式 (Source Mode)

Full CodeMirror editor with syntax highlighting — identical to the current "edit" mode experience. The existing `MarkdownEditor` component is reused as-is.

## Component Architecture

### New Components

#### `WysiwygEditor.tsx`
Container component. Manages the `wysiwygMode` state (`"reading" | "source"`), renders the mode switch button group, toolbar, and either the reading-editing view or the source CodeMirror view.

**Props:**
- `content: string`
- `onChange: (value: string) => void`
- `fontSize: number`
- `disabled: boolean`
- `className?: string`

**State:**
- `mode: "reading" | "source"` — current display mode
- `editingBlockIndex: number | null` — which block is being edited (null if none)

#### `RenderedBlock.tsx`
A single markdown block in the reading-editing view. Manages its own edit state.

**Props:**
- `block: MarkdownBlock`
- `isEditing: boolean`
- `onFocus: () => void` — request to enter editing state
- `onChange: (newSource: string) => void` — source text changed
- `onBlur: () => void` — exit editing state
- `fontSize: number`

**States:**
- **Rendered**: Shows react-markdown output. Click handler calls `onFocus`.
- **Editing**: Shows inline CodeMirror with `block.source`. Blur calls `onBlur`.

Transitions use CSS `animate-view-fade` or a subtle opacity/height animation.

#### `markdownBlocks.ts`
Utility module for parsing markdown content into logical blocks.

**Exports:**
```typescript
interface MarkdownBlock {
  type: 'heading' | 'paragraph' | 'code' | 'list' | 'quote' | 'table' | 'math' | 'hr' | 'mermaid';
  source: string;        // raw markdown text
  startOffset: number;   // position in original content string
  endOffset: number;     // position in original content string
}

function parseBlocks(content: string): MarkdownBlock[];
function blocksToContent(blocks: MarkdownBlock[]): string;
function updateBlock(content: string, index: number, newSource: string): string;
```

Implementation uses the `remark` / `unified` AST (already a transitive dependency via react-markdown) to parse the markdown tree and split it at block-level nodes.

### Modified Components

#### `MainWindow.tsx`
- Remove: `effectiveViewMode`, scroll sync logic (`handleEditorScroll`, `handlePreviewScroll`), split resizer, `previewScrollRef`
- Remove: preview pane rendering code
- Replace the edit/split/preview layout area with a single `<WysiwygEditor>` component
- Update `ViewMode` type usages to `"wysiwyg" | "source"`
- Simplify: only one content area, no need for ratio-based layout

#### `MarkdownEditor.tsx`
- Existing `MarkdownEditor` is already a self-contained CodeMirror wrapper
- For inline mini-editor usage in `RenderedBlock`, the same component can be instantiated with a smaller height (auto-sized to content)
- May need a `minimal` prop to hide certain decorations when used inline (optional enhancement)

#### `settings/types.ts`
- `ViewMode` type: `"edit" | "split" | "preview"` → `"wysiwyg" | "source"`
- Default value: `"wysiwyg"`
- Settings panel: update the label and options for default view mode

#### `settings/api.ts`
- `normalizeViewMode` function: update to handle new values, migrate legacy settings (`"edit"`/`"split"` → `"source"`; `"preview"` → `"wysiwyg"`)

### Unchanged Components
- `MarkdownPreview.tsx` — reused inside `RenderedBlock` for rendering
- `NotePad.tsx` — out of scope
- `Sidebar`, `TabBar`, `OutlinePanel`, `BackgroundLayer` — unaffected
- `Tile.tsx` — unaffected

## Data Flow

```
content: string
     │
     ├─ [mode === "source"] ──► MarkdownEditor (CodeMirror, full document)
     │                          onChange → setContent(value)
     │
     └─ [mode === "reading"] ─► parseBlocks(content) → blocks[]
                                 │
                                 ├─ Block 0 (heading)
                                 ├─ Block 1 (paragraph, editingBlockIndex === 1)
                                 │    └─ InlineCodeMirror(block.source)
                                 │       onChange → update content string
                                 │       onBlur   → set editingBlockIndex = null
                                 ├─ Block 2 (code)
                                 └─ ...
```

When switching from source → reading mode: re-parse blocks, all rendered.
When switching from reading → source mode: show full CodeMirror with current content.

## Migration of User Settings

| Old Setting | New Setting |
|---|---|
| `defaultViewMode: "edit"` | `defaultViewMode: "source"` |
| `defaultViewMode: "split"` | `defaultViewMode: "source"` |
| `defaultViewMode: "preview"` | `defaultViewMode: "wysiwyg"` |

`normalizeViewMode` handles this migration transparently on config load.

## Out of Scope
- NotePad (floating notepad) — remains unchanged
- Tile view — remains unchanged
- Mobile/responsive adaptations
- Collaborative editing

## Technical Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Block parsing edge cases (nested lists, indented code) | Use remark AST directly, add comprehensive tests with fixture markdown files |
| Multiple CodeMirror instances memory overhead | Only create CodeMirror instance for the actively edited block; destroy on blur |
| Cursor position loss when switching rendered↔editing | Save cursor offset in block source, restore after re-render |
| Mermaid diagrams re-render on every blur (expensive) | Memoize Mermaid renders with content hash; only re-render when source actually changed |
| Large documents with many blocks | Virtualize block list; only render visible blocks (optional optimization, may not be needed initially) |
