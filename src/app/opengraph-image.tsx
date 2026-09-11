import { ImageResponse } from "next/og";

export const alt = "Assigned To Labor. Share your witness.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview for links to the site. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, background: "#fafaf7", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: "#1f5f8b", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="44" height="44" viewBox="0 0 64 64"><path fill="#b8892b" fillRule="evenodd" d="M32 12 50 52h-8.5l-3.9-9.5H26.4L22.5 52H14Zm0 13.5L28.6 36h6.8Z" /></svg>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 6, color: "#b8892b" }}>ASSIGNED TO LABOR</div>
        </div>
        <div style={{ marginTop: 36, fontSize: 92, fontWeight: 800, color: "#1c1c1e", letterSpacing: -2 }}>Share your witness.</div>
        <div style={{ marginTop: 22, fontSize: 34, color: "#6b6b70", textAlign: "center", maxWidth: 900 }}>
          Record a short, sincere video about your faith. A local team reviews it and shares it with people who need to hear it.
        </div>
        <div style={{ marginTop: 48, fontSize: 26, color: "#1f5f8b" }}>assignedtolabor.org</div>
      </div>
    ),
    size,
  );
}
