import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { areaLabel, type VideoStatus, type VideoWithArea } from "@/lib/types";

export const metadata: Metadata = { title: "Review" };

const TABS: { key: VideoStatus; label: string }[] = [
  { key: "pending", label: "To review" },
  { key: "approved", label: "Ready to post" },
  { key: "posted", label: "Posted" },
  { key: "rejected", label: "Not selected" },
];

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const sp = await searchParams;
  const viewer = await requireManager("/review");
  const status = (TABS.find((t) => t.key === sp.status)?.key ?? "pending") as VideoStatus;
  const supabase = await createClient();
  // RLS limits rows to areas this viewer manages (admins see everything).
  const { data } = await supabase
    .from("videos")
    .select("*, area:areas(id, name, language, instagram_handle)")
    .eq("status", status)
    .order("created_at", { ascending: status !== "pending" ? false : true })
    .limit(200);
  const videos = (data ?? []) as VideoWithArea[];

  return (
    <>
      <Nav current="review" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">Review</h1>
        <p className="mt-1 text-sm text-muted">{viewer.isAdmin ? "All areas, plus videos with no area." : "Videos sent to the areas you manage."}</p>
        <div className="mt-5 flex gap-1 overflow-x-auto rounded-lg border border-line bg-card p-1">
          {TABS.map((t) => (
            <Link key={t.key} href={`/review?status=${t.key}`} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${status === t.key ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}>{t.label}</Link>
          ))}
        </div>
        {videos.length === 0 ? (
          <p className="mt-10 text-center text-muted">Nothing here.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {videos.map((v) => (
              <li key={v.id}>
                <Link href={`/review/${v.id}`} className="card flex gap-4 hover:border-accent">
                  {v.thumbnail
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={v.thumbnail} alt="" className="h-20 w-14 shrink-0 rounded-md object-cover" />
                    : <div className="h-20 w-14 shrink-0 rounded-md bg-line" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span>{areaLabel(v.area)}</span>
                      {!v.area && <span className="rounded bg-gold/15 px-1.5 py-0.5 text-xs text-gold">needs an area</span>}
                    </div>
                    <div className="mt-0.5 text-sm text-muted">
                      {v.uploader_name ?? "Anonymous"}{v.language ? ` · speaks ${v.language}` : ""} · {new Date(v.created_at).toLocaleString()}{v.duration_seconds ? ` · ${v.duration_seconds}s` : ""}
                    </div>
                    {v.script?.body && <p className="mt-2 line-clamp-2 text-sm">{v.script.body}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
