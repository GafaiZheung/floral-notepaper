import { useMemo, useState, useCallback } from "react";
import type { Heading } from "../features/markdown/extractHeadings";

interface OutlinePanelProps {
  headings: Heading[];
  activeLineNumber?: number;
  onJumpTo: (lineNumber: number) => void;
  emptyText: string;
}

/** Build a tree from a flat heading list based on level nesting. */
interface OutlineNode {
  heading: Heading;
  children: OutlineNode[];
}

function buildOutlineTree(headings: Heading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  // Stack of ancestor nodes ordered by depth (root first).
  const stack: OutlineNode[] = [];

  for (const heading of headings) {
    const node: OutlineNode = { heading, children: [] };

    // Pop until we find a parent whose level is strictly less.
    while (stack.length > 0 && stack[stack.length - 1].heading.level >= heading.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return roots;
}

function OutlineTreeNode({
  node,
  depth,
  activeLineNumber,
  onJumpTo,
}: {
  node: OutlineNode;
  depth: number;
  activeLineNumber?: number;
  onJumpTo: (lineNumber: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const isActive = activeLineNumber === node.heading.lineNumber;

  const toggleCollapse = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => !prev);
  }, []);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onJumpTo(node.heading.lineNumber)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onJumpTo(node.heading.lineNumber);
        }}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={`relative flex items-center gap-1 pl-2 pr-2 py-1 text-[12px] cursor-pointer rounded-md transition-all duration-150 group ${
          isActive
            ? "bg-bamboo-mist/70 text-bamboo font-medium shadow-sm"
            : "text-ink-ghost hover:bg-bamboo-mist/40 hover:text-ink-faint"
        }`}
        title={node.heading.text}
      >
        {/* Left accent bar on hover/active */}
        <span
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-200 ${
            isActive ? "h-5 opacity-100" : "h-0 opacity-0 group-hover:h-4 group-hover:opacity-70"
          }`}
        />
        {/* Collapse toggle for nodes with children */}
        <span
          className={`w-4 h-4 flex items-center justify-center shrink-0 rounded transition-all ${
            hasChildren
              ? "text-ink-ghost/50 group-hover:text-ink-ghost cursor-pointer"
              : "invisible"
          }`}
          onClick={hasChildren ? toggleCollapse : undefined}
        >
          {hasChildren && (
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className={`transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          )}
        </span>

        <span className="truncate">{node.heading.text}</span>
      </div>

      {!collapsed &&
        node.children.map((child) => (
          <OutlineTreeNode
            key={`${child.heading.lineNumber}-${child.heading.text}`}
            node={child}
            depth={depth + 1}
            activeLineNumber={activeLineNumber}
            onJumpTo={onJumpTo}
          />
        ))}
    </div>
  );
}

export function OutlinePanel({
  headings,
  activeLineNumber,
  onJumpTo,
  emptyText,
}: OutlinePanelProps) {
  const tree = useMemo(() => buildOutlineTree(headings), [headings]);

  if (headings.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-[11px] text-ink-ghost/50 text-center leading-relaxed">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
      {tree.map((node) => (
        <OutlineTreeNode
          key={`${node.heading.lineNumber}-${node.heading.text}`}
          node={node}
          depth={0}
          activeLineNumber={activeLineNumber}
          onJumpTo={onJumpTo}
        />
      ))}
    </div>
  );
}
