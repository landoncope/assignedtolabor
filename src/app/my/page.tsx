import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { areaLabel, STATUS_LABEL, type VideoWithArea } from "@/lib/types";

export const metadata: Metadata = { title: "My videos" };

export default async function MyVideosPage({ searchParams }: PageProps<"/my">) {
  const sp = await searchParams;
  const viewer = await getViewer();
  const supabase = await createClient();
  const { data } = await supabase
    .from("videos")
    .select("*, area:areas(id, name, language, instagram_handle)")
    .eq("user_id", viewer?.userId ?? "")
    .order("created_at", { ascending: false });
  const videos = (data ?? []) as VideoWithArea[];

  return (
    <>
      <Nav current="my" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {sp.denied && <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">You don&apos;t have access to that page.</p>}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">My videos</h1>
          <Link href="/upload" className="btn-primary">Record another</Link>
        </div>
        {viewer?.isAnonymous && (
          <p className="mt-3 text-sm text-muted">You&apos;re not signed in. These videos are tied to this browser only. <Link href="/login" className="underline">Sign in</Link> to keep them.</p>
        )}
        {videos.length === 0 ? (
          <p className="mt-10 text-center text-muted">No videos yet.</p>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {videos.map((v) => (
              <li key={v.id} className="card flex gap-4">
                <Thumb src={v.thumbnail} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{STATUS_LABEL[v.status]}</div>
                  <div className="mt-0.5 text-sm text-muted">{areaLabel(v.area)} · {new Date(v.created_at).toLocaleDateString()}</div>
                  {v.script?.body && <p className="mt-2 line-clamp-2 text-sm">{v.script.body}</p>}
                  {v.status === "rejected" && v.rejection_note && <p className="mt-2 text-sm text-muted">Note from the team: {v.rejection_note}</p>}
                  {v.status === "posted" && v.post_url && <a href={v.post_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-accent underline">See the post</a>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function Thumb({ src }: { src: string | null }) {
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" className="h-20 w-14 shrink-0 rounded-md object-cover" />
    : <div className="h-20 w-14 shrink-0 rounded-md bg-line" />;
}
