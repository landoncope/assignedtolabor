import Link from "next/link";
import Mark from "@/components/Mark";
import Nav from "@/components/Nav";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <Mark size={56} className="mb-5" />
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Assigned To Labor</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Share your witness.</h1>
        <p className="mt-4 max-w-md text-lg text-muted">
          Record a short, sincere video about your faith. A local team reviews it and shares it with people who need to hear it.
        </p>
        <Link href="/upload" className="btn-primary mt-8 px-6 py-3 text-base">Record a video</Link>
        <p className="mt-3 text-sm text-muted">Takes about two minutes. No account needed.</p>
      </main>
      <footer className="flex justify-center gap-4 px-6 py-6 text-xs text-muted">
        <Link href="/login" className="hover:text-foreground">Reviewer sign in</Link>
        <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
        <Link href="/terms" className="hover:text-foreground">Terms</Link>
      </footer>
    </>
  );
}
