import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0b1220";
const AMBER = "#e8622c";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background: INK,
          padding: "80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ position: "relative", width: 64, height: 64, display: "flex" }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: AMBER,
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 0,
                right: 0,
                width: 42,
                height: 42,
                borderRadius: "50%",
                border: `8px solid ${AMBER}`,
              }}
            />
          </div>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, color: "#f5f2ea" }}>
            Interlingo
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 32,
            fontSize: 32,
            color: "#b8bfcc",
            maxWidth: 900,
          }}
        >
          Cross-lingual remote workshop facilitation — live captions, translation, and
          AI-generated context.
        </div>
      </div>
    ),
    { ...size },
  );
}
