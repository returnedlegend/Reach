import type { Metadata } from "next";
import { UnsubscribePanel } from "@/components/notification-preferences";
import "@/components/account-panel.css";
export const metadata: Metadata = {
  title: "Email preferences · Reach",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function UnsubscribePage() {
  return (
    <main className="account-page">
      <header className="account-header">
        <a className="account-brand" href="/">
          Reach<span>A little more within reach</span>
        </a>
        <a href="/account">Your account</a>
      </header>
      <div className="account-intro">
        <p className="account-eyebrow">YOUR CHOICE</p>
      </div>
      <UnsubscribePanel />
    </main>
  );
}
