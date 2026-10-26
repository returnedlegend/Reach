"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import dynamic from "next/dynamic";
import { AILoadingIndicator } from "./ai-loading-indicator";
import { FOOD_SEARCH_TIMEOUT_MS } from "@/lib/ai-timing";
import { transitStops, type Resource } from "../data/resources";
import Link from "next/link";
import {
  CORE_FEATURES,
  type PublicFeatures,
} from "../lib/public-feature-types";
import { chicagoNow, googleMapsUrl, validCoordinates } from "../lib/journey";
import { formatTime } from "../lib/time";
import type {
  AccessInput,
  AccessOption,
  AccessResponse,
} from "../lib/access-types";
import { LocationPicker, type SelectedLocation } from "./location-picker";
import { NavigationPreferences } from "./navigation-preferences";
import { NavigationGuidanceView } from "./navigation-guidance";
import {
  DEFAULT_NAVIGATION_NEEDS,
  type NavigationNeeds,
  type NeedsSuggestion,
} from "../lib/navigation-types";
import "./access-planner.css";

const JourneyMap = dynamic(
  () => import("./journey-map").then((module) => module.JourneyMap),
  { loading: () => <p role="status">Loading map…</p> },
);

type Props = {
  location: SelectedLocation | null;
  onLocationChange: (location: SelectedLocation) => void;
  onBack: () => void;
  foodResources: Resource[];
  features?: PublicFeatures;
};
type AssistReply = NeedsSuggestion;

function safeAssistPatch(value: unknown): Partial<AccessInput> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const patch: Partial<AccessInput> = {};
  if (
    raw.mode === "walking" ||
    raw.mode === "transit" ||
    raw.mode === "driving"
  )
    patch.mode = raw.mode;
  if (raw.mobility === "standard" || raw.mobility === "step-free")
    patch.mobility = raw.mobility;
  if (
    raw.appointment === "booked" ||
    raw.appointment === "not-booked" ||
    raw.appointment === "unknown"
  )
    patch.appointment = raw.appointment;
  for (const key of [
    "maxWalkingMinutes",
    "maxWalkingMiles",
    "fareBudget",
    "maxTransfers",
    "visitMinutes",
    "arrivalBufferMinutes",
  ] as const) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key]))
      patch[key] = raw[key] as never;
  }
  for (const key of [
    "eligibilityConfirmed",
    "dietaryRequired",
    "allowWaiting",
  ] as const) {
    if (typeof raw[key] === "boolean") patch[key] = raw[key];
  }
  for (const key of [
    "dietaryPreference",
    "date",
    "departure",
    "arrivalDeadline",
    "returnDeadline",
  ] as const) {
    if (typeof raw[key] === "string") patch[key] = raw[key] as never;
  }
  return Object.keys(patch).length ? patch : undefined;
}

function safeAssistNeeds(value: unknown): Partial<NavigationNeeds> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>,
    patch: Partial<NavigationNeeds> = {};
  if (
    ["food", "groceries", "prepared-meals", "shelter"].includes(
      String(raw.service),
    )
  )
    patch.service = raw.service as NavigationNeeds["service"];
  if (["soon", "today", "flexible"].includes(String(raw.urgency)))
    patch.urgency = raw.urgency as NavigationNeeds["urgency"];
  if (["yes", "no", "unknown"].includes(String(raw.hasIdentification)))
    patch.hasIdentification =
      raw.hasIdentification as NavigationNeeds["hasIdentification"];
  if (
    Number.isInteger(raw.householdSize) &&
    Number(raw.householdSize) >= 1 &&
    Number(raw.householdSize) <= 20
  )
    patch.householdSize = Number(raw.householdSize);
  if (typeof raw.preferTransitNearby === "boolean")
    patch.preferTransitNearby = raw.preferTransitNearby;
  return Object.keys(patch).length ? patch : undefined;
}

function readablePatch(patch: Partial<AccessInput>) {
  return Object.entries(patch)
    .map(
      ([key, value]) =>
        `${key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}: ${String(value)}`,
    )
    .join(" · ");
}

function chicagoDefaults() {
  const now = chicagoNow(new Date());
  return {
    date: now.date,
    departure: now.time,
  };
}

function validResponse(value: unknown): value is AccessResponse {
  const response = value as AccessResponse | null;
  return Boolean(
    response &&
      Array.isArray(response.options) &&
      typeof response.message === "string",
  );
}

function displayTime(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Not provided";
  return formatTime(value);
}

function inputClock(value: string | undefined) {
  if (!value) return "";
  const [hourText, minute = "00"] = value.split(":");
  const hour = Number(hourText);
  return `${String(hour >= 24 ? hour - 24 : hour).padStart(2, "0")}:${minute}`;
}

function isNextDay(value: string | undefined) {
  return Boolean(value && Number(value.slice(0, 2)) >= 24);
}

function withDayOffset(value: string, nextDay: boolean) {
  if (!value) return undefined;
  const [hour, minute] = value.split(":").map(Number);
  return `${String(hour + (nextDay ? 24 : 0)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function availabilityLabel(option: AccessOption) {
  const availability = option.availability;
  // Availability enters this planner as dated reports, never a verified live feed.
  // A source's freeform name cannot establish real-time integration.
  const sourceType = availability.reportedAt
    ? "dated report · not live"
    : "report freshness unavailable";
  if (availability.status === "unknown")
    return `Availability unknown · ${sourceType}`;
  const label =
    availability.status === "available"
      ? "Reported available"
      : availability.status === "limited"
        ? "Reported limited"
        : "Reported unavailable";
  return availability.reportedAt
    ? `${label} · ${sourceType} · checked ${new Date(availability.reportedAt).toLocaleString()}`
    : `${label} · ${sourceType} · date not provided`;
}

function publishedValue(
  value: string | null | undefined,
  fallback = "Not provided",
) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeSourceUrl(value: string | undefined) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function itineraryText(
  option: AccessOption,
  includeOrigin: boolean,
  input: AccessInput,
  originLabel: string,
) {
  const lines = [
    `Reach food itinerary: ${option.resource.name}`,
    option.resource.address,
    `Created: ${new Date().toISOString()}`,
    "Saved snapshot: schedules, food and routes may change. This file does not provide offline routing or live updates.",
    `Date: ${input.date}`,
    "All trip times: America/Chicago",
    `Planning status: ${option.status === "fits" ? "Fits the checked limits" : option.status === "no" ? "Does not fit" : "May fit; confirmation needed"}. Food and admission are not guaranteed.`,
    `Pedestrian pickup: ${option.resource.pedestrianPickup ?? "unknown"}`,
    `Travel mode: ${input.mode === "walking" ? "Walking" : input.mode === "driving" ? "Driving" : "Public transit"}`,
    ...(includeOrigin
      ? [
          `Starting location: ${/^[-\d.]+,\s*[-\d.]+$/.test(originLabel) ? "Selected starting location" : originLabel}`,
        ]
      : []),
    `Departure: ${displayTime(option.outbound?.departure)}`,
    `Arrival: ${displayTime(option.outbound?.arrival)}`,
    ...(option.outbound?.mode === "driving"
      ? [
          `Routed driving: ${option.outbound.durationMinutes} minutes, ${option.outbound.distanceMiles?.toFixed(1) ?? "unknown"} miles; fuel, parking, loading and walking from parking are unknown.`,
        ]
      : []),
    `Service time: ${displayTime(option.serviceStart)}${option.serviceEnd != null ? `–${displayTime(option.serviceEnd)}` : ""}`,
    `Availability: ${option.availability.status}; source: ${option.availability.source || "not provided"}`,
    `Availability reported: ${option.availability.reportedAt ? new Date(option.availability.reportedAt).toLocaleString() : "date not provided"}`,
    `Availability expires: ${option.availability.expiresAt ? new Date(option.availability.expiresAt).toLocaleString() : "expiry not provided"}`,
    `Offering: ${publishedValue(option.resource.offering, "Not specified")}`,
    `Published hours: ${publishedValue(option.resource.hours, "Unknown / not verified")}`,
    `Eligibility: ${publishedValue(option.resource.eligibility, "Unknown / not verified")}`,
    `Accessibility: ${publishedValue(option.resource.accessibility, "Unknown / not verified")}`,
    `Phone: ${publishedValue(option.resource.phone, "Not provided")}`,
    ...(option.resource.sources.length
      ? [
          "Published sources:",
          ...option.resource.sources.map(
            (source) =>
              `• ${source.title}${source.checkedOn ? ` · checked ${source.checkedOn}` : " · check date not provided"}${source.url ? ` · ${source.url}` : ""}`,
          ),
        ]
      : ["Published sources: none provided"]),
    ...(option.outbound?.steps.length
      ? [
          "Outbound directions:",
          ...option.outbound.steps.map((step) => `• ${step}`),
        ]
      : ["No outbound directions were returned."]),
    ...(option.returnJourney
      ? [
          `Return departure: ${displayTime(option.returnJourney.departure)}`,
          `Return arrival: ${displayTime(option.returnJourney.arrival)}`,
          "Return directions:",
          ...option.returnJourney.steps.map((step) => `• ${step}`),
        ]
      : []),
    ...(input.returnTo && !option.returnJourney
      ? ["Requested return: unavailable. This is not a confirmed round trip."]
      : []),
    "Trip checks:",
    ...option.reasons.map((v) => `• ${v}`),
    "Uncertainties:",
    ...option.warnings.map((v) => `• ${v}`),
    "Confirm current hours, eligibility, food availability, fares, and accessibility with the pantry before travel.",
  ];
  return lines.join("\n");
}

export function AccessPlanner({
  location,
  onLocationChange,
  onBack,
  foodResources,
  features = CORE_FEATURES,
}: Props) {
  const defaults = useMemo(chicagoDefaults, []);
  const [input, setInput] = useState<AccessInput>(() => ({
    origin: location?.coordinates ?? { lat: 41.8781, lng: -87.6298 },
    ...defaults,
    mode: "transit",
    maxWalkingMinutes: 20,
    maxWalkingMiles: 1,
    fareBudget: 5,
    maxTransfers: 2,
    mobility: "standard",
    appointment: "unknown",
    eligibilityConfirmed: false,
    dietaryPreference: "",
    dietaryRequired: false,
    visitMinutes: 30,
    arrivalBufferMinutes: 15,
    allowWaiting: false,
  }));
  const [needs, setNeeds] = useState<NavigationNeeds>({
    ...DEFAULT_NAVIGATION_NEEDS,
  });
  const [explain, setExplain] = useState(false);
  const [response, setResponse] = useState<AccessResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [staleAvailability, setStaleAvailability] = useState(false);
  const [saveOriginConsent, setSaveOriginConsent] = useState(false);
  const [assistText, setAssistText] = useState("");
  const [assistBusy, setAssistBusy] = useState(false);
  const assistController = useRef<AbortController | null>(null);
  useEffect(() => () => assistController.current?.abort(), []);
  function resetAssist() {
    assistController.current?.abort();
    assistController.current = null;
    setAssistBusy(false);
    setAssist(null);
  }
  const [assist, setAssist] = useState<AssistReply | null>(null);
  const [appliedAssist, setAppliedAssist] =
    useState<Partial<AccessInput> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const locationKey = location
    ? `${location.coordinates.lat},${location.coordinates.lng},${location.source ?? ""},${location.timestamp ?? ""}`
    : "";
  const previousLocationKey = useRef(locationKey);
  const selected =
    response?.options.find((option) => option.id === selectedId) ?? null;
  const mapResources = (response?.options ?? []).filter(
    (option) =>
      option.resource.coordinates &&
      Number.isFinite(option.resource.coordinates.lat) &&
      Number.isFinite(option.resource.coordinates.lng) &&
      Math.abs(option.resource.coordinates.lat) <= 90 &&
      Math.abs(option.resource.coordinates.lng) <= 180,
  );
  const [checkedDestinationIds, setCheckedDestinationIds] = useState<string[]>(
    [],
  );
  const [destinationCheckMessage, setDestinationCheckMessage] = useState("");
  const [destinationMessageId, setDestinationMessageId] = useState("");
  const [checkingDestinationId, setCheckingDestinationId] = useState("");
  const [returnNextDay, setReturnNextDay] = useState(false);

  const invalidate = useCallback((clear = true) => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    if (clear) {
      setResponse(null);
      setSelectedId("");
      setCheckedDestinationIds([]);
      setDestinationCheckMessage("");
      setDestinationMessageId("");
      setCheckingDestinationId("");
    }
  }, []);

  const runPlan = useCallback(
    async (nextInput: AccessInput, destinationId?: string) => {
      invalidate(false);
      if (!destinationId) setCheckingDestinationId("");
      const generation = generationRef.current;
      const controller = new AbortController();
      controllerRef.current = controller;
      setBusy(true);
      setMessage("");
      setStaleAvailability(false);
      setInput(nextInput);
      try {
        const result = await fetch("/api/access/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: nextInput,
            needs,
            explain: features.ai && explain,
            ...(destinationId ? { destinationId } : {}),
          }),
          signal: controller.signal,
          cache: "no-store",
        });
        const payload: unknown = await result.json();
        if (generation !== generationRef.current) return;
        if (!result.ok || !validResponse(payload)) {
          const explanation =
            (payload as { error?: unknown; message?: unknown } | null)?.error ??
            (payload as { message?: unknown } | null)?.message;
          throw new Error(
            typeof explanation === "string"
              ? explanation
              : "The access planner could not complete this search. Try again.",
          );
        }
        setResponse(payload);
        setSelectedId((current) =>
          payload.options.some((option) => option.id === current)
            ? current
            : (payload.options.find((option) => option.id === destinationId)
                ?.id ??
              payload.recommendation?.selectedId ??
              payload.options[0]?.id ??
              ""),
        );
        if (destinationId) {
          setDestinationMessageId(destinationId);
          setCheckedDestinationIds((current) =>
            current.includes(destinationId)
              ? current
              : [...current, destinationId],
          );
          const checkedOption = payload.options.find(
            (option) => option.id === destinationId,
          );
          setDestinationCheckMessage(
            checkedOption?.outbound
              ? "A destination-specific route was returned for this option."
              : `A destination-specific route check was attempted, but no outbound itinerary was returned. ${payload.message}`,
          );
        }
        setMessage(
          payload.message ||
            (payload.options.length
              ? "Review the options and confirm details before leaving."
              : "No matching food resources were found for these preferences."),
        );
      } catch (error) {
        if (
          generation === generationRef.current &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          if (!destinationId) setResponse(null);
          setMessage(
            error instanceof Error
              ? error.message
              : "The access planner is unavailable right now. Try again.",
          );
          if (destinationId) {
            setDestinationMessageId(destinationId);
            setCheckedDestinationIds((current) =>
              current.includes(destinationId)
                ? current
                : [...current, destinationId],
            );
            setDestinationCheckMessage(
              `The destination-specific route request failed: ${error instanceof Error ? error.message : "the planner is unavailable"}`,
            );
          }
        }
      } finally {
        if (generation === generationRef.current) {
          setBusy(false);
          if (destinationId) setCheckingDestinationId("");
        }
      }
    },
    [invalidate, needs, explain],
  );

  useEffect(() => {
    if (previousLocationKey.current === locationKey) return;
    previousLocationKey.current = locationKey;
    const hadPlan = Boolean(response);
    invalidate();
    if (location) {
      const next = { ...input, origin: location.coordinates };
      setInput(next);
      if (hadPlan) void runPlan(next);
      else
        setMessage(
          "Starting location updated. Review preferences and search again.",
        );
    }
    // Prop updates are corrections from the owning guided flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKey]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  function patchInput(patch: Partial<AccessInput>) {
    invalidate();
    setInput((current) => ({ ...current, ...patch }));
    setMessage("Preferences changed. Search again to refresh the trip.");
  }

  function checkSelectedRoute() {
    if (!selected) return;
    setDestinationMessageId(selected.id);
    setCheckingDestinationId(selected.id);
    setDestinationCheckMessage("Checking this destination…");
    void runPlan(input, selected.id);
  }

  function handleLocationChange(value: SelectedLocation) {
    const hadPlan = Boolean(response);
    previousLocationKey.current = `${value.coordinates.lat},${value.coordinates.lng},${value.source ?? ""},${value.timestamp ?? ""}`;
    onLocationChange(value);
    invalidate();
    const next = { ...input, origin: value.coordinates };
    setInput(next);
    if (hadPlan) void runPlan(next);
    else setMessage("Starting location updated.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!location) {
      setMessage("Choose a starting location before searching.");
      return;
    }
    await runPlan(input);
  }

  async function requestAssist() {
    if (assistController.current || !assistText.trim()) return;
    const active = new AbortController();
    assistController.current = active;
    setAssistBusy(true);
    setAssist(null);
    setAppliedAssist(null);
    try {
      const result = await fetch("/api/access/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "preferences", text: assistText }),
        signal: AbortSignal.any([
          active.signal,
          AbortSignal.timeout(FOOD_SEARCH_TIMEOUT_MS),
        ]),
      });
      const payload = (await result.json()) as AssistReply;
      if (assistController.current !== active || active.signal.aborted) return;
      if (!result.ok) throw new Error("Preference request failed.");
      setAssist({
        status: payload.status === "available" ? "available" : "unavailable",
        patch: safeAssistPatch(payload.patch),
        needs: safeAssistNeeds(payload.needs),
        message:
          typeof payload.message === "string"
            ? payload.message
            : "Preference suggestions were not returned.",
      });
    } catch {
      if (assistController.current !== active || active.signal.aborted) return;
      setAssist({
        status: "unavailable",
        message:
          "Preference interpretation is unavailable. You can still set preferences directly.",
      });
    } finally {
      if (assistController.current === active) {
        assistController.current = null;
        setAssistBusy(false);
      }
    }
  }

  function applyAssist() {
    if (assist?.status !== "available" || (!assist.patch && !assist.needs))
      return;
    const patch = assist.patch || {};
    if (assist.needs) setNeeds((current) => ({ ...current, ...assist.needs }));
    setAppliedAssist(patch);
    patchInput(patch);
  }

  function exportText() {
    if (!selected) return;
    const text = itineraryText(
      selected,
      saveOriginConsent,
      input,
      location?.label ?? "Selected starting location",
    );
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "reach-food-itinerary.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="access-planner" id="main-content">
      <div className="access-planner__topbar">
        <button className="btn btn-ghost" type="button" onClick={onBack}>
          ← Back
        </button>
        <span>Food access planner</span>
      </div>
      <header className="access-planner__hero">
        <p className="access-planner__eyebrow">
          Plan a trip that fits your day
        </p>
        <h1>Find food I can reach</h1>
        <p>
          Choose a starting point and travel preferences. Routes and schedules
          depend on the information available for each option.
        </p>
      </header>

      <div className="access-planner__form">
        <div className="access-planner__section">
          <NavigationPreferences
            value={needs}
            onChange={(value) => {
              invalidate();
              setNeeds(value);
              setMessage(
                "Preferences changed. Search again to refresh the trip.",
              );
            }}
            aiAvailable={features.ai}
            aiEnabled={features.ai && explain}
            onAIEnabledChange={(value) => {
              invalidate();
              setExplain(value);
            }}
          />
          <p className="navigation-ui__note">
            Defaults: food assistance today, public transit, no confirmed
            eligibility and no assumed appointment. Every preference can be
            edited. Identification and household size do not establish
            eligibility or food quantity.
          </p>
          {explain && (
            <p className="navigation-ui__note">
              Only computed public route timings and availability uncertainty
              are sent for optional AI guidance. Your coordinates, private
              pickup details and profile are excluded. Providers have their own
              data policies.
            </p>
          )}
        </div>
        <section
          className="access-planner__section"
          aria-labelledby="access-location-heading"
        >
          <h2 id="access-location-heading">Where are you starting?</h2>
          <LocationPicker
            value={location}
            onChange={handleLocationChange}
            resources={foodResources}
          />
        </section>

        <section
          className="access-planner__section"
          aria-labelledby="access-travel-heading"
        >
          <h2 id="access-travel-heading">Travel preferences</h2>
          <form id="access-travel-preferences" onSubmit={submit}>
            <div className="access-planner__fields">
              <label>
                Travel by
                <select
                  className="select select-bordered"
                  value={input.mode}
                  onChange={(event) =>
                    patchInput({
                      mode: event.target.value as AccessInput["mode"],
                    })
                  }
                >
                  <option value="walking">Walking</option>
                  <option value="driving">Driving</option>
                  <option value="transit">Public transit</option>
                </select>
              </label>
              <label>
                Maximum walking time (minutes)
                <input
                  className="input input-bordered"
                  type="number"
                  min="0"
                  max="180"
                  value={input.maxWalkingMinutes}
                  onChange={(event) =>
                    patchInput({
                      maxWalkingMinutes: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Maximum walking distance (miles)
                <input
                  className="input input-bordered"
                  type="number"
                  min="0"
                  max="20"
                  step="any"
                  value={input.maxWalkingMiles}
                  onChange={(event) =>
                    patchInput({ maxWalkingMiles: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Fare budget (dollars)
                <input
                  className="input input-bordered"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={input.fareBudget}
                  onChange={(event) =>
                    patchInput({ fareBudget: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Maximum transfers
                <input
                  className="input input-bordered"
                  type="number"
                  min="0"
                  max="5"
                  value={input.maxTransfers}
                  onChange={(event) =>
                    patchInput({ maxTransfers: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Date
                <input
                  className="input input-bordered"
                  type="date"
                  value={input.date}
                  onChange={(event) => patchInput({ date: event.target.value })}
                />
              </label>
              <label>
                Leave around
                <input
                  className="input input-bordered"
                  type="time"
                  value={input.departure}
                  onChange={(event) =>
                    patchInput({ departure: event.target.value })
                  }
                />
              </label>
              <label>
                Need to arrive by (optional)
                <input
                  className="input input-bordered"
                  type="time"
                  value={input.arrivalDeadline ?? ""}
                  onChange={(event) =>
                    patchInput({
                      arrivalDeadline: event.target.value || undefined,
                    })
                  }
                />
              </label>
              <label>
                Time at the pantry (minutes)
                <input
                  className="input input-bordered"
                  type="number"
                  min="1"
                  max="240"
                  value={input.visitMinutes}
                  onChange={(event) =>
                    patchInput({ visitMinutes: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Arrival buffer (minutes)
                <input
                  className="input input-bordered"
                  type="number"
                  min="0"
                  max="60"
                  value={input.arrivalBufferMinutes}
                  onChange={(event) =>
                    patchInput({
                      arrivalBufferMinutes: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <div className="access-planner__checks">
              <label>
                <input
                  className="checkbox checkbox-primary"
                  type="checkbox"
                  checked={input.allowWaiting}
                  onChange={(event) =>
                    patchInput({ allowWaiting: event.target.checked })
                  }
                />{" "}
                Waiting for a service window is okay
              </label>
              <label>
                <input
                  className="checkbox checkbox-primary"
                  type="checkbox"
                  checked={input.mobility === "step-free"}
                  onChange={(event) =>
                    patchInput({
                      mobility: event.target.checked ? "step-free" : "standard",
                    })
                  }
                />{" "}
                I need step-free travel
              </label>
              <label>
                <input
                  className="checkbox checkbox-primary"
                  type="checkbox"
                  checked={input.eligibilityConfirmed}
                  onChange={(event) =>
                    patchInput({ eligibilityConfirmed: event.target.checked })
                  }
                />{" "}
                I have confirmed I meet the pantry’s eligibility requirements
              </label>
            </div>
            <label className="access-planner__wide">
              Appointment
              <select
                className="select select-bordered"
                value={input.appointment}
                onChange={(event) =>
                  patchInput({
                    appointment: event.target
                      .value as AccessInput["appointment"],
                  })
                }
              >
                <option value="unknown">Not sure</option>
                <option value="booked">Appointment booked</option>
                <option value="not-booked">No appointment</option>
              </select>
            </label>
            <div className="access-planner__diet">
              <label>
                Dietary preference (optional)
                <input
                  className="input input-bordered"
                  value={input.dietaryPreference}
                  onChange={(event) =>
                    patchInput({ dietaryPreference: event.target.value })
                  }
                  placeholder="For example, vegetarian"
                />
              </label>
              <label>
                <input
                  className="checkbox checkbox-primary"
                  type="checkbox"
                  checked={input.dietaryRequired}
                  onChange={(event) =>
                    patchInput({ dietaryRequired: event.target.checked })
                  }
                />{" "}
                This is required for me
              </label>
            </div>
          </form>
          <details className="access-planner__return">
            <summary>Plan a return trip too (optional)</summary>
            <LocationPicker
              value={
                input.returnTo
                  ? {
                      coordinates: input.returnTo,
                      label: "Selected return destination",
                      source: "manual",
                    }
                  : null
              }
              onChange={(value) => patchInput({ returnTo: value.coordinates })}
              resources={foodResources}
              compact
            />
            {input.returnTo && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setReturnNextDay(false);
                  patchInput({
                    returnTo: undefined,
                    returnDeadline: undefined,
                  });
                }}
              >
                Clear return destination
              </button>
            )}
            {input.returnTo && (
              <label>
                Return by (optional)
                <input
                  className="input input-bordered"
                  form="access-travel-preferences"
                  type="time"
                  value={inputClock(input.returnDeadline)}
                  onChange={(event) =>
                    patchInput({
                      returnDeadline: withDayOffset(
                        event.target.value,
                        isNextDay(input.returnDeadline) || returnNextDay,
                      ),
                    })
                  }
                />
              </label>
            )}
            {input.returnTo && (
              <label className="access-planner__next-day">
                <input
                  className="checkbox checkbox-primary"
                  form="access-travel-preferences"
                  type="checkbox"
                  checked={
                    isNextDay(input.returnDeadline) ||
                    (!input.returnDeadline && returnNextDay)
                  }
                  onChange={(event) => {
                    const nextDay = event.target.checked;
                    setReturnNextDay(nextDay);
                    if (input.returnDeadline) {
                      const time = inputClock(input.returnDeadline);
                      patchInput({
                        returnDeadline: withDayOffset(time, nextDay),
                      });
                    }
                  }}
                />
                Return deadline is the next day
              </label>
            )}
          </details>
        </section>

        {features.ai && (
          <section
            className="access-planner__section"
            aria-labelledby="access-assist-heading"
          >
            <h2 id="access-assist-heading">
              Want help describing preferences?
            </h2>
            <p>
              Optional interpretation can suggest form changes for you to
              review. You can use every control without it. Using this button
              sends the text below to the configured AI provider. Do not include
              names, addresses, coordinates or contact details.
            </p>
            <label>
              Describe what matters to your trip
              <textarea
                className="textarea textarea-bordered"
                maxLength={1200}
                value={assistText}
                onChange={(event) => {
                  resetAssist();
                  setAssistText(event.target.value);
                }}
                placeholder="For example, I can walk for 10 minutes and need step-free travel."
              />
            </label>
            <button
              className="btn btn-outline"
              type="button"
              onClick={requestAssist}
              disabled={assistBusy || !assistText.trim()}
              aria-label={assistBusy ? "Analyzing…" : undefined}
            >
              {assistBusy ? <AILoadingIndicator /> : "Interpret preferences"}
            </button>
            {assistBusy && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetAssist}
              >
                Cancel interpretation
              </button>
            )}
            {assist && (
              <div className="access-planner__assist" role="status">
                <p>{assist.message}</p>
                {assist.status === "available" &&
                  (assist.patch || assist.needs) && (
                    <>
                      <p>
                        Suggested preferences:{" "}
                        {readablePatch({
                          ...assist.patch,
                          ...assist.needs,
                        } as Partial<AccessInput>)}
                      </p>
                      <button
                        className="btn btn-outline"
                        type="button"
                        onClick={applyAssist}
                      >
                        Review and apply suggested preferences
                      </button>
                      {appliedAssist && (
                        <p>
                          Preferences applied. Check the fields above and search
                          when ready.
                        </p>
                      )}
                    </>
                  )}
              </div>
            )}
          </section>
        )}
        <button
          className="btn btn-primary access-planner__search"
          aria-label={busy ? "Finding options…" : undefined}
          form="access-travel-preferences"
          type="submit"
          disabled={busy}
        >
          {busy ? (
            <AILoadingIndicator label="Finding options…" />
          ) : (
            "Find food I can reach"
          )}
        </button>
      </div>

      {message && (
        <p className="access-planner__message" role="status">
          {message}
        </p>
      )}
      {response && (
        <section
          className="access-planner__results"
          aria-labelledby="access-results-heading"
        >
          <div className="access-planner__result-head">
            <div>
              <p className="access-planner__eyebrow">Plan options</p>
              <h2 id="access-results-heading">Review your trip</h2>
            </div>
            <p>
              Calculated {new Date(response.searchedAt).toLocaleString()} ·{" "}
              {response.routingCalls} route lookups
            </p>
          </div>
          <p className="access-planner__timezone-note">
            All trip times are America/Chicago.
          </p>
          {response.recommendation && (
            <section
              className="card bg-base-100 p-4 my-4"
              aria-label="Pantry recommendation"
            >
              <h3>{response.recommendation.headline}</h3>
              <p>
                {response.recommendation.status === "confirm"
                  ? "Confirm before leaving. "
                  : ""}
                {response.recommendation.comparison.complete
                  ? "Complete comparison of the verified sites in this search."
                  : "Limited comparison: another pantry could be better."}
              </p>
              <p>
                {response.recommendation.comparison.routedPantries} routed ·{" "}
                {response.recommendation.comparison.staticallyExcludedPantries}{" "}
                ruled out by known timing or pickup constraints ·{" "}
                {response.recommendation.comparison.unresolvedPantries}{" "}
                unresolved ·{" "}
                {response.recommendation.comparison.unverifiedPantries} sites
                without verified locations excluded from recommendations.
              </p>
              {response.recommendation.selectedId && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    setSelectedId(response.recommendation!.selectedId!)
                  }
                >
                  View recommended pantry
                </button>
              )}
              <details className="reach-disclosure">
                <summary>Why this recommendation?</summary>
                <ul>
                  {response.recommendation.explanation.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </details>
            </section>
          )}
          {response.guidance && (
            <NavigationGuidanceView
              guidance={response.guidance}
              options={response.options}
              onSelect={setSelectedId}
            />
          )}
          {response.options.length === 0 ? (
            <div className="access-planner__empty">
              <h3>No matching options found</h3>
              <p>
                {response.message ||
                  "Try changing your travel preferences or starting location."}
              </p>
            </div>
          ) : (
            <>
              {mapResources.length > 0 && (
                <div className="access-planner__map">
                  <JourneyMap
                    origin={location?.coordinates ?? input.origin}
                    originLabel={location?.label}
                    destination={selected?.resource.coordinates ?? null}
                    stops={input.mode === "transit" ? transitStops : []}
                    accuracyMeters={location?.accuracyMeters}
                    locationSource={location?.source}
                    onOriginChange={(coordinates) =>
                      handleLocationChange({
                        coordinates,
                        label: "Corrected starting point",
                        source: "manual",
                        timestamp: Date.now(),
                      })
                    }
                    pantries={mapResources.map((option) => ({
                      id: option.resource.id,
                      name:
                        option.kind === "household"
                          ? `${option.resource.name} · private pickup point (not verified)`
                          : option.resource.name,
                      ...option.resource.coordinates!,
                    }))}
                    selectedPantryId={selected?.resource.id}
                    onPantrySelect={setSelectedId}
                    paths={
                      selected
                        ? [
                            ...(selected.outbound?.paths ?? []),
                            ...(selected.returnJourney?.paths ?? []),
                          ]
                        : []
                    }
                  />
                  {selected && (
                    <p>
                      Map paths are shown only when the selected option returned
                      route geometry. A missing line does not mean a confirmed
                      route.
                    </p>
                  )}
                </div>
              )}
              <div className="access-planner__cards">
                {response.options.map((option) => (
                  <article
                    className={`access-planner__card ${selectedId === option.id ? "is-selected" : ""}`}
                    key={option.id}
                  >
                    <button
                      className="access-planner__choose"
                      type="button"
                      aria-pressed={selectedId === option.id}
                      onClick={() => setSelectedId(option.id)}
                    >
                      <span>
                        <strong>{option.resource.name}</strong>
                        <small>{option.resource.address}</small>
                        {option.kind === "household" && (
                          <small>Private pickup point · not verified</small>
                        )}
                      </span>
                      <span
                        className={`access-planner__fit access-planner__fit--${option.status}`}
                      >
                        {option.status === "fits"
                          ? "Fits preferences"
                          : option.status === "confirm"
                            ? "Confirm details"
                            : "Does not fit"}
                      </span>
                    </button>
                    <p className="access-planner__availability">
                      {availabilityLabel(option)} · Source:{" "}
                      {option.availability.source || "not provided"}
                      {option.availability.expiresAt
                        ? ` · through ${new Date(option.availability.expiresAt).toLocaleString()}`
                        : " · freshness not provided"}
                    </p>
                    <details className="access-planner__published-details">
                      <summary>
                        Published details · confirm before travel
                      </summary>
                      <dl>
                        <dt>Offering</dt>
                        <dd>
                          {publishedValue(
                            option.resource.offering,
                            "Not specified",
                          )}
                        </dd>
                        <dt>Hours</dt>
                        <dd>
                          {publishedValue(
                            option.resource.hours,
                            "Unknown / not verified",
                          )}
                        </dd>
                        <dt>Eligibility</dt>
                        <dd>
                          {publishedValue(
                            option.resource.eligibility,
                            "Unknown / not verified",
                          )}
                        </dd>
                        <dt>Accessibility</dt>
                        <dd>
                          {publishedValue(
                            option.resource.accessibility,
                            "Unknown / not verified",
                          )}
                        </dd>
                        <dt>Phone</dt>
                        <dd>
                          {option.resource.phone ? (
                            <a
                              href={`tel:${option.resource.phone.replace(/[^+\d]/g, "")}`}
                            >
                              {option.resource.phone}
                            </a>
                          ) : (
                            "Not provided"
                          )}
                        </dd>
                      </dl>
                      <p>
                        Directory information can be outdated or incomplete.
                        Contact the pantry to confirm hours, eligibility,
                        accessibility, and current food availability.
                      </p>
                      <ul className="access-planner__source-dates">
                        {option.resource.sources.length ? (
                          option.resource.sources.map((source, index) => {
                            const href = safeSourceUrl(source.url);
                            return (
                              <li key={`${source.title}-${index}`}>
                                {href ? (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {source.title}
                                  </a>
                                ) : (
                                  source.title
                                )}{" "}
                                · checked{" "}
                                {source.checkedOn || "date not provided"}
                              </li>
                            );
                          })
                        ) : (
                          <li>No source or check date provided.</li>
                        )}
                      </ul>
                    </details>
                    {option.reasons.length > 0 && (
                      <ul>
                        {option.reasons.map((reason, index) => (
                          <li key={`reason-${index}`}>{reason}</li>
                        ))}
                      </ul>
                    )}
                    {option.warnings.map((warning, index) => (
                      <p
                        className="access-planner__warning"
                        key={`warning-${index}`}
                      >
                        {warning}
                      </p>
                    ))}
                    {option.outbound && (
                      <div className="access-planner__trip">
                        <h3>Outbound</h3>
                        <p>
                          Leave {displayTime(option.outbound.departure)} ·
                          arrive {displayTime(option.outbound.arrival)} ·{" "}
                          {option.outbound.mode === "driving" ? (
                            `${option.outbound.durationMinutes ?? option.outbound.arrival - option.outbound.departure} min drive (${option.outbound.distanceMiles?.toFixed(1) ?? "unknown"} mi routed) · fuel and parking costs unknown`
                          ) : (
                            <>
                              {option.outbound.walkingMinutes} min walk (
                              {option.outbound.walkingMiles.toFixed(1)} mi)
                              {option.outbound.fare != null
                                ? ` · fare $${option.outbound.fare.toFixed(2)}`
                                : " · fare not provided"}
                            </>
                          )}
                          {option.outbound.transfers
                            ? ` · ${option.outbound.transfers} transfer${option.outbound.transfers === 1 ? "" : "s"}`
                            : ""}
                        </p>
                        <ol>
                          {option.outbound.steps.map((step, index) => (
                            <li key={index}>{step}</li>
                          ))}
                        </ol>
                        {option.outbound.warnings.map((warning, index) => (
                          <p className="access-planner__warning" key={index}>
                            {warning}
                          </p>
                        ))}
                      </div>
                    )}
                    {!option.outbound && selectedId === option.id && (
                      <div className="access-planner__route-check">
                        {checkedDestinationIds.includes(option.id) ? (
                          <p role="status">
                            {destinationMessageId === option.id
                              ? destinationCheckMessage
                              : "A destination-specific check was requested earlier. No outbound itinerary is available in the current result."}
                          </p>
                        ) : (
                          <p>
                            No outbound itinerary is shown for this option yet.
                            Check this specific destination to request its
                            route.
                          </p>
                        )}
                        <button
                          className="btn btn-outline"
                          type="button"
                          disabled={busy}
                          onClick={checkSelectedRoute}
                        >
                          {checkingDestinationId === option.id
                            ? "Checking route…"
                            : checkedDestinationIds.includes(option.id)
                              ? "Check this route again"
                              : "Check this route"}
                        </button>
                      </div>
                    )}
                    {option.returnJourney && (
                      <div className="access-planner__trip">
                        <h3>Return</h3>
                        <p>
                          Leave {displayTime(option.returnJourney.departure)} ·
                          arrive {displayTime(option.returnJourney.arrival)}
                        </p>
                        <ol>
                          {option.returnJourney.steps.map((step, index) => (
                            <li key={index}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {option.serviceStart != null && (
                      <p>
                        Service window: {displayTime(option.serviceStart)}
                        {option.serviceEnd != null
                          ? `–${displayTime(option.serviceEnd)}`
                          : ""}
                        {option.intakeCutoff != null
                          ? ` · intake cutoff ${displayTime(option.intakeCutoff)}`
                          : ""}
                      </p>
                    )}
                    {(option.outbound?.attribution.length ?? 0) +
                      (option.returnJourney?.attribution.length ?? 0) >
                      0 && (
                      <p className="access-planner__sources">
                        Route sources:{" "}
                        {[
                          ...(option.outbound?.attribution ?? []),
                          ...(option.returnJourney?.attribution ?? []),
                        ].map((source, index) => (
                          <span key={`${source.url}-${index}`}>
                            {index > 0 ? " · " : ""}
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {source.label}
                            </a>
                          </span>
                        ))}
                      </p>
                    )}
                    {selectedId === option.id &&
                      option.kind === "pantry" &&
                      location &&
                      validCoordinates(location.coordinates) &&
                      option.resource.verificationStatus === "confirmed-site" &&
                      validCoordinates(option.resource.coordinates) && (
                        <div className="access-planner__external-directions">
                          <a
                            className="btn btn-outline"
                            href={googleMapsUrl(
                              location.coordinates,
                              option.resource.coordinates,
                              input.mode,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open directions in Google Maps
                          </a>
                          <p>
                            Google Maps receives your selected starting point
                            and this pantry location, then calculates its own
                            route. That route has not been retrieved or checked
                            by Reach.
                          </p>
                        </div>
                      )}
                  </article>
                ))}
              </div>
              {staleAvailability && (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void runPlan(input)}
                >
                  Recalculate with updated availability
                </button>
              )}
              {selected && (
                <div className="access-planner__save">
                  <h3>Keep this itinerary</h3>
                  <p className="access-planner__timezone-note">
                    All trip times in this itinerary are America/Chicago.
                  </p>
                  <label>
                    <input
                      className="checkbox checkbox-primary"
                      type="checkbox"
                      checked={saveOriginConsent}
                      onChange={(event) =>
                        setSaveOriginConsent(event.target.checked)
                      }
                    />{" "}
                    Include my starting location label in the downloaded
                    itinerary. This file will be saved on this device.
                  </label>
                  <div className="access-planner__actions">
                    <button
                      className="btn btn-outline"
                      type="button"
                      onClick={exportText}
                    >
                      Download text itinerary
                    </button>
                    <button
                      className="btn btn-outline"
                      type="button"
                      onClick={() => window.print()}
                    >
                      Print itinerary
                    </button>
                  </div>
                  <pre
                    className="access-planner__offline-text"
                    tabIndex={0}
                    role="region"
                    aria-label="Offline itinerary"
                  >
                    {itineraryText(
                      selected,
                      saveOriginConsent,
                      input,
                      location?.label ?? "Selected starting location",
                    )}
                  </pre>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
