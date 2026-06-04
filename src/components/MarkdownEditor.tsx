import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, placeholder as placeholderExt } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import {
  createCodemirrorBaseTheme,
  getSyntaxHighlighting,
} from "../features/editor/codemirrorTheme";
import { codeBlockBackground } from "../features/editor/codeBlockDecorations";

export interface MarkdownEditorHandle {
  focus(): void;
  getScrollTop(): number;
  setScrollTop(top: number): void;
  getMaxScrollTop(): number;
  scrollToLine(lineNumber: number): void;
  getSelectionRange(): { from: number; to: number };
  setSelectionRange(from: number, to: number): void;
  insertAtCursor(text: string): void;
  runUndo(): boolean;
}

export interface MarkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  fontSize?: number;
  className?: string;
  onScroll?: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
}

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    { value, onChange, placeholder, disabled, fontSize = 14, className, onScroll, onKeyDown },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onScrollRef = useRef(onScroll);
    onScrollRef.current = onScroll;
    const onKeyDownRef = useRef(onKeyDown);
    onKeyDownRef.current = onKeyDown;
    const isUpdatingRef = useRef(false);

    // Compartments for dynamic theme switching
    const themeCompartment = useRef(new Compartment());
    const highlightCompartment = useRef(new Compartment());
    const editableCompartment = useRef(new Compartment());

    // Create editor on mount
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const dark = isDarkTheme();

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged && !isUpdatingRef.current) {
          const newValue = update.state.doc.toString();
          onChangeRef.current?.(newValue);
        }
      });

      const extensions = [
        themeCompartment.current.of(createCodemirrorBaseTheme(dark)),
        highlightCompartment.current.of(getSyntaxHighlighting(dark)),
        editableCompartment.current.of(EditorView.editable.of(!disabled)),
        markdown({ codeLanguages: languages, defaultCodeLanguage: markdownLanguage }),
        codeBlockBackground,
        EditorView.lineWrapping,
        history(),
        bracketMatching(),
        indentOnInput(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        updateListener,
      ];

      if (placeholder) {
        extensions.push(placeholderExt(placeholder));
      }

      const state = EditorState.create({
        doc: value ?? "",
        extensions,
      });

      const view = new EditorView({
        state,
        parent: container,
      });

      viewRef.current = view;

      // Forward scroll events from CodeMirror's scroll DOM
      const scrollDom = view.scrollDOM;
      const handleScroll = () => onScrollRef.current?.();
      scrollDom.addEventListener("scroll", handleScroll, { passive: true });

      // Forward keydown events for parent components (e.g., ArrowUp to jump to title)
      const contentDom = view.contentDOM;
      const handleKeyDown = (event: KeyboardEvent) => onKeyDownRef.current?.(event);
      contentDom.addEventListener("keydown", handleKeyDown);

      return () => {
        scrollDom.removeEventListener("scroll", handleScroll);
        contentDom.removeEventListener("keydown", handleKeyDown);
        view.destroy();
        viewRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Watch theme changes and reconfigure compartments
    useEffect(() => {
      const observer = new MutationObserver(() => {
        const view = viewRef.current;
        if (!view) return;
        const dark = isDarkTheme();
        view.dispatch({
          effects: [
            themeCompartment.current.reconfigure(createCodemirrorBaseTheme(dark)),
            highlightCompartment.current.reconfigure(getSyntaxHighlighting(dark)),
          ],
        });
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      return () => observer.disconnect();
    }, []);

    // Sync disabled state
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: [editableCompartment.current.reconfigure(EditorView.editable.of(!disabled))],
      });
    }, [disabled]);

    // Sync external value changes (e.g., loading a different note)
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const currentValue = view.state.doc.toString();
      if (value !== currentValue) {
        isUpdatingRef.current = true;
        view.dispatch({
          changes: { from: 0, to: currentValue.length, insert: value ?? "" },
        });
        isUpdatingRef.current = false;
      }
    }, [value]);

    // Sync font size via CSS custom property
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      container.style.setProperty("--cm-font-size", `${fontSize}px`);
    }, [fontSize]);

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          viewRef.current?.focus();
        },
        getScrollTop(): number {
          return viewRef.current?.scrollDOM.scrollTop ?? 0;
        },
        setScrollTop(top: number): void {
          const view = viewRef.current;
          if (view) view.scrollDOM.scrollTop = top;
        },
        getMaxScrollTop(): number {
          const view = viewRef.current;
          if (!view) return 0;
          return view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
        },
        scrollToLine(lineNumber: number): void {
          const view = viewRef.current;
          if (!view) return;
          const doc = view.state.doc;
          if (lineNumber >= doc.lines) return;
          const line = doc.line(lineNumber + 1); // CodeMirror lines are 1-based
          // Get the vertical position of the target line within the scroll DOM
          const lineTop = view.lineBlockAt(line.from).top;
          view.scrollDOM.scrollTop = lineTop;
        },
        getSelectionRange(): { from: number; to: number } {
          const view = viewRef.current;
          if (!view) return { from: 0, to: 0 };
          const { from, to } = view.state.selection.main;
          return { from, to };
        },
        setSelectionRange(from: number, to: number): void {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({
            selection: { anchor: from, head: to },
          });
          view.focus();
        },
        insertAtCursor(text: string): void {
          const view = viewRef.current;
          if (!view) return;
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: text },
          });
          view.focus();
        },
        runUndo(): boolean {
          const view = viewRef.current;
          if (!view) return false;
          return undo(view);
        },
      }),
      [],
    );

    const containerStyle: React.CSSProperties = {
      fontSize: `${fontSize}px`,
      height: "100%",
      width: "100%",
    };

    return (
      <div
        ref={containerRef}
        className={className}
        style={containerStyle}
        data-codemirror-editor="true"
      />
    );
  },
);
