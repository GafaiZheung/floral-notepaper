import { ViewPlugin, Decoration } from "@codemirror/view";
import type { EditorView, ViewUpdate, DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";

const codeBlockLineDeco = Decoration.line({ class: "cm-codeblock-line" });

/**
 * ViewPlugin that adds a background CSS class to lines inside fenced code blocks,
 * so the background spans the full line width rather than just the text tokens.
 */
export const codeBlockBackground = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
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
