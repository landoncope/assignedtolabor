"use client";

import { useState, useTransition } from "react";
import { disconnectInstagram } from "@/app/review/actions";
import type { Notice } from "@/lib/instagram-notice";
import { areaLabel, type Area } from "@/lib/types";

/**
 * Each team's Instagram connection: connect (sends the lead to Instagram, logged in
 * to the team's account), or disconnect. Shown to leads for their teams and to admins
 * for every team.
 */
export default function InstagramConnections({ areas, back, notice }: { areas: Area[]; back: string; notice: Notice | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);

  return (
    <section id="instagram" className="card">
      <div className="font-semibold">Instagram accounts</div>
      <p className="mt-1 text-sm text-muted">Posting with one tap needs the team&rsquo;s Instagram account connected once. Tap Connect while this browser is logged in to that account; Instagram asks you to allow it. The account must be a professional account (Business or Creator). Nothing is posted until a lead taps Post.</p>
      <p className="mt-2 text-sm text-muted"><b>Before the first Connect:</b> Instagram lets only accounts we have listed as testers of our app log in, and it shows &ldquo;Insufficient developer role&rdquo; to any other account. Send the team&rsquo;s exact Instagram username to <a href="mailto:landoncope@gmail.com" className="underline">landoncope@gmail.com</a>; once it is listed, accept the invitation on <a href="https://www.instagram.com/accounts/manage_access/" target="_blank" rel="noreferrer" className="underline">instagram.com/accounts/manage_access</a> in a browser while logged in to that account (the &ldquo;Tester Invites&rdquo; tab; the phone app does not show it), then come back and tap Connect.</p>
      {notice && <p className={`mt-2 text-sm font-medium ${notice.kind === "ok" ? "text-accent" : "text-danger"}`}>{notice.text}</p>}
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {areas.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
            <span>
              <b>{areaLabel(a)}</b>
              {a.instagram_user_id
                ? <> · connected as <b>@{(a.instagram_handle ?? "").replace(/^@/, "")}</b>{a.instagram_connected_at ? ` since ${new Date(a.instagram_connected_at).toLocaleDateString()}` : ""}</>
                : <> · not connected{a.instagram_handle ? ` (handle on file: @${a.instagram_handle.replace(/^@/, "")})` : ""}</>}
            </span>
            {a.instagram_user_id ? (
              confirm === a.id ? (
                <span className="flex gap-2">
                  <button onClick={() => { setError(""); start(async () => { const r = await disconnectInstagram(a.id); if ("error" in r) setError(r.error ?? "Could not disconnect."); setConfirm(null); }); }} disabled={pending} className="btn-danger text-xs">Disconnect</button>
                  <button onClick={() => setConfirm(null)} disabled={pending} className="btn-secondary text-xs">Keep</button>
                </span>
              ) : (
                <button onClick={() => setConfirm(a.id)} disabled={pending} className="text-xs text-muted hover:text-danger">Disconnect</button>
              )
            ) : (
              <a href={`/api/instagram/connect?area=${a.id}&back=${encodeURIComponent(back)}`} className="btn-secondary text-xs">Connect Instagram</a>
            )}
          </li>
        ))}
        {areas.length === 0 && <li className="text-muted">No teams yet.</li>}
      </ul>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
