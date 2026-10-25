import { publicFeatures } from "@/lib/release-features";
import { ReleaseUnavailable } from "@/components/release-unavailable";
import { OutreachPanel } from "@/components/outreach-panel";
export const metadata = {
  title: "Availability inquiries · Reach",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  if (!publicFeatures().email)
    return <ReleaseUnavailable title="Availability inquiries" />;
  return (
    <main className="account-page">
      <a href="/">Back to finding food</a>
      <h1>Availability inquiries</h1>
      <p>
        Contact participating food sources after reviewing your message. Your
        history and replies stay private.
      </p>
      <OutreachPanel />
    </main>
  );
}
