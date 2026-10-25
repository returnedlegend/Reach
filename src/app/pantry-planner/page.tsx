import { cookies } from "next/headers";
import { ReachApp } from "@/components/reach-app";
import { publicDirectory } from "@/lib/public-directory";
export const dynamic = "force-dynamic";
export default async function Page() {
  const directory = publicDirectory((await cookies()).toString());
  return (
    <ReachApp
      productionPantries={directory.pantries}
      directoryError={directory.error}
    />
  );
}
