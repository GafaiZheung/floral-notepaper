import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const paperWarmBg = "#f0ebe0";
const ink = "#1a1a18";
const inkSoft = "#3d3d38";
const inkFaint = "#8a8a80";
const inkGhost = "#b8b8ae";
const bamboo = "#2d5a3d";
const bambooLight = "#3a7a52";

const darkPaperWarmBg = "#2c2a27";
const darkInk = "#e5e1da";
const darkInkSoft = "#b5b1a8";
const darkInkFaint = "#928f87";
const darkInkGhost = "#706d67";
const darkBamboo = "#4faa70";
const darkBambooLight = "#5fc085";

export const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: ink, fontWeight: "700", fontSize: "1.57em" },
  { tag: tags.heading2, color: ink, fontWeight: "700", fontSize: "1.21em" },
  { tag: tags.heading3, color: ink, fontWeight: "600", fontSize: "1.07em" },
  { tag: tags.heading4, color: ink, fontWeight: "600" },
  { tag: tags.heading5, color: inkSoft, fontWeight: "600" },
  { tag: tags.heading6, color: inkSoft, fontWeight: "600" },
  { tag: tags.strong, color: ink, fontWeight: "700" },
  { tag: tags.emphasis, color: bambooLight, fontStyle: "italic" },
  { tag: tags.monospace, color: bamboo, fontSize: "0.85em" },
  { tag: tags.url, color: bamboo, textDecoration: "underline" },
  { tag: tags.link, color: bamboo },
  { tag: tags.quote, color: bambooLight, fontStyle: "italic" },
  { tag: tags.list, color: inkSoft },
  { tag: tags.contentSeparator, color: inkGhost },
  { tag: tags.processingInstruction, color: inkGhost },
  { tag: tags.strikethrough, color: inkFaint, textDecoration: "line-through" },
  { tag: tags.comment, color: inkGhost, fontStyle: "italic" },
  { tag: tags.meta, color: inkGhost },
]);

export const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: darkInk, fontWeight: "700", fontSize: "1.57em" },
  { tag: tags.heading2, color: darkInk, fontWeight: "700", fontSize: "1.21em" },
  { tag: tags.heading3, color: darkInk, fontWeight: "600", fontSize: "1.07em" },
  { tag: tags.heading4, color: darkInk, fontWeight: "600" },
  { tag: tags.heading5, color: darkInkSoft, fontWeight: "600" },
  { tag: tags.heading6, color: darkInkSoft, fontWeight: "600" },
  { tag: tags.strong, color: darkInk, fontWeight: "700" },
  { tag: tags.emphasis, color: darkBambooLight, fontStyle: "italic" },
  { tag: tags.monospace, color: darkBamboo, fontSize: "0.85em" },
  { tag: tags.url, color: darkBamboo, textDecoration: "underline" },
  { tag: tags.link, color: darkBamboo },
  { tag: tags.quote, color: darkBambooLight, fontStyle: "italic" },
  { tag: tags.list, color: darkInkSoft },
  { tag: tags.contentSeparator, color: darkInkGhost },
  { tag: tags.processingInstruction, color: darkInkGhost },
  { tag: tags.strikethrough, color: darkInkFaint, textDecoration: "line-through" },
  { tag: tags.comment, color: darkInkGhost, fontStyle: "italic" },
  { tag: tags.meta, color: darkInkGhost },
]);

export function createCodemirrorBaseTheme(isDark: boolean): ReturnType<typeof EditorView.theme> {
  const fg = isDark ? darkInkSoft : inkSoft;
  const cursor = isDark ? darkBamboo : bamboo;
  const selectionBg = isDark ? "rgba(79, 170, 112, 0.25)" : "rgba(45, 90, 61, 0.12)";
  const lineHighlight = isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)";
  const gutterFg = isDark ? darkInkGhost : inkGhost;
  const activeLineGutter = isDark ? darkInkFaint : inkFaint;
  const matchingBracket = isDark ? "rgba(79, 170, 112, 0.3)" : "rgba(45, 90, 61, 0.15)";

  return EditorView.theme(
    {
      "&": {
        backgroundColor: "transparent",
        color: fg,
        height: "100%",
        fontSize: "inherit",
        outline: "none",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-content": {
        fontFamily: "var(--font-body)",
        lineHeight: 1.9,
        padding: "0",
        caretColor: cursor,
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: cursor,
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: selectionBg,
      },
      ".cm-activeLine": {
        backgroundColor: lineHighlight,
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: activeLineGutter,
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: gutterFg,
        border: "none",
      },
      ".cm-line": {
        padding: "0",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: "none",
        color: isDark ? darkInkFaint : inkFaint,
      },
      "&.cm-focused .cm-matchingBracket": {
        backgroundColor: matchingBracket,
        outline: "none",
      },
      ".cm-placeholder": {
        color: isDark ? "rgba(112, 109, 103, 0.4)" : "rgba(184, 184, 174, 0.4)",
      },
      ".cm-codeblock-line": {
        backgroundColor: isDark ? darkPaperWarmBg : paperWarmBg,
        fontSize: "0.85em",
      },
    },
    { dark: isDark },
  );
}

export function getSyntaxHighlighting(isDark: boolean) {
  return syntaxHighlighting(isDark ? darkHighlightStyle : lightHighlightStyle);
}
