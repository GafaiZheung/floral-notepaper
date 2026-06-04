import { describe, expect, it } from "vitest";
import { extractHeadings } from "./extractHeadings";

describe("extractHeadings", () => {
  it("returns empty array for empty document", () => {
    expect(extractHeadings("")).toEqual([]);
  });

  it("returns empty array for document with no headings", () => {
    expect(extractHeadings("Hello world\nThis is a paragraph.")).toEqual([]);
  });

  it("extracts a single h1 heading", () => {
    const result = extractHeadings("# Introduction");
    expect(result).toEqual([{ level: 1, text: "Introduction", lineNumber: 0 }]);
  });

  it("extracts headings of different levels", () => {
    const md = [
      "# Title",
      "## Section 1",
      "### Subsection 1.1",
      "## Section 2",
      "###### Deep heading",
    ].join("\n");
    const result = extractHeadings(md);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ level: 1, text: "Title", lineNumber: 0 });
    expect(result[1]).toEqual({ level: 2, text: "Section 1", lineNumber: 1 });
    expect(result[2]).toEqual({ level: 3, text: "Subsection 1.1", lineNumber: 2 });
    expect(result[3]).toEqual({ level: 2, text: "Section 2", lineNumber: 3 });
    expect(result[4]).toEqual({ level: 6, text: "Deep heading", lineNumber: 4 });
  });

  it("skips headings inside fenced code blocks", () => {
    const md = [
      "# Real heading",
      "```",
      "# Not a heading",
      "## Also not a heading",
      "```",
      "## Another real heading",
    ].join("\n");
    const result = extractHeadings(md);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ level: 1, text: "Real heading", lineNumber: 0 });
    expect(result[1]).toEqual({ level: 2, text: "Another real heading", lineNumber: 5 });
  });

  it("strips trailing # markers from heading text", () => {
    const result = extractHeadings("## My Section ##");
    expect(result).toEqual([{ level: 2, text: "My Section", lineNumber: 0 }]);
  });

  it("ignores lines where # is not preceded by start-of-line", () => {
    const md = "This is not a ## heading because # is not at start";
    const result = extractHeadings(md);
    expect(result).toEqual([]);
  });

  it("ignores heading lines with empty text after stripping", () => {
    const result = extractHeadings("#   ");
    expect(result).toEqual([]);
  });

  it("handles headings with inline formatting", () => {
    const result = extractHeadings("### Hello **world** and *more*");
    expect(result).toEqual([{ level: 3, text: "Hello **world** and *more*", lineNumber: 0 }]);
  });

  it("handles multiple fenced code blocks correctly", () => {
    const md = [
      "# One",
      "```python",
      "# code comment",
      "print('hello')",
      "```",
      "## Two",
      "```",
      "### fake heading",
      "```",
      "# Three",
    ].join("\n");
    const result = extractHeadings(md);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("One");
    expect(result[1].text).toBe("Two");
    expect(result[2].text).toBe("Three");
  });

  it("handles heading with only spaces before text", () => {
    const result = extractHeadings("##    Lots of space");
    expect(result).toEqual([{ level: 2, text: "Lots of space", lineNumber: 0 }]);
  });
});
