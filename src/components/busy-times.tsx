"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { BusySummary, CrowdLevel } from "@/lib/crowd-types";

const labels = ["Not busy", "A little busy", "Moderately busy", "Very busy"];
const hourLabel = (hour: number) =>
  `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;

export function BusyTimes({
  pantryId,
  canReport = false,
}: {
  pantryId: string;
  canReport?: boolean;
}) {
  const [summary, setSummary] = useState<BusySummary | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState<CrowdLevel>(0);
  const [wait, setWait] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(`/api/crowd/${encodeURIComponent(pantryId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.error || data.message || "Busy times are unavailable.",
          );
        return data as BusySummary;
      })
      .then((data) => {
        setSummary(data);
        setDay(
          (selected) =>
            selected ??
            new Date(
              new Date().toLocaleString("en-US", {
                timeZone: "America/Chicago",
              }),
            ).getDay(),
        );
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason.message || "Busy times are unavailable.");
      });
    return () => controller.abort();
  }, [pantryId, reload]);
  async function report(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/crowd/${encodeURIComponent(pantryId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            level,
            ...(wait !== "" ? { waitMinutes: Number(wait) } : {}),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || data.message || "Your report could not be saved.",
        );
      setMessage(
        "Thank you. Your observation helps build an aggregate picture; it may not appear until enough reports are available.",
      );
      setReload((value) => value + 1);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Your report could not be saved.",
      );
    } finally {
      setSending(false);
    }
  }
  const selected = summary?.days.find((item) => item.weekday === day);
  const selectedSlot = selected?.hours.find(
    (slot) => slot.hour === selectedHour,
  );
  const observed = selected?.hours.some(
    (slot) => slot.status === "observed" && slot.level !== null,
  );
  return (
    <section
      className="card bg-base-100 pantry-section busy-times"
      aria-labelledby={`busy-${pantryId}`}
    >
      <div className="pantry-section-heading">
        <div>
          <p className="pantry-eyebrow">Plan your visit</p>
          <h2 id={`busy-${pantryId}`}>Typical busy times</h2>
        </div>
        <span className="pantry-tag">Community observations</span>
      </div>
      <p>
        Historical activity, when enough observations exist. This is not live
        occupancy. All times are Central Time.
      </p>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            className="btn btn-primary"
          >
            Try again
          </button>
        </div>
      ) : !summary ? (
        <p role="status">Loading busy times…</p>
      ) : (
        <>
          <div className="busy-days" aria-label="Choose a weekday">
            {summary.days.map((item) => (
              <button
                type="button"
                key={item.weekday}
                aria-label={item.label}
                title={item.label}
                aria-pressed={day === item.weekday}
                onClick={() => setDay(item.weekday)}
                className="btn btn-outline"
              >
                {item.label.slice(0, 3)}
              </button>
            ))}
          </div>
          <h3>{selected?.label}</h3>
          {!observed && (
            <div className="pantry-empty">
              <strong>Not enough data</strong>
              <p>
                There are not enough reliable observations for this day. Missing
                reports do not mean a pantry is quiet.
              </p>
            </div>
          )}
          {observed && (
            <div
              className="busy-chart"
              role="group"
              aria-label={`${selected?.label} hourly historical activity`}
            >
              {selected?.hours.map((slot) => {
                const known = slot.status === "observed" && slot.level !== null;
                const description = `${hourLabel(slot.hour)}: ${known ? labels[slot.level!] : "Not enough data"}${known && slot.waitMinutes !== null ? `; reported wait about ${slot.waitMinutes} minutes` : ""}${known && slot.confidence ? `; ${slot.confidence} confidence` : ""}`;
                return (
                  <div className="busy-column" key={slot.hour}>
                    <div className="busy-track">
                      <button
                        type="button"
                        className={`btn btn-primary busy-bar ${known ? "" : "busy-missing"}`}
                        style={
                          known
                            ? { height: `${24 + slot.level! * 24}%` }
                            : undefined
                        }
                        aria-label={description}
                        title={description}
                        onClick={() => setSelectedHour(slot.hour)}
                        onFocus={() => setSelectedHour(slot.hour)}
                      >
                        {known ? (
                          <span className="pantry-sr-only">{description}</span>
                        ) : (
                          <span aria-hidden="true">?</span>
                        )}
                      </button>
                    </div>
                    <span>{hourLabel(slot.hour)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {observed && (
            <>
              <p className="pantry-muted">
                Select or focus an hour for its activity, estimated wait and
                confidence. Taller bars mean busier observations; ? means not
                enough data.
              </p>
              <p className="busy-selected" role="status">
                {selectedSlot
                  ? `${hourLabel(selectedSlot.hour)}: ${selectedSlot.status === "observed" && selectedSlot.level !== null ? `${labels[selectedSlot.level]}${selectedSlot.waitMinutes !== null ? ` · Reported wait about ${selectedSlot.waitMinutes} minutes` : ""}${selectedSlot.confidence ? ` · ${selectedSlot.confidence} confidence` : ""}` : "Not enough data"}`
                  : "Choose an hour to see its observations."}
              </p>
            </>
          )}
          {summary.quieterWindow && (
            <p className="pantry-notice">
              Historically quieter:{" "}
              {
                summary.days.find(
                  (item) => item.weekday === summary.quieterWindow!.weekday,
                )?.label
              }
              , {hourLabel(summary.quieterWindow.hour)}. Confirm opening hours
              before choosing a visit.
            </p>
          )}
          {summary.recent ? (
            <p>
              Recent community observation:{" "}
              <strong>{labels[summary.recent.level]}</strong>
              {summary.recent.waitMinutes !== null
                ? `; reported wait about ${summary.recent.waitMinutes} minutes`
                : ""}
              . Reported{" "}
              {new Date(summary.recent.updatedAt).toLocaleString("en-US", {
                timeZone: "America/Chicago",
                timeZoneName: "short",
              })}
              . Conditions may have changed.
            </p>
          ) : (
            <p className="pantry-muted">
              No sufficiently supported recent crowd observations.
            </p>
          )}
          <details>
            <summary>How these estimates work</summary>
            <p>{summary.explanation}</p>
          </details>
        </>
      )}
      <details className="pantry-report">
        <summary>How busy is this pantry? Share an observation</summary>
        <p>
          Reporting is optional. Share only what you observed recently. No
          location tracking is required.
        </p>
        {canReport ? (
          <form onSubmit={report} className="pantry-form">
            <label>
              Crowd level
              <select
                value={level}
                onChange={(event) =>
                  setLevel(Number(event.target.value) as CrowdLevel)
                }
                className="input input-bordered"
              >
                {labels.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estimated wait in minutes (optional)
              <input
                type="number"
                min="0"
                max="240"
                step="1"
                value={wait}
                onChange={(event) => setWait(event.target.value)}
                className="input input-bordered"
              />
            </label>
            <button
              type="submit"
              disabled={sending}
              className="btn btn-primary"
            >
              {sending ? "Sending…" : "Share observation"}
            </button>
          </form>
        ) : (
          <p>
            <a href="/account">Sign in with a verified email</a> to share an
            observation.
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </details>
    </section>
  );
}
