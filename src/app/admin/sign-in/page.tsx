import type { Metadata } from "next";
import { AdminCredentials } from "@/components/admin-credentials";

export const metadata: Metadata = {
  title: "Administrator sign in · Reach",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function AdminSignInPage() {
  return <AdminCredentials />;
}
