import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/RouteErrorFallback", () => ({
  RouteErrorFallback: ({ error }: { error: Error }) =>
    React.createElement("div", { role: "alert" }, `Recovered route error: ${error.message}`),
}));

const { default: SessionsOverviewError } = await import("./error");

describe("SessionsOverviewError", () => {
  it("uses the shared route error fallback", () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionsOverviewError, {
        error: new Error("overview failed"),
        unstable_retry: vi.fn(),
      }),
    );

    expect(html).toContain("Recovered route error: overview failed");
  });
});
