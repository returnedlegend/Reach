import { cookies } from "next/headers";
import { publicFeatures } from "@/lib/release-features";
import { ReleaseUnavailable } from "@/components/release-unavailable";
import { GuidedReach } from "@/components/guided-reach";
import { publicDirectory } from "@/lib/public-directory";
export const dynamic = "force-dynamic";

export const metadata = { title: "Food hotspots | ReachAI" };

export default async function FoodHotspotsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const initialCommunityOffers = query.type === "offer";
  const features = publicFeatures();
  if (!features.community) return <ReleaseUnavailable title="Food sharing" />;
  const directory = publicDirectory((await cookies()).toString());
  return (
    <GuidedReach
      features={features}
      initialHotspots={!initialCommunityOffers}
      initialCommunityOffers={initialCommunityOffers}
      foodResources={directory.resources}
      directoryError={directory.error}
    />
  );
}
