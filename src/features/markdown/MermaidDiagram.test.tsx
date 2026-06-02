import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { MermaidDiagram } from "./MermaidDiagram";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

describe("MermaidDiagram", () => {
  test("renders the initial 'rendering' placeholder before mermaid resolves", () => {
    const markup = renderToStaticMarkup(<MermaidDiagram chart="graph TD\nA-->B" />);

    expect(markup).toContain("渲染图表中…");
  });

  test("calls mermaid.initialize at most once across renders", async () => {
    const { default: mermaid } = await import("mermaid");

    vi.mocked(mermaid.initialize).mockClear();

    renderToStaticMarkup(<MermaidDiagram chart="graph TD\nA-->B" />);
    renderToStaticMarkup(<MermaidDiagram chart="flowchart LR\nC-->D" />);

    const callCount = vi.mocked(mermaid.initialize).mock.calls.length;
    expect(callCount).toBeLessThanOrEqual(1);
  });

  test("renders the initial loading placeholder structure", () => {
    const markup = renderToStaticMarkup(<MermaidDiagram chart="flowchart LR\nA-->B" />);

    expect(markup).toContain("渲染图表中…");
    expect(markup).toContain("text-ink-ghost");
  });

  test("renders nothing dangerous in the initial state", () => {
    const markup = renderToStaticMarkup(<MermaidDiagram chart={"<script>alert('xss')</script>"} />);

    expect(markup).not.toContain("<script>");
    expect(markup).toContain("渲染图表中…");
  });
});
