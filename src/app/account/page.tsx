import type { Metadata } from "next";
import { AccountPanel } from "@/components/account-panel";

export const metadata: Metadata = {
  title: "Your account · Reach",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountPanel />;
}
