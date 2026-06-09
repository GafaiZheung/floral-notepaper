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
    expect(blocks[1].type).toBe("paragraph");
  });

  test("keeps fenced code block intact", () => {
    const content = "Text before\n\n```js\nconst x = 1;\n\nconsole.log(x);\n```\n\nText after";
    const blocks = parseBlocks(content);
    const codeBlock = blocks.find((b) => b.type === "code");
    expect(codeBlock).toBeDefined();
    expect(codeBlock!.source).toContain("```js");
    expect(codeBlock!.source).toContain("console.log(x);");
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
    expect(blocks[0].endOffset).toBe(10);
    expect(blocks[1].startOffset).toBe(12);
    expect(blocks[1].endOffset).toBe(content.length);
  });
});

describe("blocksToContent", () => {
  test("reassembles blocks with double newlines", () => {
    const content = "# A\n\nPara.\n\n- list";
    const blocks = parseBlocks(content);
    const result = blocksToContent(blocks);
    expect(result).toBe(content);
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

  test("returns original content for invalid index", () => {
    const content = "Text";
    const blocks = parseBlocks(content);
    expect(updateBlock(content, -1, "X", blocks)).toBe(content);
    expect(updateBlock(content, 99, "X", blocks)).toBe(content);
  });
});
