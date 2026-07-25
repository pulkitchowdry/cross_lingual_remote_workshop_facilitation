import { describe, expect, it } from "vitest";
import { classifyCaptionSocketClose } from "@/lib/caption-socket-client";

describe("classifyCaptionSocketClose", () => {
  it("trusts a server-provided reason regardless of whether the socket had opened", () => {
    expect(classifyCaptionSocketClose({ code: 1011, reason: "Not authorized for this session." }, false)).toEqual({
      kind: "server-reason",
      reason: "Not authorized for this session.",
    });
    expect(classifyCaptionSocketClose({ code: 1011, reason: "Start the session before streaming captions." }, true)).toEqual(
      { kind: "server-reason", reason: "Start the session before streaming captions." },
    );
  });

  it("classifies a reasonless closure that never opened as opaque", () => {
    expect(classifyCaptionSocketClose({ code: 1006, reason: "" }, false)).toEqual({ kind: "opaque" });
  });

  it("classifies a reasonless closure after opening as a dropped connection, not opaque", () => {
    expect(classifyCaptionSocketClose({ code: 1006, reason: "" }, true)).toEqual({ kind: "dropped" });
  });
});
