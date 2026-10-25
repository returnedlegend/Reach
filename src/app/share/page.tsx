import { ShareFoodForm } from "@/components/share-food-form";
import { ReleaseUnavailable } from "@/components/release-unavailable";
import { featureEnabled } from "@/lib/release-features";

export default function SharePage() {
  if (!featureEnabled("community"))
    return <ReleaseUnavailable title="Community food sharing" />;
  return <ShareFoodForm />;
}
