/** Same dark, phone-first shell as the upload flow: part 2 hosts the recorder, which is built for it. */
export default function LeadLayout({ children }: LayoutProps<"/lead">) {
  return <div className="flex min-h-dvh flex-1 flex-col bg-[#0b0b0f] text-white">{children}</div>;
}
