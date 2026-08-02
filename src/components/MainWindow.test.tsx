import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { MainWindow, pinTileButtonTitle, runEditorUndo } from "./MainWindow";

describe("MainWindow settings", () => {
  test("can render the settings panel with the loaded config", () => {
    const markup = renderToStaticMarkup(
      <MainWindow
        initialSettingsOpen
        initialConfig={{
          locale: "zh-CN",
          dataDir: "D:\\Notes\\花笺",
          notesDir: "D:\\Notes\\花笺",
          notesDirs: ["D:\\Notes\\花笺"],
          globalShortcut: "Ctrl+Space",
          closeToTray: true,
          autostart: false,
          defaultViewMode: "split",
          noteAutoSave: true,
          noteSurfaceAutoSave: true,
          tileColor: "#f6f3ec",
          tileColorMode: "system",
          theme: "light",
          fontSize: 14,
          surfaceFontSize: 14,
          tabIndentSize: 2,
          externalFileAutoSave: true,
          aiEnabled: false,
          aiApiKey: "",
          aiApiEndpoint: "https://api.deepseek.com",
          aiModel: "deepseek-v4-pro",
          aiFimEndpoint: "https://api.deepseek.com/beta",
          aiTitleModel: "deepseek-v4-flash",
          aiTitlePrompt: "",
          aiContinuePrompt: "",
          aiFimPrompt: "",
          aiFormatModel: "deepseek-v4-flash",
          aiFormatPrompt: "",
          rememberSurfaceSize: true,
          tileCtrlClose: true,
          tileDoubleClickToEdit: false,
          tileSaveReturnsToPin: false,
          toggleVisibilityShortcut: "",
          tileRenderMarkdown: false,
          renderHtmlMarkdown: false,
          splitScrollSync: true,
          openAtCursor: true,
        }}
      />,
    );

    expect(markup).toContain("通用");
    expect(markup).toContain("编辑器");
    expect(markup).toContain("D:\\Notes\\花笺");
    const isMacOS = /Mac/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform);
    expect(markup).toContain(isMacOS ? "关闭窗口后保持后台运行" : "关闭到托盘");
  });

  test("keeps draggable window chrome on the default arrow cursor", () => {
    const markup = renderToStaticMarkup(<MainWindow />);

    expect(markup).toContain("cursor-default");
    expect(markup).not.toContain("cursor-grab");
    expect(markup).not.toContain("cursor-grabbing");
  });

  test("does not mount the browser extension while it is closed", () => {
    const markup = renderToStaticMarkup(<MainWindow />);

    expect(markup).not.toContain('data-testid="browser-extension"');
  });

  test("renders shortcut registration failures in the title bar", () => {
    const markup = renderToStaticMarkup(
      <MainWindow initialErrorMessage="快捷键 Command+Option+N 注册失败" />,
    );

    expect(markup).toContain("快捷键 Command+Option+N 注册失败");
  });

  test("renders the import Markdown icon as a down arrow", () => {
    const markup = renderToStaticMarkup(<MainWindow />);

    expect(markup).toContain('d="M12 3v12"');
    expect(markup).toContain('d="m7 10 5 5 5-5"');
    expect(markup).toContain('d="M5 21h14"');
    expect(markup).not.toContain('d="m7 14 5-5 5 5"');
    expect(markup).not.toContain('d="m7 8 5-5 5 5"');
  });

  test("renders the WysiwygEditor with mode switch", () => {
    const markup = renderToStaticMarkup(<MainWindow />);

    expect(markup).toContain("阅读编辑");
    expect(markup).toContain("源码编辑");
  });

  test("labels the pin button as a toggle", () => {
    expect(pinTileButtonTitle(false)).toBe("钉到屏幕");
    expect(pinTileButtonTitle(true)).toBe("取消钉屏");
  });
});

describe("MainWindow tab management", () => {
  test("renders the tab bar with new tab button", () => {
    const markup = renderToStaticMarkup(<MainWindow />);

    // The new-note action is present in the compact mode toolbar
    expect(markup).toContain("新建笔记");
  });

  test("renders no tab items when no notes are open", () => {
    const markup = renderToStaticMarkup(<MainWindow />);

    // The tab scroll container should be present but empty (no data-tab-id attributes)
    expect(markup).not.toContain("data-tab-id=");
  });

  test("renders tab scroll container", () => {
    const markup = renderToStaticMarkup(<MainWindow />);

    // Tab bar should contain overflow-x-hidden for scroll area
    expect(markup).toContain("overflow-x-hidden");
  });
});

describe("MainWindow editor undo", () => {
  test("renders undo as an icon before save in the editor action bar", () => {
    const markup = renderToStaticMarkup(<MainWindow />);

    expect(markup).toContain('aria-label="撤销"');
    expect(markup).toContain('data-testid="main-editor-undo-icon"');
    expect(markup).not.toContain(">撤销<");
    expect(markup.indexOf('aria-label="撤销"')).toBeLessThan(markup.indexOf(">保存<"));
  });

  test("runEditorUndo returns false (undo handled by CodeMirror natively)", () => {
    const editor = {
      focus: vi.fn(),
      runUndo: vi.fn(() => true),
    } as unknown as import("./MarkdownEditor").MarkdownEditorHandle;

    const undone = runEditorUndo(editor);

    // Undo is now handled natively by CodeMirror in source mode
    expect(undone).toBe(false);
  });

  test("returns false for null editor", () => {
    expect(runEditorUndo(null)).toBe(false);
  });
});
