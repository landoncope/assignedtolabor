import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Nav from "@/components/Nav";
import VideoPlayer from "@/components/VideoPlayer";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { areaLabel, STATUS_LABEL, type Area, type VideoWithArea } from "@/lib/types";
import ReviewActions from "./ReviewActions";

export const metadata: Metadata = { title: "Review video" };

export default async function ReviewVideoPage({ params }: PageProps<"/review/[id]">) {
  const { id } = await params;
  const viewer = await requireManager(`/review/${id}`);
  const supabase = await createClient();
  const [{ data: video }, { data: areas }] = await Promise.all([
    supabase.from("videos").select("*, area:areas(id, name, language, instagram_handle)").eq("id", id).maybeSingle(),
    supabase.from("areas").select("*").eq("is_active", true).order("sort_order").order("name"),
  ]);
  if (!video) notFound();
  const v = video as VideoWithArea;
  const script = v.script;
  const caption = [script?.hook, script?.body, script?.cta].filter(Boolean).join("\n\n");

  return (
    <>
      <Nav current="review" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Link href="/review" className="text-sm text-muted hover:text-foreground">‹ Back to review</Link>
        <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <VideoPlayer videoId={v.id} poster={v.thumbnail} />
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{STATUS_LABEL[v.status]}</div>
              <h1 className="mt-1 text-xl font-bold">{areaLabel(v.area)}</h1>
              <p className="text-sm text-muted">
                From {v.uploader_name ?? "Anonymous"}{v.language ? ` · speaks ${v.language}` : ""} · {new Date(v.created_at).toLocaleString()}
                {v.duration_seconds ? ` · ${v.duration_seconds}s` : ""}{v.file_size ? ` · ${(v.file_size / 1048576).toFixed(1)} MB` : ""}
              </p>
            </div>
            {caption ? (
              <div className="card">
                <div className="label">Script</div>
                <p className="whitespace-pre-line text-sm leading-relaxed">{caption}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">No script. The uploader improvised.</p>
            )}
            {v.uploader_note && <div className="card"><div className="label">Note from uploader</div><p className="text-sm">{v.uploader_note}</p></div>}
            {v.rejection_note && <div className="card"><div className="label">Reason not selected</div><p className="text-sm">{v.rejection_note}</p></div>}
            <ReviewActions video={v} areas={(areas ?? []) as Area[]} caption={caption} isAdmin={viewer.isAdmin} />
          </div>
        </div>
      </main>
    </>
  );
}
