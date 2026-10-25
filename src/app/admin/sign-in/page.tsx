import type { Metadata } from "next";
import { AccountPanel } from "@/components/account-panel";

export const metadata: Metadata = {
  title: "Administrator sign in · Reach",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function AdminSignInPage() {
  return <AccountPanel administrator />;
}
