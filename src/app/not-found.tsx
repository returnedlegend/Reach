import Link from "next/link";

export default function NotFound() {
  return (
    <main className="reach-recovery" aria-labelledby="not-found-heading">
      <span className="badge badge-outline">Page not found</span>
      <h1 id="not-found-heading">Let’s get you back on track.</h1>
      <p>
        This link may have changed. You can still search the food directory
        without an account.
      </p>
      <Link className="btn btn-primary" href="/">
        Find food
      </Link>
      <p>
        Need another way to find help? <a href="tel:211">Call 211</a> and
        confirm availability directly with the provider.
      </p>
    </main>
  );
}
