import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WysiwygEditor } from "./WysiwygEditor";

// 预览组件已懒加载（MarkdownPreviewLazy），SSR 场景下 lazy 只渲染 Suspense
// fallback。这里 mock 掉懒加载边界，验证 WysiwygEditor 正确地把块内容
// 传给预览组件；真实渲染链由 MarkdownPreview.test.tsx 覆盖。
vi.mock("../features/markdown/MarkdownPreviewLazy", () => ({
  MarkdownPreviewLazy: ({ content }: { content: string }) => (
    <div className="markdown-preview-mock">{content}</div>
  ),
}));

describe("WysiwygEditor", () => {
  test("renders mode switch buttons", () => {
    const markup = renderToStaticMarkup(<WysiwygEditor content="# Hello" onChange={() => {}} />);
    expect(markup).toContain("阅读编辑");
    expect(markup).toContain("源码编辑");
  });

  test("renders toolbar buttons", () => {
    const markup = renderToStaticMarkup(<WysiwygEditor content="# Hello" onChange={() => {}} />);
    // Toolbar button labels are present in the DOM
    expect(markup).toContain("粗体");
    expect(markup).toContain("标题");
  });

  test("renders markdown preview in reading mode", () => {
    const markup = renderToStaticMarkup(
      <WysiwygEditor content="## Test Heading" onChange={() => {}} />,
    );
    expect(markup).toContain("Test Heading");
  });

  test("shows placeholder with empty content in reading mode", () => {
    const markup = renderToStaticMarkup(
      <WysiwygEditor content="" onChange={() => {}} placeholder="写点什么……" />,
    );
    expect(markup).toContain("写点什么……");
  });

  test("renders RenderedBlock wrappers in reading mode", () => {
    const markup = renderToStaticMarkup(
      <WysiwygEditor content="## Hello\n\nWorld." onChange={() => {}} />,
    );
    expect(markup).toContain("rendered-block");
  });

  test("renders code blocks in reading mode", () => {
    const markup = renderToStaticMarkup(
      <WysiwygEditor content="```js\nconsole.log('hi')\n```" onChange={() => {}} />,
    );
    expect(markup).toContain("console.log");
  });
});
