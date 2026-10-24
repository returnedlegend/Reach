import { GuidedReach } from "@/components/guided-reach";
import { publicFeatures } from "@/lib/release-features";
import { publicDirectory } from "@/lib/public-directory";
export const dynamic = "force-dynamic";
export default function Page() {
  const directory = publicDirectory();
  return (
    <GuidedReach
      features={publicFeatures()}
      foodResources={directory.resources}
      directoryError={directory.error}
    />
  );
}
