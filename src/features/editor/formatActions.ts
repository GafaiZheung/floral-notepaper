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

/**
 * Apply a format action directly on the CodeMirror editor using replaceRangeAndSelect
 * to avoid the string-build → onChange → React-render → document-sync → scroll-reset chain.
 */
export function applyFormat(
  editor: MarkdownEditorHandle,
  _currentValue: string,
  action: FormatAction,
  translate: TFunction,
  _onCommit: (v: string) => void,
) {
  const { from: start, to: end } = editor.getSelectionRange();
  const selected = _currentValue.slice(start, end);
  const before = _currentValue.slice(0, start);
  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = before.slice(lineStart);

  let from: number;
  let to: number;
  let insert: string;
  let selFrom: number;
  let selTo: number;

  switch (action) {
    case "bold": {
      const fallback = translate("main.formatSample.boldText", { defaultValue: "粗体文本" });
      from = start;
      to = end;
      insert = `**${selected || fallback}**`;
      selFrom = start + 2;
      selTo = selFrom + (selected || fallback).length;
      break;
    }
    case "italic": {
      const fallback = translate("main.formatSample.italicText", { defaultValue: "斜体文本" });
      from = start;
      to = end;
      insert = `*${selected || fallback}*`;
      selFrom = start + 1;
      selTo = selFrom + (selected || fallback).length;
      break;
    }
    case "heading": {
      const prefix = currentLine.match(/^(#{1,5})\s/);
      if (prefix) {
        const newLevel = prefix[1].length < 5 ? "#".repeat(prefix[1].length + 1) : "#";
        from = lineStart;
        to = lineStart + prefix[0].length;
        insert = newLevel + " ";
        selFrom = start + newLevel.length + 1 - prefix[0].length;
        selTo = end + newLevel.length + 1 - prefix[0].length;
      } else if (currentLine.length > 0 && start === end) {
        from = lineStart;
        to = lineStart;
        insert = "## ";
        selFrom = start + 3;
        selTo = selFrom;
      } else if (selected) {
        from = start;
        to = end;
        insert = `## ${selected}`;
        selFrom = start + 3;
        selTo = selFrom + selected.length;
      } else {
        const fallback = translate("main.formatSample.headingText", { defaultValue: "标题" });
        from = start;
        to = end;
        insert = `## ${fallback}`;
        selFrom = start + 3;
        selTo = selFrom + fallback.length;
      }
      break;
    }
    case "hr": {
      const newlineBefore = before.endsWith("\n") || before === "" ? "" : "\n";
      const newlineAfter =
        _currentValue.slice(end).startsWith("\n") || _currentValue.slice(end) === "" ? "" : "\n";
      from = start;
      to = end;
      insert = `${newlineBefore}---${newlineAfter}`;
      selFrom = selTo = from + newlineBefore.length + 3;
      break;
    }
    case "ul": {
      from = start;
      to = end;
      if (selected.includes("\n")) {
        insert = selected
          .split("\n")
          .map((l) => `- ${l}`)
          .join("\n");
        selFrom = start;
        selTo = start + insert.length;
      } else {
        const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
        insert = `- ${selected || fallback}`;
        selFrom = start + 2;
        selTo = selFrom + (selected || fallback).length;
      }
      break;
    }
    case "ol": {
      from = start;
      to = end;
      if (selected.includes("\n")) {
        insert = selected
          .split("\n")
          .map((l, i) => `${i + 1}. ${l}`)
          .join("\n");
        selFrom = start;
        selTo = start + insert.length;
      } else {
        const fallback = translate("main.formatSample.listItem", { defaultValue: "列表项" });
        insert = `1. ${selected || fallback}`;
        selFrom = start + 3;
        selTo = selFrom + (selected || fallback).length;
      }
      break;
    }
    case "code": {
      from = start;
      to = end;
      if (selected.includes("\n")) {
        insert = "```\n" + selected + "\n```";
        selFrom = start + 4;
        selTo = selFrom + selected.length;
      } else {
        const fallback = translate("main.formatSample.codeText", { defaultValue: "代码" });
        insert = `\`${selected || fallback}\``;
        selFrom = start + 1;
        selTo = selFrom + (selected || fallback).length;
      }
      break;
    }
    case "quote": {
      from = start;
      to = end;
      if (selected.includes("\n")) {
        insert = selected
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n");
        selFrom = start;
        selTo = start + insert.length;
      } else {
        const fallback = translate("main.formatSample.quoteText", { defaultValue: "引用文本" });
        insert = `> ${selected || fallback}`;
        selFrom = start + 2;
        selTo = selFrom + (selected || fallback).length;
      }
      break;
    }
    case "inlineMath": {
      const fallback = selected || "E=mc^2";
      from = start;
      to = end;
      insert = `$${fallback}$`;
      selFrom = start + 1;
      selTo = selFrom + fallback.length;
      break;
    }
    case "blockMath": {
      const fallback = selected || "E=mc^2";
      from = start;
      to = end;
      insert = `\n$$\n${fallback}\n$$\n`;
      selFrom = start + 4;
      selTo = selFrom + fallback.length;
      break;
    }
    default:
      return;
  }

  editor.replaceRangeAndSelect(from, to, insert, selFrom, selTo);
}
