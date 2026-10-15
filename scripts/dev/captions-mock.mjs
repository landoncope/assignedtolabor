// A stand-in for ElevenLabs Scribe and the Claude Messages API, for testing the caption
// sweep without spending anything (scripts/dev/captions-check.mjs drives it).
//   node scripts/dev/captions-mock.mjs [port]      (default 3997, on 127.0.0.1 only)
// Point the app at it with ELEVENLABS_BASE and ANTHROPIC_BASE = http://127.0.0.1:3997
// (and any ELEVENLABS_API_KEY / ANTHROPIC_API_KEY). The transcription HEADs the
// source_url it is given, like the real service fetching the file. Switches, one-shot
// unless noted: /__config?stt=quota|fail|empty  /__config?claude=garbage|overloaded
// GET /__state shows what happened; POST /__reset clears it.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 3997);
const TRANSCRIPT = "Kumusta po. Gusto ko lang ibahagi na ang panalangin ang nagbigay sa akin ng kapayapaan nang mawalan ako ng trabaho. Hindi ako nag-iisa. Subukan ninyo ring manalangin ngayong gabi.";
const state = { stt: [], claude: [], fetched: [], next: { stt: null, claude: null } };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); });
const field = (body, name) => { const m = body.match(new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`)); return m ? m[1] : null; };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const p = url.pathname;
  log(req.method, p);
  if (p === "/__state") return json(res, 200, state);
  if (p === "/__reset") { state.stt = []; state.claude = []; state.fetched = []; state.next = { stt: null, claude: null }; return json(res, 200, { ok: true }); }
  if (p === "/__config") {
    if (url.searchParams.has("stt")) state.next.stt = url.searchParams.get("stt") || null;
    if (url.searchParams.has("claude")) state.next.claude = url.searchParams.get("claude") || null;
    return json(res, 200, state.next);
  }

  if (p === "/v1/speech-to-text" && req.method === "POST") {
    if (!req.headers["xi-api-key"]) return json(res, 401, { detail: { status: "missing_api_key", message: "No API key" } });
    const body = await readBody(req);
    const call = { model_id: field(body, "model_id"), source_url: field(body, "source_url"), diarize: field(body, "diarize"), tag_audio_events: field(body, "tag_audio_events") };
    state.stt.push(call);
    const mode = state.next.stt; state.next.stt = null;
    if (mode === "quota") return json(res, 402, { detail: { status: "quota_exceeded", message: "You have exceeded your transcription quota for this period." } });
    if (mode === "fail") return json(res, 422, { detail: [{ loc: ["body", "source_url"], msg: "Could not download the file", type: "value_error" }] });
    if (!call.source_url) return json(res, 422, { detail: [{ loc: ["body"], msg: "Either file or source_url is required", type: "value_error" }] });
    try {
      const r = await fetch(call.source_url); const buf = r.ok ? await r.arrayBuffer() : new ArrayBuffer(0);
      state.fetched.push({ url: call.source_url.split("?")[0], status: r.status, bytes: buf.byteLength });
      if (!r.ok) return json(res, 422, { detail: [{ loc: ["body", "source_url"], msg: `Could not download the file (HTTP ${r.status})`, type: "value_error" }] });
    } catch (e) {
      return json(res, 422, { detail: [{ loc: ["body", "source_url"], msg: `Could not download the file (${e.message})`, type: "value_error" }] });
    }
    if (mode === "empty") return json(res, 200, { language_code: "eng", language_probability: 0.2, text: "", words: [], audio_duration_secs: 2 });
    return json(res, 200, { language_code: "tgl", language_probability: 0.98, text: TRANSCRIPT, words: [], audio_duration_secs: 8, transcription_id: `mock-${state.stt.length}` });
  }

  if (p === "/v1/messages" && req.method === "POST") {
    if (!req.headers["x-api-key"]) return json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    const b = JSON.parse(await readBody(req) || "{}");
    const user = (b.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
    state.claude.push({ model: b.model, systemChars: (b.system ?? "").length, user });
    const mode = state.next.claude; state.next.claude = null;
    if (mode === "overloaded") return json(res, 529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    const text = mode === "garbage"
      ? "I'm sorry, I can't help with that."
      : JSON.stringify({ caption: "“Hindi ako nag-iisa.” Ibinahagi ni Maria kung paano siya binigyan ng kapayapaan ng panalangin nang mawalan siya ng trabaho. Subukan ninyo ring manalangin ngayong gabi.\n\n#panalangin #pananampalataya #LiwanagNiKristo #Pilipinas", summary: "Maria says prayer gave her peace after losing her job and invites viewers to pray tonight." });
    return json(res, 200, { id: `msg_mock_${state.claude.length}`, type: "message", role: "assistant", model: b.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 120 } });
  }

  json(res, 404, { error: `mock: no route for ${req.method} ${p}` });
}).listen(port, "127.0.0.1", () => log(`captions mock on http://127.0.0.1:${port}`));
