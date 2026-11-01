/**
 * Captions drawn into the posted video (2026-11-01, Travis's request): the words
 * ElevenLabs Scribe times for us are grouped into short cues, which the lead reads and
 * corrects on the review page before the post, and which src/lib/render.ts draws into
 * the file. Pure functions, shared by the server and the browser preview.
 */
export type Word = { t: string; s: number; e: number };
/** The headline drawn at the top of the video: a few words. */
export const MAX_HEADLINE = 60;
export type Cue = { s: number; e: number; text: string };

/** Languages written without spaces between words (Scribe's ISO 639-3 codes, plus 639-1). */
const NO_SPACE = /^(zho|cmn|yue|jpn|kor|chi|zh|ja|ko)\b/i;
export function noSpaces(lang: string | null | undefined): boolean {
  return !!lang && NO_SPACE.test(lang);
}

/** At most this many characters (two lines at the drawn size: Inter Bold 72 px on a 1080 frame fits about 22 a line) or seconds in one cue. */
const MAX_CHARS = 44;
const MAX_CHARS_CJK = 22;
const MAX_SECONDS = 3.5;
/** A cue appears a little before its first word and stays a little after its last. */
const LEAD_IN = 0.1;
const HOLD = 0.45;
const GAP = 0.02;
const round = (n: number) => Math.round(n * 100) / 100;

/** Group timed words into cues: short, at most two lines, breaking after a sentence. */
export function cuesFromWords(words: Word[], lang: string | null | undefined): Cue[] {
  const cjk = noSpaces(lang);
  const sep = cjk ? "" : " ";
  const maxChars = cjk ? MAX_CHARS_CJK : MAX_CHARS;
  const text = (ws: Word[]) => ws.map((w) => w.t.trim()).filter(Boolean).join(sep);
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    if (!w.t.trim() || !(w.e >= w.s)) continue;
    const cand = [...cur, w];
    const last = cur[cur.length - 1];
    const endsSentence = !!last && /[.!?。！？]["”’)]?$/.test(last.t) && text(cur).length > 18;
    if (cur.length && (text(cand).length > maxChars || w.e - cand[0].s > MAX_SECONDS || endsSentence)) { groups.push(cur); cur = [w]; }
    else cur = cand;
  }
  if (cur.length) groups.push(cur);
  return groups.map((g, i) => {
    const s = Math.max(0, g[0].s - LEAD_IN);
    let e = g[g.length - 1].e + HOLD;
    const next = groups[i + 1];
    if (next) e = Math.min(e, Math.max(0, next[0].s - LEAD_IN) - GAP);
    return { s: round(s), e: round(Math.max(e, s + 0.3)), text: text(g) };
  });
}

/** The cue showing at `t` seconds, for the preview. */
export function cueAt(cues: Cue[], t: number): Cue | null {
  for (const c of cues) { if (t >= c.s && t < c.e) return c; if (c.s > t) break; }
  return null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function isCueList(v: unknown): v is Cue[] {
  return Array.isArray(v) && v.every((c) => c && typeof c === "object" && isNum((c as Cue).s) && isNum((c as Cue).e) && typeof (c as Cue).text === "string");
}
export function isWordList(v: unknown): v is Word[] {
  return Array.isArray(v) && v.every((w) => w && typeof w === "object" && isNum((w as Word).s) && isNum((w as Word).e) && typeof (w as Word).t === "string");
}

/** Scribe's `words` (type "word" entries, with spacing and audio events dropped) -> ours. */
export function wordsFromScribe(raw: unknown): Word[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Word[] = [];
  for (const w of raw as Record<string, unknown>[]) {
    if (!w || (w.type !== undefined && w.type !== "word")) continue;
    if (typeof w.text !== "string" || !isNum(w.start) || !isNum(w.end)) continue;
    out.push({ t: w.text, s: round(w.start), e: round(w.end) });
  }
  return out;
}

/** The cue texts the lead typed, with the stored timings kept. */
export function retextCues(cues: Cue[], texts: string[]): Cue[] {
  return cues.map((c, i) => ({ ...c, text: (texts[i] ?? c.text).replace(/\s+/g, " ").trim().slice(0, 140) }));
}
