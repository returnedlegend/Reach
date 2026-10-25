"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SharingAdminResponse, SharingReview } from "@/lib/sharing-types";
import "./sharing-pages.css";

export function AdminSubmissions() {
  const [items, setItems] = useState<SharingReview[]>([]);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();
  const [notification, setNotification] =
    useState<SharingAdminResponse["notification"]>();
  const [focusRequest, setFocusRequest] = useState("");

  useEffect(() => {
    setFocusRequest(
      new URLSearchParams(window.location.search).get("request")?.trim() || "",
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/sharing/admin", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAuthError(response.status === 401 || response.status === 403);
        throw new Error(result.error || "Could not load submissions.");
      }
      setItems((result as SharingAdminResponse).submissions || []);
      setNotification((result as SharingAdminResponse).notification);
      setAuthError(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load submissions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!loading && focusRequest) {
      const target = items.find((item) => item.id === focusRequest);
      if (target)
        document
          .getElementById(`submission-${target.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusRequest, items, loading]);

  async function decide(item: SharingReview, decision: "approve" | "reject") {
    if (
      decision === "approve" &&
      !window.confirm("Approve this submission and make its listing public?")
    )
      return;
    const reason =
      decision === "reject"
        ? window.prompt("Reason for rejection (optional):")
        : null;
    if (decision === "reject" && reason === null) return;
    setPending(item.id);
    setError("");
    try {
      const response = await fetch(
        `/api/sharing/admin/${encodeURIComponent(item.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            action: decision,
            ...(reason?.trim() ? { reason: reason.trim() } : {}),
          }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          result.error || `Could not ${decision} this submission.`,
        );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update this submission.",
      );
    } finally {
      setPending(undefined);
    }
  }

  return (
    <main className="sharing-shell">
      <header className="sharing-header">
        <Link href="/" className="sharing-back">
          ← Reach
        </Link>
        <span className="sharing-kicker">Reviewer workspace</span>
        <h1>Food submissions</h1>
        <p>Review each submission before it becomes a public listing.</p>
      </header>
      {notification && (
        <p className="sharing-notice" role="status">
          {notification.pending} queued alerts ·{" "}
          {notification.mode === "smtp"
            ? "SMTP configured; delivery is not guaranteed"
            : notification.mode === "preview"
              ? "Preview only — no email sent"
              : "Email delivery is not configured"}
        </p>
      )}
      {focusRequest &&
        !loading &&
        !items.some((item) => item.id === focusRequest) && (
          <p className="sharing-hint">
            No submission was found for this request.
          </p>
        )}
      {error && (
        <p className="sharing-error" role="alert">
          {error}
          {authError && (
            <>
              {" "}
              <Link href="/admin/sign-in">Sign in</Link>.
            </>
          )}
        </p>
      )}
      {loading ? (
        <p className="sharing-card">Loading submissions…</p>
      ) : !error && items.length === 0 ? (
        <p className="sharing-card">No submissions to review.</p>
      ) : (
        <section className="sharing-admin-list" aria-label="Submissions">
          {items.map((item) => (
            <article
              id={`submission-${item.id}`}
              className={`sharing-card sharing-review${focusRequest === item.id ? " sharing-review-focused" : ""}`}
              key={item.id}
            >
              <div className="sharing-review-top">
                <span className="sharing-kicker">
                  {item.kind === "hotspot" ? "Food pickup" : "Extra food"}
                </span>
                <span
                  className={`sharing-status sharing-status-${item.status}`}
                >
                  {item.status}
                </span>
              </div>
              <h2>{String(item.data.title || "Untitled submission")}</h2>
              <p>{String(item.data.description || "")}</p>
              {item.photoUrl && (
                <img
                  className="sharing-photo"
                  src={item.photoUrl}
                  alt={`Submitted photo for ${String(item.data.title || "food")}`}
                />
              )}
              {item.hasTestId && item.status === "pending" && (
                <p className="sharing-notice">
                  Optional developer test image · private · expires within 24
                  hours or on review.{" "}
                  <a
                    href={`/api/sharing/admin/${encodeURIComponent(item.id)}/test-id`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View test image
                  </a>
                </p>
              )}
              <dl className="sharing-details">
                <div>
                  <dt>Submitted</dt>
                  <dd>{new Date(item.submittedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Private submitter contact</dt>
                  <dd>
                    {item.contactName} ·{" "}
                    <a href={`mailto:${encodeURIComponent(item.contactEmail)}`}>
                      {item.contactEmail}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>Public contact</dt>
                  <dd>
                    {item.publicContact.kind}: {item.publicContact.value}
                  </dd>
                </div>
                {Object.entries(item.data)
                  .filter(([key]) => !["title", "description"].includes(key))
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {key
                          .replace(
                            /[A-Z]/g,
                            (letter) => ` ${letter.toLowerCase()}`,
                          )
                          .replace(/^./, (letter) => letter.toUpperCase())}
                      </dt>
                      <dd>
                        {typeof value === "boolean"
                          ? value
                            ? "Yes"
                            : "No"
                          : String(value ?? "—")}
                      </dd>
                    </div>
                  ))}
              </dl>
              {item.reason && (
                <p className="sharing-notice">Review note: {item.reason}</p>
              )}
              {item.status === "pending" && (
                <div className="sharing-actions">
                  <button
                    type="button"
                    className="sharing-submit"
                    disabled={!!pending}
                    onClick={() => void decide(item, "approve")}
                  >
                    {pending === item.id ? "Saving…" : "Approve and publish"}
                  </button>
                  <button
                    type="button"
                    className="sharing-reject"
                    disabled={!!pending}
                    onClick={() => void decide(item, "reject")}
                  >
                    Reject
                  </button>
                </div>
              )}
              {item.status === "approved" && item.recordId && (
                <p>Public listing created · {item.recordId}</p>
              )}
            </article>
          ))}
        </section>
      )}
      <button
        className="sharing-refresh"
        onClick={() => void load()}
        disabled={loading || !!pending}
      >
        Refresh submissions
      </button>
    </main>
  );
}
