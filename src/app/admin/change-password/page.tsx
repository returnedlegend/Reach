import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminCredentials } from "@/components/admin-credentials";
import { getAccountActor } from "@/lib/account-store";
import { openCommunityDatabase } from "@/lib/community";
export const metadata = {
  title: "Change administrator password · Reach",
  robots: { index: false, follow: false },
};
export default async function ChangePasswordPage() {
  const db = openCommunityDatabase();
  const actor = getAccountActor(
    db,
    new Request("http://reach.internal", {
      headers: { cookie: (await cookies()).toString() },
    }),
  );
  if (!actor) redirect("/admin/sign-in");
  if (
    db.prepare("SELECT role FROM users WHERE id=?").get(actor.id)?.role !==
    "moderator"
  )
    redirect("/admin");
  return <AdminCredentials changePassword />;
}
