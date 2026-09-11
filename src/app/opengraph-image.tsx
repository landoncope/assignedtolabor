import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Assigned To Labor. Share your witness.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview for links to the site. */
export default async function OpenGraphImage() {
  const logo = await readFile(join(process.cwd(), "public", "brand", "logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, background: "#fafaf7", display: "flex", alignItems: "center", justifyContent: "center", gap: 64, fontFamily: "sans-serif", padding: "0 80px" }}>
        <img src={logoSrc} alt="" width={300} height={399} style={{ width: 300, height: 399 }} />
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 640 }}>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 6, color: "#c98a2f" }}>ASSIGNED TO LABOR</div>
          <div style={{ marginTop: 18, fontSize: 84, fontWeight: 800, color: "#002850", letterSpacing: -2, lineHeight: 1 }}>Share your witness.</div>
          <div style={{ marginTop: 26, fontSize: 30, color: "#6b6b70", lineHeight: 1.35 }}>
            Record a short, sincere video about your faith. A local team reviews it and shares it with people who need to hear it.
          </div>
          <div style={{ marginTop: 34, fontSize: 24, color: "#002850" }}>assignedtolabor.org</div>
        </div>
      </div>
    ),
    size,
  );
}
