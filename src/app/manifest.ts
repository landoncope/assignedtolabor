import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Assigned To Labor",
    short_name: "Assigned To Labor",
    description: "Share a short video of your faith.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf7",
    theme_color: "#1f5f8b",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
