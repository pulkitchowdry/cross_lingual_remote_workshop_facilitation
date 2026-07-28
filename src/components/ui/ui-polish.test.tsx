import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

describe("shared UI polish", () => {
  it("keeps long card titles and body text break-safe", () => {
    const longText = "SuperLongWorkshopIdentifierWithoutSpaces0123456789".repeat(3);

    const html = renderToStaticMarkup(
      <Card title={longText} eyebrow="Live" meta={longText}>
        <p>{longText}</p>
      </Card>,
    );

    expect(html).toContain("min-w-0");
    expect(html).toContain("break-words");
    expect(html).toContain(longText);
  });

  it("gives shared buttons a visible focus style and disabled affordance", () => {
    const html = renderToStaticMarkup(
      <Button type="button" disabled>
        Create session
      </Button>,
    );

    expect(html).toContain("focus-visible:outline");
    expect(html).toContain("disabled:cursor-not-allowed");
    expect(html).toContain("Create session");
  });
});
