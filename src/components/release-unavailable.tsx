import Link from "next/link";
export function ReleaseUnavailable({ title }: { title: string }) {
  return (
    <main className="account-page">
      <h1>{title}</h1>
      <p>
        This optional service is not available in this release. You can find
        food, compare trips and save directions without an account.
      </p>
      <Link className="btn btn-primary" href="/">
        Find food
      </Link>
    </main>
  );
}
