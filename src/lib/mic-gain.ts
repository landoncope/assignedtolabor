/**
 * Microphone gain for the recorder (2026-10-15).
 *
 * The recorder asks for the raw microphone (echo cancellation, noise suppression and
 * automatic gain all off, since 2026-09-17, for natural sound). On iPhones that means
 * Apple's voice-processing unit is out of the path and nothing levels the signal: the
 * 45 iPhone recordings stored by 2026-10-15 had a median loudness of -44 LUFS, 15 to
 * 25 dB under the same people on Android or in their camera app (see
 * scripts/dev/loudness-audit.mjs). WebKit sets no gain property at all, so the
 * `autoGainControl` constraint cannot help there. This module does what a camera app
 * does for itself: the microphone track goes through a gain stage and a limiter in
 * the browser's audio graph, and the recorder records the result.
 *
 *   mic -> gain -> limiter -> MediaStreamDestination -> MediaRecorder
 *
 * The gain adapts: every 100 ms the short-window level of the raw signal is read, the
 * loudest speech frame of the last two seconds is taken as "how loud this person is",
 * and the gain moves towards the value that puts it at GAIN_TARGET_DB, rising slowly
 * (6 dB per second) and dropping at once, held during silence so room noise is never
 * cranked up, and capped at GAIN_MAX_DB. iPhones start at +18 dB and Android at +6 so
 * the first words are already louder before the loop has heard anything. The limiter
 * catches the peaks. Nothing is played back, so there is no feedback.
 *
 * Everything here is in the page; nothing changes server-side, and `?gain=off` on the
 * upload page records the raw track for comparison (capture_meta says which).
 */
export const GAIN_TARGET_DB = -16;
export const GAIN_MAX_DB = 30;
export const GAIN_MIN_DB = 0;
/** Frames quieter than this (short-window RMS of the raw input) count as silence or room noise. */
export const SPEECH_GATE_DB = -58;
export const RISE_DB_PER_S = 6;
export const TICK_MS = 100;
const WINDOW_TICKS = 20; // two seconds of frames behind the speech-level estimate

export type LevelReading = { inDb: number; outDb: number; gainDb: number; reductionDb: number; running: boolean };
export type GainStats = {
  startDb: number; minDb: number; maxDb: number; endDb: number;
  /** Median short-window level of the speech frames seen, before and after the gain (dBFS). */
  inputDb: number | null; outputDb: number | null;
  /** Seconds in which the limiter was pulling the signal down by more than 1 dB. */
  limitedSeconds: number;
};
export type GainStage = {
  /** The levelled audio; give this to MediaRecorder instead of the microphone track. */
  track: MediaStreamTrack;
  /** True while the audio graph is running (it may start suspended until a tap). */
  ready(): boolean;
  /** Call from a user gesture (the record tap) so a suspended graph starts. */
  resume(): Promise<boolean>;
  read(): LevelReading;
  stats(): GainStats;
  stop(): void;
};

/** The gain to aim for given the loudest speech frame seen lately; hold during silence. */
export function planGainDb(speechPeakDb: number | null, currentDb: number): number {
  if (speechPeakDb === null) return currentDb;
  return Math.max(GAIN_MIN_DB, Math.min(GAIN_MAX_DB, GAIN_TARGET_DB - speechPeakDb));
}
/** One tick of movement: down at once, up at RISE_DB_PER_S. */
export function stepGainDb(currentDb: number, plannedDb: number, dtSeconds: number): number {
  if (plannedDb <= currentDb) return plannedDb;
  return Math.min(plannedDb, currentDb + RISE_DB_PER_S * dtSeconds);
}
/** Where a device starts before the loop has heard a word. */
export function priorGainDb(ua: string): number {
  if (/iPhone|iPad/.test(ua)) return 18;
  if (/Android/.test(ua)) return 6;
  return 0;
}
const toLinear = (db: number) => Math.pow(10, db / 20);
function rmsDb(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / Math.max(1, buf.length));
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)] * 10) / 10; };

/**
 * Builds the graph around the microphone track. Returns null (and says why through
 * `onEvent`) where the browser cannot do it; the recorder then records the raw track.
 */
export function createGainStage(mic: MediaStreamTrack, ua: string, onEvent?: (line: string) => void): GainStage | null {
  const Ctor = (typeof AudioContext !== "undefined" ? AudioContext : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) ?? null;
  if (!Ctor) { onEvent?.("mic gain unavailable: no AudioContext"); return null; }
  let ctx: AudioContext;
  let dest: MediaStreamAudioDestinationNode;
  let gain: GainNode;
  let limiter: DynamicsCompressorNode;
  let inAnalyser: AnalyserNode;
  let outAnalyser: AnalyserNode;
  const startDb = priorGainDb(ua);
  try {
    ctx = new Ctor();
    const source = ctx.createMediaStreamSource(new MediaStream([mic]));
    gain = ctx.createGain();
    gain.gain.value = toLinear(startDb);
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 2; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.08;
    inAnalyser = ctx.createAnalyser(); inAnalyser.fftSize = 2048;
    outAnalyser = ctx.createAnalyser(); outAnalyser.fftSize = 2048;
    dest = ctx.createMediaStreamDestination();
    dest.channelCount = 1; dest.channelCountMode = "explicit";
    source.connect(inAnalyser);
    source.connect(gain); gain.connect(limiter); limiter.connect(outAnalyser); limiter.connect(dest);
  } catch (e) {
    onEvent?.(`mic gain unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  const track = dest.stream.getAudioTracks()[0];
  if (!track) { onEvent?.("mic gain unavailable: no output track"); try { ctx.close(); } catch { /* ignore */ } return null; }

  let currentDb = startDb, minDb = startDb, maxDb = startDb;
  let limitedTicks = 0;
  const recent: number[] = [];
  const speechIn: number[] = [], speechOut: number[] = [];
  const buf = new Float32Array(2048);
  let last: LevelReading = { inDb: -100, outDb: -100, gainDb: startDb, reductionDb: 0, running: ctx.state === "running" };
  let resuming: Promise<boolean> | null = null;
  let stopped = false;
  let suspendedNoted = false;
  onEvent?.(`mic gain on: starting at +${startDb} dB${ctx.state !== "running" ? ` (audio graph ${ctx.state} until a tap)` : ""}`);

  const resume = (): Promise<boolean> => {
    if (stopped) return Promise.resolve(false);
    if (ctx.state === "running") return Promise.resolve(true);
    if (!resuming) resuming = ctx.resume().then(() => { resuming = null; return ctx.state === "running"; }).catch(() => { resuming = null; return false; });
    return resuming;
  };
  const timer = setInterval(() => {
    if (stopped) return;
    const running = ctx.state === "running";
    if (!running) {
      if (!suspendedNoted) { suspendedNoted = true; onEvent?.(`audio graph ${ctx.state}; trying to resume`); }
      void resume();
      last = { ...last, running: false };
      return;
    }
    if (suspendedNoted) { suspendedNoted = false; onEvent?.("audio graph running again"); }
    inAnalyser.getFloatTimeDomainData(buf);
    const inDb = rmsDb(buf);
    outAnalyser.getFloatTimeDomainData(buf);
    const outDb = rmsDb(buf);
    const reductionDb = typeof limiter.reduction === "number" ? limiter.reduction : 0;
    if (reductionDb < -1) limitedTicks++;
    recent.push(inDb); if (recent.length > WINDOW_TICKS) recent.shift();
    const speech = recent.filter((d) => d > SPEECH_GATE_DB);
    const peak = speech.length ? Math.max(...speech) : null;
    const next = stepGainDb(currentDb, planGainDb(peak, currentDb), TICK_MS / 1000);
    if (next !== currentDb) {
      currentDb = next;
      gain.gain.setTargetAtTime(toLinear(currentDb), ctx.currentTime, 0.05);
      if (currentDb < minDb) minDb = currentDb;
      if (currentDb > maxDb) maxDb = currentDb;
    }
    if (inDb > SPEECH_GATE_DB && speechIn.length < 6000) { speechIn.push(inDb); speechOut.push(outDb); }
    last = { inDb, outDb, gainDb: currentDb, reductionDb, running: true };
  }, TICK_MS);

  return {
    track,
    ready: () => !stopped && ctx.state === "running",
    resume,
    read: () => last,
    stats: () => ({
      startDb, minDb: Math.round(minDb * 10) / 10, maxDb: Math.round(maxDb * 10) / 10, endDb: Math.round(currentDb * 10) / 10,
      inputDb: median(speechIn), outputDb: median(speechOut), limitedSeconds: Math.round(limitedTicks * TICK_MS / 100) / 10,
    }),
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try { track.stop(); } catch { /* ignore */ }
      ctx.close().catch(() => {});
    },
  };
}
