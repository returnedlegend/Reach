"use client";

import { useEffect, useRef, useState } from "react";

type Coordinates = { lat: number; lng: number };
type Candidate = { label: string; coordinates: Coordinates };
type GeocodeResponse = {
  status?: string;
  candidates?: Candidate[];
  message?: string;
  attribution?: { label: string; url: string }[];
};

const inPickupArea = ({ lat, lng }: Coordinates) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= 30.4 &&
  lat <= 30.9 &&
  lng >= -96.7 &&
  lng <= -96.1;

export function PickupLocationFields() {
  const [attribution, setAttribution] = useState<
    { label: string; url: string }[]
  >([]);
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  function updateCoordinates(latText: string, lngText: string) {
    setLatitude(latText);
    setLongitude(lngText);
    const lat = Number(latText);
    const lng = Number(lngText);
    setMessage(
      latText && lngText && !inPickupArea({ lat, lng })
        ? "Pickup coordinates must be within the Bryan–College Station area."
        : "",
    );
  }

  async function searchAddress() {
    const text = address.trim();
    if (text.length < 3) {
      setMessage("Enter at least 3 characters of the public pickup address.");
      return;
    }
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const timeout = setTimeout(() => active.abort(), 20_000);
    setBusy(true);
    setMessage("");
    setCandidates([]);
    setAttribution([]);
    setLatitude("");
    setLongitude("");
    try {
      const response = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: active.signal,
        body: JSON.stringify({ address: text }),
      });
      const result = (await response.json()) as GeocodeResponse;
      if (controller.current !== active) return;
      if (!response.ok || result.status !== "available") {
        setMessage(
          result.message ||
            "Address search is unavailable. Enter the pickup address and coordinates manually.",
        );
        return;
      }
      setAttribution(
        (result.attribution ?? []).filter(
          (item) =>
            typeof item.label === "string" &&
            typeof item.url === "string" &&
            item.url.startsWith("https://"),
        ),
      );
      const matches = (result.candidates ?? []).filter(
        (candidate) =>
          typeof candidate?.label === "string" &&
          candidate.label.trim() &&
          Number.isFinite(candidate.coordinates?.lat) &&
          Number.isFinite(candidate.coordinates?.lng),
      );
      const localMatches = matches.filter((candidate) =>
        inPickupArea(candidate.coordinates),
      );
      if (!localMatches.length) {
        setMessage(
          "No matching address was found within the Bryan–College Station area. You can enter coordinates manually.",
        );
        return;
      }
      setCandidates(localMatches.slice(0, 5));
      setMessage("Choose the matching pickup location.");
    } catch {
      if (controller.current === active)
        setMessage(
          "Address search is unavailable. Enter the pickup address and coordinates manually.",
        );
    } finally {
      clearTimeout(timeout);
      if (controller.current === active) setBusy(false);
    }
  }

  function select(candidate: Candidate) {
    setAddress(candidate.label);
    setLatitude(String(candidate.coordinates.lat));
    setLongitude(String(candidate.coordinates.lng));
    setCandidates([]);
    setMessage(
      "Location selected. The address and coordinates are reported, not verified.",
    );
  }

  const selectedCoordinates = inPickupArea({
    lat: Number(latitude),
    lng: Number(longitude),
  });

  return (
    <div>
      <label>
        Public pickup address
        <input
          name="address"
          value={address}
          onChange={(event) => {
            controller.current?.abort();
            controller.current = null;
            setBusy(false);
            setAddress(event.target.value);
            setLatitude("");
            setLongitude("");
            setCandidates([]);
            setMessage("");
          }}
          required
          maxLength={200}
          autoComplete="street-address"
          placeholder="Street address or public landmark"
        />
      </label>
      <button
        type="button"
        className="btn btn-outline"
        disabled={busy}
        onClick={() => void searchAddress()}
      >
        {busy ? "Searching…" : "Search address"}
      </button>
      {candidates.length > 0 && (
        <div role="group" aria-label="Matching pickup locations">
          {candidates.map((candidate, index) => (
            <button
              type="button"
              className="btn btn-outline"
              key={`${candidate.label}-${index}`}
              onClick={() => select(candidate)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      )}
      {message && (
        <p role="status" className="sharing-hint">
          {message}
        </p>
      )}
      {attribution.length > 0 && (
        <p className="sharing-hint">
          {attribution.map((item) => (
            <a key={item.url} href={item.url} target="_blank" rel="noreferrer">
              {item.label}{" "}
            </a>
          ))}
        </p>
      )}
      {selectedCoordinates && (
        <p className="sharing-hint">
          Selected coordinates: {latitude}, {longitude}. Location details are
          reported by the submitter and not verified.
        </p>
      )}
      <details>
        <summary>Enter pickup coordinates manually</summary>
        <p className="sharing-hint">
          Use coordinates for the public pickup location. Your home location is
          not needed.
        </p>
        <div className="sharing-grid">
          <label>
            Latitude
            <input
              type="number"
              min="30.4"
              max="30.9"
              step="any"
              value={latitude}
              onChange={(event) =>
                updateCoordinates(event.target.value, longitude)
              }
            />
          </label>
          <label>
            Longitude
            <input
              type="number"
              min="-96.7"
              max="-96.1"
              step="any"
              value={longitude}
              onChange={(event) =>
                updateCoordinates(latitude, event.target.value)
              }
            />
          </label>
        </div>
      </details>
      <input
        type="hidden"
        name="lat"
        value={selectedCoordinates ? latitude : ""}
      />
      <input
        type="hidden"
        name="lng"
        value={selectedCoordinates ? longitude : ""}
      />
      {!selectedCoordinates && (
        <p className="sharing-hint">
          Search and select a location or enter coordinates in the allowed area.
        </p>
      )}
    </div>
  );
}
