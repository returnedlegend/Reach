import { ReachApp } from "@/components/reach-app";
import { publicDirectory } from "@/lib/public-directory";
export const dynamic = "force-dynamic";
export default function Page() {
  const directory = publicDirectory();
  return (
    <ReachApp
      productionPantries={directory.pantries}
      directoryError={directory.error}
    />
  );
}
