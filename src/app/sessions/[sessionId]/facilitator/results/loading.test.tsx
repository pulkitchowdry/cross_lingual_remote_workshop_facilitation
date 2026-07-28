import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ResultsLoading from "./loading";

describe("ResultsLoading", () => {
  it("renders a localized-neutral skeleton instead of hardcoded loading copy", () => {
    const html = renderToStaticMarkup(<ResultsLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading session results"');
    expect(html).toContain("bg-surface-raised");
    expect(html).not.toContain("Loading session results...");
  });
});
