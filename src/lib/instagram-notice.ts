/** The notice a page shows after the Instagram connect flow sends someone back (`?instagram_connected=` or `?instagram_error=`). */
export type Notice = { kind: "ok" | "error"; text: string };

export function instagramNotice(sp: Record<string, string | string[] | undefined>): Notice | null {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const ok = first(sp.instagram_connected);
  const err = first(sp.instagram_error);
  if (ok) return { kind: "ok", text: `Instagram connected as @${ok.replace(/^@/, "")}. Approved videos can now be posted with one tap.` };
  if (err) return { kind: "error", text: `Instagram: ${err}` };
  return null;
}
