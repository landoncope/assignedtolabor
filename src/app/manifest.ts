import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Assigned To Labor",
    short_name: "Assigned To Labor",
    description: "Share a short video of your faith.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf7",
    theme_color: "#002850",
    icons: [
      { src: "/brand/ear.png", sizes: "256x256", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
