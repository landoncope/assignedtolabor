"use client";

import { QRCodeSVG } from "qrcode.react";
import Image from "next/image";

const TARGET = "https://theholyrebellion.org/assignedtolabor/quickupload";

// Printable QR page (clean white root layout — no app shell). Scanning the code
// opens the Quick Upload sequence.
export default function QrPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "48px 24px",
        background: "#fff",
        color: "#0b0b0f",
        textAlign: "center",
        fontFamily: '"Hanken Grotesk", -apple-system, system-ui, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <Image src="/logo.png" alt="Assigned to Labor" width={76} height={76} style={{ objectFit: "contain" }} />
      <div style={{ fontSize: 13, letterSpacing: 2.5, textTransform: "uppercase", color: "#b8915a", fontWeight: 700 }}>
        Assigned to Labor
      </div>
      <h1 style={{ fontFamily: '"Archivo", sans-serif', fontWeight: 800, fontSize: 30, lineHeight: 1.1, margin: 0 }}>
        Scan to share your witness
      </h1>
      <p style={{ fontSize: 15, color: "#555", margin: "0 0 6px", maxWidth: 380, lineHeight: 1.45 }}>
        Record a short video and send it in — no account needed.
      </p>
      <div style={{ padding: 20, border: "1px solid #e6e6e6", borderRadius: 18, background: "#fff" }}>
        <QRCodeSVG value={TARGET} size={300} level="M" />
      </div>
      <div style={{ fontSize: 13, color: "#888", wordBreak: "break-all", maxWidth: 380 }}>
        theholyrebellion.org/assignedtolabor/quickupload
      </div>
      <button
        onClick={() => window.print()}
        className="qr-print-btn"
        style={{ marginTop: 10, padding: "12px 24px", borderRadius: 12, border: "none", background: "linear-gradient(160deg, #6cb2e8 0%, #4a93d6 100%)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
      >
        Print
      </button>
      <style>{`@media print { .qr-print-btn { display: none !important; } }`}</style>
    </div>
  );
}
