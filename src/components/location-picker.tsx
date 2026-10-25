"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Resource } from "../data/resources";

export type Coordinates = { lat: number; lng: number };
export type SelectedLocation = {
  coordinates: Coordinates;
  label: string;
  accuracyMeters?: number;
  source?: "gps" | "address" | "map" | "manual";
  timestamp?: number;
};

type Candidate = { label: string; coordinates: Coordinates };
type Attribution = { label: string; url: string };
type GeocodeResponse = {
  status?: string;
  candidates?: Candidate[];
  message?: string;
  attribution?: Attribution[];
};

function responseAttribution(payload: GeocodeResponse): Attribution[] {
  return (payload.attribution ?? []).filter((item) => {
    try {
      return (
        typeof item.label === "string" &&
        item.label.length > 0 &&
        new URL(item.url).protocol === "https:"
      );
    } catch {
      return false;
    }
  });
}

function validCoordinates(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function LocationPicker({
  value,
  onChange,
  resources = [],
  compact = false,
  simple = false,
  className = "",
}: {
  value: SelectedLocation | null;
  onChange: (value: SelectedLocation) => void;
  resources?: Resource[];
  compact?: boolean;
  simple?: boolean;
  className?: string;
}) {
  const [latitude, setLatitude] = useState(
    value ? String(value.coordinates.lat) : "",
  );
  const [longitude, setLongitude] = useState(
    value ? String(value.coordinates.lng) : "",
  );
  const [address, setAddress] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attribution, setAttribution] = useState<Attribution[]>([]);
  const [showLocalSuggestions, setShowLocalSuggestions] = useState(false);
  const queryWords = address.trim().toLocaleLowerCase().split(/\s+/);
  const localSuggestions =
    showLocalSuggestions && address.trim().length >= 2
      ? resources.filter(
          (resource) =>
            resource.coordinates &&
            queryWords.every((word) =>
              `${resource.name} ${resource.address}`
                .toLocaleLowerCase()
                .includes(word),
            ),
        )
      : [];
  const requestGeneration = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const selectedPoint = value
    ? `${value.coordinates.lat},${value.coordinates.lng}/${value.source ?? ""}/${value.timestamp ?? ""}`
    : "";
  const latestPoint = useRef(selectedPoint);
  latestPoint.current = selectedPoint;
  const latestSelection = useRef(value);
  latestSelection.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const followWatch = useRef<number | null>(null);
  const followGeneration = useRef(0);
  const following = useRef(false);
  const ownFollowPoint = useRef("");
  const [isFollowing, setIsFollowing] = useState(false);

  function stopFollowing() {
    followGeneration.current += 1;
    following.current = false;
    ownFollowPoint.current = "";
    if (followWatch.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(followWatch.current);
      followWatch.current = null;
    }
    setIsFollowing(false);
  }

  // Map clicks and selections outside this component invalidate pending lookups.
  useEffect(() => {
    if (ownFollowPoint.current && selectedPoint === ownFollowPoint.current) {
      ownFollowPoint.current = "";
      return;
    }
    if (following.current) stopFollowing();
    requestGeneration.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setBusy(false);
    setCandidates([]);
    setLatitude(value ? String(value.coordinates.lat) : "");
    setLongitude(value ? String(value.coordinates.lng) : "");
    // A new selection invalidates a pending result even at the same point.
    // Reverse lookup preserves source/timestamp and only updates its label.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPoint]);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
      activeRequest.current?.abort();
      followGeneration.current += 1;
      following.current = false;
      if (followWatch.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(followWatch.current);
        followWatch.current = null;
      }
    },
    [],
  );

  function invalidateRequest() {
    requestGeneration.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
  }

  function useManualCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!latitude.trim() || !longitude.trim() || !validCoordinates(lat, lng)) {
      setMessage(
        "Enter a latitude from -90 to 90 and longitude from -180 to 180.",
      );
      return;
    }
    stopFollowing();
    invalidateRequest();
    setBusy(false);
    setCandidates([]);
    onChangeRef.current({
      coordinates: { lat, lng },
      label: "Manually entered starting point",
      source: "manual",
      timestamp: Date.now(),
    });
    setMessage("Starting point selected.");
  }

  function useMyLocation() {
    stopFollowing();
    invalidateRequest();
    const generation = requestGeneration.current;
    const pointAtStart = selectedPoint;
    setMessage("");
    setCandidates([]);
    if (!navigator.geolocation) {
      setBusy(false);
      setMessage(
        "Location access is unavailable in this browser. Enter coordinates below.",
      );
      return;
    }
    setBusy(true);
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (
            generation !== requestGeneration.current ||
            latestPoint.current !== pointAtStart
          )
            return;
          setBusy(false);
          const timestamp = position.timestamp;
          const age = Date.now() - timestamp;
          if (!Number.isFinite(timestamp) || age < 0 || age > 2 * 60 * 1000) {
            setMessage(
              "The browser returned an old location. Try again or enter coordinates below.",
            );
            return;
          }
          const { latitude: lat, longitude: lng, accuracy } = position.coords;
          if (!validCoordinates(lat, lng)) {
            setMessage(
              "The browser returned invalid coordinates. Enter them manually below.",
            );
            return;
          }
          onChangeRef.current({
            coordinates: { lat, lng },
            label: "Current location",
            source: "gps",
            timestamp,
            ...(Number.isFinite(accuracy) && accuracy >= 0
              ? { accuracyMeters: accuracy }
              : {}),
          });
          setLatitude(String(lat));
          setLongitude(String(lng));
          setMessage(
            "Location selected. The accuracy reading is an estimate, not a guarantee.",
          );
        },
        (error) => {
          if (
            generation !== requestGeneration.current ||
            latestPoint.current !== pointAtStart
          )
            return;
          setBusy(false);
          const explanation =
            error.code === error.PERMISSION_DENIED
              ? "Location permission was denied. Enter coordinates or search an address below."
              : error.code === error.TIMEOUT
                ? "Location lookup timed out. Try again or enter coordinates below."
                : "Your location is unavailable. Enter coordinates or search an address below.";
          setMessage(explanation);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
      );
    } catch {
      if (generation === requestGeneration.current) {
        setBusy(false);
        setMessage(
          "Your location is unavailable. Enter coordinates or search an address below.",
        );
      }
    }
  }

  function startFollowing() {
    if (isFollowing) {
      stopFollowing();
      setMessage("Location follow stopped.");
      return;
    }
    stopFollowing();
    invalidateRequest();
    setBusy(false);
    setMessage("");
    setCandidates([]);
    if (!window.isSecureContext) {
      setMessage(
        "Location follow requires a secure connection (HTTPS). Enter coordinates or search an address instead.",
      );
      return;
    }
    if (!navigator.geolocation) {
      setMessage(
        "Location access is unavailable in this browser. Enter coordinates or search an address instead.",
      );
      return;
    }
    const generation = followGeneration.current;
    following.current = true;
    setIsFollowing(true);
    setMessage(
      "Following browser location. Accuracy is an estimate, not a guarantee.",
    );
    try {
      followWatch.current = navigator.geolocation.watchPosition(
        (position) => {
          if (!following.current || generation !== followGeneration.current)
            return;
          const timestamp = position.timestamp;
          const age = Date.now() - timestamp;
          if (!Number.isFinite(timestamp) || age < 0 || age > 2 * 60 * 1000) {
            setMessage(
              "The browser returned an old location. Follow is stopped; try again or enter coordinates below.",
            );
            stopFollowing();
            return;
          }
          const { latitude: lat, longitude: lng, accuracy } = position.coords;
          if (!validCoordinates(lat, lng)) {
            setMessage(
              "The browser returned invalid coordinates. Follow is stopped; enter coordinates manually.",
            );
            stopFollowing();
            return;
          }
          const next: SelectedLocation = {
            coordinates: { lat, lng },
            label: "Current location",
            source: "gps",
            timestamp,
            ...(Number.isFinite(accuracy) && accuracy >= 0
              ? { accuracyMeters: accuracy }
              : {}),
          };
          ownFollowPoint.current = `${lat},${lng}/gps/${timestamp}`;
          setLatitude(String(lat));
          setLongitude(String(lng));
          onChangeRef.current(next);
          setMessage(
            `Following browser location. ${Number.isFinite(accuracy) && accuracy >= 0 ? `Estimated accuracy ±${Math.round(accuracy)} m; ` : ""}this is not a guaranteed boundary.`,
          );
        },
        (error) => {
          if (!following.current || generation !== followGeneration.current)
            return;
          const explanation =
            error.code === error.PERMISSION_DENIED
              ? "Location permission was denied. Follow is stopped; enter coordinates or search an address below."
              : error.code === error.TIMEOUT
                ? "Location follow timed out. Follow is stopped; try again or enter coordinates below."
                : "Your location is unavailable. Follow is stopped; enter coordinates or search an address below.";
          stopFollowing();
          setMessage(explanation);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
      );
    } catch {
      stopFollowing();
      setMessage(
        "Your location is unavailable. Follow is stopped; enter coordinates or search an address below.",
      );
    }
  }

  async function searchAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = address.trim();
    if (!query) {
      setMessage("Enter an address to search.");
      return;
    }
    stopFollowing();
    invalidateRequest();
    const generation = requestGeneration.current;
    const pointAtStart = selectedPoint;
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setBusy(true);
    setMessage("");
    setCandidates([]);
    setShowLocalSuggestions(false);
    try {
      const response = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: query }),
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = (await response.json()) as GeocodeResponse;
      if (
        generation !== requestGeneration.current ||
        latestPoint.current !== pointAtStart
      )
        return;
      if (!response.ok || payload.status !== "available") {
        setMessage(
          payload.message ||
            "Address search is unavailable. Enter coordinates manually.",
        );
        return;
      }
      const options = (payload.candidates ?? []).filter(
        (item) =>
          item?.label &&
          validCoordinates(item.coordinates?.lat, item.coordinates?.lng),
      );
      if (!options.length) {
        setMessage(
          "No matching addresses were found. Enter coordinates manually.",
        );
        return;
      }
      setCandidates(options);
      setAttribution(responseAttribution(payload));
      setMessage("Choose the matching address to use it.");
    } catch {
      if (
        generation === requestGeneration.current &&
        latestPoint.current === pointAtStart
      ) {
        setMessage(
          "Address search is unavailable right now. Enter coordinates manually.",
        );
      }
    } finally {
      clearTimeout(timeout);
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  async function lookUpSelectedCoordinates() {
    if (!value) return;
    const selection = value;
    const pointAtStart = selectedPoint;
    invalidateRequest();
    const generation = requestGeneration.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setBusy(true);
    setMessage("");
    setCandidates([]);
    try {
      const response = await fetch("/api/reverse-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: selection.coordinates }),
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = (await response.json()) as GeocodeResponse;
      if (
        generation !== requestGeneration.current ||
        latestPoint.current !== pointAtStart
      )
        return;
      const match = payload.candidates?.find(
        (item) =>
          typeof item?.label === "string" && item.label.trim().length > 0,
      );
      if (!response.ok || payload.status !== "available" || !match) {
        setMessage(
          payload.message ||
            "No address label was found. Your selected coordinates are still available.",
        );
        return;
      }
      // A reverse-geocoder may snap to a nearby feature. Preserve the exact point
      // and browser accuracy; only the descriptive label comes from the provider.
      onChangeRef.current({
        ...(latestSelection.current ?? selection),
        label: match.label,
      });
      setAttribution(responseAttribution(payload));
      setMessage("Address label added to your selected coordinates.");
    } catch {
      if (
        generation === requestGeneration.current &&
        latestPoint.current === pointAtStart
      )
        setMessage(
          "Address lookup is unavailable right now. Your selected coordinates are still available.",
        );
    } finally {
      clearTimeout(timeout);
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  const addressForm = (
    <form onSubmit={searchAddress}>
      <label>
        Address
        <input
          className="input w-full"
          value={address}
          onChange={(event) => {
            stopFollowing();
            invalidateRequest();
            setBusy(false);
            setCandidates([]);
            setMessage("");
            setAddress(event.target.value);
            setShowLocalSuggestions(true);
          }}
          placeholder={
            compact ? "Address or pantry" : "Address or local pantry name"
          }
          autoComplete="off"
        />
      </label>
      <button
        className="btn btn-outline"
        type="submit"
        disabled={busy}
        aria-label="Search address"
      >
        {compact ? "Search" : "Search address"}
      </button>
    </form>
  );

  return (
    <section
      aria-label="Choose a starting location"
      className={`location-picker ${className}`}
      data-compact={compact || undefined}
    >
      <p>
        {compact
          ? "Where are you starting?"
          : "Use your location or search an address or place. Your location is used only when you choose it. You can also choose a point on the map."}
      </p>
      <button
        className="btn btn-outline"
        type="button"
        onClick={useMyLocation}
        disabled={busy}
      >
        {busy ? "Working…" : "Use my location"}
      </button>
      {!compact && (
        <button
          className="btn btn-outline"
          type="button"
          onClick={startFollowing}
          disabled={busy}
        >
          {isFollowing ? "Stop following" : "Follow my location"}
        </button>
      )}
      {value && (
        <p>
          Selected:{" "}
          {/^[-\d.]+,\s*[-\d.]+$/.test(value.label)
            ? "Selected starting point"
            : value.label}
          {value.accuracyMeters !== undefined &&
            ` (estimated accuracy ±${Math.round(value.accuracyMeters)} m)`}
        </p>
      )}
      {simple ? (
        <details className="location-address-disclosure">
          <summary>Enter an address instead</summary>
          {addressForm}
        </details>
      ) : (
        addressForm
      )}
      {localSuggestions.length > 0 && (
        <fieldset className="location-suggestions">
          <legend>Local places</legend>
          <p>
            Matches from Reach’s pantry directory. No search is sent while you
            type.
          </p>
          {localSuggestions.map((resource) => (
            <button
              className="btn btn-outline"
              key={resource.id}
              type="button"
              onClick={() => {
                if (!resource.coordinates) return;
                stopFollowing();
                invalidateRequest();
                setBusy(false);
                onChangeRef.current({
                  coordinates: resource.coordinates,
                  label: `${resource.name}, ${resource.address}`,
                  source: "address",
                  timestamp: Date.now(),
                });
                setAddress(resource.address);
                setShowLocalSuggestions(false);
                setCandidates([]);
                setMessage(
                  "Local place selected. Directory pins identify the site; entrances have not been reviewed.",
                );
              }}
            >
              <strong>{resource.name}</strong>
              <span>{resource.address}</span>
            </button>
          ))}
        </fieldset>
      )}
      {candidates.length > 0 && (
        <fieldset>
          <legend>Address matches</legend>
          {candidates.map((candidate, index) => (
            <button
              className="btn btn-outline"
              key={`${candidate.label}-${index}`}
              type="button"
              onClick={() => {
                stopFollowing();
                invalidateRequest();
                setBusy(false);
                onChangeRef.current({
                  coordinates: candidate.coordinates,
                  label: candidate.label,
                  source: "address",
                  timestamp: Date.now(),
                });
                setLatitude(String(candidate.coordinates.lat));
                setLongitude(String(candidate.coordinates.lng));
                setCandidates([]);
                setMessage("Address selected.");
              }}
            >
              {candidate.label}
            </button>
          ))}
        </fieldset>
      )}
      {attribution.length > 0 && (
        <p>
          {attribution.map((item, index) => (
            <span key={item.url}>
              {index > 0 && " · "}
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                {item.label}
              </a>
            </span>
          ))}
        </p>
      )}
      <details className="location-advanced">
        <summary>Advanced: enter coordinates</summary>
        {compact && (
          <button
            className="btn btn-outline"
            type="button"
            onClick={startFollowing}
            disabled={busy}
          >
            {isFollowing ? "Stop following" : "Follow my location"}
          </button>
        )}
        <p>
          Enter an exact point or inspect your selected location. Coordinate
          precision does not establish a safe entrance.
        </p>
        {value && (
          <p>
            Source:{" "}
            {value.source === "gps"
              ? "Browser location"
              : value.source === "address"
                ? "Address or local place"
                : value.source === "map"
                  ? "Confirmed map point"
                  : "Manual point"}
            .{" "}
            {value.timestamp
              ? `Selected ${new Date(value.timestamp).toLocaleTimeString()}.`
              : ""}
          </p>
        )}
        {value && (
          <button
            className="btn btn-outline"
            type="button"
            onClick={lookUpSelectedCoordinates}
            disabled={busy}
          >
            Look up selected coordinates
          </button>
        )}
        <form onSubmit={useManualCoordinates}>
          <label>
            Latitude
            <input
              className="input w-full"
              inputMode="decimal"
              type="number"
              min="-90"
              max="90"
              step="any"
              value={latitude}
              onChange={(event) => {
                stopFollowing();
                setLatitude(event.target.value);
              }}
            />
          </label>
          <label>
            Longitude
            <input
              className="input w-full"
              inputMode="decimal"
              type="number"
              min="-180"
              max="180"
              step="any"
              value={longitude}
              onChange={(event) => {
                stopFollowing();
                setLongitude(event.target.value);
              }}
            />
          </label>
          <button className="btn btn-outline" type="submit">
            Use these coordinates
          </button>
        </form>
      </details>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
