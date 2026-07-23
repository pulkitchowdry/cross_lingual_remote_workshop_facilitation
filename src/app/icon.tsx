import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const INK = "#0b1220";
const AMBER = "#e8622c";

export default function Icon() {
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
          borderRadius: 7,
        }}
      >
        <div style={{ position: "relative", width: 20, height: 20, display: "flex" }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 13,
              height: 13,
              borderRadius: "50%",
              background: AMBER,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              right: 0,
              width: 13,
              height: 13,
              borderRadius: "50%",
              border: `2.5px solid ${AMBER}`,
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}
