import { ViewPlugin, Decoration } from "@codemirror/view";
import type { EditorView, ViewUpdate, DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";

const codeBlockLineDeco = Decoration.line({ class: "cm-codeblock-line" });

/**
 * ViewPlugin that adds a background CSS class to lines inside fenced code blocks,
 * so the background spans the full line width rather than just the text tokens.
 *
 * 增量更新：仅当变更区域涉及围栏代码块（新建、删除围栏或块内编辑）时才重建
 * decorations；普通正文按键与滚动（viewport 变化）不再触发全树遍历重建。
 */
export const codeBlockBackground = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (!update.docChanged) return;

      const tree = syntaxTree(update.view.state);
      let touched = false;

      update.changes.iterChangedRanges((fromA, toA) => {
        if (touched) return;

        // 变更区域内出现了新的围栏代码块（新建块/补全围栏）
        tree.iterate({
          from: fromA,
          to: toA,
          enter: (node) => {
            if (node.type.name === "FencedCode") {
              touched = true;
              return false;
            }
          },
        });
        if (touched) return;

        // 变更落在旧代码块装饰行上（块内编辑、删除围栏等）：
        // 行装饰的 from == line.from，块内编辑必然覆盖该点
        this.decorations.between(fromA, toA, () => {
          touched = true;
        });
      });

      if (touched) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;

  tree.iterate({
    enter: (node) => {
      if (node.type.name === "FencedCode") {
        const blockTo = node.to;
        let pos = node.from;
        while (pos <= blockTo) {
          const line = doc.lineAt(pos);
          builder.add(line.from, line.from, codeBlockLineDeco);
          pos = line.to + 1;
        }
        return false;
      }
    },
  });

  return builder.finish();
}
