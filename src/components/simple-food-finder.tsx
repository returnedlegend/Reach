"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  MapPin,
  Phone,
  Soup,
  Check,
  Footprints,
  Bus,
  Car,
  Bookmark,
  Sparkles,
} from "lucide-react";
import { FOOD_SEARCH_TIMEOUT_MS } from "@/lib/ai-timing";
import { discoveryComparison } from "@/lib/discovery-comparison";
import type { FoodRanking } from "@/lib/food-ai-ranking";
import type { Resource } from "@/data/resources";
import type { TravelMode } from "@/lib/journey";
import type { AccessResponse } from "@/lib/access-types";
import { formatTime } from "@/lib/time";
import { foodTripIsFresh, type CheckedFoodTrip } from "@/lib/food-trip";
import {
  discoverFood,
  foodDirectionsUrl,
  type FoodIntent,
} from "@/lib/simple-food";
import { nextPublishedWindow } from "@/lib/discovery";
import { LocationPicker, type SelectedLocation } from "./location-picker";
import styles from "./simple-food-finder.module.css";
import {
  AILoadingIndicator,
  RecommendationSkeletons,
} from "./ai-loading-indicator";

type RouteMetric = {
  miles: number;
  minutes: number;
  mode?: TravelMode;
  attribution: { label: string; url: string }[];
};
type Props = {
  resources: Resource[];
  location: SelectedLocation | null;
  onLocationChange: (value: SelectedLocation) => void;
  mode: TravelMode;
  onModeChange: (mode: TravelMode) => void;
  onDirections: (resource: Resource) => void;
  onViewMap: (resource: Resource) => void;
  onCheckedDirections: (trip: CheckedFoodTrip) => void;
  initialRequest: string;
  onRequestChange: (text: string) => void;
  onDetails: (id: string) => void;
  onSave: (id: string) => void;
  savedIds: string[];
  onAdvanced: () => void;
  aiAvailable: boolean;
  directoryError: string;
};

export function SimpleFoodFinder(props: Props) {
  const router = useRouter();
  const { resources, location, mode } = props;
  const [draft, setDraft] = useState(props.initialRequest);
  const [request, setRequest] = useState(props.initialRequest);
  const [intent, setIntent] = useState<FoodIntent>();
  const [now, setNow] = useState<Date>();
  const [showAll, setShowAll] = useState(false);
  const [useAI, setUseAI] = useState(true);
  const [assistance, setAssistance] = useState<"directory" | "ai">("directory");
  const [thinking, setThinking] = useState(false);
  const [aiAttempted, setAiAttempted] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [aiSummary, setAiSummary] = useState<
    { id: string; name: string; text: string }[]
  >([]);
  const [aiRanking, setAiRanking] = useState<{
    items: FoodRanking;
    expires: number;
  } | null>(null);
  const generation = useRef(0);
  const aiController = useRef<AbortController | null>(null);
  const searchInFlight = useRef(false);
  const [checkedTrip, setCheckedTrip] = useState<
    | (AccessResponse & {
        assumptions?: string[];
        searchScope?: string;
        clarification?: string;
        planningDate?: string;
      })
    | null
  >(null);
  const [checkAgain, setCheckAgain] = useState(0);
  const [routes, setRoutes] = useState<Record<string, RouteMetric>>({});
  const [routeState, setRouteState] = useState<
    "idle" | "loading" | "done" | "unavailable"
  >("idle");
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const serverClockOffset = useRef(0);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(
      () => setNow(new Date(Date.now() + serverClockOffset.current)),
      15_000,
    );
    return () => {
      clearInterval(timer);
      aiController.current?.abort();
      searchInFlight.current = false;
    };
  }, []);
  const found = useMemo(
    () =>
      discoverFood(resources, request, {
        origin: location?.coordinates,
        mode,
        now,
        intent,
      }),
    [
      resources,
      request,
      location?.coordinates.lat,
      location?.coordinates.lng,
      mode,
      now,
      intent,
    ],
  );
  const mathematicalRanking: FoodRanking = found.matches
    .filter(
      ({ resource }) =>
        resource.verificationStatus === "confirmed-site" ||
        !!(resource.communityHotspot ?? resource.communityOffer),
    )
    .map((item) => ({
      id: item.resource.id,
      comparison: discoveryComparison(
        item.resource,
        item.straightLineMiles,
        now ?? new Date(),
      ),
      reasons: [
        item.resource.hours || "Hours unknown",
        item.resource.eligibility || "Requirements unknown",
      ],
      selectedBy: "mathematical" as const,
    }))
    .sort((a, b) => (b.comparison?.score ?? 0) - (a.comparison?.score ?? 0))
    .slice(0, 3);
  const activeRanking =
    aiRanking && now && now.getTime() < aiRanking.expires
      ? aiRanking.items
      : mathematicalRanking;
  const directoryChoices = found.matches.length
    ? found.matches
    : found.alternatives;
  const choices =
    activeRanking.length && found.matches.length
      ? [...directoryChoices].sort((a, b) => {
          const rank = (id: string) => {
            const index = activeRanking.findIndex((item) => item.id === id);
            return index < 0 ? Number.MAX_SAFE_INTEGER : index;
          };
          return rank(a.resource.id) - rank(b.resource.id);
        })
      : directoryChoices;
  const recommended = activeRanking
    .flatMap((rank) => {
      const match = found.matches.find((item) => item.resource.id === rank.id);
      return match ? [match] : [];
    })
    .slice(0, 3);
  const topCards = activeRanking.length ? recommended : choices.slice(0, 3);
  const extraCommunity = [
    choices.find((item) => !!item.resource.communityHotspot),
    choices.find((item) => !!item.resource.communityOffer),
  ].filter(
    (item): item is (typeof choices)[number] =>
      !!item && !topCards.some((top) => top.resource.id === item.resource.id),
  );
  const visible = showAll ? choices : [...topCards, ...extraCommunity];
  const candidateKey = choices
    .slice(0, 3)
    .map((item) => item.resource.id)
    .join("|");
  const routeKey = JSON.stringify([
    location?.coordinates.lat,
    location?.coordinates.lng,
    mode,
    found.blockedMode,
    candidateKey,
    request,
    checkAgain,
  ]);
  const [metricsKey, setMetricsKey] = useState("");
  // Never display old distances under a new origin, mode, or result set, even
  // during the render before the previous effect's cleanup has run.
  const currentRoutes = metricsKey === routeKey ? routes : {};
  useEffect(() => {
    setRoutes({});
    setMetricsKey(routeKey);
    setCheckedTrip(null);
    if (
      !location ||
      mode === "transit" ||
      found.blockedMode ||
      !found.matches.length
    ) {
      setRouteState("idle");
      return;
    }
    const controller = new AbortController();
    const origin = { ...location.coordinates };
    setRouteState("loading");
    const timer = setTimeout(async () => {
      const requestStarted = performance.now();
      try {
        const response = await fetch("/api/food-search/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(35000),
          ]),
          body: JSON.stringify({ origin, mode, message: request }),
        });
        const data: AccessResponse & {
          assumptions?: string[];
          searchScope?: string;
        } = await response.json();
        if (controller.signal.aborted) return;
        const metrics: Record<string, RouteMetric> = {};
        if (response.ok && Array.isArray(data.options)) {
          const checkedTime = Date.parse(data.searchedAt);
          if (Number.isFinite(checkedTime)) {
            // Align expiry to the server's planning clock plus observed request
            // duration, so a slow response or a skewed device clock cannot make
            // a fresh server calculation appear expired on arrival.
            serverClockOffset.current =
              checkedTime + performance.now() - requestStarted - Date.now();
            setNow(new Date(Date.now() + serverClockOffset.current));
          }
          setCheckedTrip(data);
          for (const option of data.options) {
            const out = option.outbound;
            if (
              !out ||
              !Number.isFinite(out.distanceMiles) ||
              !Number.isFinite(out.durationMinutes) ||
              out.distanceMiles! < 0 ||
              out.durationMinutes! < 0
            )
              continue;
            metrics[option.id] = {
              miles: out.distanceMiles!,
              minutes: out.durationMinutes!,
              mode: out.mode ?? (out.source === "scheduled" ? "transit" : mode),
              attribution: (out.attribution ?? [])
                .filter((a) => {
                  try {
                    return (
                      typeof a.label === "string" &&
                      new URL(a.url).protocol === "https:"
                    );
                  } catch {
                    return false;
                  }
                })
                .slice(0, 8),
            };
          }
        }
        setRoutes(metrics);
        setRouteState(
          response.ok && data.recommendation?.selectedId
            ? "done"
            : "unavailable",
        );
      } catch {
        if (!controller.signal.aborted) setRouteState("unavailable");
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Candidate identity + exact origin/mode fully describe these requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const currentTrip = metricsKey === routeKey ? checkedTrip : null;
  const tripExpired = Boolean(
    currentTrip?.recommendation?.selectedId &&
      now &&
      !foodTripIsFresh(currentTrip, now),
  );
  const bestTrip = !tripExpired
    ? currentTrip?.options.find(
        (option) => option.id === currentTrip.recommendation?.selectedId,
      )
    : undefined;

  async function search(text: string) {
    if (searchInFlight.current) return;
    const version = ++generation.current;
    aiController.current?.abort();
    searchInFlight.current = false;
    setDraft(text);
    setRequest(text);
    props.onRequestChange(text);
    setIntent(undefined);
    setShowAll(false);
    setAssistance("directory");
    setThinking(false);
    setAiAttempted(false);
    setAiMessage("");
    setAiRanking(null);
    setAiSummary([]);
    const local = discoverFood(resources, text).intent;
    if (local.mode) props.onModeChange(local.mode);
    if (!useAI || !text.trim())
      requestAnimationFrame(() => {
        resultsHeading.current?.focus({ preventScroll: true });
        resultsHeading.current?.scrollIntoView({ block: "start" });
      });
    if (!useAI || !text.trim()) return;
    const controller = new AbortController();
    aiController.current = controller;
    searchInFlight.current = true;
    setThinking(true);
    setAiAttempted(true);
    try {
      router.refresh(); // Include newly approved listings in the server-provided directory.
      const response = await fetch("/api/food-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(FOOD_SEARCH_TIMEOUT_MS),
        ]),
        body: JSON.stringify({
          message: text,
          useAI: true,
          origin: location?.coordinates,
          mode,
        }),
      });
      const data = await response.json();
      if (version !== generation.current) return;
      if (!response.ok) {
        setAiMessage(
          typeof data.error === "string" && data.error.trim()
            ? `${data.error.slice(0, 300)} Your pantry results are still available.`
            : response.status === 429
              ? "AI is busy. Please wait a moment and try again."
              : "Reach could not process the AI request. Your pantry results are still available.",
        );
        return;
      }
      if (typeof data.aiMessage === "string")
        setAiMessage(data.aiMessage.slice(0, 500));
      if (data.assistance === "ai" && Array.isArray(data.summary)) {
        setAiSummary(
          data.summary
            .filter(
              (item: { id?: unknown; name?: unknown; text?: unknown }) =>
                typeof item.id === "string" &&
                typeof item.name === "string" &&
                typeof item.text === "string" &&
                item.text.length <= 280,
            )
            .slice(0, 3),
        );
      }
      if (data.intent) {
        if (Array.isArray(data.ranking) && typeof data.rankedAt === "string") {
          const valid = data.ranking.every(
            (item: { id?: unknown; reasons?: unknown }) =>
              typeof item.id === "string" &&
              Array.isArray(item.reasons) &&
              item.reasons.every((reason) => typeof reason === "string"),
          );
          const time = Date.parse(data.rankedAt);
          if (valid && Number.isFinite(time))
            setAiRanking({
              items: data.ranking,
              expires: Math.min(time + 60000, Date.now() + 60000),
            });
        }
        setIntent(data.intent);
        setAssistance(data.assistance === "ai" ? "ai" : "directory");
        if (["walking", "transit", "driving"].includes(data.intent.mode))
          props.onModeChange(data.intent.mode);
      }
    } catch {
      if (version === generation.current)
        setAiMessage(
          "The AI request could not finish. Check your connection and try again. Your pantry results are still available.",
        );
    } finally {
      if (version === generation.current) {
        searchInFlight.current = false;
        setThinking(false);
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void search(draft);
  }

  return (
    <div className={styles.finder}>
      <section className={styles.welcome} aria-labelledby="food-welcome">
        <span className={styles.eyebrow}>
          <Soup size={18} aria-hidden="true" /> A LITTLE HELP, CLOSE BY
        </span>
        <h1 id="food-welcome">
          Let’s find you <span>food.</span>
        </h1>
        <p>
          Tell us what would help. We’ll find places to try and help you get
          there.
        </p>
        <p>
          Have food to share or want to host a pickup?{" "}
          <Link className="btn btn-outline" href="/share">
            Host a Food Pickup / Share Extra Food
          </Link>
        </p>
        <form onSubmit={submit} className={styles.ask}>
          <label htmlFor="food-request">What do you need?</label>
          <textarea
            id="food-request"
            rows={1}
            maxLength={1200}
            value={draft}
            onChange={(event) => {
              if (searchInFlight.current) {
                generation.current++;
                aiController.current?.abort();
                searchInFlight.current = false;
                setThinking(false);
                setAiRanking(null);
                setAiSummary([]);
                setAiMessage(
                  "Request changed. Search again to compare these options.",
                );
              }
              setDraft(event.target.value);
            }}
            placeholder="I need food in Bryan and I’m walking"
          />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={thinking}
            aria-busy={thinking}
            aria-label={thinking ? "Analyzing…" : undefined}
          >
            {thinking ? (
              <AILoadingIndicator />
            ) : (
              <>
                <Sparkles size={18} aria-hidden="true" /> Find best resources{" "}
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        </form>
        <div className={styles.chips} aria-label="Quick food requests">
          {[
            ["I need food today", "Food today"],
            ["Food in Bryan", "Bryan"],
            ["Food in College Station", "College Station"],
          ].map(([text, label]) => (
            <button
              key={text}
              className="btn btn-outline"
              disabled={thinking}
              onClick={() => void search(text)}
            >
              {label}
            </button>
          ))}
        </div>
        {
          <label className={styles.aiChoice}>
            <input
              type="checkbox"
              checked={useAI}
              onChange={(event) => {
                setUseAI(event.target.checked);
                if (!event.target.checked) {
                  generation.current++;
                  aiController.current?.abort();
                  searchInFlight.current = false;
                  setThinking(false);
                  setAiRanking(null);
                  setAiSummary([]);
                }
              }}
            />{" "}
            Use AI to help understand my request and compare pantries.
          </label>
        }
        <details>
          <summary>What is shared with AI?</summary>
          <p>
            Your request, public listing facts, approximate distances and
            comparison scores go to the configured AI provider. Your selected
            coordinates are not sent. Don’t include private details.{" "}
            <Link href="/privacy">Privacy information</Link>.
          </p>
        </details>
      </section>

      <section className={styles.start} aria-label="Optional starting point">
        <div>
          <h2>
            {location ? "Starting from your chosen place" : "Find food near me"}
          </h2>
          <p>
            {location
              ? "Travel checks send this exact point to our routing provider. It is not saved. Change it anytime."
              : "Optional. Travel checks share your chosen point with our routing provider. It isn’t saved."}
          </p>
        </div>
        <LocationPicker
          simple
          compact
          value={location}
          onChange={(value) => {
            generation.current++;
            aiController.current?.abort();
            searchInFlight.current = false;
            setThinking(false);
            setAiRanking(null);
            setAiSummary([]);
            props.onLocationChange(value);
          }}
          resources={resources}
        />
        {(location || found.blockedMode) && (
          <fieldset className={styles.travel}>
            <legend>How are you getting there?</legend>
            {(
              [
                { id: "walking", label: "Walk", Icon: Footprints },
                { id: "transit", label: "Bus", Icon: Bus },
                { id: "driving", label: "Ride", Icon: Car },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                type="button"
                key={id}
                className="btn btn-outline"
                aria-pressed={mode === id}
                onClick={() => {
                  // A person's explicit travel choice wins over an in-flight
                  // interpretation of their earlier request.
                  generation.current++;
                  aiController.current?.abort();
                  searchInFlight.current = false;
                  setThinking(false);
                  setAiRanking(null);
                  setAiSummary([]);
                  props.onModeChange(id);
                }}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </button>
            ))}
          </fieldset>
        )}
      </section>

      <section className={styles.results} aria-labelledby="food-results-title">
        <div className={styles.resultHeading}>
          <div>
            <span className={styles.eyebrow}>
              {request
                ? "LET’S START HERE"
                : "BROWSE WITHOUT SHARING YOUR LOCATION"}
            </span>
            <h2 id="food-results-title" ref={resultsHeading} tabIndex={-1}>
              {found.matches.length
                ? "Places to try"
                : "Other listed food options"}
            </h2>
          </div>
          <span>
            {choices.length} {found.matches.length ? "listed" : "alternatives"}
          </span>
        </div>
        <p className={styles.context}>
          {activeRanking.length
            ? "Travel has not been checked yet."
            : location
              ? "Sorted using your starting point and published schedules. Distance alone does not establish a usable trip."
              : found.area
                ? `Showing matches for ${found.area}. Add your starting point for travel help.`
                : "Showing selected central Texas pantries. Add your location or enter a city to narrow the list."}
        </p>
        {aiRanking &&
          now &&
          now.getTime() < aiRanking.expires &&
          aiSummary.length > 0 &&
          !thinking && (
            <section
              className={styles.comparisonCard}
              aria-labelledby="ai-summary-heading"
              aria-live="polite"
            >
              <h3 id="ai-summary-heading">AI’s quick take</h3>
              <ul>
                {aiSummary
                  .filter((item) =>
                    recommended.some((match) => match.resource.id === item.id),
                  )
                  .map((item) => (
                    <li key={item.id}>
                      <strong>{item.name}:</strong> {item.text}
                    </li>
                  ))}
              </ul>
              <small>
                AI-generated from listed facts. Confirm pickup details and
                availability before traveling.
              </small>
            </section>
          )}
        {request && recommended.length > 0 && (
          <details className={styles.comparisonDetails} key={request}>
            <summary>
              Compare your top {recommended.length}{" "}
              {recommended.length === 1 ? "option" : "options"}
            </summary>
            <section aria-labelledby="ai-comparison-title">
              <h3 id="ai-comparison-title">
                Your top {recommended.length}{" "}
                {recommended.length === 1 ? "option" : "options"}
              </h3>
              {recommended.length < 3 && (
                <p>
                  Fewer than three matching listings are available for this
                  request. Try a nearby city or a broader search.
                </p>
              )}
              <p>
                Compare reported details before choosing. Food availability is
                not guaranteed.
              </p>
              <div className={styles.comparisonGrid}>
                {recommended.map(
                  ({ resource, summary, straightLineMiles }, index) => (
                    <div
                      className={styles.comparisonCard}
                      key={resource.id}
                      role="group"
                      aria-label={`Compare ${resource.name}`}
                    >
                      <h4>
                        {index + 1}. {resource.name}
                      </h4>
                      <dl>
                        <dt>Distance and pickup score</dt>
                        <dd>
                          {(() => {
                            const comparison = activeRanking.find(
                              (item) => item.id === resource.id,
                            )?.comparison;
                            if (!comparison || comparison.score === null)
                              return "Unknown — add your location to compare distance.";
                            return (
                              <>
                                <strong>
                                  {comparison.score} points ·{" "}
                                  {comparison.status === "fits"
                                    ? "Fits checked constraints"
                                    : "Confirm details before traveling"}
                                </strong>
                                <details>
                                  <summary>
                                    How this score is calculated
                                  </summary>
                                  <p>{comparison.explanation}</p>
                                  <dl>
                                    {Object.entries(comparison.parameters).map(
                                      ([key, value]) => (
                                        <div key={key}>
                                          <dt>
                                            {key.replace(/([A-Z])/g, " $1")}
                                          </dt>
                                          <dd>{value ?? "Unknown"}</dd>
                                        </div>
                                      ),
                                    )}
                                  </dl>
                                </details>
                              </>
                            );
                          })()}
                        </dd>
                        <dt>Food</dt>
                        <dd>{resource.shortOffering || summary.offering}</dd>
                        <dt>Pickup times</dt>
                        <dd>{resource.hours || "Hours not verified."}</dd>
                        <dt>Requirements</dt>
                        <dd>
                          {resource.eligibility || "Requirements not verified."}
                        </dd>
                        <dt>Distance</dt>
                        <dd>
                          {straightLineMiles === undefined
                            ? "Unknown — select a starting point; some pickup locations are approximate."
                            : `${straightLineMiles.toFixed(1)} straight-line miles, not routed travel distance.`}
                        </dd>
                        <dt>Access</dt>
                        <dd>
                          {resource.accessibility ||
                            "Accessibility not verified."}
                        </dd>
                      </dl>
                      {!found.blockedMode && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => props.onDirections(resource)}
                        >
                          Directions to option {index + 1}
                        </button>
                      )}
                    </div>
                  ),
                )}
              </div>
            </section>
          </details>
        )}
        <div aria-live="polite" className={styles.feedback}>
          {thinking && (
            <div>
              <p>
                Checking your request with AI. You can use these results or open
                the map while you wait.
              </p>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => {
                  generation.current++;
                  aiController.current?.abort();
                  searchInFlight.current = false;
                  setThinking(false);
                  setAiMessage(
                    "AI comparison stopped. Your pantry results are still available.",
                  );
                }}
              >
                Stop AI comparison
              </button>
            </div>
          )}
          {request &&
            aiAttempted &&
            !thinking &&
            aiSummary.length === 0 &&
            assistance === "ai" &&
            useAI && (
              <div role="status">
                <p>
                  {aiMessage ||
                    "No AI summary was returned. Your pantry matches remain available."}
                </p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void search(request)}
                >
                  Try AI again
                </button>
              </div>
            )}
          {request && !thinking && (
            <p>
              {assistance === "ai"
                ? activeRanking.some((item) => item.selectedBy === "ai")
                  ? "AI compared candidates; distance and pickup scores determine the order. Confirm details before traveling."
                  : "Showing current mathematical matches. Run AI again for a fresh comparison."
                : aiAttempted
                  ? aiMessage ||
                    "AI could not finish interpreting your request. Showing directory matches instead; your text may have reached the AI provider."
                  : "Showing directory matches. Turn on AI above to interpret your request."}{" "}
              <button
                className={styles.textButton}
                onClick={() => void search("")}
              >
                Clear request
              </button>
              {aiAttempted && assistance !== "ai" && (
                <button
                  className={styles.textButton}
                  onClick={() => void search(request)}
                >
                  Try AI again
                </button>
              )}
            </p>
          )}
          {found.notices.map((note) => (
            <p key={note} className={styles.notice}>
              {note}
            </p>
          ))}
          {props.directoryError && (
            <p role="alert">
              The directory is unavailable right now. Call 211 or use the food
              bank’s directory below.
            </p>
          )}
          {routeState === "loading" && (
            <p>Checking routes, pickup times, and arrival before closing…</p>
          )}
          {routeState === "unavailable" && (
            <p>
              No checked trip is available right now. Travel, pickup times, or
              your requirements could not be confirmed. Pantry details still
              work; Google Maps can calculate directions separately.
            </p>
          )}
          {location && mode === "transit" && (
            <p>
              Public-transit itineraries are outside this discovery feature.
              Open Google Maps to check available transit directions.
            </p>
          )}
        </div>
        {location && mode !== "transit" && !found.blockedMode && (
          <section className={styles.tripCheck} aria-label="Trip check">
            {tripExpired && (
              <p role="status">
                This trip check has expired. Recheck for current departures and
                pickup times.
              </p>
            )}
            {bestTrip && bestTrip.outbound ? (
              <>
                <span className={styles.eyebrow}>A TRIP TO CHECK</span>
                <h3>{bestTrip.resource.name}</h3>
                <p>
                  Arrival {formatTime(bestTrip.outbound.arrival)} ·{" "}
                  {bestTrip.outbound.source === "scheduled"
                    ? "scheduled transit"
                    : "routed travel estimate"}{" "}
                  · Central time.
                </p>
                <p>{currentTrip?.recommendation?.explanation.join(" ")}</p>
                {[...new Set([...bestTrip.reasons, ...bestTrip.warnings])]
                  .length > 0 && (
                  <details className={styles.tripWarnings}>
                    <summary>Before you go: requirements & unknowns</summary>
                    <ul>
                      {[
                        ...new Set([...bestTrip.reasons, ...bestTrip.warnings]),
                      ].map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {bestTrip.warnings
                  .filter((warning) =>
                    /appointment|step-free|dietary|pedestrian|fare.*unknown|eligibility/i.test(
                      warning,
                    ),
                  )
                  .map((warning) => (
                    <p key={warning} className={styles.caution}>
                      {warning}
                    </p>
                  ))}
                <p>
                  Food, admission, and accessible pickup are not guaranteed.{" "}
                  {bestTrip.status === "confirm"
                    ? "Confirm the listed requirements before traveling."
                    : "This meets only the checked planning constraints."}
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const freshNow = new Date(
                      Date.now() + serverClockOffset.current,
                    );
                    if (
                      !currentTrip ||
                      !foodTripIsFresh(currentTrip, freshNow)
                    ) {
                      setNow(freshNow);
                      return;
                    }
                    props.onCheckedDirections({
                      option: bestTrip,
                      date: currentTrip?.planningDate ?? "",
                      checkedAt: currentTrip?.searchedAt ?? "",
                      assumptions: currentTrip?.assumptions ?? [],
                      clockOffsetMs: serverClockOffset.current,
                    });
                  }}
                >
                  See this trip on the map
                </button>
              </>
            ) : (
              <h3>
                {routeState === "loading"
                  ? "Checking what you can reach…"
                  : "Browse places, then check before going"}
              </h3>
            )}
            {currentTrip && (
              <>
                {currentTrip.clarification && (
                  <p role="status">{currentTrip.clarification}</p>
                )}
                <details>
                  <summary>What Reach checked & planning assumptions</summary>
                  <p>{currentTrip.searchScope}</p>
                  <p>{currentTrip.message}</p>
                  <ul>
                    {currentTrip.assumptions?.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {currentTrip.recommendation?.explanation.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </details>
              </>
            )}
            {routeState !== "loading" && (
              <button
                className={styles.textButton}
                onClick={() => setCheckAgain((value) => value + 1)}
              >
                Recheck my trip
              </button>
            )}
          </section>
        )}
        {thinking && <RecommendationSkeletons />}
        <div className={styles.cards}>
          {visible.map(({ resource, summary, straightLineMiles }) => {
            const communityWindow =
              resource.communityHotspot ?? resource.communityOffer;
            const metric = currentRoutes[resource.id];
            const next = now ? nextPublishedWindow(resource, now) : null;
            const checked = resource.sources
              .map((source) => source.checkedOn)
              .filter((date): date is string => Boolean(date))
              .sort()[0];
            return (
              <article
                key={resource.id}
                className={styles.card}
                aria-label={resource.name}
              >
                <div className={styles.cardTop}>
                  <span>
                    <Check size={15} aria-hidden="true" />
                    {resource.communityOffer
                      ? "Household food share · moderator approved"
                      : resource.communityHotspot
                        ? "Community food hotspot · confirm details"
                        : resource.verificationStatus === "confirmed-site"
                          ? "Pickup site checked"
                          : "Location needs confirmation"}
                  </span>
                  <button
                    className="btn btn-ghost"
                    aria-label={`${props.savedIds.includes(resource.id) ? "Unsave" : "Save"} ${resource.name}`}
                    aria-pressed={props.savedIds.includes(resource.id)}
                    onClick={() => props.onSave(resource.id)}
                  >
                    <Bookmark size={20} aria-hidden="true" />
                  </button>
                </div>
                <h3>{resource.name}</h3>
                {extraCommunity.some(
                  (item) => item.resource.id === resource.id,
                ) && <p>Additional approved community option</p>}
                {activeRanking.some((item) => item.id === resource.id) && (
                  <div className={styles.caution}>
                    <strong>
                      {activeRanking.find((item) => item.id === resource.id)
                        ?.selectedBy === "ai"
                        ? "AI-compared match"
                        : "Distance-and-pickup match"}
                    </strong>
                    <details>
                      <summary>Why this suggestion?</summary>
                      <ul>
                        {activeRanking
                          .find((item) => item.id === resource.id)
                          ?.reasons.map((reason, index) => (
                            <li key={index}>{reason}</li>
                          ))}
                      </ul>
                    </details>
                  </div>
                )}
                <p className={styles.address}>
                  <MapPin size={16} aria-hidden="true" />
                  {resource.address}
                </p>
                <p>{resource.shortOffering ?? summary.offering}</p>
                <p className={styles.when}>
                  <strong>
                    {communityWindow &&
                    now &&
                    Date.parse(communityWindow.startsAt) <= now.getTime() &&
                    Date.parse(communityWindow.endsAt) > now.getTime()
                      ? resource.communityOffer
                        ? "Pickup window in progress. Request food to arrange pickup."
                        : "The organizer reports a pickup window in progress. Confirm before going."
                      : summary.availabilityLabel ===
                          "Published distribution window"
                        ? "A published distribution window is in progress. Call to confirm."
                        : next
                          ? `Next published start: ${next.label} (Central time)`
                          : "Call to check the next pickup time."}
                  </strong>
                </p>
                {metric ? (
                  <p className={styles.distance}>
                    {metric.miles.toFixed(1)} routed miles · about{" "}
                    {Math.ceil(metric.minutes)} min{" "}
                    {metric.mode === "transit"
                      ? "by scheduled transit"
                      : metric.mode === "driving"
                        ? "driving"
                        : "walking"}
                  </p>
                ) : straightLineMiles !== undefined ? (
                  <p className={styles.distance}>
                    {straightLineMiles.toFixed(1)} miles in a straight line ·
                    travel time not available
                  </p>
                ) : null}
                {metric && metric.attribution.length > 0 && (
                  <p className={styles.caption}>
                    {metric.attribution.map((a, i) => (
                      <span key={a.url}>
                        {i ? " · " : ""}
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {a.label}
                        </a>
                      </span>
                    ))}
                  </p>
                )}
                {!resource.communityOffer &&
                  resource.pedestrianPickup !== "allowed" && (
                    <p className={styles.caution}>
                      {resource.pedestrianPickup === "not-allowed"
                        ? "This site does not allow pickup on foot."
                        : "Walking or taking a bus? Call first to check pickup on foot."}
                    </p>
                  )}
                <div className={styles.cardActions}>
                  {resource.communityContact ? (
                    <a
                      className="btn btn-primary"
                      href={
                        resource.communityContact.kind === "email"
                          ? `mailto:${resource.communityContact.value}`
                          : `tel:${resource.communityContact.value}`
                      }
                    >
                      Contact to arrange pickup
                    </a>
                  ) : resource.communityOffer ? (
                    <a
                      className="btn btn-primary"
                      href={`/food-hotspots?type=offer#community-item-${encodeURIComponent(resource.communityOffer.recordId)}`}
                    >
                      Request food
                    </a>
                  ) : (
                    !found.blockedMode && (
                      <a
                        className="btn btn-primary"
                        href={foodDirectionsUrl(
                          resource,
                          location?.coordinates,
                          mode,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Google Maps directions{" "}
                        <ArrowUpRight size={17} aria-hidden="true" />
                      </a>
                    )
                  )}
                  {resource.phone && (
                    <a
                      className="btn btn-outline"
                      href={`tel:${resource.phone}`}
                      aria-label={`Call ${resource.name}`}
                    >
                      <Phone size={17} aria-hidden="true" />
                      Call
                    </a>
                  )}
                </div>
                <p className={styles.caption}>
                  {resource.communityOffer
                    ? "Community-shared food. Safety and availability aren’t verified. Check allergens and packaging; arrange pickup before traveling."
                    : "Google Maps calculates directions. Confirm food availability before going."}
                </p>
                <details className={styles.visit}>
                  <summary>Pickup times & what to bring</summary>
                  <p>
                    <strong>Published schedule:</strong> {summary.hours}
                  </p>
                  {resource.communityOffer && <p>{summary.offering}</p>}
                  <p>{summary.requirements}</p>
                  <p>{summary.accessibilityLabel}</p>
                  {communityWindow && <p>{resource.notes}</p>}
                  <p>
                    Sources checked: {checked ?? "date unknown"}. This is not
                    live availability.
                  </p>
                  {resource.sources
                    .filter((source) => source.url)
                    .map((source, i) => (
                      <a
                        key={`${source.url}-${i}`}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {source.title}
                      </a>
                    ))}
                </details>
                {!resource.communityOffer && (
                  <div className={styles.more}>
                    <button
                      className={styles.textButton}
                      onClick={() => props.onViewMap(resource)}
                    >
                      View on map
                    </button>
                    {resource.communityHotspot ? (
                      <a
                        className={styles.textButton}
                        href={`/food-hotspots#community-item-${encodeURIComponent(resource.communityHotspot.recordId)}`}
                      >
                        Community listing details
                      </a>
                    ) : (
                      <button
                        className={styles.textButton}
                        onClick={() => props.onDetails(resource.id)}
                      >
                        More pantry details
                      </button>
                    )}
                    {!found.blockedMode && (
                      <button
                        className={styles.textButton}
                        onClick={() => props.onDirections(resource)}
                      >
                        Directions in Reach
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {!showAll && choices.length > visible.length && (
          <button
            className={`btn btn-outline ${styles.showMore}`}
            onClick={() => setShowAll(true)}
          >
            Show {choices.length - visible.length} more places
          </button>
        )}
        <div className={styles.help}>
          <h3>Need help finding something else?</h3>
          <p>
            For more local options, call 211 or check the regional food bank.
          </p>
          <div>
            <a className="btn btn-outline" href="tel:211">
              Call 211
            </a>
            <a
              href="https://www.bvfb.org/find-food"
              target="_blank"
              rel="noopener noreferrer"
            >
              Food bank directory <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>
        <button className={styles.textButton} onClick={props.onAdvanced}>
          Step-by-step trip controls
        </button>
      </section>
    </div>
  );
}
