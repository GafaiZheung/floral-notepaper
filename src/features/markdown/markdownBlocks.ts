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
  if (/^\|.*\|/.test(firstLine) && /^\|[\s\-:]+\|/.test(content.split("\n")[1] ?? ""))
    return "table";
  if (/^-{3,}$/.test(firstLine.trim()) || /^\*{3,}$/.test(firstLine.trim())) return "hr";
  return "paragraph";
}

/**
 * Split markdown content into logical blocks.
 * Fenced code blocks (```) are kept intact (not split by blank lines inside them).
 * Offset 采用增量累计（O(n)），避免逐块重建整个前缀字符串（O(n²)）。
 */
export function parseBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  if (!content) return blocks;

  const lines = content.split("\n");
  const lineLengths = lines.map((line) => line.length);
  let i = 0;
  // 当前行在原始 content 中的起始偏移，随消费进度增量推进
  let currentOffset = 0;

  while (i < lines.length) {
    // Skip blank lines between blocks
    if (lines[i].trim() === "") {
      currentOffset += lineLengths[i] + 1;
      i++;
      continue;
    }

    const firstLine = lines[i];
    const startOffset = currentOffset;

    // Fenced code block: capture from opening ``` to closing ```
    if (/^```/.test(firstLine)) {
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        j++;
      }
      if (j < lines.length) j++;
      else j = lines.length;
      const source = lines.slice(i, j).join("\n");
      const endOffset = startOffset + source.length;
      blocks.push({ type: classifyBlock(firstLine, source), source, startOffset, endOffset });
      i = j;
      currentOffset = endOffset + 1;
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
      const endOffset = startOffset + source.length;
      blocks.push({ type: "math", source, startOffset, endOffset });
      i = j;
      currentOffset = endOffset + 1;
      continue;
    }

    // Table detection: consecutive |...| lines
    if (/^\|.*\|/.test(firstLine)) {
      let j = i + 1;
      if (j < lines.length && /^\|[\s\-:]+\|/.test(lines[j])) {
        j++;
        while (j < lines.length && /^\|.*\|/.test(lines[j])) {
          j++;
        }
      }
      const source = lines.slice(i, j).join("\n");
      const endOffset = startOffset + source.length;
      blocks.push({ type: "table", source, startOffset, endOffset });
      i = j;
      currentOffset = endOffset + 1;
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(firstLine.trim()) || /^\*{3,}$/.test(firstLine.trim())) {
      const endOffset = startOffset + firstLine.length;
      blocks.push({ type: "hr", source: firstLine, startOffset, endOffset });
      i++;
      currentOffset = endOffset + 1;
      continue;
    }

    // List block: consecutive lines with list markers or indented continuation
    if (/^[\-*+]\s/.test(firstLine) || /^\d+\.\s/.test(firstLine)) {
      let j = i;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === "") break;
        if (/^[\-*+]\s/.test(l) || /^\d+\.\s/.test(l) || /^\s{2,}/.test(l) || /^\s/.test(l)) {
          j++;
        } else {
          break;
        }
      }
      const source = lines.slice(i, j).join("\n");
      const endOffset = startOffset + source.length;
      blocks.push({ type: "list", source, startOffset, endOffset });
      i = j;
      currentOffset = endOffset + 1;
      continue;
    }

    // Blockquote: consecutive >-prefixed lines
    if (/^>\s/.test(firstLine)) {
      let j = i;
      while (j < lines.length && /^>/.test(lines[j])) {
        j++;
      }
      const source = lines.slice(i, j).join("\n");
      const endOffset = startOffset + source.length;
      blocks.push({ type: "quote", source, startOffset, endOffset });
      i = j;
      currentOffset = endOffset + 1;
      continue;
    }

    // Heading
    if (/^#{1,6}\s/.test(firstLine)) {
      const endOffset = startOffset + firstLine.length;
      blocks.push({ type: "heading", source: firstLine, startOffset, endOffset });
      i++;
      currentOffset = endOffset + 1;
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
      const endOffset = startOffset + source.length;
      blocks.push({ type: "paragraph", source, startOffset, endOffset });
      i = j;
      currentOffset = endOffset + 1;
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
