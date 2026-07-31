export interface Heading {
  level: number; // 1-6
  text: string;
  lineNumber: number; // 0-based
}

/**
 * Extract all ATX headings (# ...) from raw Markdown text.
 * Lines inside fenced code blocks (```) are skipped.
 * Returns headings in document order.
 */
export function extractHeadings(rawMarkdown: string): Heading[] {
  const headings: Heading[] = [];
  const lines = rawMarkdown.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Toggle fenced code block state
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (!match) continue;

    const level = match[1].length;
    let text = match[2].trimEnd();

    // Strip trailing # characters (used as closing markers in ATX headings)
    text = text.replace(/\s+#+\s*$/, "");

    if (text.length === 0) continue;

    headings.push({ level, text, lineNumber: i });
  }

  return headings;
}
