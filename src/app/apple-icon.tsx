import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, background: "#1f5f8b", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="140" height="140" viewBox="0 0 64 64"><path fill="#b8892b" fillRule="evenodd" d="M32 12 50 52h-8.5l-3.9-9.5H26.4L22.5 52H14Zm0 13.5L28.6 36h6.8Z" /></svg>
      </div>
    ),
    size,
  );
}
