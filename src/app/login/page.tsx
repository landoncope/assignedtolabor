import type { Metadata } from "next";
import Link from "next/link";
import Mark from "@/components/Mark";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "/my";
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-8 flex items-center gap-2 text-sm font-bold tracking-tight">
        <Mark size={22} />
        <span>Assigned <span className="text-gold">To</span> Labor</span>
      </Link>
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">For reviewers, and for anyone who wants to keep track of their videos.</p>
      {error && <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <LoginForm next={next} />
    </main>
  );
}
