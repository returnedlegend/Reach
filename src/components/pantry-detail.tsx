"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
const OutreachPanel = dynamic(
  () => import("./outreach-panel").then((m) => m.OutreachPanel),
  { loading: () => <p role="status">Loading inquiry controls…</p> },
);
import { useRouter } from "next/navigation";
import { offerNavigationOrigin } from "@/lib/navigation-handoff";
import {
  ArrowLeft,
  ArrowUpRight,
  Clock3,
  Heart,
  MapPin,
  Phone,
} from "lucide-react";
import type { PantryDetailResponse, PantryRecord } from "@/lib/pantry-types";
import type { PantryWindow } from "@/lib/types";
import { matchesRule } from "@/lib/recurrence";
import { formatTime, parseTime } from "@/lib/time";
import { BusyTimes } from "./busy-times";
import { LocationPicker, type SelectedLocation } from "./location-picker";
import "./pantry-pages.css";

export type PantryAccount = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  role: "user" | "administrator";
};
export async function pantryRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : data.message ||
          "This request could not be completed. Please try again.",
    );
  return data as T;
}
export function safePantryUrl(value?: string | null) {
  try {
    const url = new URL(value || "");
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
function clock(value: string) {
  try {
    return formatTime(parseTime(value));
  } catch {
    return "Time needs confirmation";
  }
}
function dateLabel(value: string | null | undefined) {
  if (!value) return "Not yet verified";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Date not known";
}
export function scheduleLabel(window: PantryWindow) {
  const rule = window.rule;
  const when =
    rule.kind === "weekly"
      ? rule.weekdays.map((day) => days[day]).join(", ")
      : rule.kind === "nth-weekday"
        ? `${["", "First", "Second", "Third", "Fourth", "Fifth"][rule.nth]} ${days[rule.weekday]} each month`
        : rule.kind === "first-weekdays"
          ? `First ${rule.count} ${days[rule.weekday]}s each month`
          : rule.dates.map(dateLabel).join(", ");
  return `${when} · ${clock(window.opens)}–${clock(window.closes)}`;
}
function chicagoNow(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
function status(pantry: PantryRecord, now: Date) {
  const local = chicagoNow(now);
  const today = pantry.windows.filter((window) =>
    matchesRule(window.rule, local.date),
  );
  if (pantry.closures.includes(local.date))
    return {
      label: "Closed today · published exception",
      today: "A closure is recorded for today.",
    };
  if (
    !pantry.windows.length ||
    today.some((window) => window.conflictingSources || !window.policyKnown) ||
    /programmed closures?|closure dates?|except game days|game-day/i.test(
      pantry.notes,
    )
  )
    return {
      label: "Current status unknown",
      today: today.length
        ? today
            .map((window) => `${clock(window.opens)}–${clock(window.closes)}`)
            .join(" · ") + " · Confirm before visiting."
        : "Today's hours need confirmation.",
    };
  const open = today.some(
    (window) =>
      local.minute >= parseTime(window.opens) &&
      local.minute < parseTime(window.closes),
  );
  return {
    label: open ? "Open in published schedule" : "Closed in published schedule",
    today: today.length
      ? today
          .map((window) => `${clock(window.opens)}–${clock(window.closes)}`)
          .join(" · ")
      : "No distribution is listed for today.",
  };
}

export function PantryDetail({
  id: pantryId,
  initialOrigin = null,
  initialLocation,
  embedded = false,
  onDirections,
  onLocationChange,
}: {
  id: string;
  initialOrigin?: { lat: number; lng: number } | null;
  initialLocation?: SelectedLocation | null;
  embedded?: boolean;
  onDirections?: (origin: SelectedLocation | null) => void;
  onLocationChange?: (origin: SelectedLocation | null) => void;
}) {
  const router = useRouter();
  const [showInquiry, setShowInquiry] = useState(false);
  const [data, setData] = useState<PantryDetailResponse | null>(null);
  const [user, setUser] = useState<PantryAccount | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [correction, setCorrection] = useState("");
  const [correctionMessage, setCorrectionMessage] = useState("");
  const [localOrigin, setLocalOrigin] = useState<SelectedLocation | null>(
    initialLocation ??
      (initialOrigin
        ? {
            coordinates: initialOrigin,
            label: "Selected starting point",
            source: "map",
          }
        : null),
  );
  // Embedded detail shares the journey's current point, including GPS accuracy
  // and subsequent fixes. Standalone detail keeps its selection in memory.
  const origin = onLocationChange ? (initialLocation ?? null) : localOrigin;
  function setOrigin(value: SelectedLocation | null) {
    if (onLocationChange) onLocationChange(value);
    else setLocalOrigin(value);
  }
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setData(null);
    pantryRequest<PantryDetailResponse>(
      `/api/pantries/${encodeURIComponent(pantryId)}`,
      { signal: controller.signal },
    )
      .then(setData)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [pantryId, reload]);
  useEffect(() => {
    const controller = new AbortController();
    pantryRequest<{ user: PantryAccount | null }>("/api/account/me", {
      signal: controller.signal,
    })
      .then(({ user: account }) => {
        setUser(account);
        if (account)
          pantryRequest<{ pantries: PantryRecord[] }>(
            "/api/pantries/favorites",
            { signal: controller.signal },
          )
            .then((result) =>
              setFavorite(
                result.pantries.some((pantry) => pantry.id === pantryId),
              ),
            )
            .catch(() => {});
      })
      .catch(() => {});
    return () => controller.abort();
  }, [pantryId]);
  async function toggleFavorite() {
    if (!user) {
      setMessage("Sign in to your account to save favorite pantries.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await pantryRequest("/api/pantries/favorites", {
        method: favorite ? "DELETE" : "POST",
        body: JSON.stringify({ id: pantryId }),
      });
      setFavorite(!favorite);
      setMessage(
        favorite ? "Removed from favorites." : "Saved to your favorites.",
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Could not update favorites.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function submitCorrection(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setCorrectionMessage("");
    try {
      await pantryRequest(
        `/api/pantries/${encodeURIComponent(pantryId)}/corrections`,
        { method: "POST", body: JSON.stringify({ description: correction }) },
      );
      setCorrection("");
      setCorrectionMessage(
        "Thank you. Your correction has been sent for review.",
      );
    } catch (reason) {
      setCorrectionMessage(
        reason instanceof Error
          ? reason.message
          : "Your correction could not be sent.",
      );
    } finally {
      setSaving(false);
    }
  }
  const pantry = data?.pantry;
  const current = pantry && now ? status(pantry, now) : null;
  const directions = pantry
    ? new URL("https://www.google.com/maps/dir/")
    : null;
  if (directions && pantry) {
    directions.searchParams.set("api", "1");
    directions.searchParams.set(
      "destination",
      pantry.coordinates
        ? `${pantry.coordinates.lat},${pantry.coordinates.lng}`
        : pantry.address,
    );
    directions.searchParams.set("travelmode", "transit");
    if (origin)
      directions.searchParams.set(
        "origin",
        `${origin.coordinates.lat},${origin.coordinates.lng}`,
      );
  }
  return (
    <article
      className={`pantry-page${embedded ? " pantry-page-embedded" : ""}`}
    >
      {!embedded && (
        <nav className="pantry-nav" aria-label="Pantry navigation">
          <Link href="/" className="pantry-back">
            <ArrowLeft size={18} /> Back to Reach
          </Link>
          <Link href="/account">Your account</Link>
        </nav>
      )}
      {error ? (
        <section className="card bg-base-100 pantry-section" role="alert">
          <h1>Pantry details unavailable</h1>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            className="btn btn-primary"
          >
            Try again
          </button>
        </section>
      ) : !pantry || !data ? (
        <section className="card bg-base-100 pantry-section" role="status">
          <h1>Loading pantry details…</h1>
          <p>Finding the latest information.</p>
        </section>
      ) : (
        <>
          <header className="pantry-hero">
            <p className="pantry-eyebrow">
              Food assistance · {pantry.city ?? "Central Texas"}
            </p>
            <h1>{pantry.name}</h1>
            <p className="pantry-address">
              <MapPin size={19} aria-hidden="true" />
              {pantry.address || "Address needs confirmation"}
            </p>
            <div className="pantry-actions pantry-hero-actions">
              <span className="pantry-tag pantry-status">
                <Clock3 size={15} aria-hidden="true" />
                {current?.label ?? "Checking published hours…"}
              </span>
              <button
                className="btn btn-outline pantry-secondary"
                type="button"
                disabled={saving}
                aria-pressed={favorite}
                onClick={toggleFavorite}
              >
                <Heart size={18} fill={favorite ? "currentColor" : "none"} />
                {favorite ? "Saved pantry" : "Save pantry"}
              </button>
              {data.permissions.canEdit && (
                <Link className="btn btn-primary pantry-button" href="/manage">
                  Manage pantry
                </Link>
              )}
            </div>
            <p className="pantry-muted">
              Published hours can change. Contact the pantry to confirm your
              visit and food availability.
            </p>
            {!user && (
              <p className="pantry-muted pantry-sign-in">
                <Link href="/account">Sign in</Link> to keep favorites across
                devices.
              </p>
            )}
          </header>
          {message && (
            <p className="pantry-notice" role="status">
              {message}
            </p>
          )}
          <section
            className="card bg-base-100 pantry-section"
            aria-labelledby="pantry-contact-assistant"
          >
            <h2 id="pantry-contact-assistant">Questions before you travel?</h2>
            <p>
              Check routes with the assistant or review an inquiry to an
              enrolled pantry contact. Food availability is not guaranteed.
              Email requires sign-in and your approval.
            </p>
            <div className="pantry-actions">
              <Link
                className="btn btn-outline"
                href={`/?assistant=1&pantry=${encodeURIComponent(pantryId)}`}
              >
                Reach AI assistant
              </Link>
              <button
                className="btn btn-primary"
                type="button"
                aria-expanded={showInquiry}
                onClick={() => setShowInquiry((v) => !v)}
              >
                Ask about availability
              </button>
            </div>
            {showInquiry && <OutreachPanel pantryId={pantryId} />}
          </section>
          <div className="pantry-detail-grid">
            <section className="card bg-base-100 pantry-section">
              <p className="pantry-eyebrow">Before you go</p>
              <h2>Hours &amp; visiting</h2>
              <div className="pantry-today">
                <h3>Today’s distribution hours</h3>
                <p>{current?.today ?? "Checking today’s schedule…"}</p>
                <p className="pantry-muted">All times are Central Time.</p>
              </div>
              <details open>
                <summary>Full distribution schedule</summary>
                {pantry.windows.length ? (
                  <ul className="pantry-schedule">
                    {pantry.windows.map((window) => (
                      <li key={window.id}>
                        <strong>{scheduleLabel(window)}</strong>
                        {window.distributionCutoff && (
                          <span>
                            Distribution cutoff{" "}
                            {clock(window.distributionCutoff)}.
                          </span>
                        )}
                        {(window.appointmentRequired !== undefined ||
                          window.registrationOpens ||
                          window.registrationCutoff) && (
                          <div className="pantry-registration">
                            <span className="pantry-registration-label">
                              Registration &amp; appointments
                            </span>
                            {window.appointmentRequired !== undefined && (
                              <span>
                                Appointment{" "}
                                {window.appointmentRequired
                                  ? "required"
                                  : "not required"}
                                .
                              </span>
                            )}
                            {window.registrationOpens && (
                              <span>
                                Registration opens{" "}
                                {clock(window.registrationOpens)}.
                              </span>
                            )}
                            {window.registrationCutoff && (
                              <span>
                                Registration closes{" "}
                                {clock(window.registrationCutoff)}.
                              </span>
                            )}
                          </div>
                        )}
                        {window.conflictingSources && (
                          <span className="pantry-warning">
                            Published sources conflict. Confirm this window.
                          </span>
                        )}
                        {!window.policyKnown && (
                          <span>Pickup policy needs confirmation.</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {pantry.hours ||
                      "Distribution hours have not been verified."}
                  </p>
                )}
                {pantry.closures.length > 0 && (
                  <p>
                    Recorded closure dates:{" "}
                    {pantry.closures.map(dateLabel).join(", ")}
                  </p>
                )}
              </details>
            </section>
            <section className="card bg-base-100 pantry-section">
              <p className="pantry-eyebrow">Food &amp; essentials</p>
              <h2>Food availability</h2>
              <p>
                {pantry.offering || "Food categories have not been verified."}
              </p>
              <p className="pantry-muted">
                Reported availability can change and does not guarantee food at
                pickup.
              </p>
              {data.inventory.length ? (
                <ul className="pantry-inventory">
                  {data.inventory.map((item) => (
                    <li key={item.category}>
                      <div>
                        <strong>{item.category}</strong>
                        <span className="pantry-tag">
                          {
                            {
                              available: "Reported available",
                              limited: "Reported limited",
                              unavailable: "Reported unavailable",
                              unknown: "Availability unknown",
                            }[item.status]
                          }
                        </span>
                      </div>
                      <p>
                        {item.quantity !== null
                          ? `Reported quantity: ${item.quantity}. `
                          : ""}
                        Updated {dateLabel(item.updatedAt)}
                        {Date.now() - Date.parse(item.updatedAt) >
                        48 * 60 * 60 * 1000
                          ? " · Older report; confirm availability"
                          : ""}
                        .
                      </p>
                      <p className="pantry-muted">
                        Source: {item.source || "Not specified"}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="pantry-empty">
                  <strong>Current inventory unknown</strong>
                  <p>The pantry has not shared current food availability.</p>
                </div>
              )}
            </section>
          </div>
          <BusyTimes
            pantryId={pantryId}
            canReport={Boolean(user?.emailVerified)}
          />
          <section className="card bg-base-100 pantry-section">
            <p className="pantry-eyebrow">Getting there</p>
            <h2>Transportation &amp; directions</h2>
            <p>
              Get walking or driving directions here in Reach. Public transit
              depends on verified schedules, not the street map.
            </p>
            <div className="pantry-actions pantry-directions-actions">
              <button
                className="btn btn-primary pantry-button"
                type="button"
                onClick={() => {
                  if (onDirections) onDirections(origin);
                  else {
                    offerNavigationOrigin(pantryId, origin);
                    router.push(
                      `/?directions=${encodeURIComponent(pantryId)}&mode=walking`,
                    );
                  }
                }}
              >
                Get directions
              </button>
              {directions && (
                <a
                  className="pantry-secondary"
                  href={directions.toString()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Google Maps (transit){" "}
                  <ArrowUpRight size={17} aria-hidden="true" />
                </a>
              )}
              <Link href="/pantry-planner">
                Plan a round trip with Reach{" "}
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <details>
              <summary>
                {origin
                  ? "Change your starting point"
                  : "Choose a starting point"}
              </summary>
              <LocationPicker
                value={origin}
                onChange={setOrigin}
                resources={[pantry]}
              />
            </details>
            {origin && (
              <p>
                Starting from {origin.label}{" "}
                <button
                  type="button"
                  onClick={() => setOrigin(null)}
                  className="btn btn-primary"
                >
                  Clear starting point
                </button>
              </p>
            )}
            <p className="pantry-muted">
              Requesting a route sends your selected coordinates to the routing
              provider. Google Maps opens separately and calculates its own
              route. Confirm schedules and an accessible entrance.
            </p>
            <details className="pantry-privacy-details">
              <summary>About your starting point &amp; directions</summary>
              <p className="pantry-muted">
                Your selected point stays in this page’s memory. Address
                searches send the entered address to a geocoding provider.
                External directions may differ from Reach’s published transit
                planning.
              </p>
            </details>
          </section>
          <section className="card bg-base-100 pantry-section pantry-visit-details">
            <p className="pantry-eyebrow">A little preparation</p>
            <h2>More for your visit</h2>
            <details>
              <summary>Eligibility &amp; what to bring</summary>
              <p>
                {pantry.eligibility ||
                  "Eligibility requirements have not been verified."}
              </p>
            </details>
            <details>
              <summary>Accessibility</summary>
              <p>
                {pantry.accessibility ||
                  "Accessibility information has not been verified. Contact the pantry about your needs."}
              </p>
            </details>
          </section>
          <section className="card bg-base-100 pantry-section">
            <p className="pantry-eyebrow">Stay informed</p>
            <h2>Contact &amp; information sources</h2>
            <div className="pantry-actions">
              {pantry.phone && (
                <a
                  className="btn btn-primary pantry-button"
                  href={`tel:${pantry.phone.replace(/[^+\d]/g, "")}`}
                >
                  <Phone size={17} />
                  {pantry.phone}
                </a>
              )}
              {safePantryUrl(pantry.website) && (
                <a
                  href={safePantryUrl(pantry.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Pantry website <ArrowUpRight size={15} />
                </a>
              )}
              {!pantry.phone && !safePantryUrl(pantry.website) && (
                <p>Contact information has not been verified.</p>
              )}
            </div>
            <p className="pantry-muted">
              Last verified: {dateLabel(pantry.lastVerified)}.
            </p>
            <details>
              <summary>Sources, freshness &amp; visit notes</summary>
              {pantry.notes && <p>{pantry.notes}</p>}
              {pantry.detailsNeedConfirmation && (
                <p>Some details need confirmation with the provider.</p>
              )}
              {pantry.sources.length ? (
                <ul>
                  {pantry.sources.map((source, index) => (
                    <li key={`${source.title}-${index}`}>
                      {safePantryUrl(source.url) ? (
                        <a
                          href={safePantryUrl(source.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.title}
                        </a>
                      ) : (
                        source.title
                      )}
                      {source.checkedOn
                        ? ` · Checked ${dateLabel(source.checkedOn)}`
                        : " · Check date not recorded"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No supporting sources are recorded.</p>
              )}
              <p className="pantry-muted">
                Listing updated {dateLabel(pantry.updatedAt)}. An edited listing
                does not establish independent verification.
              </p>
            </details>
            <details className="pantry-report">
              <summary>Report incorrect information</summary>
              <p>
                Tell us what needs updating and include a source or provider
                confirmation when possible. A reviewer checks suggested changes
                before publication.
              </p>
              {user?.emailVerified ? (
                <form className="pantry-form" onSubmit={submitCorrection}>
                  <label>
                    Suggested correction
                    <textarea
                      required
                      minLength={10}
                      maxLength={2000}
                      rows={4}
                      value={correction}
                      onChange={(event) => setCorrection(event.target.value)}
                      className="textarea textarea-bordered"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={saving}
                    className="btn btn-primary"
                  >
                    {saving ? "Sending…" : "Send correction for review"}
                  </button>
                </form>
              ) : (
                <p>
                  <Link href="/account">Sign in and verify your email</Link> to
                  submit a correction.
                </p>
              )}
              {correctionMessage && (
                <p role="status" className="pantry-notice">
                  {correctionMessage}
                </p>
              )}
            </details>
          </section>
        </>
      )}
    </article>
  );
}
