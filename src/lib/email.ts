// Transactional email through Resend's REST API. Server only.
// All messages share one plain wrapper so they read as one product.

const FROM = "Assigned To Labor <no-reply@assignedtolabor.org>";
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://assignedtolabor.org";

export type Outgoing = { to: string; subject: string; heading: string; paragraphs: string[]; cta?: { label: string; href: string } };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function renderEmail(m: Outgoing): string {
  const cta = m.cta
    ? `<p style="margin:24px 0"><a href="${m.cta.href}" style="display:inline-block;padding:12px 20px;background:#1f5f8b;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(m.cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#fafaf7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1e">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<p style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#b8892b;margin:0 0 16px">Assigned To Labor</p>
<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(m.heading)}</h1>
${m.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px">${p}</p>`).join("")}
${cta}
<p style="font-size:12px;color:#6b6b70;margin-top:32px">You are receiving this because of your role on <a href="${SITE}" style="color:#6b6b70">assignedtolabor.org</a>.</p>
</div></body></html>`;
}

/** Sends one email. Returns Resend's message id. Throws on failure so callers can decide what to mark. */
export async function sendEmail(m: Outgoing): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, html: renderEmail(m) }),
  });
  const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok) throw new Error(`Resend ${r.status}: ${body.message ?? "unknown error"}`);
  return body.id ?? "";
}

export const siteUrl = SITE;
