"use client";

import { useState } from "react";
import { baseMimeType, mergeClips, pickRecorderMimeType } from "@/lib/merge-clips";
import { createClient } from "@/lib/supabase/client";
import { uploadVideo } from "@/lib/upload-video";


/** Records a synthetic clip (animated canvas + near-silent tone) with the same MediaRecorder setup the real recorder uses. */
async function recordSyntheticClip(seconds: number, label: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 360; canvas.height = 640;
  const ctx = canvas.getContext("2d")!;
  let frame = 0, raf = 0;
  const draw = () => {
    ctx.fillStyle = `hsl(${(frame * 3) % 360} 70% 40%)`; ctx.fillRect(0, 0, 360, 640);
    ctx.fillStyle = "#fff"; ctx.font = "bold 64px sans-serif"; ctx.fillText(label, 40, 320); ctx.fillText(String(frame), 40, 420);
    frame++; raf = requestAnimationFrame(draw);
  };
  draw();
  const stream = canvas.captureStream(30);
  const ac = new AudioContext();
  const osc = ac.createOscillator(); const gain = ac.createGain(); gain.gain.value = 0.01;
  const dest = ac.createMediaStreamDestination(); osc.connect(gain).connect(dest); osc.start();
  stream.addTrack(dest.stream.getAudioTracks()[0]);
  const mime = pickRecorderMimeType();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
  rec.start();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  rec.stop(); await stopped;
  cancelAnimationFrame(raf); osc.stop(); await ac.close(); stream.getTracks().forEach((t) => t.stop());
  return new Blob(chunks, { type: baseMimeType(rec.mimeType || mime) || "video/webm" });
}

export default function MergeTest() {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const log = (s: string) => setLines((l) => [...l, s]);

  async function run(upload: boolean) {
    setBusy(true); setLines([]);
    try {
      log(`MediaRecorder picks: ${pickRecorderMimeType() || "(default)"}`);
      const clips = [await recordSyntheticClip(1.5, "A"), await recordSyntheticClip(1.5, "B")];
      log(`clips: ${clips.map((c) => `${c.type} ${c.size}B`).join(" | ")}`);
      const t0 = performance.now();
      const merged = await mergeClips(clips);
      log(`merged: ${merged.type} ${merged.size}B in ${Math.round(performance.now() - t0)}ms`);
      const v = document.createElement("video");
      v.src = URL.createObjectURL(merged);
      await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error("merged video failed to load")); });
      log(`merged metadata: ${v.videoWidth}x${v.videoHeight}, ${v.duration.toFixed(2)}s`);
      if (upload) {
        const supabase = createClient();
        let { data: { session } } = await supabase.auth.getSession();
        if (!session) { const { data } = await supabase.auth.signInAnonymously(); session = data.session; }
        const id = await uploadVideo(supabase, session!.user.id, merged, { areaId: null, script: null, uploaderName: "dev-merge-test" }, (p) => log(`upload ${p}%`));
        log(`uploaded: video ${id}`);
      }
      log("RESULT: PASS");
    } catch (e) {
      log(`RESULT: FAIL ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-bold">Recorder pipeline self-test</h1>
      <p className="text-sm text-muted">Records two synthetic clips with MediaRecorder, merges them with ffmpeg.wasm, optionally uploads the result.</p>
      <div className="mt-4 flex gap-2">
        <button id="run-merge" className="btn-primary" disabled={busy} onClick={() => run(false)}>Merge only</button>
        <button id="run-upload" className="btn-secondary" disabled={busy} onClick={() => run(true)}>Merge + upload</button>
      </div>
      <pre id="log" className="card mt-4 whitespace-pre-wrap text-xs">{lines.join("\n")}</pre>
    </main>
  );
}
