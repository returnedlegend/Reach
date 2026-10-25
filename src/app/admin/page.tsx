import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminSubmissions } from "@/components/admin-submissions";
import { getAccountActor } from "@/lib/account-store";
import { openCommunityDatabase } from "@/lib/community";

export default async function AdminPage() {
  const db = openCommunityDatabase();
  const actor = getAccountActor(
    db,
    new Request("http://reach.internal", {
      headers: { cookie: (await cookies()).toString() },
    }),
  );
  if (!actor) redirect("/admin/sign-in");
  if (actor.mustChangePassword) redirect("/admin/change-password");
  if (
    db.prepare("SELECT role FROM users WHERE id=?").get(actor.id)?.role !==
    "moderator"
  )
    return (
      <main>
        <h1>Moderator access required</h1>
        <a href="/admin/sign-in">Administrator sign in</a>
      </main>
    );
  return <AdminSubmissions />;
}
