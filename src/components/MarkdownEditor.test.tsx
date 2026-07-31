import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor", () => {
  test("renders a container with the codemirror data attribute", () => {
    const markup = renderToStaticMarkup(<MarkdownEditor value="# Hello" />);

    expect(markup).toContain('data-codemirror-editor="true"');
    expect(markup).not.toContain("<textarea");
  });

  test("accepts font size prop and sets it as inline style", () => {
    const markup = renderToStaticMarkup(<MarkdownEditor value="test" fontSize={18} />);

    expect(markup).toContain("font-size:18px");
  });

  test("accepts a custom className", () => {
    const markup = renderToStaticMarkup(
      <MarkdownEditor value="test" className="my-custom-class" />,
    );

    expect(markup).toContain("my-custom-class");
  });
});
