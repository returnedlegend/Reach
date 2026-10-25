import { AdminCredentials } from "@/components/admin-credentials";
export const metadata = {
  title: "Change administrator password · Reach",
  robots: { index: false, follow: false },
};
export default function ChangePasswordPage() {
  return <AdminCredentials changePassword />;
}
