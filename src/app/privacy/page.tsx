import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="September 10, 2026">
      <p>Assigned To Labor (&ldquo;we&rdquo;) helps people share short videos about their faith. This page explains what we collect and how we use it.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Videos you submit</b>, along with the script you built, the area you chose, and the first name you enter, if any.</li>
        <li><b>Your email address</b> if you sign in or ask to be kept posted. If you sign in with Google, we receive your name and email from Google.</li>
        <li><b>Basic technical data</b> needed to run the service, such as the time of your upload and standard server logs.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>Volunteer reviewers for the area you chose watch your video and decide whether to share it.</li>
        <li>If your video is approved, it is posted publicly on that area&rsquo;s social media accounts. By submitting, you agree to that.</li>
        <li>We use your email only to let you sign in and to tell you what happened to your video. We do not sell or rent your information.</li>
      </ul>
      <h2>How long we keep it</h2>
      <p>The original video file is deleted from our servers about seven days after it is posted or declined. A record that it existed, including the script text, stays so reviewers can see history. You can ask us to delete your account and records at any time.</p>
      <h2>Who can see it</h2>
      <p>Videos are private while under review. Only you, reviewers for your area, and site administrators can view them. Our data is stored with Supabase and the site is hosted on Vercel.</p>
      <h2>Contact</h2>
      <p>Questions or deletion requests: <a href="mailto:landoncope@gmail.com" className="text-accent underline">landoncope@gmail.com</a>.</p>
    </LegalPage>
  );
}
