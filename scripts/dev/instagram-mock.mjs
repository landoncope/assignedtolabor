// A stand-in for Instagram's login and Graph endpoints, for testing the connect and
// publish flows without a real account (scripts/dev/instagram-flow-check.mjs drives it).
//   node scripts/dev/instagram-mock.mjs [port]      (default 3998, on 127.0.0.1 only)
// Point the app at it with INSTAGRAM_AUTHORIZE_BASE, INSTAGRAM_OAUTH_BASE and
// INSTAGRAM_GRAPH_BASE all = http://127.0.0.1:3998 (and any INSTAGRAM_APP_ID / _SECRET).
// Behaviour: a container is IN_PROGRESS for two status checks, then FINISHED; a caption
// containing MOCKFAIL ends in ERROR instead; media_publish on an unfinished container is
// refused like the real API. GET /__state shows what happened.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 3998);
const APP_ID = process.env.INSTAGRAM_APP_ID ?? "mock-app-id";
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET ?? "mock-app-secret";
const IG_USER_ID = "17841400000000001";
const APP_SCOPED_ID = "9000000000000001";
const state = { codes: 0, tokens: 0, containers: new Map(), media: new Map(), fetched: [], calls: [], badcode: false };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const oauthError = (res, status, message, code) => json(res, status, { error: { message, type: "OAuthException", code } });
const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); });
const validToken = (t) => typeof t === "string" && (t.startsWith("long-") || t.startsWith("short-"));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const params = Object.fromEntries(url.searchParams);
  const body = req.method === "POST" ? Object.fromEntries(new URLSearchParams(await readBody(req))) : {};
  const p = url.pathname.replace(/^\/v\d+\.\d+/, "");
  state.calls.push(`${req.method} ${url.pathname}`);
  log(req.method, url.pathname);

  if (p === "/__state") return json(res, 200, { ...state, containers: [...state.containers.values()], media: [...state.media.values()] });
  // Test switches: /__config?badcode=1 makes the next login hand back a code the token exchange rejects.
  if (p === "/__config") { state.badcode = params.badcode === "1"; return json(res, 200, { badcode: state.badcode }); }

  // Login dialog: send the browser straight back with a code (or an error with ?deny=1).
  if (p === "/oauth/authorize") {
    if (params.client_id !== APP_ID) return json(res, 400, { error_message: "Invalid client_id" });
    const back = new URL(params.redirect_uri);
    if (params.deny === "1") { back.searchParams.set("error", "access_denied"); back.searchParams.set("error_description", "The user denied your request."); }
    else { back.searchParams.set("code", state.badcode ? "NOTACODE" : `MOCKCODE-${++state.codes}`); back.searchParams.set("state", params.state ?? ""); back.hash = "_"; state.badcode = false; }
    res.writeHead(302, { location: back.toString() }); return res.end();
  }
  if (p === "/oauth/access_token" && req.method === "POST") {
    if (body.client_id !== APP_ID || body.client_secret !== APP_SECRET) return oauthError(res, 400, "Invalid platform app", 10);
    if (!/^MOCKCODE-\d+$/.test(body.code ?? "")) return json(res, 400, { error_type: "OAuthException", code: 400, error_message: "Invalid authorization code" });
    return json(res, 200, { data: [{ access_token: `short-${++state.tokens}`, user_id: IG_USER_ID, permissions: "instagram_business_basic,instagram_business_content_publish" }] });
  }
  if (p === "/access_token") {
    if (params.grant_type !== "ig_exchange_token" || params.client_secret !== APP_SECRET || !validToken(params.access_token)) return oauthError(res, 400, "Invalid token exchange", 190);
    return json(res, 200, { access_token: `long-${++state.tokens}`, token_type: "bearer", expires_in: 5184000 });
  }
  if (p === "/refresh_access_token") {
    if (params.grant_type !== "ig_refresh_token" || !validToken(params.access_token)) return oauthError(res, 400, "Invalid refresh", 190);
    return json(res, 200, { access_token: `long-${++state.tokens}`, token_type: "bearer", expires_in: 5184000 });
  }

  // Graph API: everything below needs a token.
  const token = params.access_token ?? body.access_token;
  if (!validToken(token)) return oauthError(res, 400, "Invalid OAuth access token - Cannot parse access token", 190);

  if (p === "/me" && req.method === "GET") return json(res, 200, { id: APP_SCOPED_ID, user_id: IG_USER_ID, username: "atl_mock_team", account_type: "BUSINESS", name: "Mock Team" });
  if ((p === "/me/media" || p === `/${IG_USER_ID}/media`) && req.method === "POST") {
    if (body.media_type !== "REELS") return oauthError(res, 400, "Only REELS are mocked", 100);
    if (!body.video_url) return oauthError(res, 400, "video_url is required", 100);
    let fetchStatus = null;
    try { const r = await fetch(body.video_url, { method: "HEAD" }); fetchStatus = r.status; state.fetched.push({ url: body.video_url.slice(0, 80), status: r.status, length: r.headers.get("content-length") }); }
    catch (e) { state.fetched.push({ url: body.video_url.slice(0, 80), error: String(e) }); }
    if (fetchStatus !== 200) return oauthError(res, 400, `The video file could not be fetched (HTTP ${fetchStatus ?? "error"})`, 9004);
    const id = `c-${state.containers.size + 1}`;
    state.containers.set(id, { id, caption: body.caption ?? "", checks: 0, status_code: "IN_PROGRESS", fail: /MOCKFAIL/.test(body.caption ?? "") });
    return json(res, 200, { id });
  }
  if (/^\/c-\d+$/.test(p) && req.method === "GET") {
    const c = state.containers.get(p.slice(1));
    if (!c) return oauthError(res, 400, "Unsupported get request. Object does not exist", 100);
    c.checks += 1;
    if (c.status_code === "IN_PROGRESS" && c.checks >= 2) c.status_code = c.fail ? "ERROR" : "FINISHED";
    return json(res, 200, { id: c.id, status_code: c.status_code, status: c.status_code === "ERROR" ? "Error: The video format is not supported." : c.status_code === "IN_PROGRESS" ? "In progress" : "Finished" });
  }
  if ((p === "/me/media_publish" || p === `/${IG_USER_ID}/media_publish`) && req.method === "POST") {
    const c = state.containers.get(body.creation_id ?? "");
    if (!c) return oauthError(res, 400, "Invalid creation_id", 100);
    if (c.status_code !== "FINISHED") return oauthError(res, 400, "Media ID is not available", 9007);
    c.status_code = "PUBLISHED";
    const id = `m-${state.media.size + 1}`;
    state.media.set(id, { id, container: c.id, caption: c.caption, permalink: `https://www.instagram.com/reel/MOCK${state.media.size + 1}/` });
    return json(res, 200, { id });
  }
  if (/^\/m-\d+$/.test(p) && req.method === "GET") {
    const m = state.media.get(p.slice(1));
    if (!m) return oauthError(res, 400, "Object does not exist", 100);
    return json(res, 200, { id: m.id, permalink: m.permalink, media_type: "VIDEO", media_product_type: "REELS" });
  }
  return oauthError(res, 404, `Unknown mock endpoint ${req.method} ${url.pathname}`, 803);
}).listen(port, "127.0.0.1", () => log(`instagram mock listening on http://127.0.0.1:${port}`));
