import type { Metadata } from "next";
import QrPrint from "./QrPrint";

export const metadata: Metadata = { title: "Print a QR code" };

/** A printable poster with a QR code that opens the upload flow. */
export default function QrPage() {
  const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/upload`;
  return <QrPrint url={url} />;
}
