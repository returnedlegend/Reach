import { publicFeatures } from "@/lib/release-features";
import { ReleaseUnavailable } from "@/components/release-unavailable";
import type { Metadata } from "next";
import { VolunteerPanel } from "@/components/volunteer-panel";
export const metadata: Metadata = {
  title: "Volunteer pickups · Reach AI",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function VolunteerPage() {
  if (!publicFeatures().volunteering)
    return <ReleaseUnavailable title="Volunteer pickups" />;
  return <VolunteerPanel />;
}
