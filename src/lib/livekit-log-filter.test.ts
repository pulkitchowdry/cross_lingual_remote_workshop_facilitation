import { describe, expect, it, vi } from "vitest";
import { wrapConsoleError } from "@/lib/livekit-log-filter";

describe("wrapConsoleError", () => {
  it("redirects the known-benign track-dimensions message to debug instead of error", () => {
    const original = vi.fn();
    const debug = vi.fn();
    const wrapped = wrapConsoleError(original, debug);

    wrapped("could not determine track dimensions, using defaults", { dims: { width: 1280, height: 720 } });

    expect(original).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith("[livekit]", "could not determine track dimensions, using defaults", {
      dims: { width: 1280, height: 720 },
    });
  });

  it("passes every other error through to the original console.error unchanged", () => {
    const original = vi.fn();
    const debug = vi.fn();
    const wrapped = wrapConsoleError(original, debug);
    const error = new Error("boom");

    wrapped("some other real LiveKit error", error);

    expect(debug).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledWith("some other real LiveKit error", error);
  });

  it("passes through non-string first arguments unchanged", () => {
    const original = vi.fn();
    const debug = vi.fn();
    const wrapped = wrapConsoleError(original, debug);
    const error = new Error("boom");

    wrapped(error);

    expect(debug).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledWith(error);
  });
});
