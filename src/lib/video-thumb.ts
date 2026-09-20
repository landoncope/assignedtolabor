/**
 * A small JPEG (data URL) from near the start of a video file, for videos that did not
 * come from the recorder ("Upload a video I already have"). Until 2026-09-19 those had
 * no thumbnail at all and showed as blank tiles in the review queue.
 *
 * Returns "" when this browser cannot decode the file (an iPhone's HEVC .mov in some
 * desktop browsers) or takes too long. Never throws and never blocks the upload.
 *
 * The element is put in the page and played, muted: iOS only decodes frames for a
 * video that is playing, and paints nothing from one that merely loaded its metadata.
 */
export async function thumbnailFromFile(file: Blob, width = 240, timeoutMs = 8000): Promise<string> {
  if (typeof document === "undefined") return "";
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto";
  v.setAttribute("aria-hidden", "true");
  Object.assign(v.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0.01", pointerEvents: "none" });
  const once = (event: string, ms: number) => new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    v.addEventListener(event, () => { clearTimeout(timer); resolve(true); }, { once: true });
  });
  const grab = async (): Promise<string> => {
    const meta = once("loadedmetadata", timeoutMs);
    const failed = once("error", timeoutMs + 1000).then((errored) => { if (errored) throw new Error("cannot decode"); return false; });
    v.src = url;
    document.body.appendChild(v);
    if (!(await Promise.race([meta, failed]))) return "";
    // A second in (less for very short files): the first frame is often black or blurred.
    const target = Number.isFinite(v.duration) ? Math.min(1, v.duration / 10) : 0;
    if (target > 0) { const seeked = once("seeked", 3000); v.currentTime = target; await seeked; }
    const frame = "requestVideoFrameCallback" in v
      ? new Promise<void>((resolve) => { (v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(() => resolve()); })
      : once("timeupdate", 2000).then(() => {});
    await v.play().catch(() => {});
    await Promise.race([frame, new Promise((resolve) => setTimeout(resolve, 2500))]);
    v.pause();
    if (!v.videoWidth || !v.videoHeight) return "";
    const c = document.createElement("canvas");
    c.width = width; c.height = Math.round((width * v.videoHeight) / v.videoWidth);
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  };
  try {
    return await Promise.race([grab(), new Promise<string>((resolve) => setTimeout(() => resolve(""), timeoutMs + 4000))]);
  } catch {
    return "";
  } finally {
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* ignore */ }
    v.remove();
    URL.revokeObjectURL(url);
  }
}
