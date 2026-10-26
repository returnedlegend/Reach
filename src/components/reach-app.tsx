"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  BusFront,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Download,
  ExternalLink,
  Footprints,
  HeartHandshake,
  Info,
  Leaf,
  MapPin,
  Phone,
  Plus,
  Printer,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { demoData, demoDefaults } from "@/data/demo";
import {
  officialSources,
  productionData as sourceProductionData,
  productionDefaults,
} from "@/data/coverage";
import type { Pantry, PlannerInput, PlanResult } from "@/lib/types";
import { formatTime } from "@/lib/time";
import { en } from "@/lib/copy";
import { isSavedPlan } from "@/lib/saved-plan-validation";
import { downloadCard, STORAGE_KEY, type SavedPlan } from "@/lib/trip-card";

type Tab = "plan" | "saved" | "sources" | "about";
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
const shortTime = (value: string) =>
  formatTime(Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)));
const StatusIcon = ({ status }: { status: PlanResult["status"] }) =>
  status === "fits" ? (
    <CheckCircle2 size={16} />
  ) : status === "confirm" ? (
    <CircleHelp size={16} />
  ) : (
    <X size={16} />
  );

export function ReachApp({
  productionPantries = [],
  directoryError = "",
}: { productionPantries?: Pantry[]; directoryError?: string } = {}) {
  const productionData = {
    ...sourceProductionData,
    pantries: productionPantries,
  };
  const [tab, setTab] = useState<Tab>("plan");
  const [demo, setDemo] = useState(false);
  const [input, setInput] = useState<PlannerInput>(productionDefaults);
  const [submitted, setSubmitted] = useState<PlannerInput | null>(null);
  const [results, setResults] = useState<PlanResult[] | null>(null);
  const [filter, setFilter] = useState<"all" | PlanResult["status"]>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<SavedPlan[]>([]);
  const [detail, setDetail] = useState<SavedPlan | null>(null);
  const activeData = demo ? demoData : productionData;
  function toggleDemo() {
    setDemo(!demo);
    setInput(demo ? productionDefaults : demoDefaults);
    setResults(null);
    setSubmitted(null);
    setError("");
  }
  const resultsRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data: unknown = JSON.parse(raw);
        if (Array.isArray(data))
          setSaved(data.filter(isSavedPlan).slice(0, 20));
      }
    } catch {
      setNotice(
        "Saved plans could not be read. You can still download or print a trip card.",
      );
    }
  }, []);
  useEffect(() => {
    if (detail && dialogRef.current && !dialogRef.current.open)
      dialogRef.current.showModal();
    if (!detail && dialogRef.current?.open) dialogRef.current.close();
  }, [detail]);
  function change<K extends keyof PlannerInput>(
    key: K,
    value: PlannerInput[K],
  ) {
    setInput((old) => ({ ...old, [key]: value, skipDepartures: 0 }));
  }
  function navigate(next: Tab) {
    setTab(next);
    setNotice("");
    setError("");
  }
  function openDetail(plan: SavedPlan) {
    triggerRef.current = document.activeElement as HTMLElement;
    setDetail(plan);
  }
  function closeDetail() {
    setDetail(null);
    triggerRef.current?.focus();
  }
  function persist(next: SavedPlan[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSaved(next);
      return true;
    } catch {
      setNotice(
        "This browser could not save the plan. Download a trip card instead.",
      );
      return false;
    }
  }
  function savePlan(plan: SavedPlan) {
    const existing = saved.some((x) => x.id === plan.id);
    if (persist([plan, ...saved.filter((x) => x.id !== plan.id)].slice(0, 20)))
      setNotice(
        existing ? "Saved trip updated on this device." : en.saveNotice,
      );
  }
  function makePlan(result: PlanResult, values: PlannerInput): SavedPlan {
    return {
      id: `${result.pantryId}-${values.date}-${result.arrival}-${values.mode}-${values.visitMinutes}`,
      savedAt: new Date().toISOString(),
      demo,
      input: { ...values },
      result,
      pantry: activeData.pantries.find((x) => x.id === result.pantryId)!,
      placeNames: Object.fromEntries(
        [
          ...activeData.origins,
          ...activeData.pantries,
          ...activeData.transit.stops,
        ].map((p) => [p.id, p.name]),
      ),
      originName:
        activeData.origins.find((x) => x.id === values.originId)?.name ??
        "Starting landmark",
    };
  }
  async function findTrips(event?: FormEvent, override?: PlannerInput) {
    event?.preventDefault();
    const values = override ?? { ...input, skipDepartures: 0 };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demo, input: values }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error ?? "Trip planning is temporarily unavailable.",
        );
      setInput(values);
      setSubmitted(values);
      setResults(payload.results);
      setFilter("all");
      requestAnimationFrame(() => resultsRef.current?.focus());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not calculate trips. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const filtered = results?.filter(
    (x) => filter === "all" || x.status === filter,
  );
  const changed =
    submitted && JSON.stringify(input) !== JSON.stringify(submitted);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <button
            className="btn btn-outline brand"
            onClick={() => navigate("plan")}
            aria-label="Reach home"
          >
            <span className="brand-mark">
              <Route size={25} strokeWidth={2.4} />
            </span>
            reach<span className="brand-dot">.</span>
          </button>
          <nav aria-label="Trip planner navigation">
            <button
              className={
                "btn btn-outline " +
                (tab === "plan" ? "nav-item active" : "nav-item")
              }
              onClick={() => navigate("plan")}
            >
              <Route size={17} />
              Plan a visit
            </button>
            <button
              className={
                "btn btn-outline " +
                (tab === "saved" ? "nav-item active" : "nav-item")
              }
              onClick={() => navigate("saved")}
            >
              <Bookmark size={17} />
              Saved trips
              {saved.length > 0 && (
                <span className="count">{saved.length}</span>
              )}
            </button>
            <button
              className={
                "btn btn-outline " +
                (tab === "sources" ? "nav-item active" : "nav-item")
              }
              onClick={() => navigate("sources")}
            >
              <ShieldCheck size={17} />
              Our information
            </button>
          </nav>
          <button
            className="btn btn-outline help-button"
            aria-label="How Reach works"
            onClick={() => navigate("about")}
          >
            <CircleHelp size={18} />
            <span>How Reach works</span>
          </button>
        </div>
      </header>
      <main id="main" className="page-shell">
        {directoryError && !demo && <p role="alert">{directoryError}</p>}
        <div className="location-label">
          <MapPin size={14} /> BRYAN–COLLEGE STATION, TX{" "}
          <span className="location-divider" /> A COMMUNITY PROJECT
        </div>
        {notice && (
          <div className="toast" role="status">
            <Info size={18} />
            <span>{notice}</span>
            <button
              className="btn btn-outline"
              aria-label="Dismiss message"
              onClick={() => setNotice("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {tab === "plan" && (
          <>
            <section className="hero">
              <div>
                <div className="eyebrow">
                  <span /> EVERY JOURNEY STARTS WITH A PLAN
                </div>
                <h1>
                  Good food.
                  <br />A way there. <em>And back.</em>
                </h1>
                <p>
                  Find a pantry visit that works for your day.
                  <br className="desktop-break" /> We’ll help you think through
                  the whole trip.
                </p>
              </div>
              <div className="journey-art" aria-hidden="true">
                <div className="art-label">THE WHOLE JOURNEY, CONSIDERED</div>
                <div className="art-path">
                  <div className="art-node">
                    <MapPin />
                    <span>Your start</span>
                  </div>
                  <div className="art-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="art-node pantry">
                    <HeartHandshake />
                    <span>A helping hand</span>
                  </div>
                  <div className="art-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="art-node">
                    <Check />
                    <span>Back home</span>
                  </div>
                </div>
                <div className="art-note">
                  <Leaf size={15} /> A little planning. A little more peace of
                  mind.
                </div>
              </div>
            </section>
            <div className={`coverage-banner ${demo ? "demo" : ""}`}>
              <span className="banner-icon">
                {demo ? <Info size={21} /> : <ShieldCheck size={21} />}
              </span>
              <div>
                <strong>
                  {demo
                    ? "You’re exploring a fictional example"
                    : "8 local pantry listings. Carefully limited coverage."}
                </strong>
                <p>
                  {demo
                    ? "These places, bus times, and walking connections are made up for testing. Do not use them to travel."
                    : "Pantry hours and a BTD feed have been reviewed. Walking links and conflicting bus times still need confirmation, so local results are not travel-ready."}
                </p>
              </div>
              <button
                className="btn btn-outline text-button"
                onClick={toggleDemo}
              >
                {demo ? "Exit example" : "Try an example"}
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="planner-layout">
              <aside className="plan-sidebar">
                <form ref={formRef} onSubmit={findTrips}>
                  <div className="section-heading">
                    <div>
                      <span className="step-label">01 / YOUR DAY</span>
                      <h2>Let’s plan your visit</h2>
                    </div>
                    <SlidersHorizontal size={20} />
                  </div>
                  {!demo && (
                    <p className="form-intro">
                      Start at a published BTD stop. Route 00 Orange is the only
                      imported route; pantry walking connections are not yet
                      reviewed.
                    </p>
                  )}
                  <fieldset disabled={busy}>
                    <div className="field">
                      <label htmlFor="origin">Where are you starting?</label>
                      <div className="select-wrap">
                        <MapPin size={17} />
                        <select
                          className="select w-full"
                          id="origin"
                          value={input.originId}
                          onChange={(e) => change("originId", e.target.value)}
                        >
                          {activeData.origins.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className="field-note">
                        {demo
                          ? "Fictional landmarks with example walking links."
                          : "You start at the stop itself. Travel to this landmark is not included."}
                      </span>
                    </div>
                    <div className="field">
                      <label htmlFor="date">What day?</label>
                      <input
                        className="input w-full"
                        required
                        id="date"
                        type="date"
                        value={input.date}
                        onChange={(e) => change("date", e.target.value)}
                      />
                      <span className="field-note">
                        {demo
                          ? "Example schedules: Oct 1 – Dec 31, 2026."
                          : "Central Time · imported feed ends Dec 31, 2026."}
                      </span>
                    </div>
                    <div className="field-pair">
                      <div className="field">
                        <label htmlFor="leave">Leave after</label>
                        <input
                          className="input w-full"
                          required
                          id="leave"
                          type="time"
                          value={input.earliestDeparture}
                          onChange={(e) =>
                            change("earliestDeparture", e.target.value)
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="return">Home by</label>
                        <input
                          className="input w-full"
                          required
                          id="return"
                          type="time"
                          value={input.latestReturn}
                          onChange={(e) =>
                            change("latestReturn", e.target.value)
                          }
                        />
                      </div>
                    </div>
                    <div className="field">
                      <span className="field-label" id="mode-label">
                        How will you travel?
                      </span>
                      <div
                        className="mode-options"
                        role="group"
                        aria-labelledby="mode-label"
                      >
                        <button
                          type="button"
                          aria-pressed={input.mode === "bus"}
                          className={
                            "btn btn-outline " +
                            (input.mode === "bus" ? "selected" : "")
                          }
                          onClick={() => change("mode", "bus")}
                        >
                          <BusFront size={19} />
                          Bus + walk
                        </button>
                        <button
                          type="button"
                          aria-pressed={input.mode === "walk"}
                          className={
                            "btn btn-outline " +
                            (input.mode === "walk" ? "selected" : "")
                          }
                          onClick={() => change("mode", "walk")}
                        >
                          <Footprints size={19} />
                          Walk only
                        </button>
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor="walk">
                        Walking limit <span>whole round trip</span>
                      </label>
                      <select
                        className="select w-full"
                        id="walk"
                        value={input.maxWalkMiles}
                        onChange={(e) =>
                          change("maxWalkMiles", Number(e.target.value))
                        }
                      >
                        <option value={0.5}>Up to ½ mile total</option>
                        <option value={1}>Up to 1 mile total</option>
                        <option value={2}>Up to 2 miles total</option>
                        <option value={3}>Up to 3 miles total</option>
                      </select>
                      <span className="field-note">
                        Consider the walk home with groceries, too.
                      </span>
                    </div>
                    <details className="preferences">
                      <summary>
                        Visit time & appointment <Plus size={16} />
                      </summary>
                      <div className="field">
                        <label htmlFor="duration">Time at the pantry</label>
                        <select
                          className="select w-full"
                          id="duration"
                          value={input.visitMinutes}
                          onChange={(e) =>
                            change("visitMinutes", Number(e.target.value))
                          }
                        >
                          <option value={20}>20 minutes</option>
                          <option value={30}>30 minutes</option>
                          <option value={45}>45 minutes</option>
                          <option value={60}>1 hour</option>
                          <option value={90}>1½ hours</option>
                        </select>
                        <span className="field-note">
                          An allowance, not a verified queue estimate. Includes
                          a 5-minute pantry arrival buffer and 5 minutes at each
                          bus boarding.
                        </span>
                      </div>
                      <div className="field">
                        <label htmlFor="appointment">
                          If an appointment is needed
                        </label>
                        <select
                          className="select w-full"
                          id="appointment"
                          value={input.appointmentStatus}
                          onChange={(e) =>
                            change(
                              "appointmentStatus",
                              e.target
                                .value as PlannerInput["appointmentStatus"],
                            )
                          }
                        >
                          <option value="unknown">
                            I’m not sure / not checked
                          </option>
                          <option value="not-booked">I don’t have one</option>
                          <option value="booked">
                            I have one — confirm my slot
                          </option>
                        </select>
                        <span className="field-note">
                          A booking still needs its exact time checked.
                        </span>
                      </div>
                    </details>
                    <button
                      className="btn btn-primary primary-button find-button"
                      type="submit"
                    >
                      {busy ? "Checking the whole trip…" : "Find my options"}
                      {!busy && <ArrowRight size={18} />}
                    </button>
                  </fieldset>

                  <div className="privacy-note">
                    <ShieldCheck size={14} />
                    No account. No home address. Just a plan.
                  </div>
                  {error && (
                    <div className="form-error" role="alert">
                      {error}
                    </div>
                  )}
                </form>
              </aside>
              <section
                className="options-section"
                ref={resultsRef}
                tabIndex={-1}
                aria-label="Trip options"
              >
                <div className="options-header">
                  <div>
                    <span className="step-label">02 / YOUR OPTIONS</span>
                    <h2>
                      {results
                        ? "A few ways forward"
                        : "A plan you can feel clearer about"}
                    </h2>
                  </div>
                  <span className="small-pill">
                    {demo ? "EXAMPLE MODE" : "SOURCE-REVIEWED LISTINGS"}
                  </span>
                </div>
                {!results && (
                  <>
                    <div className="intro-card">
                      <div className="intro-icon">
                        <Route size={29} />
                      </div>
                      <h3>More than a way there.</h3>
                      <p>
                        A useful plan leaves time to check in, collect food, and
                        catch your ride home. Reach checks published hours and
                        shows what still needs confirmation.
                      </p>
                      <div className="check-list">
                        <div>
                          <Check size={16} />
                          <span>Pantry dates and registration cutoffs</span>
                        </div>
                        <div>
                          <Check size={16} />
                          <span>
                            Walking, bus connections, and a return trip
                          </span>
                        </div>
                        <div>
                          <Check size={16} />
                          <span>Requirements to check before you go</span>
                        </div>
                      </div>
                      <button
                        className="btn btn-outline text-button"
                        onClick={() => formRef.current?.requestSubmit()}
                      >
                        {demo
                          ? "Find options with this example"
                          : "Compare local pantry listings"}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="legend-cards">
                      <div>
                        <span className="status-dot fits" />
                        <h4>Fits your day</h4>
                        <p>The schedule fits the constraints you shared.</p>
                      </div>
                      <div>
                        <span className="status-dot confirm" />
                        <h4>Check a detail</h4>
                        <p>Something important still needs confirmation.</p>
                      </div>
                      <div>
                        <span className="status-dot no" />
                        <h4>Try another time</h4>
                        <p>We’ll explain what makes a trip unworkable.</p>
                      </div>
                    </div>
                    <div className="resource-card">
                      <div className="resource-icon">
                        <HeartHandshake size={24} />
                      </div>
                      <div>
                        <h3>Looking for food assistance now?</h3>
                        <p>
                          Use the Brazos Valley Food Bank’s directory to contact
                          local providers. Confirm hours and pickup requirements
                          directly.
                        </p>
                        <a
                          href="https://www.bvfb.org/find-food"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Visit the official food directory
                          <ArrowUpRight size={16} />
                        </a>
                      </div>
                    </div>
                  </>
                )}
                {results && submitted && (
                  <>
                    <p className="results-summary">
                      {dateLabel(submitted.date)} <span>·</span>{" "}
                      {shortTime(submitted.earliestDeparture)}–
                      {shortTime(submitted.latestReturn)} Central
                    </p>
                    {changed && (
                      <div className="inline-notice">
                        <Info size={17} />
                        Your inputs changed. Select “Find my options” to update
                        these results.
                      </div>
                    )}
                    {(submitted.skipDepartures ?? 0) > 0 && (
                      <div className="inline-notice">
                        <Clock3 size={17} />
                        Showing options after skipping{" "}
                        {submitted.skipDepartures} earlier departure
                        {submitted.skipDepartures === 1 ? "" : "s"} at each
                        pantry.
                      </div>
                    )}
                    <div
                      className="filter-tabs"
                      role="group"
                      aria-label="Filter options"
                    >
                      {(["all", "fits", "confirm", "no"] as const).map((f) => (
                        <button
                          key={f}
                          aria-pressed={filter === f}
                          onClick={() => setFilter(f)}
                          className={
                            "btn btn-outline " + (filter === f ? "active" : "")
                          }
                        >
                          {f === "all"
                            ? "All options"
                            : f === "fits"
                              ? "Fits"
                              : f === "confirm"
                                ? "Confirm"
                                : "Doesn’t fit"}
                          <span>
                            {f === "all"
                              ? results.length
                              : results.filter((r) => r.status === f).length}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="result-list">
                      {filtered?.map((result) => (
                        <OptionCard
                          key={result.pantryId}
                          result={result}
                          pantry={
                            activeData.pantries.find(
                              (x) => x.id === result.pantryId,
                            )!
                          }
                          input={submitted}
                          demo={demo}
                          onOpen={() => openDetail(makePlan(result, submitted))}
                        />
                      ))}
                    </div>
                    {!filtered?.length && (
                      <div className="empty-state">
                        <CircleHelp size={28} />
                        <h3>No options in this category</h3>
                        <p>
                          Try viewing all options or changing your trip time.
                        </p>
                      </div>
                    )}
                    {submitted.mode === "bus" && (
                      <div className="later-card">
                        <div>
                          <strong>Compare later scheduled departures</strong>
                          <p>
                            Explore later departures relative to your search
                            time. This comparison does not use the current
                            clock. For a missed bus now, use the guided planner
                            on the home page.
                          </p>
                        </div>
                        <button
                          className="btn btn-outline secondary-button"
                          disabled={
                            busy || (submitted.skipDepartures ?? 0) >= 10
                          }
                          onClick={() =>
                            findTrips(undefined, {
                              ...submitted,
                              skipDepartures:
                                (submitted.skipDepartures ?? 0) + 1,
                            })
                          }
                        >
                          Try a later departure
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    )}
                    <p className="fine-print">
                      <Info size={14} />
                      {en.scheduleNotice}
                    </p>
                  </>
                )}
              </section>
            </div>
          </>
        )}
        {tab === "saved" && (
          <section className="inner-page">
            <span className="eyebrow">A PLAN TO KEEP CLOSE</span>
            <div className="page-title-row">
              <div>
                <h1>
                  Your saved trips<span className="brand-dot">.</span>
                </h1>
                <p>
                  On this browser only. Saving a plan does not book an
                  appointment.
                </p>
              </div>
              {saved.length > 0 && (
                <button
                  className="btn btn-outline secondary-button"
                  onClick={() => {
                    if (persist([]))
                      setNotice(
                        "All saved plans were cleared from this browser.",
                      );
                  }}
                >
                  <Trash2 size={16} />
                  Clear all saved plans
                </button>
              )}
            </div>
            {saved.length === 0 ? (
              <div className="empty-state large">
                <Bookmark size={38} />
                <h2>A little peace of mind, saved.</h2>
                <p>
                  Open a trip’s details to save it here, or download a card you
                  can keep.
                </p>
                <button
                  className="btn btn-primary primary-button"
                  onClick={() => navigate("plan")}
                >
                  Plan a visit
                  <ArrowRight size={17} />
                </button>
              </div>
            ) : (
              <div className="saved-grid">
                {saved.map((plan) => (
                  <article className="saved-card" key={plan.id}>
                    <span className="demo-tag">
                      {plan.demo ? "FICTIONAL EXAMPLE" : "SAVED SNAPSHOT"}
                    </span>
                    <h2>{plan.pantry.name}</h2>
                    <p>{dateLabel(plan.input.date)}</p>
                    <div className={`status-label ${plan.result.status}`}>
                      <StatusIcon status={plan.result.status} />
                      {en.statuses[plan.result.status]}
                    </div>
                    <p className="small-copy">
                      Saved information can become outdated. Recheck before
                      travel.
                    </p>
                    <div className="saved-actions">
                      <button
                        className="btn btn-outline text-button"
                        onClick={() => openDetail(plan)}
                      >
                        Open trip
                        <ArrowRight size={16} />
                      </button>
                      <button
                        className="btn btn-outline icon-button"
                        aria-label={`Remove saved trip to ${plan.pantry.name}`}
                        onClick={() =>
                          persist(saved.filter((x) => x.id !== plan.id))
                        }
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="fine-print">
              Downloaded text cards can be read offline. This app does not
              provide offline routing.
            </p>
          </section>
        )}
        {tab === "sources" && (
          <SourcesPage pantryCount={productionPantries.length} />
        )}
        {tab === "about" && (
          <section className="inner-page about-page">
            <span className="eyebrow">MADE FOR THE WHOLE JOURNEY</span>
            <h1>
              A little more
              <br />
              <em>within reach.</em>
            </h1>
            <p className="lead">
              Finding a pantry is one step. Knowing whether you can get there,
              collect food, and get home is the next.
            </p>
            <div className="about-steps">
              {[
                {
                  icon: MapPin,
                  title: "Tell us about your day",
                  text: "Choose a starting landmark, a date, and your time and walking limits. No account or personal eligibility details are needed.",
                },
                {
                  icon: Route,
                  title: "Consider the whole trip",
                  text: "The planner checks the way there and back, pantry windows, registration deadlines, and time for your visit.",
                },
                {
                  icon: CircleHelp,
                  title: "Know what still needs a call",
                  text: "Missing or conflicting information stays visible. A schedule match is not a guarantee of eligibility, admission, food stock, or short lines.",
                },
                {
                  icon: Bookmark,
                  title: "Keep your plan handy",
                  text: "Save a trip in this browser, print it, or download a text card. A saved plan is never an appointment reservation.",
                },
              ].map((s, i) => (
                <article key={s.title}>
                  <span className="step-number">0{i + 1}</span>
                  <s.icon size={23} />
                  <h2>{s.title}</h2>
                  <p>{s.text}</p>
                </article>
              ))}
            </div>
            <div className="coverage-banner">
              <ShieldCheck />
              <div>
                <strong>A student project, built transparently</strong>
                <p>
                  Reach is a Congressional App Challenge project in development.
                  Eight local listings and BTD Route 00 Orange feed data have
                  been reviewed. Local pedestrian connections and conflicting
                  bus times remain unresolved; fictional examples demonstrate
                  the complete workflow. English is the only reviewed interface
                  language.
                </p>
              </div>
            </div>
            <button
              className="btn btn-primary primary-button"
              onClick={() => navigate("plan")}
            >
              Back to the planner
              <ArrowRight size={17} />
            </button>
          </section>
        )}
        <footer className="site-footer">
          <div className="footer-brand">
            <Route size={18} />
            <strong>Reach AI</strong>
            <span>Small steps. More possibilities.</span>
          </div>
          <div>
            <button
              className="btn btn-outline"
              onClick={() => navigate("sources")}
            >
              Sources & limitations
            </button>
            <span>Made with care for the Brazos Valley</span>
          </div>
        </footer>
      </main>
      <dialog
        ref={dialogRef}
        className="trip-dialog"
        onCancel={closeDetail}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDetail();
        }}
        aria-labelledby="trip-title"
      >
        {detail && (
          <TripDetails
            plan={detail}
            onClose={closeDetail}
            onSave={() => savePlan(detail)}
            saved={saved.some((x) => x.id === detail.id)}
            notice={notice}
          />
        )}
      </dialog>
    </>
  );
}

function OptionCard({
  result,
  pantry,
  input,
  demo,
  onOpen,
}: {
  result: PlanResult;
  pantry: Pantry;
  input: PlannerInput;
  demo: boolean;
  onOpen: () => void;
}) {
  const window = pantry.windows.find((x) => x.id === result.windowId);
  const bus = result.segments.find((x) => x.kind === "bus");
  return (
    <article className={`option-card ${result.status}`}>
      <div className="option-top">
        <span className={`status-label ${result.status}`}>
          <StatusIcon status={result.status} />
          {en.statuses[result.status]}
        </span>
        <span className="demo-tag">
          {demo ? "EXAMPLE" : "WEBSITE REVIEWED"}
        </span>
      </div>
      <h3>{pantry.name}</h3>
      <p className="address">
        <MapPin size={14} />
        {pantry.address}
      </p>
      <div className="option-facts">
        <span>
          <Clock3 size={16} />
          {window
            ? `${shortTime(window.opens)}–${shortTime(window.distributionCutoff ?? window.closes)}`
            : result.status === "confirm"
              ? "Schedule needs confirmation"
              : "No matching visit window"}
        </span>
        <span>
          {input.mode === "bus" ? (
            <BusFront size={16} />
          ) : (
            <Footprints size={16} />
          )}
          {bus
            ? bus.route
            : input.mode === "walk"
              ? "Walk only"
              : result.status === "confirm"
                ? "Bus connection unconfirmed"
                : "No complete bus trip"}
        </span>
        {result.walkingMiles !== undefined && (
          <span>
            <Footprints size={16} />
            {result.walkingMiles.toFixed(2)} mi total
          </span>
        )}
      </div>
      <ul className="reason-list">
        {result.reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
      <div className="option-bottom">
        <span>
          {result.returnAt !== undefined ? (
            <>
              Back by <strong>{formatTime(result.returnAt)}</strong>
            </>
          ) : (
            "See the details before making a plan"
          )}
        </span>
        <button className="btn btn-outline text-button" onClick={onOpen}>
          View trip details
          <ArrowRight size={17} />
        </button>
      </div>
    </article>
  );
}

function TripDetails({
  plan,
  onClose,
  onSave,
  saved,
  notice,
}: {
  plan: SavedPlan;
  onClose: () => void;
  onSave: () => void;
  saved: boolean;
  notice: string;
}) {
  const { pantry, result, input } = plan;
  const window = pantry.windows.find((x) => x.id === result.windowId);
  const visits = result.segments;
  return (
    <div className="dialog-body">
      <div className="dialog-toolbar">
        <span>
          <Route size={18} /> YOUR ROUND TRIP
        </span>
        <button
          className="btn btn-outline icon-button"
          onClick={onClose}
          aria-label="Close trip details"
        >
          <X size={22} />
        </button>
      </div>
      <div className="trip-content">
        <span className="demo-tag">
          {plan.demo
            ? "FICTIONAL EXAMPLE · DO NOT USE FOR TRAVEL"
            : "SCHEDULED ESTIMATES"}
        </span>
        <h2 id="trip-title">{pantry.name}</h2>
        <p className="address">
          <MapPin size={16} />
          {pantry.address}
        </p>
        <p>{dateLabel(input.date)} · Central Time</p>
        <div className={`detail-status ${result.status}`}>
          <StatusIcon status={result.status} />
          <div>
            <strong>{en.statuses[result.status]}</strong>
            <ul>
              {result.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="trip-summary">
          <div>
            <span>Start at</span>
            <strong>{plan.originName}</strong>
          </div>
          <div>
            <span>Leave</span>
            <strong>
              {visits.length ? formatTime(visits[0].start) : "No itinerary"}
            </strong>
          </div>
          <div>
            <span>Home by</span>
            <strong>
              {result.returnAt !== undefined
                ? formatTime(result.returnAt)
                : "Not confirmed"}
            </strong>
          </div>
          <div>
            <span>Total walking</span>
            <strong>
              {result.walkingMiles !== undefined
                ? `${result.walkingMiles.toFixed(2)} mi`
                : "Not confirmed"}
            </strong>
          </div>
        </div>
        <h3 className="detail-heading">
          Your itinerary <span>Scheduled, not live</span>
        </h3>
        {visits.length ? (
          <ol className="timeline">
            {visits.map((s, i) => (
              <li key={i} className={`segment ${s.kind}`}>
                <div className="timeline-icon">
                  {s.kind === "walk" ? (
                    <Footprints size={18} />
                  ) : s.kind === "bus" ? (
                    <BusFront size={18} />
                  ) : s.kind === "visit" ? (
                    <HeartHandshake size={18} />
                  ) : (
                    <Clock3 size={18} />
                  )}
                </div>
                <div>
                  <span className="segment-time">
                    {formatTime(s.start)} – {formatTime(s.end)}
                  </span>
                  <strong>
                    {s.kind === "visit"
                      ? `Visit ${pantry.name}`
                      : s.kind === "wait"
                        ? "Wait / connection buffer"
                        : s.kind === "bus"
                          ? `Take ${s.route}`
                          : "Walk"}
                  </strong>
                  <p>
                    {s.kind === "visit"
                      ? `${input.visitMinutes}-minute visit allowance. The arrival buffer appears separately; queues can be longer.`
                      : `${plan.placeNames?.[s.from] ?? s.from} → ${plan.placeNames?.[s.to] ?? s.to}`}
                  </p>
                  {s.miles !== undefined && (
                    <span className="field-note">
                      {s.miles.toFixed(2)} miles ·{" "}
                      {plan.demo
                        ? "fictional walking connection"
                        : "reviewed connection; check current conditions"}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="inline-notice">
            <Info size={18} />
            {result.status === "confirm"
              ? "A complete round trip cannot be confirmed from the available data. Check the missing information before traveling."
              : "No complete round-trip itinerary meets these inputs. Try another date, departure, or return deadline."}
          </div>
        )}
        <h3 className="detail-heading">Before you go</h3>
        {pantry.notes && <p className="small-copy">{pantry.notes}</p>}
        <dl className="requirements">
          <div>
            <dt>Distribution window</dt>
            <dd>
              {window
                ? `${shortTime(window.opens)}–${shortTime(window.distributionCutoff ?? window.closes)}`
                : "No matching distribution date"}
            </dd>
          </div>
          <div>
            <dt>Registration</dt>
            <dd>
              {window?.registrationCutoff
                ? `${window.registrationOpens ? `From ${shortTime(window.registrationOpens)} · ` : ""}Closes ${shortTime(window.registrationCutoff)}`
                : "Not separately published — confirm"}
            </dd>
          </div>
          <div>
            <dt>Appointment</dt>
            <dd>
              {window?.appointmentRequired === true
                ? "Required; exact booked time needs confirmation"
                : window?.appointmentRequired === false
                  ? plan.demo
                    ? "Not required in this example"
                    : "No appointment required per source"
                  : "Unknown — confirm with provider"}
              {pantry.bookingUrl && (
                <a href={pantry.bookingUrl} target="_blank" rel="noreferrer">
                  Official booking page
                  <ExternalLink size={13} />
                </a>
              )}
            </dd>
          </div>
          <div>
            <dt>Pickup format</dt>
            <dd>
              {pantry.pickupFormat ?? "Unknown"}
              {pantry.pickupFormat === "drive-through" && (
                <span>
                  {" "}
                  · Pedestrian access: {pantry.pedestrianPickup ?? "unknown"}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Service area</dt>
            <dd>{pantry.serviceArea ?? "Unknown — confirm"}</dd>
          </div>
          <div>
            <dt>Visit frequency</dt>
            <dd>{pantry.visitFrequency ?? "Unknown — confirm"}</dd>
          </div>
          <div>
            <dt>Documents</dt>
            <dd>
              {pantry.documents?.length
                ? pantry.documents.map((d) => (
                    <span className="document-item" key={d.name}>
                      {d.name} <strong>({d.requirement})</strong>
                    </span>
                  ))
                : "Not specified — ask which are requested or required"}
            </dd>
          </div>
          <div>
            <dt>Languages</dt>
            <dd>{pantry.languages?.join(", ") || "Not verified"}</dd>
          </div>
          <div>
            <dt>Accessibility</dt>
            <dd>{pantry.accessibility || "Not verified"}</dd>
          </div>
        </dl>
        {pantry.missingInformation && pantry.missingInformation.length > 0 && (
          <div className="inline-notice">
            <CircleHelp size={18} />
            <div>
              <strong>Still needs confirmation</strong>
              <ul>
                {pantry.missingInformation.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {pantry.phone ? (
          <a
            className="secondary-button call-button"
            href={`tel:${pantry.phone.replace(/[^+\d]/g, "")}`}
          >
            <Phone size={16} />
            Call provider
          </a>
        ) : (
          <p className="small-copy">
            {plan.demo
              ? "No call button: this is a fictional provider with no real phone number."
              : "No verified phone number is available."}
          </p>
        )}
        <h3 className="detail-heading">Where this information comes from</h3>
        <div className="source-list">
          {result.sources.map((s, i) => (
            <div key={`${s.id}-${i}`}>
              <ShieldCheck size={16} />
              <div>
                <strong>{s.title}</strong>
                <span>
                  {s.fictional
                    ? "Fictional test data · not provider confirmed"
                    : `Last checked: ${s.checkedOn ?? "unknown"} · ${s.verificationMethod ?? "method unknown"}`}
                </span>
                {s.url && (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    View official source
                    <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="fine-print">
          Hours do not guarantee food stock, admission, or short queues. A saved
          trip is not an appointment. Downloaded cards can be read offline;
          routing requires the app.
        </p>
        {notice && (
          <p className="inline-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      <div className="trip-actions">
        <button className="btn btn-primary primary-button" onClick={onSave}>
          {saved ? <Check size={17} /> : <Bookmark size={17} />}
          {saved ? "Saved on this device" : "Save trip"}
        </button>
        <button
          className="btn btn-outline secondary-button"
          onClick={() => downloadCard(plan)}
        >
          <Download size={17} />
          Download card
        </button>
        <button
          className="btn btn-outline icon-button print-button"
          onClick={() => windowPrint()}
          aria-label="Print trip card"
        >
          <Printer size={20} />
        </button>
      </div>
    </div>
  );
}
function windowPrint() {
  window.print();
}
function SourcesPage({ pantryCount }: { pantryCount: number }) {
  return (
    <section className="inner-page sources-page">
      <span className="eyebrow">KNOW WHAT YOU’RE RELYING ON</span>
      <h1>
        Good information.
        <br />
        <em>Honest limits.</em>
      </h1>
      <p className="lead">
        Every useful plan starts with trustworthy information. Here’s exactly
        where Reach stands.
      </p>
      <div className="coverage-stats">
        <div>
          <strong>{pantryCount}</strong>
          <span>Website-reviewed pantry listings</span>
        </div>
        <div>
          <strong>1</strong>
          <span>Imported BTD route · confirmation needed</span>
        </div>
        <div>
          <strong>6</strong>
          <span>Fictional pantry examples</span>
        </div>
      </div>
      <div className="coverage-banner">
        <TriangleAlert size={24} />
        <div>
          <strong>
            Local listings are reviewed; full trips still need confirmation
          </strong>
          <p>
            Pantry details were checked on official websites on October 15,
            2026. BTD’s GTFS feed covers July 15, 2025–December 31, 2026; Route
            00 Orange is imported. Its bus times conflict with the linked
            November 2025 PDF, and no pantry walking route is reviewed. Reach
            does not turn those gaps into a travel-ready itinerary.
          </p>
        </div>
      </div>
      <h2 className="section-title">Official places to check</h2>
      <div className="source-grid">
        {officialSources.map((s) => (
          <article key={s.id}>
            <div className="source-card-top">
              <ShieldCheck size={22} />
              <span className="small-pill">
                {s.verified ? "WEBSITE REVIEWED" : "NOT CONNECTED"}
              </span>
            </div>
            <h3>{s.name}</h3>
            <p>{s.status}</p>
            <p className="small-copy">
              {s.verified ? "Website checked" : "Access attempted"} October 15,
              2026. No provider telephone confirmation.
            </p>
            <a
              className="text-button"
              href={s.url}
              target="_blank"
              rel="noreferrer"
            >
              Open official website
              <ArrowUpRight size={16} />
            </a>
          </article>
        ))}
      </div>
      <div className="review-box">
        <div>
          <span className="step-label">FOR PROJECT MAINTAINERS</span>
          <h2>Review first. Publish second.</h2>
          <p>
            Trusted data is updated through version-controlled files, not a
            public editor. Record each source, check its dates, review walking
            connections, and validate a complete outward and return journey
            before publishing coverage.
          </p>
        </div>
        <ol>
          <li>
            Edit <code>src/data/real-pantries.ts</code> and reviewed connections
            in <code>src/data/coverage.ts</code>.
          </li>
          <li>
            Keep fictional fixtures in <code>src/data/demo.ts</code>.
          </li>
          <li>
            Run <code>npm run data:validate</code> and the tests.
          </li>
          <li>Review the evidence and changes with another maintainer.</li>
        </ol>
        <p className="small-copy">
          See <code>docs/DATA-REVIEW.md</code> in the repository for the
          complete review checklist. No data can be changed from this screen.
        </p>
      </div>
      <div className="limits-grid">
        <article>
          <h3>Transit support</h3>
          <p>
            The routing engine supports a small published timetable with direct
            rides or one transfer at the same stop. The official BTD GTFS
            snapshot supplies Route 00 Orange. The linked PDF conflicts with its
            times, so confirm with BTD at 979-778-0607. Holiday closures from
            the agency website override the feed’s empty exceptions file. Texas
            A&M Transit is a research lead, not a supported agency.
          </p>
        </article>
        <article>
          <h3>Walking & accessibility</h3>
          <p>
            No real pedestrian routes have been reviewed. Example distances are
            fictional. Reach never substitutes straight-line distances for safe
            walking directions.
          </p>
        </article>
        <article>
          <h3>Freshness & privacy</h3>
          <p>
            Plans are saved only in your browser. Clear them in Saved trips.
            Downloaded cards are snapshots and can become outdated. Reach has no
            live bus tracking or offline route calculation.
          </p>
        </article>
      </div>
    </section>
  );
}
