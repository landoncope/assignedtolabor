/** The interim brand mark: a gold A on deep blue. Swap for the real logo when it lands. */
export default function Mark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#1f5f8b" />
      <path fill="#b8892b" fillRule="evenodd" d="M32 12 50 52h-8.5l-3.9-9.5H26.4L22.5 52H14Zm0 13.5L28.6 36h6.8Z" />
    </svg>
  );
}
