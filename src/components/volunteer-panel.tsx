"use client";

import { useEffect, useState, type ReactNode } from "react";
import type {
  EligibleVolunteerOffer,
  ManagedVolunteerRun,
  VolunteerDashboard,
  VolunteerDiscovery,
  VolunteerPickup,
  VolunteerRun,
} from "@/lib/volunteer-types";
import "./pantry-pages.css";
import "./volunteer-panel.css";

type Pantry = { id: string; name: string; active: boolean };
class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new RequestError(
      data?.error ||
        "This request could not be completed. Try again when you are online.",
      response.status,
    );
  return data as T;
}
const areaName = (area: string) =>
  area === "bryan"
    ? "Bryan"
    : area === "college-station"
      ? "College Station"
      : "Local pickup area";
function windowLabel(run: { startsAt: string; endsAt: string }) {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  };
  return `${new Date(run.startsAt).toLocaleString("en-US", options)} – ${new Date(run.endsAt).toLocaleString("en-US", options)} (Central time)`;
}
function RunCard({
  run,
  children,
}: {
  run: VolunteerRun;
  children?: ReactNode;
}) {
  return (
    <article className="volunteer-run">
      <div className="volunteer-run-heading">
        <h3>{run.offerTitle}</h3>
        <span className="pantry-tag">
          {run.status === "pending"
            ? "Awaiting pantry approval"
            : run.status.charAt(0).toUpperCase() + run.status.slice(1)}
        </span>
      </div>
      <p>
        <strong>To {run.pantryName}</strong> · Pickup in{" "}
        {areaName(run.pickupAreaId)}
      </p>
      <p>{windowLabel(run)}</p>
      <dl className="volunteer-facts">
        <div>
          <dt>Quantity</dt>
          <dd>{run.quantity}</dd>
        </div>
        <div>
          <dt>Food category</dt>
          <dd>{run.foodCategory}</dd>
        </div>
        <div>
          <dt>Allergens</dt>
          <dd>{run.allergens || "Not specified — confirm before handling"}</dd>
        </div>
        <div>
          <dt>Storage</dt>
          <dd>{run.storage || "Confirm with the donor"}</dd>
        </div>
      </dl>
      {run.useBy && <p>Use by: {run.useBy}</p>}
      {children}
    </article>
  );
}
export function VolunteerPanel() {
  const [runs, setRuns] = useState<VolunteerRun[]>([]);
  const [dashboard, setDashboard] = useState<VolunteerDashboard | null>(null);
  const [offers, setOffers] = useState<EligibleVolunteerOffer[]>([]);
  const [pantries, setPantries] = useState<Pantry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [pickups, setPickups] = useState<Record<string, VolunteerPickup>>({});
  async function load() {
    setLoading(true);
    setError("");
    setUnavailable(false);
    setPickups({});
    const results = await Promise.allSettled([
      request<VolunteerDiscovery>("/api/volunteer"),
      request<VolunteerDashboard>("/api/volunteer/mine"),
      request<{ offers: EligibleVolunteerOffer[] }>(
        "/api/volunteer/eligible-offers",
      ),
      request<{ pantries: Pantry[] }>("/api/pantries?pageSize=100"),
    ]);
    if (results[0].status === "fulfilled") setRuns(results[0].value.runs);
    else {
      setRuns([]);
      const cause = results[0].reason;
      setUnavailable(
        cause instanceof RequestError && [404, 503].includes(cause.status),
      );
      setError(
        cause instanceof Error
          ? cause.message
          : "Pickup opportunities could not be loaded. Try again when you are online.",
      );
    }
    if (results[1].status === "fulfilled") setDashboard(results[1].value);
    else {
      setDashboard(null);
      if (
        !(
          results[1].reason instanceof RequestError &&
          results[1].reason.status === 401
        )
      )
        setError(
          "Your pickup dashboard could not be loaded. Please try again.",
        );
    }
    if (results[2].status === "fulfilled") setOffers(results[2].value.offers);
    else {
      setOffers([]);
      if (results[1].status === "fulfilled" && results[1].value.emailVerified)
        setError("Your eligible offers could not be loaded. Please try again.");
    }
    if (results[3].status === "fulfilled")
      setPantries(results[3].value.pantries.filter((pantry) => pantry.active));
    else {
      setPantries([]);
      if (results[1].status === "fulfilled")
        setError("Destination pantries could not be loaded. Please try again.");
    }
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(path: string, body: unknown, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(path, "POST", body);
      await load();
      setConsent({});
      setNotice(message);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The pickup could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }
  const managedIds = new Set(dashboard?.runs.map((run) => run.id));
  const opportunities = runs.filter(
    (run) => run.status === "open" && !managedIds.has(run.id),
  );
  const canClaim = !!dashboard?.emailVerified && dashboard.participationEnabled;
  function actions(run: ManagedVolunteerRun) {
    return (
      <>
        <div className="pantry-actions">
          {run.canApprove && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    `/api/volunteer/${encodeURIComponent(run.id)}/approve`,
                    {},
                    "Pickup approved. Volunteers can now accept it.",
                  )
                }
                className="btn btn-primary"
              >
                Approve pickup
              </button>
              <button
                className="btn btn-outline pantry-secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/api/volunteer/${encodeURIComponent(run.id)}/decline`,
                    {},
                    "Pickup declined.",
                  )
                }
              >
                Decline pickup
              </button>
            </>
          )}
          {run.canComplete && (
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  `/api/volunteer/${encodeURIComponent(run.id)}/complete`,
                  {},
                  "Pickup marked complete.",
                )
              }
              className="btn btn-primary"
            >
              Mark pickup complete
            </button>
          )}
          {run.canRelease && (
            <button
              className="btn btn-outline pantry-secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  `/api/volunteer/${encodeURIComponent(run.id)}/release`,
                  {},
                  "Assignment released. Another volunteer can accept the pickup.",
                )
              }
            >
              Release my assignment
            </button>
          )}
          {run.canCancel && !run.canRelease && (
            <button
              className="btn btn-outline pantry-secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  `/api/volunteer/${encodeURIComponent(run.id)}/cancel`,
                  {},
                  "Pickup cancelled.",
                )
              }
            >
              Cancel pickup
            </button>
          )}
        </div>
        {run.canViewPickup && (
          <div className="volunteer-private">
            <p>
              Private pickup instructions are shared only with authorized
              participants. Keep them private.
            </p>
            {pickups[run.id] ? (
              <>
                <h4>Private pickup instructions</h4>
                <p className="pantry-preserve">
                  {pickups[run.id].instructions ||
                    "No additional instructions provided."}
                </p>
                <button
                  className="btn btn-outline pantry-secondary"
                  onClick={() =>
                    setPickups((current) => {
                      const next = { ...current };
                      delete next[run.id];
                      return next;
                    })
                  }
                >
                  Hide pickup instructions
                </button>
              </>
            ) : (
              <button
                className="btn btn-outline pantry-secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const pickup = await request<VolunteerPickup>(
                      `/api/volunteer/${encodeURIComponent(run.id)}/pickup`,
                    );
                    setPickups((current) => ({ ...current, [run.id]: pickup }));
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Private instructions could not be loaded.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reveal private pickup instructions
              </button>
            )}
          </div>
        )}
      </>
    );
  }
  return (
    <main className="pantry-page volunteer-page">
      <nav className="pantry-nav" aria-label="Pickup navigation">
        <a className="pantry-back" href="/">
          Reach
        </a>
        <div>
          <a href="/food-hotspots">Food offers</a>
          <a href="/account">Your account</a>
          <a href="/manage">Manage pantries</a>
        </div>
      </nav>
      <header className="pantry-hero">
        <p className="pantry-eyebrow">A LITTLE HELP GETTING THERE</p>
        <h1>Help with a food pickup.</h1>
        <p>
          Connect an approved food donation with a pantry and a volunteer. A
          pantry manager approves each pickup before a volunteer can accept it.
        </p>
        <p className="pantry-muted">
          Pickup windows are shown in Central time. Private pickup instructions
          stay off the public listing.
        </p>
      </header>
      <div aria-live="polite">
        {notice && (
          <p className="pantry-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="pantry-notice pantry-warning" role="alert">
            {error}
          </p>
        )}
      </div>
      {loading ? (
        <p role="status">Loading pickups…</p>
      ) : unavailable ? (
        <section className="card bg-base-100 pantry-section">
          <h2>Pickup coordination is unavailable</h2>
          <p>
            This service is disabled right now. You can still browse food
            resources.
          </p>
          <button onClick={() => void load()} className="btn btn-primary">
            Try again
          </button>
        </section>
      ) : (
        <>
          {error && (
            <button
              className="btn btn-outline pantry-secondary volunteer-retry"
              disabled={busy}
              onClick={() => void load()}
            >
              Refresh pickups
            </button>
          )}
          {!dashboard ? (
            <section className="card bg-base-100 pantry-section">
              <h2>Sign in to coordinate a pickup</h2>
              <p>
                A verified account and volunteer participation opt-in are
                required to accept a pickup.
              </p>
              <a className="btn btn-primary pantry-button" href="/account">
                Go to your account
              </a>
            </section>
          ) : (
            <>
              {!canClaim && (
                <p className="pantry-notice">
                  To accept a pickup, verify your email and opt in to volunteer
                  participation in{" "}
                  <a href="/account">your account preferences</a>.
                </p>
              )}
              <section className="card bg-base-100 pantry-section">
                <h2>Request a donation pickup</h2>
                <p>
                  Choose one of your approved, eligible food offers and an
                  active destination pantry. The pantry manager will review your
                  request.
                </p>
                {offers.length && pantries.length ? (
                  <form
                    className="pantry-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void act(
                        "/api/volunteer",
                        {
                          offerId: form.get("offerId"),
                          pantryId: form.get("pantryId"),
                        },
                        "Pickup requested. It is awaiting pantry manager approval.",
                      );
                    }}
                  >
                    <fieldset disabled={busy}>
                      <div className="pantry-field-grid">
                        <label>
                          Approved food offer
                          <select
                            name="offerId"
                            required
                            defaultValue=""
                            className="input input-bordered"
                          >
                            <option value="" disabled>
                              Choose your offer
                            </option>
                            {offers.map((offer) => (
                              <option key={offer.offerId} value={offer.offerId}>
                                {offer.offerTitle} ·{" "}
                                {areaName(offer.pickupAreaId)} ·{" "}
                                {windowLabel(offer)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Destination pantry
                          <select
                            name="pantryId"
                            required
                            defaultValue=""
                            className="input input-bordered"
                          >
                            <option value="" disabled>
                              Choose a pantry
                            </option>
                            {pantries.map((pantry) => (
                              <option key={pantry.id} value={pantry.id}>
                                {pantry.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <button className="btn btn-primary">
                        Request pantry approval
                      </button>
                    </fieldset>
                  </form>
                ) : (
                  <p className="pantry-empty">
                    {!offers.length
                      ? "No eligible approved offers are available for a pickup request."
                      : "No active destination pantries are available right now."}
                  </p>
                )}
                <a href="/food-hotspots">Create or manage your food offers</a>
              </section>
              <section className="card bg-base-100 pantry-section">
                <h2>Your pickups & pantry requests</h2>
                <p>
                  Review requests for pantries you manage, track your donations
                  and manage volunteer assignments.
                </p>
                {dashboard.runs.length ? (
                  dashboard.runs.map((run) => (
                    <RunCard key={run.id} run={run}>
                      {actions(run)}
                    </RunCard>
                  ))
                ) : (
                  <p className="pantry-empty">
                    You have no pickup requests or assignments yet.
                  </p>
                )}
              </section>
            </>
          )}
          <section className="card bg-base-100 pantry-section">
            <h2>Open volunteer opportunities</h2>
            <p>
              Only accept a pickup if you can safely handle the food and meet
              its pickup window. Acceptance reserves the assignment for one
              volunteer.
            </p>
            {opportunities.length ? (
              opportunities.map((run) => (
                <RunCard key={run.id} run={run}>
                  {canClaim ? (
                    <fieldset disabled={busy}>
                      <label className="pantry-check">
                        <input
                          type="checkbox"
                          checked={!!consent[run.id]}
                          onChange={(event) =>
                            setConsent({
                              ...consent,
                              [run.id]: event.target.checked,
                            })
                          }
                          className="checkbox checkbox-primary"
                        />
                        <span>
                          I can meet this pickup window and agree to keep
                          private pickup instructions confidential.
                        </span>
                      </label>
                      <button
                        disabled={!consent[run.id] || busy}
                        onClick={() =>
                          void act(
                            `/api/volunteer/${encodeURIComponent(run.id)}/claim`,
                            { pickupConsent: true },
                            "Pickup accepted. View it in your assignments for private instructions.",
                          )
                        }
                        className="btn btn-primary"
                      >
                        Accept this pickup
                      </button>
                    </fieldset>
                  ) : (
                    <p>
                      <a href="/account">
                        Verify your account and opt in to volunteer
                      </a>{" "}
                      to accept this pickup.
                    </p>
                  )}
                </RunCard>
              ))
            ) : (
              <p className="pantry-empty">
                No open pickups right now. Check back for a new opportunity.
              </p>
            )}
          </section>
        </>
      )}
      <footer className="volunteer-footer">
        <a href="/account">Notification preferences</a>
        <a href="/privacy">Privacy</a>
        <a href="/food-hotspots">Food offers</a>
      </footer>
    </main>
  );
}
