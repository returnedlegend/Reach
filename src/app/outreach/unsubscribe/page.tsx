"use client";
import { useEffect, useState } from "react";
export default function Page() {
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    setToken(fragment.get("token") || "");
    history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <main className="account-page">
      <h1>Stop Reach availability inquiries</h1>
      <p>
        Confirm below to stop inquiries to this enrolled contact. Opening this
        link alone makes no changes.
      </p>
      <button
        className="btn btn-primary"
        disabled={!/^[a-f0-9]{64}$/.test(token)}
        onClick={async () => {
          try {
            const r = await fetch("/api/outreach/unsubscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token }),
              cache: "no-store",
              referrerPolicy: "no-referrer",
            });
            if (!r.ok) throw new Error();
            setNotice("This contact will receive no further Reach inquiries.");
            setToken("");
          } catch {
            setNotice("Could not update this preference. Please try again.");
          }
        }}
      >
        Stop inquiries
      </button>
      <p role="status">{notice}</p>
      <a href="/">Reach home</a>
    </main>
  );
}
