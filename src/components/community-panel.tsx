"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  COMMUNITY_PICKUP_AREAS,
  type CommunityDiscovery,
  type CommunityMine,
  type CommunityModeration,
  type CommunityRecord,
  type CommunityRequest,
  type CommunityUser,
  type HotspotDraft,
  type OfferDraft,
} from "@/lib/community-types";
import type { CommunityMapMarker } from "@/lib/map-types";
import { googleMapsUrl, validCoordinates } from "@/lib/journey";
import { JourneyMap } from "./journey-map";
import "./community-panel.css";

type Props = {
  hotspotRequest?: number;
  origin?: { lat: number; lng: number } | null;
  onDiscoveryChange?: (markers: CommunityMapMarker[]) => void;
  selectedMarkerId?: string;
};
type View =
  | "discover"
  | "offer"
  | "hotspot"
  | "dashboard"
  | "account"
  | "moderation";
class CommunityError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
function isCommunityDisabled(error: unknown): boolean {
  return (
    error instanceof CommunityError &&
    error.status === 503 &&
    (error.code === "community_disabled" ||
      // Support older servers that predate the structured error contract.
      (error.code === undefined &&
        error.message.toLowerCase().includes("disabled")))
  );
}
async function api<T>(
  path: string,
  data?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`/api/community/${path}`, {
    method: data === undefined ? "GET" : method,
    credentials: "same-origin",
    cache: "no-store",
    ...(data === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new CommunityError(
      "The community service returned an unreadable response. Please try again.",
      response.status,
    );
  }
  if (!response.ok)
    throw new CommunityError(
      typeof result === "object" &&
      result &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "The community service could not complete this request.",
      response.status,
      typeof result === "object" &&
      result &&
      "code" in result &&
      typeof result.code === "string"
        ? result.code
        : undefined,
    );
  if (!result || typeof result !== "object")
    throw new CommunityError(
      "The community service returned an incomplete response. Please try again.",
      response.status,
    );
  return result as T;
}
const explain = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
const when = (value: string) =>
  Number.isNaN(Date.parse(value))
    ? "Time unavailable"
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(value));
const deviceTime = (value?: string) => {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const endpoint = (record: CommunityRecord) =>
  `${record.kind === "hotspot" ? "hotspots" : "offers"}/${record.id}`;
const areaName = (record: CommunityRecord) =>
  record.kind === "hotspot"
    ? record.address || "Public location"
    : COMMUNITY_PICKUP_AREAS.find((area) => area.id === record.pickupAreaId)
        ?.label || "Approximate pickup area";
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="community-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function RecordDetails({ record }: { record: CommunityRecord }) {
  return (
    <>
      {record.photoUrl && (
        <img
          className="community-photo"
          src={record.photoUrl}
          alt={`Photo supplied for ${record.title}`}
          loading="lazy"
        />
      )}
      <p>{record.description}</p>
      <dl className="community-facts">
        <div>
          <dt>Pickup area</dt>
          <dd>{areaName(record)}</dd>
        </div>
        <div>
          <dt>Pickup window</dt>
          <dd>
            {when(record.startsAt)} – {when(record.endsAt)}
          </dd>
        </div>
        {record.kind === "hotspot" ? (
          <>
            <div>
              <dt>Organizer</dt>
              <dd>{record.organizerName}</dd>
            </div>
            <div>
              <dt>Food / quantity</dt>
              <dd>
                {record.foodCategory}
                {record.quantityText ? ` · ${record.quantityText}` : ""}
              </dd>
            </div>
            <div>
              <dt>Requirements</dt>
              <dd>{record.eligibility}</dd>
            </div>
            <div>
              <dt>Accessibility</dt>
              <dd>{record.accessibility}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>{record.contact}</dd>
            </div>
            <div>
              <dt>Pickup instructions</dt>
              <dd>{record.pickupInstructions}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Food category</dt>
              <dd>
                {record.foodCategory === "canned-groceries"
                  ? "Canned groceries"
                  : record.foodCategory === "dry-groceries"
                    ? "Dry groceries"
                    : record.foodCategory === "sealed-snacks"
                      ? "Sealed snacks"
                      : record.foodCategory || "Not specified"}
              </dd>
            </div>
            <div>
              <dt>Quantity</dt>
              <dd>{record.quantity} item(s), offered together</dd>
            </div>
            <div>
              <dt>Allergens</dt>
              <dd>{record.allergens}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{record.storage}</dd>
            </div>
            <div>
              <dt>Use by</dt>
              <dd>{record.useBy}</dd>
            </div>
            <div>
              <dt>Food safety</dt>
              <dd>
                Giver attests sealed, undamaged, shelf stable, commercially
                prepared and not recalled, with readable original labels and no
                infant formula, supplements or alcohol. Check the label before
                accepting.
              </dd>
            </div>
          </>
        )}
      </dl>
      <p className="community-small">
        Availability is reported by the organizer or giver. A listing does not
        guarantee food is still available.
        {record.kind === "hotspot" &&
          " Hotspot details are community reported and have not been independently verified."}
      </p>
    </>
  );
}

function HotspotDirections({
  record,
  origin,
}: {
  record: CommunityRecord;
  origin?: Props["origin"];
}) {
  if (
    record.kind !== "hotspot" ||
    !validCoordinates({ lat: record.lat, lng: record.lng })
  )
    return null;
  const destination = { lat: record.lat!, lng: record.lng! };
  const hasOrigin = validCoordinates(origin);
  const href = hasOrigin
    ? googleMapsUrl(origin, destination, "walking")
    : `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: `${destination.lat},${destination.lng}`, travelmode: "walking" })}`;
  return (
    <div className="community-directions">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {hasOrigin
          ? "Walking directions in Google Maps"
          : "Choose a start in Google Maps"}
        <span className="community-small"> (opens a new tab)</span>
      </a>
      <p className="community-small">
        Google Maps calculates walking directions outside Reach.
        {hasOrigin
          ? " Opening this link shares your selected starting point with Google Maps."
          : " Choose your starting point there."}
      </p>
    </div>
  );
}

export function CommunityPanel({
  hotspotRequest = 0,
  origin,
  onDiscoveryChange,
  selectedMarkerId,
}: Props) {
  const [view, setView] = useState<View>("discover");
  const [afterSignIn, setAfterSignIn] = useState<View>("dashboard");
  const [clock, setClock] = useState(() => Date.now());
  const [pollingError, setPollingError] = useState("");
  const emittedMarkers = useRef<string | null>(null);
  const [discovery, setDiscovery] = useState<CommunityDiscovery | null>(null);
  const [user, setUser] = useState<CommunityUser | null>(null);
  const [mine, setMine] = useState<CommunityMine | null>(null);
  const [moderation, setModeration] = useState<CommunityModeration | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CommunityRecord | null>(null);
  const [pickup, setPickup] = useState<Record<string, string>>({});
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const callback = useRef(onDiscoveryChange);
  useEffect(() => {
    if (!hotspotRequest) return;
    setView("discover");
    setFilter("hotspot");
    setSearch("");
    setAvailability("all");
  }, [hotspotRequest]);
  useEffect(() => {
    callback.current = onDiscoveryChange;
  }, [onDiscoveryChange]);

  async function refresh() {
    const [found, account] = await Promise.all([
      api<CommunityDiscovery>("discovery"),
      api<{ user: CommunityUser | null }>("me"),
    ]);
    if (
      !Array.isArray(found.hotspots) ||
      !Array.isArray(found.offers) ||
      !("user" in account)
    )
      throw new Error(
        "The community service returned incomplete information. Please refresh.",
      );
    setDiscovery(found);
    setUser(account.user);
    setDisabled(false);
    if (account.user) {
      const own = await api<CommunityMine>("mine");
      if (
        !Array.isArray(own.hotspots) ||
        !Array.isArray(own.offers) ||
        !Array.isArray(own.requests)
      )
        throw new Error("Your dashboard could not be read. Please refresh.");
      setMine(own);
      if (account.user.role === "moderator")
        setModeration(await api<CommunityModeration>("moderation"));
      else setModeration(null);
    } else {
      setMine(null);
      setModeration(null);
      setPickup({});
    }
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await refresh();
      } catch (failure) {
        if (active) {
          if (isCommunityDisabled(failure)) setDisabled(true);
          else setError(explain(failure));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") setClock(Date.now());
    }, 1000);
    const resume = () => {
      if (document.visibilityState !== "hidden") setClock(Date.now());
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  useEffect(() => {
    if (disabled || discovery?.mode !== "development") return;
    let active = true;
    let pending = false;
    const poll = async () => {
      if (document.visibilityState === "hidden" || pending) return;
      pending = true;
      try {
        const found = await api<CommunityDiscovery>("discovery");
        if (!Array.isArray(found.hotspots) || !Array.isArray(found.offers))
          throw new Error("Incomplete community listings.");
        if (active) {
          setDiscovery(found);
          setPollingError("");
        }
      } catch (failure) {
        if (active) {
          if (isCommunityDisabled(failure)) {
            setDisabled(true);
            setDiscovery(null);
          } else
            setPollingError(
              "Community listings could not refresh. Use Refresh listings to try again.",
            );
        }
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(poll, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [disabled, discovery?.mode]);
  const visible = useMemo(
    () =>
      [...(discovery?.hotspots || []), ...(discovery?.offers || [])]
        .map((record) => ({
          ...record,
          availability:
            Date.parse(record.startsAt) > clock
              ? ("scheduled" as const)
              : ("active" as const),
        }))
        .filter(
          (record) =>
            record.status === "approved" &&
            Date.parse(record.endsAt) > clock &&
            (filter === "all" || record.kind === filter) &&
            (availability === "all" || record.availability === availability) &&
            `${record.title} ${record.description} ${areaName(record)}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        ),
    [discovery, filter, availability, search, clock],
  );
  const markers = useMemo<CommunityMapMarker[]>(
    () =>
      visible.flatMap((record) => {
        const area = COMMUNITY_PICKUP_AREAS.find(
          (item) => item.id === record.pickupAreaId,
        );
        const lat = record.kind === "offer" ? area?.lat : record.lat;
        const lng = record.kind === "offer" ? area?.lng : record.lng;
        return typeof lat === "number" && typeof lng === "number"
          ? [{ id: record.id, kind: record.kind, name: record.title, lat, lng }]
          : [];
      }),
    [visible],
  );
  useEffect(() => {
    const signature = JSON.stringify(markers);
    if (emittedMarkers.current !== signature) {
      emittedMarkers.current = signature;
      callback.current?.(markers);
    }
  }, [markers]);
  useEffect(() => {
    if (!selectedMarkerId) return;
    setView("discover");
    setFilter("all");
    setAvailability("all");
    setSearch("");
    requestAnimationFrame(() =>
      document
        .getElementById(`community-item-${selectedMarkerId}`)
        ?.scrollIntoView({ block: "nearest", behavior: "instant" }),
    );
  }, [selectedMarkerId]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await refresh();
    } catch (failure) {
      setError(explain(failure));
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: View) {
    if (next === "account")
      setAfterSignIn(
        view === "hotspot" || view === "offer" ? view : "dashboard",
      );
    setView(next);
    setError("");
    setNotice("");
    if (next === "offer" || next === "hotspot") setEditing(null);
  }
  function changeRecord(
    record: CommunityRecord,
    action: "submit" | "cancel" | "end",
  ) {
    return run(
      async () => {
        await api(`${endpoint(record)}/${action}`, {});
      },
      action === "submit"
        ? record.kind === "hotspot"
          ? "Hotspot published. Its details are community reported and unverified; check the information before traveling."
          : "Submitted for moderator review. It will appear publicly only after approval."
        : action === "cancel"
          ? "Listing cancelled. Active requests have been cancelled."
          : "Listing ended. Active requests have been cancelled.",
    );
  }
  function changeRequest(
    request: CommunityRequest,
    action: "accept" | "decline" | "cancel" | "collect",
  ) {
    return run(
      async () => {
        await api(`requests/${request.id}/${action}`, {});
        setPickup({});
      },
      action === "collect"
        ? "Collection recorded and offer ended."
        : `Request ${action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled"}.`,
    );
  }
  const tabs: { id: View; label: string }[] = [
    { id: "discover", label: "Find food" },
    { id: "offer", label: "Share Food" },
    { id: "hotspot", label: "Create Food Hotspot" },
    ...(user ? [{ id: "dashboard" as const, label: "My activity" }] : []),
    ...(user?.role === "moderator"
      ? [{ id: "moderation" as const, label: "Moderation" }]
      : []),
    { id: "account", label: user ? "My account" : "Sign in" },
  ];
  return (
    <section
      className="community-panel"
      data-testid="community-panel"
      aria-label="Community food sharing"
    >
      <div className="community-heading">
        <div>
          <p className="community-eyebrow">NEIGHBORS HELPING NEIGHBORS</p>
          <h2>Community food</h2>
          <p>
            Public food hotspots and small food offers around Bryan–College
            Station.
          </p>
        </div>
      </div>
      {loading ? (
        <p role="status">Loading community food…</p>
      ) : disabled ? (
        <div className="community-empty">
          <h3>Community sharing is not enabled</h3>
          <p>
            Community sharing is currently unavailable. You can still use the
            food resources and trip planner.
          </p>
          {error && (
            <p role="alert" className="community-error">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(refresh, "Community status refreshed.")}
            className="btn btn-primary"
          >
            Check again
          </button>
        </div>
      ) : (
        <>
          {discovery?.mode === "development" && (
            <div className="community-banner">
              <strong>Community guidelines</strong>
              <span>
                Food offers are reviewed before publication. Hotspots are
                community reported and unverified. Food, identity, availability
                and safety are not independently verified. Adults 18+ only.
              </span>
            </div>
          )}
          <nav
            className="tabs tabs-box community-tabs"
            aria-label="Community views"
          >
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                aria-current={view === tab.id ? "page" : undefined}
                onClick={() => navigate(tab.id)}
                className={`tab btn ${view === tab.id ? "tab-active btn-primary" : "btn-ghost"}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div aria-live="polite" className="community-status">
            {notice && (
              <p role="status" className="community-notice">
                {notice}
              </p>
            )}
            {busy && <p role="status">Saving or refreshing…</p>}
          </div>
          {error && (
            <div
              role="alert"
              className="community-error"
              data-testid="community-error"
            >
              <p>{error}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(refresh, "Community information refreshed.")}
                className="btn btn-primary"
              >
                Refresh community
              </button>
            </div>
          )}
          {view === "discover" && (
            <div data-testid="community-discovery">
              <div className="community-section-heading">
                <h3>Find community food</h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(refresh, "Listings refreshed.")}
                  className="btn btn-primary"
                >
                  Refresh listings
                </button>
              </div>
              <p className="community-small">
                Times are shown in America/Chicago. Food offers show a named
                approximate area; map pins are not pickup addresses.
              </p>
              <div className="community-filters">
                <Field label="Search community posts">
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Food, place or description"
                    className="input input-bordered"
                  />
                </Field>
                <Field label="Post type">
                  <select
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    className="input input-bordered"
                  >
                    <option value="all">All community food</option>
                    <option value="hotspot">Food hotspots</option>
                    <option value="offer">Food offers</option>
                  </select>
                </Field>
                <Field label="Pickup timing">
                  <select
                    value={availability}
                    onChange={(event) => setAvailability(event.target.value)}
                    className="input input-bordered"
                  >
                    <option value="all">All pickup windows</option>
                    <option value="active">Window open now</option>
                    <option value="scheduled">Upcoming</option>
                  </select>
                </Field>
              </div>
              {pollingError && (
                <p className="community-error" role="status">
                  {pollingError}
                </p>
              )}
              {!discovery ? (
                <div className="community-empty">
                  <h4>Community posts have not loaded</h4>
                  <p>Refresh community to check current posts.</p>
                </div>
              ) : !visible.length ? (
                <div className="community-empty">
                  <h4>
                    {search || filter !== "all" || availability !== "all"
                      ? "No posts match these filters"
                      : "No approved food posts yet"}
                  </h4>
                  <p>
                    {search || filter !== "all" || availability !== "all"
                      ? "Try another search or pickup window."
                      : "Food offers appear after moderator approval. Hotspots are published by signed-in adults and are community reported, not independently verified."}
                  </p>
                </div>
              ) : (
                <div className="community-cards">
                  {visible.map((record) => (
                    <article
                      tabIndex={-1}
                      id={`community-item-${record.id}`}
                      key={record.id}
                      className={`card bg-base-100 community-card${selectedMarkerId === record.id ? " community-selected" : ""}`}
                    >
                      <div className="community-card-top">
                        <span className="community-tag">
                          {record.kind === "hotspot"
                            ? "Food hotspot · community reported, unverified"
                            : "Food offer"}
                        </span>
                        <span className="community-small">
                          {record.availability === "active"
                            ? "Pickup window open"
                            : "Upcoming pickup"}
                        </span>
                      </div>
                      <h4>{record.title}</h4>
                      <RecordDetails record={record} />
                      <HotspotDirections record={record} origin={origin} />
                      {record.kind === "offer" &&
                        record.ownerId !== user?.id &&
                        (user ? (
                          mine?.requests.some(
                            (request) =>
                              request.offerId === record.id &&
                              request.requesterId === user.id,
                          ) ? (
                            <p className="community-notice">
                              You have a request for this offer. Check My
                              activity.
                            </p>
                          ) : (
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                void run(async () => {
                                  await api(`offers/${record.id}/request`, {
                                    pickupConsent: true,
                                  });
                                }, "Request sent. The giver must accept before pickup details can be shared.");
                              }}
                            >
                              <label className="community-check">
                                <input
                                  type="checkbox"
                                  required
                                  disabled={busy}
                                  className="checkbox checkbox-primary"
                                />
                                <span>
                                  I agree to receive private pickup instructions
                                  after acceptance and to meet only at a public
                                  place.
                                </span>
                              </label>
                              <button
                                type="submit"
                                disabled={busy}
                                className="btn btn-primary"
                              >
                                Request this food
                              </button>
                            </form>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => navigate("account")}
                            className="btn btn-primary"
                          >
                            Sign in to request food
                          </button>
                        ))}
                      {user && record.ownerId !== user.id && (
                        <details className="community-safety">
                          <summary>Report or block</summary>
                          <p className="community-small">
                            A report goes to moderators. Blocking hides this
                            person’s posts and cancels requests between you.
                          </p>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              const data = new FormData(event.currentTarget);
                              void run(async () => {
                                await api("reports", {
                                  targetType: record.kind,
                                  targetId: record.id,
                                  reason: String(data.get("reason")),
                                });
                              }, "Report sent to moderators.");
                            }}
                          >
                            <Field label="Reason for reporting">
                              <textarea
                                name="reason"
                                required
                                maxLength={500}
                                rows={2}
                                className="textarea textarea-bordered"
                              />
                            </Field>
                            <div className="community-actions">
                              <button
                                type="submit"
                                disabled={busy}
                                className="btn btn-primary"
                              >
                                Send report
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline community-secondary"
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    await api("blocks", {
                                      userId: record.ownerId,
                                    });
                                  }, "Account blocked. Posts are hidden and requests between you have been cancelled.")
                                }
                              >
                                Block this account
                              </button>
                            </div>
                          </form>
                        </details>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
          {(view === "offer" || view === "hotspot") && (
            <div>
              {!user ? (
                <div className="community-empty">
                  <h3>
                    {view === "offer" ? "Share Food" : "Create Food Hotspot"}
                  </h3>
                  <p>
                    Sign in or create an adult account to publish a community
                    post.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate("account")}
                    className="btn btn-primary"
                  >
                    Sign in or create account
                  </button>
                </div>
              ) : (
                <PostForm
                  key={editing?.id || view}
                  kind={view === "offer" ? "offer" : "hotspot"}
                  record={editing}
                  busy={busy}
                  onCancel={() => {
                    setEditing(null);
                    navigate("dashboard");
                  }}
                  onSave={(draft, photo) =>
                    run(
                      async () => {
                        const result = await api<{ record: CommunityRecord }>(
                          editing
                            ? endpoint(editing)
                            : view === "offer"
                              ? "offers"
                              : "hotspots",
                          draft,
                          editing ? "PATCH" : "POST",
                        );
                        if (!result.record?.id)
                          throw new Error(
                            "The draft response was incomplete. Refresh My activity before trying again.",
                          );
                        setEditing(null);
                        setView("dashboard");
                        if (photo) {
                          try {
                            const uploaded = await api<{
                              record: CommunityRecord;
                            }>(`${endpoint(result.record)}/photo`, {
                              dataUrl: photo,
                            });
                            if (!uploaded.record?.photoUrl)
                              throw new Error(
                                "The photo response was incomplete.",
                              );
                          } catch (failure) {
                            await refresh();
                            throw new Error(
                              `Your draft was saved, but its photo was not saved. ${explain(failure)} Edit the draft to try the photo again.`,
                            );
                          }
                        }
                      },
                      view === "hotspot"
                        ? "Draft saved privately. Publish it from My activity when you are ready. Published hotspot details are community reported and unverified."
                        : "Draft saved privately. Choose Submit for review in My activity when you are ready.",
                    )
                  }
                />
              )}
            </div>
          )}
          {view === "account" && (
            <div data-testid="community-account" className="community-account">
              {user ? (
                <>
                  <h3>Your account</h3>
                  <p>
                    <a href="/account">
                      Profile, email verification, and account settings
                    </a>
                  </p>
                  <p>
                    Signed in as <strong>{user.username}</strong> · {user.role}
                  </p>
                  <p className="community-small">
                    Keep your password private. Community accounts are for
                    adults 18 and older.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api("auth/logout", {});
                        setUser(null);
                        setMine(null);
                        setModeration(null);
                        setPickup({});
                        setEditing(null);
                        setView("discover");
                      }, "Signed out.")
                    }
                    className="btn btn-primary"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <h3>
                    {authMode === "signup"
                      ? "Create your community account"
                      : "Sign in to community"}
                  </h3>
                  <p>No account is needed to browse approved public posts.</p>
                  <p>
                    <a href="/account">
                      Use your existing email or Google account
                    </a>
                    . The form below is for community username accounts.
                  </p>
                  <form
                    key={authMode}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      const payload = {
                        username: String(data.get("username"))
                          .trim()
                          .toLowerCase(),
                        password: String(data.get("password")),
                        ...(authMode === "signup"
                          ? { adultConfirmed: true }
                          : {}),
                      };
                      void run(
                        async () => {
                          const result = await api<{ user: CommunityUser }>(
                            `auth/${authMode}`,
                            payload,
                          );
                          if (!result.user?.id)
                            throw new Error(
                              "The sign-in response was incomplete. Please refresh.",
                            );
                          setUser(result.user);
                          setView(afterSignIn);
                        },
                        authMode === "signup"
                          ? "Account created. You are signed in."
                          : "You are signed in.",
                      );
                    }}
                  >
                    <fieldset disabled={busy}>
                      <Field
                        label="Username"
                        hint="3–32 lowercase letters, numbers or underscores."
                      >
                        <input
                          name="username"
                          autoComplete="username"
                          required
                          minLength={3}
                          maxLength={32}
                          pattern="[a-z0-9_]{3,32}"
                          autoCapitalize="none"
                          spellCheck={false}
                          className="input input-bordered"
                        />
                      </Field>
                      <Field label="Password" hint="Use 12–128 characters.">
                        <input
                          name="password"
                          type="password"
                          autoComplete={
                            authMode === "signup"
                              ? "new-password"
                              : "current-password"
                          }
                          required
                          minLength={12}
                          maxLength={128}
                          className="input input-bordered"
                        />
                      </Field>
                      {authMode === "signup" && (
                        <label className="community-check">
                          <input
                            type="checkbox"
                            required
                            className="checkbox checkbox-primary"
                          />
                          <span>I confirm that I am 18 or older.</span>
                        </label>
                      )}
                      <button type="submit" className="btn btn-primary">
                        {authMode === "signup" ? "Create account" : "Sign in"}
                      </button>
                    </fieldset>
                  </form>
                  <button
                    className="btn btn-outline community-text-button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setAuthMode(authMode === "signup" ? "login" : "signup")
                    }
                  >
                    {authMode === "signup"
                      ? "Already have an account? Sign in"
                      : "New here? Create account"}
                  </button>
                </>
              )}
            </div>
          )}
          {view === "dashboard" && user && (
            <div data-testid="community-dashboard">
              <h3>My activity</h3>
              <p className="community-small">
                Drafts are private. Food offers stay hidden until a moderator
                approves them. Publishing a hotspot makes it public immediately;
                hotspot details are community reported and unverified. Times are
                shown in America/Chicago.
              </p>
              <h4>My posts</h4>
              {mine && !mine.hotspots.length && !mine.offers.length && (
                <p className="community-empty">
                  You have not created any posts.
                </p>
              )}
              <div className="community-cards">
                {[...(mine?.hotspots || []), ...(mine?.offers || [])].map(
                  (record) => (
                    <article
                      className="card bg-base-100 community-card"
                      key={record.id}
                    >
                      <div className="community-card-top">
                        <span className="community-tag">
                          {record.kind === "hotspot"
                            ? "Food hotspot · community reported, unverified"
                            : "Food offer"}
                        </span>
                        <strong className="community-record-status">
                          {record.kind === "hotspot" &&
                          record.status === "approved"
                            ? "Published · unverified"
                            : record.status}
                        </strong>
                      </div>
                      <h4>{record.title}</h4>
                      <p>
                        {when(record.startsAt)} – {when(record.endsAt)}
                      </p>
                      {record.moderationReason && (
                        <p className="community-notice">
                          Moderator note: {record.moderationReason}
                        </p>
                      )}
                      <details>
                        <summary>Post details</summary>
                        <RecordDetails record={record} />
                        {record.kind === "offer" && (
                          <p>
                            <strong>Private pickup notes:</strong>{" "}
                            {record.privatePickupInstructions}
                            <br />
                            Sharing after acceptance:{" "}
                            {record.sharePickupInstructions
                              ? "Allowed"
                              : "Not allowed"}
                          </p>
                        )}
                      </details>
                      <div className="community-actions">
                        {(["draft", "rejected"].includes(record.status) ||
                          (record.kind === "hotspot" &&
                            record.status === "pending")) && (
                          <>
                            {["draft", "rejected"].includes(record.status) && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setEditing(record);
                                  setView(
                                    record.kind === "offer"
                                      ? "offer"
                                      : "hotspot",
                                  );
                                  setError("");
                                  setNotice("");
                                }}
                                className="btn btn-primary"
                              >
                                Edit draft
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => changeRecord(record, "submit")}
                              className="btn btn-primary"
                            >
                              {record.kind === "hotspot"
                                ? "Publish hotspot"
                                : "Submit for review"}
                            </button>
                          </>
                        )}
                        {!["cancelled", "ended", "expired"].includes(
                          record.status,
                        ) && (
                          <button
                            type="button"
                            className="btn btn-outline community-secondary"
                            disabled={busy}
                            onClick={() =>
                              changeRecord(
                                record,
                                record.status === "approved" ? "end" : "cancel",
                              )
                            }
                          >
                            {record.status === "approved"
                              ? "End listing"
                              : "Cancel listing"}
                          </button>
                        )}
                      </div>
                    </article>
                  ),
                )}
              </div>
              <h4>Food requests</h4>
              <p className="community-small">
                A request is not a reservation until accepted. Only accepted
                requests with mutual consent can reveal private pickup
                instructions.
              </p>
              {mine && !mine.requests.length && (
                <p className="community-empty">No food requests yet.</p>
              )}
              <div className="community-cards">
                {mine?.requests.map((request) => {
                  const own = request.ownerId === user.id;
                  return (
                    <article
                      className="card bg-base-100 community-card"
                      key={request.id}
                    >
                      <span className="community-tag">
                        {own ? "Request received" : "Your request"}
                      </span>
                      <h4>{request.offerTitle}</h4>
                      <p>
                        Status: <strong>{request.status}</strong>
                      </p>
                      <p className="community-small">
                        Requested {when(request.createdAt)}
                      </p>
                      <div className="community-actions">
                        {own && request.status === "requested" && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => changeRequest(request, "accept")}
                              className="btn btn-primary"
                            >
                              Accept request
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline community-secondary"
                              disabled={busy}
                              onClick={() => changeRequest(request, "decline")}
                            >
                              Decline request
                            </button>
                          </>
                        )}
                        {request.status === "accepted" && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  const result = await api<{
                                    instructions: string;
                                  }>(`requests/${request.id}/pickup`);
                                  if (typeof result.instructions !== "string")
                                    throw new Error(
                                      "Pickup instructions could not be read.",
                                    );
                                  setPickup((current) => ({
                                    ...current,
                                    [request.id]: result.instructions,
                                  }));
                                }, "Authorized pickup instructions opened.")
                              }
                              className="btn btn-primary"
                            >
                              View pickup instructions
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => changeRequest(request, "collect")}
                              className="btn btn-primary"
                            >
                              Mark collected
                            </button>
                          </>
                        )}
                        {["requested", "accepted"].includes(request.status) && (
                          <button
                            type="button"
                            className="btn btn-outline community-secondary"
                            disabled={busy}
                            onClick={() => changeRequest(request, "cancel")}
                          >
                            Cancel request
                          </button>
                        )}
                      </div>
                      {pickup[request.id] && request.status === "accepted" && (
                        <p className="community-private">
                          <strong>Private pickup instructions</strong>
                          <br />
                          {pickup[request.id]}
                          <br />
                          <small>
                            Keep these details private. Meet only in a public
                            place.
                          </small>
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}
          {view === "moderation" &&
            user?.role === "moderator" &&
            moderation && (
              <ModerationQueue
                queue={moderation}
                busy={busy}
                userId={user.id}
                review={(path, reason) =>
                  run(async () => {
                    await api(`moderation/${path}`, reason ? { reason } : {});
                  }, "Moderation decision saved.")
                }
              />
            )}
        </>
      )}
    </section>
  );
}

function PostForm({
  kind,
  record,
  busy,
  onSave,
  onCancel,
}: {
  kind: "hotspot" | "offer";
  record: CommunityRecord | null;
  busy: boolean;
  onSave: (data: HotspotDraft | OfferDraft, photo?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [formError, setFormError] = useState("");
  const [latitude, setLatitude] = useState(
    record?.lat === undefined ? "" : String(record.lat),
  );
  const [longitude, setLongitude] = useState(
    record?.lng === undefined ? "" : String(record.lng),
  );
  const publicPoint =
    latitude &&
    longitude &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude))
      ? { lat: Number(latitude), lng: Number(longitude) }
      : null;
  function choosePublicPoint(point: { lat: number; lng: number }) {
    if (
      point.lat < 30.4 ||
      point.lat > 30.9 ||
      point.lng < -96.7 ||
      point.lng > -96.1
    ) {
      setFormError(
        "Choose a public venue within the Bryan–College Station area.",
      );
      return;
    }
    setLatitude(String(point.lat));
    setLongitude(String(point.lng));
    setFormError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const values = new FormData(event.currentTarget),
      text = (name: string) => String(values.get(name) || "").trim();
    const startsAt = new Date(text("startsAt")),
      endsAt = new Date(text("endsAt"));
    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      endsAt <= startsAt ||
      endsAt.getTime() <= Date.now() ||
      startsAt.getTime() > Date.now() + 30 * 86400000 ||
      endsAt.getTime() - startsAt.getTime() > 86400000
    ) {
      setFormError(
        "Choose a future pickup window within 30 days, lasting at most 24 hours, with its end after its start.",
      );
      return;
    }
    if (
      kind === "hotspot" &&
      (!publicPoint ||
        publicPoint.lat < 30.4 ||
        publicPoint.lat > 30.9 ||
        publicPoint.lng < -96.7 ||
        publicPoint.lng > -96.1)
    ) {
      setFormError(
        "Choose and confirm the public venue on the map, or enter its coordinates in Advanced location details.",
      );
      return;
    }
    let photo: string | undefined;
    const file = values.get("photo");
    if (file instanceof File && file.size) {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 2 * 1024 * 1024
      ) {
        setFormError("Choose a JPEG, PNG or WebP image no larger than 2 MB.");
        return;
      }
      try {
        photo = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            typeof reader.result === "string"
              ? resolve(reader.result)
              : reject(new Error("Photo could not be read."));
          reader.onerror = () => reject(new Error("Photo could not be read."));
          reader.readAsDataURL(file);
        });
      } catch {
        setFormError(
          "The photo could not be read. Choose it again or save without a photo.",
        );
        return;
      }
    }
    const base = {
      title: text("title"),
      description: text("description"),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
    if (kind === "hotspot")
      void onSave(
        {
          ...base,
          organizerName: text("organizerName"),
          address: text("address"),
          lat: Number(text("lat")),
          lng: Number(text("lng")),
          foodCategory: text("foodCategory"),
          ...(text("quantityText")
            ? { quantityText: text("quantityText") }
            : {}),
          eligibility: text("eligibility"),
          accessibility: text("accessibility"),
          contact: text("contact"),
          pickupInstructions: text("pickupInstructions"),
        },
        photo,
      );
    else {
      const dateParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(endsAt);
      const part = (type: string) =>
        dateParts.find((value) => value.type === type)?.value || "";
      const endDate = `${part("year")}-${part("month")}-${part("day")}`;
      if (endDate > text("useBy")) {
        setFormError(
          "Choose a use-by date that covers the entire pickup window.",
        );
        return;
      }
      void onSave(
        {
          ...base,
          pickupAreaId: text("pickupAreaId") as OfferDraft["pickupAreaId"],
          quantity: Number(text("quantity")),
          allergens: text("allergens"),
          storage: text("storage"),
          useBy: text("useBy"),
          foodCategory: text("foodCategory") as OfferDraft["foodCategory"],
          labelsIntact: true,
          noExcludedProducts: true,
          sealed: true,
          shelfStable: true,
          notHomemade: true,
          packagingUndamaged: true,
          notRecalled: true,
          pickupIsPublicPlace: true,
          privatePickupInstructions: text("privatePickupInstructions"),
          sharePickupInstructions:
            values.get("sharePickupInstructions") === "on",
        },
        photo,
      );
    }
  }
  return (
    <form
      onSubmit={submit}
      className="community-create-form"
      data-testid="community-create-form"
    >
      <h3>
        {record
          ? "Edit draft"
          : kind === "offer"
            ? "Share Food"
            : "Create Food Hotspot"}
      </h3>
      <p>
        {kind === "offer"
          ? "Offer a small quantity of sealed, nonexpired, shelf-stable food for pickup at a public place. Homemade, opened, damaged or refrigerated food is not accepted."
          : "Create a public food distribution at a public venue. Check that the address, public venue coordinates and pickup requirements are correct."}
      </p>
      <p className="community-small">
        {kind === "hotspot"
          ? "Save a private draft first, then publish it from My activity. Published hotspot details are community reported and unverified."
          : "Save a private draft first, then submit it for moderator review from My activity."}{" "}
        Times display in America/Chicago; date and time inputs below use your
        device’s timezone.
      </p>
      {formError && (
        <p role="alert" className="community-error">
          {formError}
        </p>
      )}
      <fieldset disabled={busy}>
        <Field
          label="Food photo (optional)"
          hint="JPEG, PNG or WebP up to 2 MB and 8 megapixels. Do not include faces, addresses or personal details. Location metadata is removed before storage."
        >
          <input
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="input input-bordered"
          />
        </Field>
        {record?.photoUrl && (
          <p className="community-small">
            A photo is already attached. Choose a new image only to replace it.
          </p>
        )}
        <Field label="Post title">
          <input
            name="title"
            required
            maxLength={100}
            defaultValue={record?.title}
            className="input input-bordered"
          />
        </Field>
        <Field label="Description">
          <textarea
            name="description"
            required
            maxLength={500}
            rows={3}
            defaultValue={record?.description}
            className="textarea textarea-bordered"
          />
        </Field>
        <div className="community-form-grid">
          <Field label="Pickup starts (device timezone)">
            <input
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={deviceTime(record?.startsAt)}
              className="input input-bordered"
            />
          </Field>
          <Field label="Pickup ends (device timezone)">
            <input
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={deviceTime(record?.endsAt)}
              className="input input-bordered"
            />
          </Field>
        </div>
        {kind === "hotspot" ? (
          <>
            <Field label="Organizer or organization name">
              <input
                name="organizerName"
                required
                maxLength={100}
                defaultValue={record?.organizerName}
                className="input input-bordered"
              />
            </Field>
            <Field
              label="Public venue address"
              hint="This address and its map pin will be public. Do not enter a private home."
            >
              <input
                name="address"
                required
                maxLength={200}
                defaultValue={record?.address}
                className="input input-bordered"
              />
            </Field>
            <div className="community-public-map">
              <p className="community-small">
                Choose and confirm the public venue’s point on the map. This
                publishes the venue’s position. Your personal starting location
                is never used.
              </p>
              <JourneyMap
                origin={publicPoint}
                onOriginChange={choosePublicPoint}
                originLabel="Public food hotspot venue"
              />
              <p role="status" className="community-small">
                {publicPoint
                  ? "A public venue map point is selected. Confirm that it matches the address above."
                  : "No public venue point selected yet."}
              </p>
            </div>
            <details>
              <summary>Advanced location details (keyboard fallback)</summary>
              <p className="community-small">
                Enter coordinates for the public venue. These are published with
                the address.
              </p>
              <div className="community-form-grid">
                <Field
                  label="Public venue latitude"
                  hint="Bryan–College Station area, 30.4 to 30.9."
                >
                  <input
                    name="lat"
                    type="number"
                    step="any"
                    min={30.4}
                    max={30.9}
                    value={latitude}
                    onChange={(event) => setLatitude(event.target.value)}
                    className="input input-bordered"
                  />
                </Field>
                <Field
                  label="Public venue longitude"
                  hint="Bryan–College Station area, −96.7 to −96.1."
                >
                  <input
                    name="lng"
                    type="number"
                    step="any"
                    min={-96.7}
                    max={-96.1}
                    value={longitude}
                    onChange={(event) => setLongitude(event.target.value)}
                    className="input input-bordered"
                  />
                </Field>
              </div>
            </details>
            <label className="community-check">
              <input
                type="checkbox"
                required
                className="checkbox checkbox-primary"
              />
              <span>
                I confirm this is a public venue and the selected map point
                matches its published address.
              </span>
            </label>
            <Field label="Food categories">
              <input
                name="foodCategory"
                required
                maxLength={100}
                defaultValue={record?.foodCategory}
                className="input input-bordered"
              />
            </Field>
            <Field label="Available quantity (optional)">
              <input
                name="quantityText"
                maxLength={100}
                defaultValue={record?.quantityText}
                className="input input-bordered"
              />
            </Field>
            <Field
              label="Eligibility and requirements"
              hint="Include identification, registration or household requirements; say ‘None’ if there are none."
            >
              <textarea
                name="eligibility"
                required
                maxLength={300}
                rows={2}
                defaultValue={record?.eligibility}
                className="textarea textarea-bordered"
              />
            </Field>
            <Field label="Accessibility information">
              <textarea
                name="accessibility"
                required
                maxLength={300}
                rows={2}
                defaultValue={record?.accessibility}
                className="textarea textarea-bordered"
              />
            </Field>
            <Field
              label="Public contact information"
              hint="Use an organization contact that may be published."
            >
              <input
                name="contact"
                required
                maxLength={200}
                defaultValue={record?.contact}
                className="input input-bordered"
              />
            </Field>
            <Field label="Public pickup instructions">
              <textarea
                name="pickupInstructions"
                required
                maxLength={500}
                rows={3}
                defaultValue={record?.pickupInstructions}
                className="textarea textarea-bordered"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Food category">
              <select
                name="foodCategory"
                required
                defaultValue={record?.foodCategory || ""}
                className="input input-bordered"
              >
                <option value="" disabled>
                  Choose a supported category
                </option>
                <option value="canned-groceries">Canned groceries</option>
                <option value="dry-groceries">Dry groceries</option>
                <option value="sealed-snacks">Sealed snacks</option>
              </select>
            </Field>
            <Field
              label="Approximate public pickup area"
              hint="Only the named area appears publicly. Your device location is never used for this post."
            >
              <select
                name="pickupAreaId"
                required
                defaultValue={record?.pickupAreaId || ""}
                className="input input-bordered"
              >
                <option value="" disabled>
                  Choose a named area
                </option>
                {COMMUNITY_PICKUP_AREAS.map((area) => (
                  <option value={area.id} key={area.id}>
                    {area.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="community-form-grid">
              <Field label="Quantity of items (offered together)">
                <input
                  name="quantity"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  required
                  defaultValue={record?.quantity}
                  className="input input-bordered"
                />
              </Field>
              <Field
                label="Use-by date"
                hint="Must cover pickup through the stated date in America/Chicago."
              >
                <input
                  name="useBy"
                  type="date"
                  required
                  defaultValue={record?.useBy}
                  className="input input-bordered"
                />
              </Field>
            </div>
            <Field
              label="Ingredients and allergens"
              hint="Copy the package label, including ‘may contain’ warnings. Do not claim allergen-free unless the label says so."
            >
              <textarea
                name="allergens"
                required
                maxLength={300}
                rows={3}
                defaultValue={record?.allergens}
                className="textarea textarea-bordered"
              />
            </Field>
            <Field
              label="Storage conditions"
              hint="Describe how the sealed food has been stored."
            >
              <textarea
                name="storage"
                required
                maxLength={300}
                rows={2}
                defaultValue={record?.storage}
                className="textarea textarea-bordered"
              />
            </Field>
            <fieldset className="community-attestations">
              <legend>Food and pickup safety confirmations</legend>
              {[
                ["sealed", "The food is sealed in its original packaging."],
                [
                  "shelfStable",
                  "The food is shelf stable and does not need refrigeration.",
                ],
                [
                  "notHomemade",
                  "The food is commercially prepared, not homemade.",
                ],
                ["packagingUndamaged", "The packaging is undamaged."],
                ["notRecalled", "I checked that the food is not recalled."],
                [
                  "labelsIntact",
                  "Original ingredient, allergen and date labels are intact and readable.",
                ],
                [
                  "noExcludedProducts",
                  "This offer contains no infant formula, supplements or alcohol.",
                ],
                [
                  "notExpired",
                  "The food is not expired and will remain within its use-by date throughout pickup.",
                ],
                [
                  "pickupIsPublicPlace",
                  "Pickup will take place at a public place, not a private home.",
                ],
              ].map(([name, label]) => (
                <label className="community-check" key={name}>
                  <input
                    type="checkbox"
                    name={name}
                    required
                    defaultChecked={Boolean(record)}
                    className="checkbox checkbox-primary"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <Field
              label="Private public-place meeting instructions"
              hint="Use a named public venue and meeting point. Do not include a home address, phone number or other unnecessary personal details."
            >
              <textarea
                name="privatePickupInstructions"
                required
                maxLength={500}
                rows={3}
                defaultValue={record?.privatePickupInstructions}
                className="textarea textarea-bordered"
              />
            </Field>
            <label className="community-check">
              <input
                name="sharePickupInstructions"
                type="checkbox"
                defaultChecked={record?.sharePickupInstructions || false}
                className="checkbox checkbox-primary"
              />
              <span>
                I explicitly allow these private instructions to be shared with
                a requester only after I accept their request and they consent.
                Without this permission, the requester cannot see them.
              </span>
            </label>
          </>
        )}
        <div className="community-actions">
          <button type="submit" className="btn btn-primary">
            Save draft
          </button>
          <button
            type="button"
            className="btn btn-outline community-secondary"
            onClick={onCancel}
          >
            Cancel editing
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function ModerationQueue({
  queue,
  busy,
  userId,
  review,
}: {
  queue: CommunityModeration;
  busy: boolean;
  userId: string;
  review: (path: string, reason: string) => Promise<void>;
}) {
  function controls(path: string, self = false) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget,
            data = new FormData(form),
            action =
              (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
                "value",
              ) || "approve";
          const reason = String(data.get("reason") || "").trim();
          if (action === "reject" && !reason) {
            const input = form.elements.namedItem(
              "reason",
            ) as HTMLTextAreaElement;
            input.setCustomValidity("Add a reason for rejection.");
            input.reportValidity();
            return;
          }
          void review(`${path}/${action}`, reason);
        }}
      >
        <Field label="Review note (required for rejection)">
          <textarea
            name="reason"
            maxLength={500}
            rows={2}
            onInput={(event) => event.currentTarget.setCustomValidity("")}
            className="textarea textarea-bordered"
          />
        </Field>
        <div className="community-actions">
          <button
            type="submit"
            value="approve"
            disabled={busy || self}
            className="btn btn-primary"
          >
            Approve
          </button>
          <button
            type="submit"
            value="reject"
            className="btn btn-outline community-secondary"
            disabled={busy || self}
          >
            Reject
          </button>
        </div>
        {self && (
          <p className="community-small">
            Another moderator must review your own submission.
          </p>
        )}
      </form>
    );
  }
  return (
    <div data-testid="community-moderation">
      <h3>Moderation queue</h3>
      <p>
        Review community submissions, organizer applications and safety reports.
        Approval does not independently verify food safety or availability.
      </p>
      <h4>Pending posts</h4>
      {!queue.hotspots.length && !queue.offers.length && (
        <p className="community-empty">No posts waiting for review.</p>
      )}
      <div className="community-cards">
        {[...queue.hotspots, ...queue.offers].map((record) => (
          <article className="card bg-base-100 community-card" key={record.id}>
            <span className="community-tag">{record.kind}</span>
            <h4>{record.title}</h4>
            <RecordDetails record={record} />
            {record.kind === "offer" && (
              <p>
                <strong>Private meeting notes:</strong>{" "}
                {record.privatePickupInstructions}
              </p>
            )}
            {controls(endpoint(record), record.ownerId === userId)}
          </article>
        ))}
      </div>
      <h4>Organizer applications</h4>
      {!queue.organizers.length && (
        <p className="community-empty">No organizer applications waiting.</p>
      )}
      {queue.organizers.map((application) => (
        <article
          className="card bg-base-100 community-card"
          key={application.id}
        >
          <h4>{application.username}</h4>
          <p>Requested {when(application.createdAt)}</p>
          {controls(`organizers/${application.id}`, application.id === userId)}
        </article>
      ))}
      <h4>Safety reports</h4>
      {!queue.reports.length && (
        <p className="community-empty">No safety reports.</p>
      )}
      {queue.reports.map((report) => (
        <article className="card bg-base-100 community-card" key={report.id}>
          <h4>Report about {report.targetType}</h4>
          <p>{report.reason}</p>
          <p className="community-small">
            Target: {report.targetId}
            <br />
            Reported {when(report.createdAt)}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void review(
                `reports/${report.id}/resolve`,
                String(data.get("reason") || ""),
              );
            }}
          >
            <Field label="Resolution note">
              <textarea
                name="reason"
                required
                maxLength={500}
                rows={2}
                className="textarea textarea-bordered"
              />
            </Field>
            <div className="community-actions">
              <button type="submit" disabled={busy} className="btn btn-primary">
                Resolve report
              </button>
              {["hotspot", "offer"].includes(report.targetType) && (
                <button
                  type="button"
                  className="btn btn-outline community-secondary"
                  disabled={busy}
                  onClick={(event) => {
                    const form = event.currentTarget.form;
                    if (!form?.reportValidity()) return;
                    const data = new FormData(form);
                    void review(
                      `${report.targetType === "hotspot" ? "hotspots" : "offers"}/${report.targetId}/remove`,
                      String(data.get("reason") || ""),
                    );
                  }}
                >
                  Remove reported listing
                </button>
              )}
            </div>
          </form>
        </article>
      ))}
      <details className="community-audit">
        <summary>Recent moderation and account audit</summary>
        <ol>
          {queue.audit.map((entry, index) => (
            <li key={`${entry.createdAt}-${index}`}>
              {when(entry.createdAt)} · {entry.action} · {entry.targetId}
              {entry.reason ? ` · ${entry.reason}` : ""}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
