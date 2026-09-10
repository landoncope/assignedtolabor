import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="September 10, 2026">
      <p>By using Assigned To Labor you agree to these terms.</p>
      <h2>Your videos</h2>
      <ul>
        <li>You must be the person in the video, or have permission from everyone who appears in it. If you are under 18, a parent or guardian must agree to these terms for you.</li>
        <li>You keep ownership of your video. You give us and the area&rsquo;s volunteer team permission to review it, edit it lightly for length or captions, and publish it on social media accounts run by the team, without payment.</li>
        <li>Submitting a video does not guarantee it will be posted. Reviewers may decline any video for any reason.</li>
        <li>Do not submit content that is hateful, harassing, sexual, violent, misleading, or that you do not have the right to share.</li>
      </ul>
      <h2>Our service</h2>
      <ul>
        <li>The service is run by volunteers and provided as is, without warranties. We may change or stop it at any time.</li>
        <li>We may remove content or close accounts that break these terms.</li>
        <li>Assigned To Labor is an independent volunteer project. It is not an official site of The Church of Jesus Christ of Latter-day Saints.</li>
      </ul>
      <h2>Contact</h2>
      <p><a href="mailto:landoncope@gmail.com" className="text-accent underline">landoncope@gmail.com</a></p>
    </LegalPage>
  );
}
