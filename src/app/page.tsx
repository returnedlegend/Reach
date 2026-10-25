import { cookies } from "next/headers";
import { GuidedReach } from "@/components/guided-reach";
import { publicFeatures } from "@/lib/release-features";
import { publicDirectory } from "@/lib/public-directory";
export const dynamic = "force-dynamic";
export default async function Page() {
  const directory = publicDirectory((await cookies()).toString());
  return (
    <GuidedReach
      features={publicFeatures()}
      foodResources={directory.resources}
      directoryError={directory.error}
    />
  );
}
