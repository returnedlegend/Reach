import { publicFeatures } from "@/lib/release-features";
import { ReleaseUnavailable } from "@/components/release-unavailable";
import { GuidedReach } from "@/components/guided-reach";
import { publicDirectory } from "@/lib/public-directory";
export const dynamic = "force-dynamic";

export const metadata = { title: "Food hotspots | Reach" };

export default function FoodHotspotsPage() {
  const features = publicFeatures();
  if (!features.community) return <ReleaseUnavailable title="Food sharing" />;
  const directory = publicDirectory();
  return (
    <GuidedReach
      features={features}
      initialHotspots
      foodResources={directory.resources}
      directoryError={directory.error}
    />
  );
}
