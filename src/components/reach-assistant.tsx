"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, LoaderCircle, MapPin, Send, X } from "lucide-react";
import { chicagoNow, googleMapsUrl } from "@/lib/journey";
import type { AccessInput, AccessOption } from "@/lib/access-types";
import type { AssistantResponse } from "@/lib/assistant-types";
import type { Resource } from "@/data/resources";
import { LocationPicker, type SelectedLocation } from "./location-picker";
import { OutreachPanel } from "./outreach-panel";
import "./reach-assistant.css";

type Props = {
  location: SelectedLocation | null;
  onLocationChange: (location: SelectedLocation) => void;
  resources: Resource[];
  selectedPantryId?: string;
  onSelectPantry: (
    id: string,
    mode: AccessInput["mode"],
    option?: AccessOption,
  ) => void;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
};

function defaultInput(
  location: SelectedLocation | null,
  mode: AccessInput["mode"],
): AccessInput {
  const now = chicagoNow(new Date());
  return {
    origin: location?.coordinates ?? { lat: 0, lng: 0 },
    date: now.date,
    departure: now.time,
    mode,
    maxWalkingMinutes: 20,
    maxWalkingMiles: 1,
    fareBudget: 5,
    maxTransfers: 2,
    mobility: "standard",
    appointment: "unknown",
    eligibilityConfirmed: false,
    dietaryPreference: "none",
    dietaryRequired: false,
    visitMinutes: 30,
    arrivalBufferMinutes: 15,
    allowWaiting: true,
  };
}

function OptionCard({
  option,
  origin,
  mode,
  onSelect,
}: {
  option: AccessOption;
  origin: SelectedLocation | null;
  mode: AccessInput["mode"];
  onSelect: (id: string) => void;
}) {
  const { resource, outbound, availability } = option;
  const routeMode = outbound
    ? (outbound.mode ?? (outbound.source === "scheduled" ? "transit" : mode))
    : mode;
  const duration = outbound
    ? (outbound.durationMinutes ?? outbound.arrival - outbound.departure)
    : null;
  const mapsUrl =
    origin && resource.coordinates
      ? googleMapsUrl(origin.coordinates, resource.coordinates, routeMode)
      : undefined;
  return (
    <article className="reach-assistant__option">
      <h3>{resource.name}</h3>
      <p>{resource.address}</p>
      <p>{resource.offering || "Published service details are limited."}</p>
      <p>
        <strong>Route status:</strong>{" "}
        {option.status === "fits"
          ? "matches entered limits"
          : option.status === "confirm"
            ? "needs confirmation"
            : "does not meet one or more entered limits"}
        {option.reasons.length ? ` · ${option.reasons.join(" ")}` : ""}
      </p>
      <p>
        <strong>Availability:</strong> {availability.status};{" "}
        {availability.source}
        {availability.reportedAt
          ? ` · checked ${availability.reportedAt}`
          : " · check date unknown"}
        {availability.expiresAt
          ? ` · freshness limit ${availability.expiresAt}`
          : " · freshness limit unknown"}
        . Confirm before traveling.
      </p>
      <p>
        <strong>Trip:</strong>{" "}
        {outbound
          ? `${duration === null ? "duration unknown" : `${Math.ceil(duration)} minutes`} · ${outbound.distanceMiles === undefined ? "routed distance not returned" : `${outbound.distanceMiles.toFixed(1)} routed miles`} by ${routeMode}`
          : "No outbound route was returned."}
      </p>
      <details>
        <summary>Published details and sources</summary>
        <p>
          <strong>Hours:</strong> {resource.hours || "Unknown"}
        </p>
        <p>
          <strong>Eligibility:</strong> {resource.eligibility || "Unknown"}
        </p>
        <p>
          <strong>Accessibility:</strong>{" "}
          {resource.accessibility || "Not verified"}
        </p>
        {resource.phone && (
          <p>
            <strong>Phone:</strong>{" "}
            <a href={`tel:${resource.phone}`}>{resource.phone}</a>
          </p>
        )}
        <ul>
          {resource.sources.map((source, index) => (
            <li key={`${source.title}-${index}`}>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              ) : (
                source.title
              )}{" "}
              · checked {source.checkedOn ?? "date unknown"}
            </li>
          ))}
        </ul>
      </details>
      {option.warnings.length > 0 && <p>{option.warnings.join(" ")}</p>}
      <div className="reach-assistant__actions">
        {option.kind === "pantry" && (
          <button
            className="btn btn-primary"
            onClick={() => onSelect(option.id)}
          >
            Show on map
          </button>
        )}
        {mapsUrl && (
          <a
            className="btn btn-outline"
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in Google Maps to calculate a route <ArrowUpRight size={16} />
          </a>
        )}
      </div>
    </article>
  );
}

export function ReachAssistant({
  location,
  onLocationChange,
  resources,
  selectedPantryId,
  onSelectPantry,
  onClose,
  returnFocusTo,
}: Props) {
  const [mode, setMode] = useState<AccessInput["mode"]>("transit");
  const [departureTime, setDepartureTime] = useState(
    () => chicagoNow(new Date()).time,
  );
  const [departureExplicit, setDepartureExplicit] = useState(false);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<AssistantResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outreachId, setOutreachId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Partial<AccessInput>>({});
  const [turns, setTurns] = useState<
    Array<{ question: string; answer: string }>
  >([]);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const originKey = location
    ? `${location.coordinates.lat},${location.coordinates.lng}`
    : "";
  useEffect(() => {
    previousFocus.current =
      returnFocusTo || (document.activeElement as HTMLElement | null);
    const dialog = dialogRef.current;
    dialogRef.current?.showModal();
    closeRef.current?.focus();
    return () => {
      controller.current?.abort();
      dialog?.close();
      const opener = previousFocus.current;
      queueMicrotask(() => {
        if ((!dialog?.isConnected || !dialog.open) && opener?.isConnected)
          opener.focus();
      });
    };
  }, []);
  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    setReply(null);
    setPreferences({});
    setBusy(false);
  }, [originKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !message.trim() || message.length > 1200 || !departureTime)
      return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const id = ++generation.current;
    const sent = message.trim();
    setBusy(true);
    setError("");
    setReply(null);
    const input = {
      ...defaultInput(location, mode),
      ...preferences,
      origin: location?.coordinates ?? defaultInput(location, mode).origin,
      mode,
      departure: preferences.departure ?? departureTime,
    };
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        signal: active.signal,
        body: JSON.stringify({
          message: sent,
          departureExplicit,
          input: location ? input : undefined,
          pantryId: selectedPantryId,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || typeof result.reply !== "string")
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "Reach could not complete this request. Try again or use the trip planner.",
        );
      if (id === generation.current) {
        const assistantResult = result as AssistantResponse;
        setReply(assistantResult);
        setTurns((current) =>
          [...current, { question: sent, answer: assistantResult.reply }].slice(
            -6,
          ),
        );
        if (assistantResult.appliedPreferences) {
          setPreferences((current) => ({
            ...current,
            ...assistantResult.appliedPreferences,
            origin: undefined,
          }));
          if (assistantResult.appliedPreferences.mode)
            setMode(assistantResult.appliedPreferences.mode);
          if (assistantResult.appliedPreferences.departure)
            setDepartureTime(assistantResult.appliedPreferences.departure);
        }
      }
    } catch (cause) {
      if (
        !(cause instanceof DOMException && cause.name === "AbortError") &&
        id === generation.current
      )
        setError(
          cause instanceof Error
            ? cause.message
            : "The assistant is unavailable. Try the trip planner.",
        );
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }

  const options = reply?.plan?.options.slice(0, 3) ?? [];
  return (
    <dialog
      ref={dialogRef}
      className="reach-assistant"
      aria-labelledby="reach-assistant-title"
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onCloseRef.current();
      }}
    >
      <header className="reach-assistant__header">
        <div>
          <span className="reach-kicker">PRIVATE TRIP HELP</span>
          <h2 id="reach-assistant-title">Reach AI assistant</h2>
        </div>
        <button
          ref={closeRef}
          autoFocus
          type="button"
          className="btn btn-ghost"
          aria-label="Close assistant"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <p>
        Describe what would help and how you prefer to travel. Your message is
        sent only when you select Send. Precise coordinates and account details
        are excluded from the optional AI interpretation.
      </p>
      <div className="reach-assistant__controls">
        <label>
          Travel mode
          <select
            className="select select-bordered"
            value={mode}
            onChange={(event) => {
              generation.current += 1;
              controller.current?.abort();
              setBusy(false);
              setReply(null);
              setPreferences(({ mode: _mode, ...rest }) => rest);
              setMode(event.target.value as AccessInput["mode"]);
            }}
          >
            <option value="walking">Walking</option>
            <option value="transit">Bus / public transit</option>
            <option value="driving">Driving or a ride</option>
          </select>
        </label>
        <label>
          Departure time (America/Chicago)
          <input
            className="input input-bordered"
            type="time"
            value={departureTime}
            onChange={(event) => {
              generation.current += 1;
              controller.current?.abort();
              setBusy(false);
              setReply(null);
              setPreferences(({ departure: _departure, ...rest }) => rest);
              setDepartureTime(event.target.value);
              setDepartureExplicit(true);
            }}
          />
        </label>
        <details>
          <summary>
            {location
              ? "Edit starting point"
              : "Choose a starting point (optional)"}
          </summary>
          <LocationPicker
            value={location}
            onChange={onLocationChange}
            resources={resources}
          />
        </details>
      </div>
      <p className="reach-assistant__defaults">
        When a location is selected, trip estimates use today’s America/Chicago
        date and your selected Chicago departure time, a 20-minute / 1-mile
        walking limit, up to $5 fare and 2 transfers, a 30-minute visit and
        15-minute arrival buffer. Waiting is allowed. Appointment and
        eligibility are unknown or unconfirmed. Change assumptions in the
        detailed planner.
      </p>
      {Object.entries(preferences).some(
        ([key, value]) => key !== "origin" && value !== undefined,
      ) && (
        <p className="reach-assistant__defaults">
          <strong>Applied from your message:</strong>{" "}
          {Object.entries(preferences)
            .filter(([key, value]) => key !== "origin" && value !== undefined)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join(" · ")}
        </p>
      )}
      {turns.length > 1 && (
        <details className="reach-assistant__transcript">
          <summary>Earlier messages in this session</summary>
          {turns.slice(0, -1).map((turn, index) => (
            <div key={index}>
              <p>
                <strong>You:</strong> {turn.question}
              </p>
              <p>
                <strong>Reach:</strong> {turn.answer}
              </p>
            </div>
          ))}
        </details>
      )}
      <form onSubmit={submit}>
        <label htmlFor="reach-assistant-message">
          What do you need help finding?
        </label>
        <textarea
          id="reach-assistant-message"
          maxLength={1200}
          value={message}
          onChange={(event) => {
            generation.current += 1;
            controller.current?.abort();
            setBusy(false);
            setError("");
            setMessage(event.target.value);
            if (reply) setReply(null);
          }}
          rows={3}
          placeholder="For example: groceries soon, and I can use the bus."
        />
        <div className="reach-assistant__sendrow">
          <span>{message.length}/1200</span>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              busy || !message.trim() || message.length > 1200 || !departureTime
            }
          >
            {busy ? (
              <LoaderCircle className="reach-assistant__spin" size={17} />
            ) : (
              <Send size={17} />
            )}
            Send
          </button>
        </div>
      </form>
      {busy && (
        <p role="status">
          Checking the published listings and possible routes…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {reply && (
        <div className="reach-assistant__reply" aria-live="polite">
          <p className="reach-assistant__badge">
            {reply.assistance === "ai"
              ? "AI-assisted summary"
              : "Computed from published information"}
          </p>
          <p>{reply.reply}</p>
          {reply.followUp && (
            <p>
              <strong>{reply.followUp}</strong>
            </p>
          )}
          {reply.status === "needs-location" && (
            <p>
              <MapPin size={16} /> Choose a starting point above to compare
              routes. No route has been calculated yet.
            </p>
          )}
          {reply.plan && (
            <>
              {reply.plan.guidance?.paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
              <p>{reply.plan.message}</p>
              {options.length ? (
                options.map((option) => (
                  <OptionCard
                    key={option.id}
                    option={option}
                    origin={location}
                    mode={mode}
                    onSelect={(id) => {
                      onSelectPantry(
                        id,
                        option.outbound?.mode ??
                          (option.outbound?.source === "scheduled"
                            ? "transit"
                            : mode),
                        option,
                      );
                      onClose();
                    }}
                  />
                ))
              ) : (
                <p>
                  No route options were returned. The directory may not cover
                  this need; try another description or call 211 for broader
                  help.
                </p>
              )}
            </>
          )}
          {(reply.inquiryPantryId || selectedPantryId) && (
            <button
              className="btn btn-outline"
              type="button"
              onClick={() =>
                setOutreachId(reply.inquiryPantryId ?? selectedPantryId!)
              }
            >
              Ask about availability
            </button>
          )}
        </div>
      )}
      {outreachId && (
        <div className="reach-assistant__outreach">
          <button className="btn btn-ghost" onClick={() => setOutreachId(null)}>
            Back to assistant
          </button>
          <OutreachPanel
            pantryId={outreachId}
            onAvailabilityChange={() => setOutreachId(null)}
          />
        </div>
      )}
      <p className="reach-assistant__fineprint">
        A route or listing is not proof of current availability, eligibility, or
        a confirmed visit. Availability inquiries are never sent automatically;
        review and approve them in the next step.
      </p>
    </dialog>
  );
}
