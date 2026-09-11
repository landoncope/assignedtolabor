"use client";

import { QRCodeSVG } from "qrcode.react";
import Mark from "@/components/Mark";

export default function QrPrint({ url }: { url: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12 text-center print:py-0">
      <Mark size={64} className="mb-4" />
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Assigned To Labor</p>
      <h1 className="mt-2 text-3xl font-bold">Share your witness</h1>
      <p className="mt-2 text-muted">Scan to record a short video of your faith.</p>
      <div className="mt-8 rounded-2xl border border-line bg-white p-6">
        <QRCodeSVG value={url} size={260} level="M" includeMargin={false} />
      </div>
      <p className="mt-4 text-sm text-muted">{url.replace(/^https?:\/\//, "")}</p>
      <button onClick={() => window.print()} className="btn-secondary mt-8 print:hidden">Print</button>
    </main>
  );
}
