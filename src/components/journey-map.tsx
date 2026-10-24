"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getMapConfiguration,
  isMapCoordinates,
  OSM_COPYRIGHT_URL,
  ROUTE_APPEARANCE,
  validMapPaths,
} from "../lib/map-config";
import type {
  CommunityMapMarker,
  MapCoordinates,
  MapPath,
} from "../lib/map-types";
import { isCoverageFeature, type CoverageFeature } from "../lib/coverage-types";
import { OsmMapCanvas, type MapStatus } from "./osm-map-canvas";

export type Coordinates = MapCoordinates;
export type JourneyStop = Coordinates & { id: string; name: string };
export type MapProps = {
  origin: Coordinates | null;
  destination?: Coordinates | null;
  stops?: JourneyStop[];
  pantries?: JourneyStop[];
  selectedPantryId?: string;
  onPantrySelect?: (id: string) => void;
  selectedStopId?: string;
  onStopSelect?: (id: string) => void;
  paths?: MapPath[];
  onOriginChange?: (coordinates: Coordinates) => void;
  originLabel?: string;
  accuracyMeters?: number;
  locationSource?: string;
  communityMarkers?: CommunityMapMarker[];
  onCommunitySelect?: (id: string) => void;
  selectedCommunityId?: string;
};
const EMPTY_STOPS: JourneyStop[] = [];
const EMPTY_PATHS: MapPath[] = [];
const EMPTY_COMMUNITY: CommunityMapMarker[] = [];
function coordinateLabel(value: Coordinates | null | undefined) {
  return isMapCoordinates(value) ? `${value.lat}, ${value.lng}` : "Not set";
}

export function JourneyMap({
  origin,
  destination = null,
  stops = EMPTY_STOPS,
  pantries = EMPTY_STOPS,
  selectedPantryId,
  onPantrySelect,
  selectedStopId,
  onStopSelect,
  paths = EMPTY_PATHS,
  onOriginChange,
  originLabel,
  accuracyMeters,
  locationSource,
  communityMarkers = EMPTY_COMMUNITY,
  onCommunitySelect,
  selectedCommunityId,
}: MapProps) {
  const [status, setStatus] = useState<MapStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [draftOrigin, setDraftOrigin] = useState<Coordinates | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [coverage, setCoverage] = useState<CoverageFeature | null>(null);
  const [coverageStatus, setCoverageStatus] = useState<
    "idle" | "loading" | "ready" | "offline" | "error"
  >("idle");
  const [coverageFitRequest, setCoverageFitRequest] = useState(0);
  useEffect(() => {
    setDraftOrigin(null);
    setChoosingLocation(false);
  }, [origin?.lat, origin?.lng]);
  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((value) => value + 1);
  }, []);
  const loadCoverage = useCallback(
    async (fitAfterLoad: boolean) => {
      if (coverage) {
        if (fitAfterLoad) setCoverageFitRequest((value) => value + 1);
        return;
      }
      if (!navigator.onLine) {
        setCoverageStatus("offline");
        return;
      }
      setCoverageStatus("loading");
      try {
        const response = await fetch("/api/coverage", { cache: "no-store" });
        if (!response.ok)
          throw new Error(`Coverage request failed (${response.status})`);
        const payload: unknown = await response.json();
        if (!isCoverageFeature(payload))
          throw new Error("Invalid coverage geometry");
        setCoverage(payload);
        setCoverageStatus("ready");
        if (fitAfterLoad) setCoverageFitRequest((value) => value + 1);
      } catch {
        setCoverageStatus(navigator.onLine ? "error" : "offline");
      }
    },
    [coverage],
  );
  const routes = validMapPaths(paths);
  const { rasterAttribution } = getMapConfiguration();
  const summary = [
    `Origin: ${isMapCoordinates(origin) ? (originLabel && !/^[-\d.]+,\s*[-\d.]+$/.test(originLabel) ? originLabel : "Your starting location") : "Choose a starting location"}.`,
    `Destination: ${isMapCoordinates(destination) ? (pantries.find((pantry) => pantry.id === selectedPantryId)?.name ?? stops.find((stop) => stop.id === selectedStopId)?.name ?? communityMarkers.find((listing) => listing.id === selectedCommunityId)?.name ?? "Selected destination") : "Not selected"}.`,
    ...(pantries.length ? [`${pantries.length} pantry sites shown.`] : []),
    ...(stops.length ? [`${stops.length} official bus stops shown.`] : []),
    ...(communityMarkers.length
      ? [`${communityMarkers.length} community food listings shown.`]
      : []),
    routes.length
      ? `${routes.length} route ${routes.length === 1 ? "line is" : "lines are"} provided.`
      : "No route line is provided.",
  ].join(" ");
  return (
    <section aria-label="Journey map" className="journey-map">
      <p className="map-summary sr-only">{summary}</p>
      <OsmMapCanvas
        key={attempt}
        origin={origin}
        destination={destination}
        stops={stops}
        pantries={pantries}
        selectedPantryId={selectedPantryId}
        onPantrySelect={onPantrySelect}
        selectedStopId={selectedStopId}
        onStopSelect={onStopSelect}
        paths={paths}
        onOriginChange={onOriginChange}
        accuracyMeters={accuracyMeters}
        locationSource={locationSource}
        communityMarkers={communityMarkers}
        onCommunitySelect={onCommunitySelect}
        selectedCommunityId={selectedCommunityId}
        coverage={coverage}
        showCoverage={showCoverage}
        coverageFitRequest={coverageFitRequest}
        choosingLocation={choosingLocation}
        draftOrigin={draftOrigin}
        onDraftOriginChange={setDraftOrigin}
        onStatus={setStatus}
        onReconnect={retry}
      />
      <div className="map-location-controls" aria-label="Coverage map controls">
        <label className="reach-checkbox">
          <input
            className="checkbox checkbox-primary"
            type="checkbox"
            checked={showCoverage}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setShowCoverage(checked);
              if (checked && !coverage) void loadCoverage(false);
            }}
          />{" "}
          Show TX-10 boundary
        </label>
        <button
          className="btn btn-outline"
          type="button"
          disabled={coverageStatus === "loading"}
          onClick={() => {
            setShowCoverage(true);
            void loadCoverage(true);
          }}
        >
          Zoom to coverage
        </button>
        {coverageStatus === "loading" && (
          <p role="status">Loading official TX-10 coverage boundary…</p>
        )}
        {coverageStatus === "offline" && (
          <p role="status">
            You are offline. TX-10 coverage could not be loaded. Reconnect and
            try again.
          </p>
        )}
        {coverageStatus === "error" && (
          <p role="status">
            TX-10 coverage is unavailable. Retry when the coverage service is
            available.
          </p>
        )}
        {coverageStatus === "ready" && showCoverage && (
          <p role="status">
            Official TX-10 boundary shown.{" "}
            {typeof coverage?.properties.sourceUrl === "string" &&
              coverage.properties.sourceUrl.startsWith("https://") && (
                <a
                  href={coverage.properties.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Boundary source
                </a>
              )}
          </p>
        )}
      </div>
      {onOriginChange && (
        <div className="map-location-controls">
          {!choosingLocation ? (
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => {
                setDraftOrigin(null);
                setChoosingLocation(true);
              }}
            >
              Choose on map
            </button>
          ) : (
            <>
              <p role="status">
                {draftOrigin
                  ? "Pending starting point selected. Confirm location to use this point."
                  : "Choose a starting point: click the map or drag your blue location pin, then confirm."}
              </p>
              <button
                className="btn btn-outline"
                type="button"
                disabled={!draftOrigin}
                onClick={() => {
                  if (!draftOrigin) return;
                  onOriginChange(draftOrigin);
                  setDraftOrigin(null);
                  setChoosingLocation(false);
                }}
              >
                Confirm location
              </button>
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => {
                  setDraftOrigin(null);
                  setChoosingLocation(false);
                }}
              >
                Cancel map selection
              </button>
            </>
          )}
        </div>
      )}
      <p>
        {pantries.length
          ? "Select a pantry pin to choose your destination. You can also use the pantry cards."
          : ""}
        {stops.length && onStopSelect
          ? " Select a bus pin to view the official stop."
          : ""}
        {communityMarkers.length && onCommunitySelect
          ? " Select a community pin to view the food listing."
          : ""}
        {locationSource === "gps" &&
        Number.isFinite(accuracyMeters) &&
        accuracyMeters! >= 0
          ? ` Blue shading shows your estimated location accuracy (±${Math.round(accuracyMeters!)} m), not a guaranteed boundary.`
          : ""}
      </p>
      {status === "loading" && (
        <p role="status">
          Loading interactive map… Location details and pantry cards remain
          available.
        </p>
      )}
      {status === "ready" && (
        <p role="status" className="sr-only">
          Interactive map ready.
        </p>
      )}
      {status === "offline" && (
        <p role="status">
          You are offline. The map cannot load new tiles. Use the location
          details and pantry cards; reconnect or retry the map.
        </p>
      )}
      {status === "error" && (
        <p role="status">
          The interactive map is unavailable. Your browser may not support
          WebGL, or map tiles could not load. Use the location details and
          pantry cards.
        </p>
      )}
      {(status === "error" || status === "offline") && (
        <button className="btn btn-outline" type="button" onClick={retry}>
          Retry map
        </button>
      )}

      <details className="map-source-details">
        <summary>Advanced location details</summary>
        <p>
          Starting point: {coordinateLabel(origin)}. Source:{" "}
          {locationSource === "gps"
            ? "Browser location"
            : locationSource === "address"
              ? "Address or local place"
              : locationSource === "map"
                ? "Confirmed map point"
                : locationSource === "manual"
                  ? "Manual point"
                  : "Selected point"}
          .
        </p>
        {draftOrigin && (
          <p>
            Pending point: {coordinateLabel(draftOrigin)}. Your starting
            location changes only after confirmation.
          </p>
        )}
      </details>
      <p style={{ fontSize: "0.875rem" }}>
        <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
        {rasterAttribution ? ` · ${rasterAttribution}` : ""}
        {!process.env.NEXT_PUBLIC_MAP_RASTER_TILE_URL?.trim() && (
          <>
            {" · "}
            <a
              href="https://openmaptiles.org/"
              target="_blank"
              rel="noreferrer"
            >
              OpenMapTiles
            </a>
          </>
        )}
      </p>
      {!!routes.length && (
        <ul aria-label="Map route legend">
          {routes.map((path, index) => (
            <li key={`${path.id}-${index}`}>
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 28,
                  marginRight: 8,
                  verticalAlign: "middle",
                  borderTop: `4px ${path.mode === "walking" ? "dashed" : "solid"} ${ROUTE_APPEARANCE[path.mode].color}`,
                }}
              />
              {path.label} — {ROUTE_APPEARANCE[path.mode].description}
            </li>
          ))}
        </ul>
      )}
      {(status === "error" || status === "offline") && !!pantries.length && (
        <ul aria-label="Map pantry alternatives">
          {pantries.map((pantry) => (
            <li key={pantry.id}>
              <button
                className="btn btn-outline"
                type="button"
                aria-pressed={pantry.id === selectedPantryId}
                onClick={() => onPantrySelect?.(pantry.id)}
                disabled={!onPantrySelect}
              >
                {pantry.name}
                {pantry.id === selectedPantryId ? " (selected)" : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
