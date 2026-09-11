import { notFound } from "next/navigation";
import MergeTest from "./MergeTest";

/** Self test for the recorder pipeline. Only served when ENABLE_DEV_PAGES=1 (never set on Vercel). */
export default function DevMergePage() {
  if (process.env.ENABLE_DEV_PAGES !== "1") notFound();
  return <MergeTest />;
}
