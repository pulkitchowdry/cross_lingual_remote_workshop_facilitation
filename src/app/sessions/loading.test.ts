import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SessionsOverviewLoading from "./loading";

describe("SessionsOverviewLoading", () => {
  it("renders an accessible loading placeholder", () => {
    const html = renderToStaticMarkup(React.createElement(SessionsOverviewLoading));

    expect(html).toContain('aria-busy="true"');
  });
});
