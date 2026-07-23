import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const INK = "#0b1220";
const AMBER = "#e8622c";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: INK,
        }}
      >
        <div style={{ position: "relative", width: 108, height: 108, display: "flex" }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 70,
              height: 70,
              borderRadius: "50%",
              background: AMBER,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              right: 0,
              width: 70,
              height: 70,
              borderRadius: "50%",
              border: `13px solid ${AMBER}`,
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}
