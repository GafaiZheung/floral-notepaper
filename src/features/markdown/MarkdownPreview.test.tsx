import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { MarkdownPreview, routeExternalLink } from "./MarkdownPreview";
import { openUrl } from "@tauri-apps/plugin-opener";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("MarkdownPreview", () => {
  test("marks rendered Markdown content as selectable", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content="# 花笺\n\n正文" />);

    expect(markup).toContain("markdown-selectable");
    expect(markup).toContain("<h1");
    expect(markup).toContain("花笺");
    expect(markup).toContain("正文");
  });

  test("keeps code block controls outside the horizontally scrollable pre", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"```text\nvery long code line\n```"} />,
    );

    const preCloseIndex = markup.indexOf("</pre>");
    const buttonIndex = markup.indexOf("<button");

    expect(markup).toContain("markdown-code-block");
    expect(markup).toContain("markdown-code-scroll");
    expect(preCloseIndex).toBeGreaterThan(-1);
    expect(buttonIndex).toBeGreaterThan(preCloseIndex);
  });

  test("routes http links through onExternalLink when provided", () => {
    const onExternalLink = vi.fn();
    routeExternalLink("https://example.com", onExternalLink);
    expect(onExternalLink).toHaveBeenCalledWith("https://example.com");
    expect(openUrl).not.toHaveBeenCalled();
  });

  test("falls back to openUrl when onExternalLink is absent", () => {
    const onExternalLink = vi.fn();
    routeExternalLink("https://example.com", undefined);
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    expect(onExternalLink).not.toHaveBeenCalled();

    const markup = renderToStaticMarkup(<MarkdownPreview content="[链接](https://example.com)" />);
    expect(markup).toContain('href="https://example.com"');
  });
});
