import { publicFeatures } from "@/lib/release-features";
import { ReleaseUnavailable } from "@/components/release-unavailable";
import { PantryManagement } from "@/components/pantry-management";

export default function ManagementPage() {
  if (!publicFeatures().accounts)
    return <ReleaseUnavailable title="Pantry management" />;
  return <PantryManagement />;
}
