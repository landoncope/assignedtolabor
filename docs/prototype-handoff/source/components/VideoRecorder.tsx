"use client";

import { useEffect, useRef, useState } from "react";

type Clip = { id: number; blob: Blob; url: string; thumb: string; secs: number };

/**
 * Multi-clip recorder. Tap the red button to record a clip, tap to stop it — each
 * clip is saved on its own, so any single clip can be deleted (the ✕ on its
 * thumbnail) without starting over. "Done" hands back ONE video: a single clip is
 * used as-is; multiple clips are stitched together in the browser (ffmpeg.wasm,
 * lazy-loaded — see lib/merge-clips.ts). Camera is released on unmount / Done /
 * Cancel. A 2s "3 tips" intro + 3-2-1 countdown runs before the first clip only.
 */
export default function VideoRecorder({
  onCapture,
  onCancel,
  showTips = true,
}: {
  onCapture: (file: File) => void;
  onCancel?: () => void;
  showTips?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const clipThumbRef = useRef<string>("");
  const clipStartRef = useRef(0);
  const clipIdRef = useRef(0);
  const firstClipRef = useRef(true); // countdown before the first clip of a session
  const tipsShownRef = useRef(true); // tips only the very first time

  const [cam, setCam] = useState<"idle" | "live" | "recording" | "error">("idle");
  const [clips, setClips] = useState<Clip[]>([]);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [tipsActive, setTipsActive] = useState(false);
  const [tipsPhase, setTipsPhase] = useState(false);
  const [merging, setMerging] = useState(false);

  const clipsRef = useRef<Clip[]>([]);
  clipsRef.current = clips;

  function teardown() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") { rec.onstop = null; try { rec.stop(); } catch {} }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  function attach(stream: MediaStream) {
    streamRef.current = stream;
    if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; videoRef.current.play().catch(() => {}); }
    setCam("live");
  }
  // Start the camera on mount; release on unmount (cancellation-safe).
  useEffect(() => {
    let cancelled = false;
    setCam("idle");
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        attach(stream);
      } catch { if (!cancelled) setCam("error"); }
    })();
    return () => { cancelled = true; teardown(); };
  }, []);
  // Release clip object URLs on unmount.
  useEffect(() => () => { clipsRef.current.forEach((c) => URL.revokeObjectURL(c.url)); }, []);
  // Duration timer for the clip being recorded.
  useEffect(() => {
    if (cam !== "recording") return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [cam]);
  // First clip: hold the tips for 2s, then fade them out as the countdown starts.
  useEffect(() => {
    if (!tipsActive || !tipsPhase) return;
    const id = setTimeout(() => { setTipsPhase(false); setCountdown(3); }, 2000);
    return () => clearTimeout(id);
  }, [tipsActive, tipsPhase]);
  // 3-2-1 countdown, then start the clip.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { setCountdown(null); setTipsActive(false); beginClip(); return; }
    const id = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  async function startCamera() {
    teardown();
    setCam("idle");
    try { attach(await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true })); }
    catch { setCam("error"); }
  }
  function pickMime() {
    const types = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    for (const t of types) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
    return "";
  }
  function captureThumb(): string {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return "";
    const w = 120, c = document.createElement("canvas");
    c.width = w; c.height = Math.round((w * v.videoHeight) / v.videoWidth);
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  }
  function beginClip() {
    if (!streamRef.current) return;
    setError(""); chunksRef.current = []; setSecs(0);
    clipThumbRef.current = captureThumb();
    clipStartRef.current = Date.now();
    const mime = pickMime(); mimeRef.current = mime;
    const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const type = mimeRef.current || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size > 0) {
        const took = Math.round((Date.now() - clipStartRef.current) / 1000);
        const clip: Clip = { id: ++clipIdRef.current, blob, url: URL.createObjectURL(blob), thumb: clipThumbRef.current, secs: took };
        setClips((cs) => [...cs, clip]);
      }
      setCam("live");
    };
    recorderRef.current = rec;
    rec.start();
    setCam("recording");
  }
  function tapRecord() {
    if (merging || countdown !== null || tipsActive) return; // busy with intro/merge
    if (cam === "error") { startCamera(); return; }
    if (cam === "recording") { recorderRef.current?.stop(); return; } // finish this clip
    if (cam === "live") {
      if (!streamRef.current) return;
      if (firstClipRef.current) {
        firstClipRef.current = false;
        const withTips = showTips && tipsShownRef.current;
        tipsShownRef.current = false;
        if (withTips) { setTipsActive(true); setTipsPhase(true); } // 2s tips → fade → countdown → beginClip
        else { setCountdown(3); }                                 // countdown → beginClip
      } else {
        beginClip(); // additional clips start immediately
      }
    }
  }
  function deleteClip(id: number) {
    setClips((cs) => {
      const c = cs.find((x) => x.id === id);
      if (c) URL.revokeObjectURL(c.url);
      return cs.filter((x) => x.id !== id);
    });
  }
  function startOver() {
    teardown();
    clips.forEach((c) => URL.revokeObjectURL(c.url));
    setClips([]); setCountdown(null); setTipsActive(false); setTipsPhase(false);
    setSecs(0); setError(""); setMerging(false);
    firstClipRef.current = true;
    startCamera();
  }
  function fileFromBlob(blob: Blob): File {
    const type = blob.type || "video/webm";
    const ext = type.includes("mp4") ? "mp4" : type.includes("quicktime") ? "mov" : "webm";
    return new File([blob], `recording-${Date.now()}.${ext}`, { type });
  }
  async function done() {
    if (merging || clips.length === 0 || cam === "recording") return;
    if (clips.length === 1) { teardown(); onCapture(fileFromBlob(clips[0].blob)); return; }
    setMerging(true); setError("");
    try {
      const { mergeClips } = await import("@/lib/merge-clips");
      const file = await mergeClips(clips.map((c) => c.blob));
      teardown();
      onCapture(file);
    } catch {
      setMerging(false);
      setError("Couldn't combine your clips — please try again.");
    }
  }

  const recording = cam === "recording";
  const hasContent = clips.length > 0 || recording;
  const doneDisabled = clips.length === 0 || recording || merging;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
      <div style={{ position: "relative", flex: 1, minHeight: 240, borderRadius: 18, overflow: "hidden", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: cam === "error" ? "none" : "block" }} />
        {cam === "error" && (
          <div style={{ color: "#9aa0a8", textAlign: "center", padding: 16, fontSize: 14, lineHeight: 1.5 }}>
            Camera unavailable.<br />Use &ldquo;Upload a file instead.&rdquo;
          </div>
        )}
        {recording && (
          <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, background: "rgba(0,0,0,.55)", color: "#fff", fontSize: 12.5, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff3b30" }} />
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          </div>
        )}
        {clips.length > 0 && (
          <div style={{ position: "absolute", bottom: 12, left: 12, display: "flex", gap: 8, maxWidth: "62%", overflowX: "auto", paddingTop: 4, paddingRight: 4 }}>
            {clips.map((c, i) => (
              <div key={c.id} style={{ position: "relative", width: 40, height: 54, borderRadius: 6, overflow: "hidden", border: "1.5px solid rgba(255,255,255,.75)", flexShrink: 0, background: "#222" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.thumb && <img src={c.thumb} alt={`Clip ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                <button onClick={() => deleteClip(c.id)} aria-label={`Delete clip ${i + 1}`} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,.85)", background: "#111", color: "#fff", fontSize: 12, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>×</button>
              </div>
            ))}
          </div>
        )}
        {cam !== "error" && !merging && (
          <button onClick={tapRecord} aria-label={recording ? "Stop clip" : "Record clip"} style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", width: 70, height: 70, borderRadius: "50%", border: "4px solid rgba(255,255,255,.9)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
            <span style={{ background: "#ff3b30", borderRadius: recording ? 7 : "50%", width: recording ? 26 : 54, height: recording ? 26 : 54, transition: "all .15s ease" }} />
          </button>
        )}
        {(countdown !== null || tipsActive) && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.64)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
            {countdown !== null && (
              <div style={{ color: "#fff", fontSize: 76, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{countdown}</div>
            )}
            {tipsActive && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, opacity: tipsPhase ? 1 : 0, transition: "opacity .55s ease", pointerEvents: "none" }}>
                <div style={{ fontSize: 11.5, letterSpacing: "1.6px", textTransform: "uppercase", color: "#ffd479", fontWeight: 700 }}>3 tips</div>
                <div style={{ color: "#fff", fontSize: 17, fontWeight: 700, lineHeight: 1.65, maxWidth: 300 }}>
                  Take a deep breath.<br />Be yourself!<br />Don&apos;t forget to smile!
                </div>
              </div>
            )}
          </div>
        )}
        {merging && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.72)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center" }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", border: "3px solid rgba(255,255,255,.25)", borderTopColor: "#fff", animation: "vrspin 0.8s linear infinite" }} />
            <div style={{ color: "#fff", fontSize: 15, fontWeight: 600 }}>Putting your clips together…</div>
            <style>{"@keyframes vrspin { to { transform: rotate(360deg); } }"}</style>
          </div>
        )}
      </div>

      {error && <p style={{ color: "#ff6b6b", fontSize: 13.5, textAlign: "center", margin: 0 }}>{error}</p>}
      {clips.length > 0 && !recording && !merging && (
        <p style={{ color: "#9aa0a8", fontSize: 12.5, textAlign: "center", margin: 0 }}>
          {clips.length} clip{clips.length > 1 ? "s" : ""} · tap ✕ on a clip to delete it, or the red button to add another
        </p>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        {hasContent && <button onClick={startOver} disabled={merging} style={{ ...recSecondaryBtn, opacity: merging ? 0.5 : 1 }}>Start over</button>}
        <button onClick={done} disabled={doneDisabled} style={{ ...recPrimaryBtn, flex: 1, opacity: doneDisabled ? 0.5 : 1 }}>{merging ? "Combining…" : "Done"}</button>
      </div>
      {onCancel && (
        <button onClick={() => { teardown(); onCancel(); }} disabled={merging} style={recLinkBtn}>Cancel</button>
      )}
    </div>
  );
}

/* Context-agnostic button colors (read on light or dark). */
const recBase: React.CSSProperties = { padding: "14px 18px", borderRadius: 13, fontSize: 15.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: "none" };
const recPrimaryBtn: React.CSSProperties = { ...recBase, background: "linear-gradient(160deg, #6cb2e8 0%, #4a93d6 100%)", color: "#fff", boxShadow: "0 10px 26px -12px rgba(74,147,214,0.6)" };
const recSecondaryBtn: React.CSSProperties = { ...recBase, background: "transparent", color: "#9aa0a8", border: "1px solid rgba(140,140,150,.45)" };
const recLinkBtn: React.CSSProperties = { background: "none", border: "none", color: "#6cb2e8", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", alignSelf: "center", padding: 6 };
