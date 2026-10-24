import { GuidedReach } from "@/components/guided-reach";
import { publicDirectory } from "@/lib/public-directory";
export const dynamic = "force-dynamic";
export default function Page() {
  const directory = publicDirectory();
  return (
    <GuidedReach
      foodResources={directory.resources}
      directoryError={directory.error}
    />
  );
}
