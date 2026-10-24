import { GuidedReach } from "@/components/guided-reach";
import { publicDirectory } from "@/lib/public-directory";
export const dynamic = "force-dynamic";

export const metadata = { title: "Food hotspots | Reach" };

export default function FoodHotspotsPage() {
  const directory = publicDirectory();
  return (
    <GuidedReach
      initialHotspots
      foodResources={directory.resources}
      directoryError={directory.error}
    />
  );
}
