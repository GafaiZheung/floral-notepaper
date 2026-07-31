import { useMemo } from "react";
import { Highlight, type PrismTheme } from "prism-react-renderer";

// Light theme matching the paper/ink/bamboo design system
const lightTheme: PrismTheme = {
  plain: {
    color: "#3d3d38",
    backgroundColor: "#f0ebe0",
  },
  styles: [
    {
      types: ["comment", "prolog", "doctype", "cdata"],
      style: { color: "#8a8a80", fontStyle: "italic" },
    },
    { types: ["punctuation"], style: { color: "#8a8a80" } },
    {
      types: ["property", "tag", "boolean", "number", "constant", "symbol", "deleted"],
      style: { color: "#2d5a3d" },
    },
    {
      types: ["selector", "attr-name", "string", "char", "builtin", "inserted"],
      style: { color: "#3a7a52" },
    },
    { types: ["operator", "entity", "url"], style: { color: "#1a1a18" } },
    { types: ["atrule", "attr-value", "keyword"], style: { color: "#2d5a3d", fontWeight: "600" } },
    { types: ["function", "class-name"], style: { color: "#1a1a18", fontWeight: "600" } },
    { types: ["regex", "important", "variable"], style: { color: "#2d5a3d" } },
  ],
};

// Dark theme
const darkTheme: PrismTheme = {
  plain: {
    color: "#b5b1a8",
    backgroundColor: "#2c2a27",
  },
  styles: [
    {
      types: ["comment", "prolog", "doctype", "cdata"],
      style: { color: "#928f87", fontStyle: "italic" },
    },
    { types: ["punctuation"], style: { color: "#928f87" } },
    {
      types: ["property", "tag", "boolean", "number", "constant", "symbol", "deleted"],
      style: { color: "#4faa70" },
    },
    {
      types: ["selector", "attr-name", "string", "char", "builtin", "inserted"],
      style: { color: "#5fc085" },
    },
    { types: ["operator", "entity", "url"], style: { color: "#e5e1da" } },
    { types: ["atrule", "attr-value", "keyword"], style: { color: "#4faa70", fontWeight: "600" } },
    { types: ["function", "class-name"], style: { color: "#e5e1da", fontWeight: "600" } },
    { types: ["regex", "important", "variable"], style: { color: "#4faa70" } },
  ],
};

function detectTheme(): PrismTheme {
  if (typeof document === "undefined") return lightTheme;
  return document.documentElement.getAttribute("data-theme") === "dark" ? darkTheme : lightTheme;
}

/**
 * Maps a language-xxx className from react-markdown to a Prism language identifier.
 */
function languageFromClassName(className: string): string {
  const match = className.match(/^language-(.+)$/);
  return match ? match[1] : "text";
}

/**
 * Renders syntax-highlighted code using Prism, with light/dark theme matching
 * the paper/ink/bamboo design system.
 */
export function SyntaxHighlightedCode({ code, className }: { code: string; className?: string }) {
  const language = className ? languageFromClassName(className) : "text";
  const theme = useMemo(() => detectTheme(), []);

  // Strip trailing newline that react-markdown adds
  const trimmed = code.endsWith("\n") ? code.slice(0, -1) : code;

  return (
    <div className="text-[0.85em] font-mono leading-[1.8]">
      <Highlight theme={theme} code={trimmed} language={language}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </>
        )}
      </Highlight>
    </div>
  );
}
