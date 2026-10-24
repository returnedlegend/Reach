import type { Metadata } from "next";
import { VolunteerPanel } from "@/components/volunteer-panel";
export const metadata: Metadata = {
  title: "Volunteer pickups · Reach",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function VolunteerPage() {
  return <VolunteerPanel />;
}
