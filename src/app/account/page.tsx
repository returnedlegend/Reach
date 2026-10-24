import { featureEnabled } from "@/lib/release-features";
import { ReleaseUnavailable } from "@/components/release-unavailable";
import type { Metadata } from "next";
import { AccountPanel } from "@/components/account-panel";

export const metadata: Metadata = {
  title: "Your account · Reach",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  if (!featureEnabled("accounts"))
    return <ReleaseUnavailable title="Accounts" />;
  return <AccountPanel />;
}
