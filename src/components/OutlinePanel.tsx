import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { Heading } from "../features/markdown/extractHeadings";

interface OutlinePanelProps {
  headings: Heading[];
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
  const stack: OutlineNode[] = [];

  for (const heading of headings) {
    const node: OutlineNode = { heading, children: [] };

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
  maxDepth,
  onJumpTo,
}: {
  node: OutlineNode;
  depth: number;
  maxDepth: number;
  onJumpTo: (lineNumber: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0 && node.heading.level < maxDepth;

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
        className="relative flex items-center gap-1 pl-2 pr-2 py-1 text-[12px] cursor-pointer rounded-md transition-all duration-150 group text-ink-ghost hover:bg-bamboo-mist/40 hover:text-ink-faint"
        title={node.heading.text}
      >
        {/* Left accent bar on hover */}
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-200 h-0 opacity-0 group-hover:h-4 group-hover:opacity-70" />
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
            maxDepth={maxDepth}
            onJumpTo={onJumpTo}
          />
        ))}
    </div>
  );
}

const DEPTH_OPTIONS = [
  { value: 2, label: "H1 – H2" },
  { value: 3, label: "H1 – H3" },
  { value: 4, label: "H1 – H4" },
  { value: 6, label: "H1 – H6" },
];

export function OutlinePanel({ headings, onJumpTo, emptyText }: OutlinePanelProps) {
  const [maxDepth, setMaxDepth] = useState(3);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildOutlineTree(headings), [headings]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  if (headings.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-[11px] text-ink-ghost/50 text-center leading-relaxed">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header with depth selector */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0 border-b border-paper-deep/15">
        <span className="text-[10px] text-ink-ghost font-mono tracking-wider uppercase">
          H1 – H{maxDepth}
        </span>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-6 h-6 flex items-center justify-center rounded text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] bg-cloud/95 backdrop-blur-sm border border-paper-deep/40 rounded-lg shadow-lg overflow-hidden py-1 animate-menu-enter">
              {DEPTH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setMaxDepth(opt.value);
                    setMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] font-body transition-colors cursor-pointer ${
                    maxDepth === opt.value
                      ? "text-bamboo bg-bamboo-mist/40 font-medium"
                      : "text-ink-faint hover:text-ink-soft hover:bg-paper-warm/60"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
        {tree.map((node) => (
          <OutlineTreeNode
            key={`${node.heading.lineNumber}-${node.heading.text}`}
            node={node}
            depth={0}
            maxDepth={maxDepth}
            onJumpTo={onJumpTo}
          />
        ))}
      </div>
    </div>
  );
}
