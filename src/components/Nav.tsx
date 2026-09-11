import Link from "next/link";
import { getViewer } from "@/lib/auth";
import Mark from "@/components/Mark";

/** Top bar for the signed-in surfaces (my videos, review, admin). */
export default async function Nav({ current }: { current?: "my" | "review" | "admin" }) {
  const v = await getViewer();
  const signedIn = v && !v.isAnonymous;
  const link = (href: string, label: string, key: typeof current) => (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${current === key ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
        <Link href="/" className="mr-auto flex items-center gap-2 text-sm font-bold tracking-tight">
          <Mark size={22} />
          <span>Assigned <span className="text-gold">To</span> Labor</span>
        </Link>
        {signedIn && link("/my", "My videos", "my")}
        {v?.isManager && link("/review", "Review", "review")}
        {v?.isAdmin && link("/admin", "Admin", "admin")}
        {signedIn ? (
          <form action="/auth/signout" method="post">
            <button className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-foreground">Sign out</button>
          </form>
        ) : (
          <Link href="/login" className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-foreground">Sign in</Link>
        )}
      </div>
    </header>
  );
}
