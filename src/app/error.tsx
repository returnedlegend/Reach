"use client";

import Link from "next/link";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <main className="reach-recovery" aria-labelledby="recovery-heading">
      <span className="badge badge-outline">Temporarily unavailable</span>
      <h1 id="recovery-heading">Let’s try that again.</h1>
      <p>
        Reach couldn’t load this page. Check your connection and try again.
        Nothing on this screen confirms a trip or a message was completed.
      </p>
      <div>
        <button className="btn btn-primary" onClick={() => retry()}>
          Try again
        </button>
        <Link className="btn btn-outline" href="/">
          Find food
        </Link>
      </div>
      <p>
        Need another way to find help? <a href="tel:211">Call 211</a> and
        confirm availability directly with the provider.
      </p>
    </main>
  );
}
