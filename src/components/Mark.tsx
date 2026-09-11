/* eslint-disable @next/next/no-img-element */
/** The Assigned To Labor wheat-sheaf mark. `size` is the rendered height; the image is 3:4. */
export default function Mark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return <img src="/brand/logo.png" alt="" width={Math.round(size * 0.753)} height={size} className={className} style={{ height: size, width: "auto" }} />;
}
