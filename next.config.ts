import type { NextConfig } from "next";

/** The render step (src/lib/render.ts) runs ffmpeg from the ffmpeg-static package with our own fonts; both must travel with the functions that render. */
const RENDER_FILES = ["./node_modules/ffmpeg-static/**/*", "./assets/fonts/**/*"];

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/videos/\\[id\\]/render": RENDER_FILES,
    "/api/cron/publish": RENDER_FILES,
  },
};

export default nextConfig;
