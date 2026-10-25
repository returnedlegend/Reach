"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LibreMap, MapOptions, Marker } from "maplibre-gl";
import "./osm-map-canvas.css";
import type { CoverageFeature, CoveragePosition } from "../lib/coverage-types";
import {
  DEFAULT_MAP_CENTER,
  getMapConfiguration,
  isMapCoordinates,
  ROUTE_APPEARANCE,
  validMapPaths,
} from "../lib/map-config";
import type { MapProps, Coordinates } from "./journey-map";

export type MapStatus = "loading" | "ready" | "offline" | "error";
type MapRuntime = { map: LibreMap; library: typeof import("maplibre-gl") };
type ResourceMarker = {
  coordinates: Coordinates;
  label: string;
  element: HTMLButtonElement;
  select: () => void;
  selected: boolean;
};
type MarkerChooser = { options: ResourceMarker[]; opener: HTMLButtonElement };
type CanvasProps = Required<Pick<MapProps, "stops" | "pantries" | "paths">> &
  MapProps & {
    onStatus: (status: MapStatus) => void;
    onReconnect: () => void;
    choosingLocation: boolean;
    draftOrigin: Coordinates | null;
    onDraftOriginChange: (coordinates: Coordinates) => void;
    coverage?: CoverageFeature | null;
    showCoverage?: boolean;
    coverageFitRequest?: number;
  };

// Geographic accuracy is a distance in meters, so a screen-sized marker cannot
// represent it. Draw a geodesic polygon around the exact browser coordinate.
function accuracyRing(origin: Coordinates, meters: number): [number, number][] {
  const angularDistance = Math.min(meters, 20_000_000) / 6_371_008.8;
  const latitude = (origin.lat * Math.PI) / 180;
  const longitude = (origin.lng * Math.PI) / 180;
  return Array.from({ length: 65 }, (_, index) => {
    const bearing = (index / 64) * 2 * Math.PI;
    const lat = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance) +
        Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const lng =
      longitude +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
        Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(lat),
      );
    return [(lng * 180) / Math.PI, (lat * 180) / Math.PI];
  });
}

function markerElement(
  label: string,
  icon:
    | "origin"
    | "pantry"
    | "bus"
    | "hotspot"
    | "offer"
    | "pending"
    | "destination",
  color: string,
  selected = false,
) {
  const element = document.createElement("button");
  element.type = "button";
  element.title = label;
  element.setAttribute("aria-label", label);
  element.dataset.markerKind = icon;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const shapes = {
    origin: [
      "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z",
      "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    ],
    pantry: [
      "M5 8h14l1 13H4L5 8Z",
      "M9 8V6a3 3 0 0 1 6 0v2",
      "M9 14h6M12 11v6",
    ],
    bus: [
      "M5 16V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11H5Z",
      "M5 10h14M8 3v7M16 3v7M7 16v4M17 16v4M8 13h1M15 13h1",
    ],
    hotspot: ["M3 10 12 3l9 7M5 9v12h14V9", "M9 21v-7h6v7"],
    offer: [
      "M3 12h18v9H3v-9ZM2 8h20v4H2V8ZM12 8v13",
      "M12 8C3 8 5 0 9 3l3 5ZM12 8c9 0 7-8 3-5l-3 5Z",
    ],
    pending: [
      "M12 2v4M12 18v4M2 12h4M18 12h4",
      "M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z",
    ],
    destination: ["M5 21V3M5 3h14l-3 5 3 5H5"],
  };
  for (const shape of shapes[icon]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", shape);
    svg.appendChild(path);
  }
  element.appendChild(svg);
  Object.assign(element.style, {
    display: "grid",
    placeItems: "center",
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    background: color,
    color: "#fff",
    fontWeight: "700",
    fontSize: "18px",
    border: selected ? "4px solid #e7a33e" : "2px solid #fff",
    boxShadow: "0 2px 6px #0006",
    cursor: "pointer",
  });
  return element;
}

export function OsmMapCanvas({
  origin,
  destination,
  stops,
  pantries,
  paths,
  selectedPantryId,
  onPantrySelect,
  selectedStopId,
  onStopSelect,
  onOriginChange,
  onStatus,
  onReconnect,
  accuracyMeters,
  locationSource,
  communityMarkers,
  onCommunitySelect,
  selectedCommunityId,
  choosingLocation,
  draftOrigin,
  onDraftOriginChange,
  coverage,
  showCoverage = false,
  coverageFitRequest = 0,
}: CanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const [runtime, setRuntime] = useState<MapRuntime | null>(null);
  const [markerChooser, setMarkerChooser] = useState<MarkerChooser | null>(
    null,
  );
  const chooserPanel = useRef<HTMLDivElement>(null);
  function closeMarkerChooser() {
    setMarkerChooser(null);
    if (markerChooser?.opener.isConnected) markerChooser.opener.focus();
  }
  useEffect(() => {
    if (!markerChooser) return;
    chooserPanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMarkerChooser(null);
      if (markerChooser.opener.isConnected) markerChooser.opener.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [markerChooser]);
  const callbacks = useRef({
    onOriginChange,
    onPantrySelect,
    onStopSelect,
    onStatus,
    onReconnect,
    onCommunitySelect,
    choosingLocation,
    onDraftOriginChange,
  });
  callbacks.current = {
    onOriginChange,
    onPantrySelect,
    onStopSelect,
    onStatus,
    onReconnect,
    onCommunitySelect,
    choosingLocation,
    onDraftOriginChange,
  };

  useEffect(() => {
    let disposed = false;
    let map: LibreMap | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let loadFailed = false;
    const offline = () => callbacks.current.onStatus("offline");
    const online = () => callbacks.current.onReconnect();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    async function initialize() {
      if (!navigator.onLine) {
        offline();
        return;
      }
      callbacks.current.onStatus("loading");
      timeout = setTimeout(() => {
        if (!disposed)
          callbacks.current.onStatus(navigator.onLine ? "error" : "offline");
      }, 20_000);
      try {
        // Import only after mounting: MapLibre never executes during SSR.
        const library = await import("maplibre-gl");
        if (disposed || !container.current) return;
        // MapLibre v6 locates its worker relative to its module by default.
        // Next bundles that module into a chunk, so emit the worker explicitly
        // as a same-origin asset and use MapLibre's supported worker URL API.
        library.setWorkerUrl(
          new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url)
            .href,
        );
        const options: MapOptions = {
          container: container.current,
          style: getMapConfiguration().style,
          center: [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat],
          zoom: 12,
          attributionControl: { compact: false },
          cancelPendingTileRequestsWhileZooming: true,
        };
        // Preserve native browser caching and Referer. MapLibre v6 has no
        // prefetchZoomDelta option; no application prefetch or downloads run.
        map = new library.Map(options);
        map.addControl(
          new library.NavigationControl({ showCompass: false }),
          "top-right",
        );
        map.on("load", () => {
          if (disposed || !map) return;
          clearTimeout(timeout);
          setRuntime({ map, library });
          callbacks.current.onStatus(
            !navigator.onLine ? "offline" : loadFailed ? "error" : "ready",
          );
        });
        map.on("error", () => {
          if (!disposed) {
            loadFailed = true;
            clearTimeout(timeout);
            callbacks.current.onStatus(navigator.onLine ? "error" : "offline");
          }
        });
        map.on("webglcontextlost", () => {
          if (!disposed) callbacks.current.onStatus("error");
        });
        map.on("click", (event) => {
          if (disposed || !callbacks.current.choosingLocation) return;
          const coordinates = { lat: event.lngLat.lat, lng: event.lngLat.lng };
          if (isMapCoordinates(coordinates))
            callbacks.current.onDraftOriginChange(coordinates);
        });
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => map?.resize());
          resizeObserver.observe(container.current);
        }
      } catch {
        clearTimeout(timeout);
        if (!disposed)
          callbacks.current.onStatus(navigator.onLine ? "error" : "offline");
      }
    }
    void initialize();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      resizeObserver?.disconnect();
      map?.remove();
    };
  }, []);

  useEffect(() => {
    if (!runtime) return;
    const { map, library } = runtime;
    setMarkerChooser(null);
    const markers: Marker[] = [];
    const resources: ResourceMarker[] = [];
    const layerIds: string[] = [];
    const sourceIds: string[] = [];
    const addMarker = (
      coordinates: Coordinates,
      label: string,
      icon: Parameters<typeof markerElement>[1],
      color: string,
      options?: {
        selected?: boolean;
        draggable?: boolean;
        select?: () => void;
      },
    ) => {
      const element = markerElement(label, icon, color, options?.selected);
      if (options?.select)
        element.setAttribute("aria-pressed", String(!!options.selected));
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const neighbors = overlappingResources(element);
        if (
          options?.select &&
          (element.dataset.clustered === "true" ||
            (event.detail > 0 && neighbors.length > 1))
        ) {
          setMarkerChooser({ options: neighbors, opener: element });
          return;
        }
        // Enter/Space retain direct access to each named native marker. Pointer
        // users can only hit the top pin, so offer every overlapping resource.
        options?.select?.();
      });
      element.addEventListener("dblclick", (event) => event.stopPropagation());
      const marker = new library.Marker({
        element,
        draggable: !!options?.draggable,
      })
        .setLngLat([coordinates.lng, coordinates.lat])
        .addTo(map);
      if (options?.draggable)
        marker.on("dragend", () => {
          const value = marker.getLngLat();
          const point = { lat: value.lat, lng: value.lng };
          if (isMapCoordinates(point))
            callbacks.current.onDraftOriginChange(point);
        });
      markers.push(marker);
      if (options?.select)
        resources.push({
          coordinates,
          label,
          element,
          select: options.select,
          selected: !!options.selected,
        });
    };
    function overlappingResources(element: HTMLButtonElement) {
      // Reproject at the current zoom/bearing. Never move the stored coordinates
      // to separate pins: this also handles listings with identical area points.
      const projected = resources.map((resource) => ({
        resource,
        point: map.project([
          resource.coordinates.lng,
          resource.coordinates.lat,
        ]),
      }));
      const first = projected.find((item) => item.resource.element === element);
      if (!first) return [];
      const group = [first];
      const included = new Set([element]);
      for (let index = 0; index < group.length; index += 1) {
        for (const item of projected) {
          if (included.has(item.resource.element)) continue;
          if (
            Math.abs(item.point.x - group[index].point.x) < 44 &&
            Math.abs(item.point.y - group[index].point.y) < 44
          ) {
            included.add(item.resource.element);
            group.push(item);
          }
        }
      }
      return group.map((item) => item.resource);
    }
    if (isMapCoordinates(origin))
      addMarker(
        origin,
        choosingLocation
          ? "Trip origin — drag to correct your starting point"
          : "Your starting location",
        "origin",
        "#1673db",
        { draggable: !!onOriginChange && choosingLocation },
      );
    if (isMapCoordinates(draftOrigin))
      addMarker(
        draftOrigin,
        "Pending starting point — confirm location to use",
        "pending",
        "#a65313",
        { draggable: choosingLocation },
      );
    if (
      isMapCoordinates(destination) &&
      ![
        pantries.find((pantry) => pantry.id === selectedPantryId),
        stops.find((stop) => stop.id === selectedStopId),
        communityMarkers?.find((listing) => listing.id === selectedCommunityId),
      ].some(
        (point) =>
          point?.lat === destination.lat && point?.lng === destination.lng,
      )
    ) {
      addMarker(destination, "Trip destination", "destination", "#a24025");
    }
    for (const pantry of pantries.filter(isMapCoordinates)) {
      const selected = pantry.id === selectedPantryId;
      addMarker(
        pantry,
        `${pantry.name} — ${selected ? "selected pantry" : "select pantry"}`,
        "pantry",
        selected ? "#124c43" : "#526951",
        {
          selected,
          select: () => callbacks.current.onPantrySelect?.(pantry.id),
        },
      );
    }
    for (const stop of stops.filter(isMapCoordinates))
      addMarker(stop, `${stop.name} — official bus stop`, "bus", "#783f9e", {
        selected: stop.id === selectedStopId,
        select: () => callbacks.current.onStopSelect?.(stop.id),
      });

    for (const listing of (communityMarkers ?? []).filter(isMapCoordinates))
      addMarker(
        listing,
        `${listing.name} — ${listing.kind === "hotspot" ? "community food hotspot" : "community food offer"}`,
        listing.kind,
        listing.kind === "hotspot" ? "#a65313" : "#a2386c",
        {
          selected: listing.id === selectedCommunityId,
          select: () => callbacks.current.onCommunitySelect?.(listing.id),
        },
      );

    const updateOverlapCounts = () => {
      const lowZoom = map.getZoom() < 11;
      const updateBadge = (resource: ResourceMarker, count: number) => {
        resource.element.dataset.overlapCount = String(count);
        resource.element.setAttribute("aria-label", resource.label);
        resource.element.removeAttribute("data-clustered");
        resource.element.style.visibility = "visible";
        if (count > 1) {
          resource.element.setAttribute(
            "aria-description",
            `${count} overlapping places. Tap to choose a place, or press Enter to select this named place.`,
          );
        } else {
          resource.element.removeAttribute("aria-description");
        }
        resource.element.title =
          count > 1
            ? `${resource.label} — ${count} overlapping places; tap to choose`
            : resource.label;
        let badge = resource.element.querySelector<HTMLSpanElement>(
          "[data-overlap-badge]",
        );
        if (count <= 1) {
          badge?.remove();
          return;
        }
        if (!badge) {
          badge = document.createElement("span");
          badge.dataset.overlapBadge = "true";
          badge.setAttribute("aria-hidden", "true");
          Object.assign(badge.style, {
            position: "absolute",
            top: "0",
            right: "0",
            minWidth: "20px",
            height: "20px",
            padding: "0 3px",
            borderRadius: "10px",
            background: "#fff",
            color: "#183f35",
            border: "1px solid #183f35",
            fontSize: "12px",
            lineHeight: "18px",
            boxSizing: "border-box",
          });
          resource.element.appendChild(badge);
        }
        badge.textContent = String(count);
      };

      if (lowZoom) {
        const visited = new Set<HTMLButtonElement>();
        for (const resource of resources) {
          if (visited.has(resource.element)) continue;
          const group = overlappingResources(resource.element);
          group.forEach((member) => visited.add(member.element));
          if (group.length < 2) {
            updateBadge(resource, 1);
            continue;
          }
          const representative =
            group.find((member) => member.selected) ?? group[0];
          for (const member of group) {
            if (member === representative) continue;
            member.element.style.visibility = "hidden";
            member.element.removeAttribute("data-clustered");
            member.element.removeAttribute("aria-description");
            member.element.querySelector("[data-overlap-badge]")?.remove();
          }
          updateBadge(representative, group.length);
          representative.element.dataset.clustered = "true";
          representative.element.setAttribute(
            "aria-label",
            `${group.length} overlapping places. Activate to choose a place. Visible place: ${representative.label}`,
          );
          representative.element.setAttribute(
            "aria-description",
            `${group.length} pantry, bus stop, or community markers are grouped here. Activate to choose any named place.`,
          );
          representative.element.title = `${group.length} overlapping places — activate to choose`;
        }
        return;
      }

      for (const resource of resources)
        updateBadge(resource, overlappingResources(resource.element).length);
    };
    const dismissOnMapMove = () => setMarkerChooser(null);
    updateOverlapCounts();
    map.on("moveend", updateOverlapCounts);
    map.on("resize", updateOverlapCounts);
    map.on("movestart", dismissOnMapMove);

    if (showCoverage && coverage) {
      const id = "reach-tx10-coverage";
      map.addSource(id, { type: "geojson", data: coverage });
      sourceIds.push(id);
      map.addLayer({
        id: `${id}-fill`,
        type: "fill",
        source: id,
        paint: { "fill-color": "#174f3a", "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: `${id}-outline`,
        type: "line",
        source: id,
        paint: {
          "line-color": "#174f3a",
          "line-width": 2.5,
          "line-opacity": 0.9,
        },
      });
      layerIds.push(`${id}-fill`, `${id}-outline`);
    }

    if (
      isMapCoordinates(origin) &&
      locationSource === "gps" &&
      Number.isFinite(accuracyMeters) &&
      accuracyMeters! > 0
    ) {
      const id = "reach-origin-accuracy";
      map.addSource(id, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: { accuracyMeters },
          geometry: {
            type: "Polygon",
            coordinates: [accuracyRing(origin, accuracyMeters!)],
          },
        },
      });
      sourceIds.push(id);
      map.addLayer({
        id,
        type: "fill",
        source: id,
        paint: { "fill-color": "#1673db", "fill-opacity": 0.14 },
      });
      map.addLayer({
        id: `${id}-outline`,
        type: "line",
        source: id,
        paint: {
          "line-color": "#1673db",
          "line-width": 1.5,
          "line-opacity": 0.55,
        },
      });
      layerIds.push(id, `${id}-outline`);
    }

    const routes = validMapPaths(paths);
    routes.forEach((path, index) => {
      const id = `reach-route-${index}`;
      map.addSource(id, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: path.coordinates },
        },
      });
      sourceIds.push(id);
      map.addLayer({
        id: `${id}-outline`,
        type: "line",
        source: id,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#fff", "line-width": 8, "line-opacity": 0.9 },
      });
      layerIds.push(`${id}-outline`);
      map.addLayer({
        id,
        type: "line",
        source: id,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_APPEARANCE[path.mode].color,
          "line-width": 5,
          ...(path.mode === "walking" ? { "line-dasharray": [1.5, 1.5] } : {}),
        },
      });
      layerIds.push(id);
    });
    return () => {
      map.off("moveend", updateOverlapCounts);
      map.off("resize", updateOverlapCounts);
      map.off("movestart", dismissOnMapMove);
      for (const marker of markers) marker.remove();
      if (!map.getStyle()) return;
      for (const id of layerIds.reverse())
        if (map.getLayer(id)) map.removeLayer(id);
      for (const id of sourceIds) if (map.getSource(id)) map.removeSource(id);
    };
  }, [
    runtime,
    origin,
    destination,
    stops,
    pantries,
    selectedPantryId,
    selectedStopId,
    selectedCommunityId,
    paths,
    !!onOriginChange,
    accuracyMeters,
    locationSource,
    communityMarkers,
    choosingLocation,
    draftOrigin,
    coverage,
    showCoverage,
  ]);

  const cameraState = useRef({
    runtime: null as MapRuntime | null,
    originKey: "",
    framingKey: "",
  });
  const originKey = isMapCoordinates(origin)
    ? `${origin.lat},${origin.lng}`
    : "";
  const routes = validMapPaths(paths);
  const selectedPantry = pantries.find(
    (pantry) => pantry.id === selectedPantryId,
  );
  const routeCoordinates = routes.flatMap((path) => path.coordinates);
  const framingPoints = [
    destination,
    selectedPantry,
    stops.find((stop) => stop.id === selectedStopId),
    communityMarkers?.find((listing) => listing.id === selectedCommunityId),
  ].filter(isMapCoordinates);
  const framingKey = JSON.stringify([
    routeCoordinates,
    framingPoints.map((point) => [point.lng, point.lat]),
  ]);

  const appliedCoverageFitRequest = useRef(0);
  useEffect(() => {
    if (
      !runtime ||
      !coverage ||
      coverageFitRequest <= 0 ||
      appliedCoverageFitRequest.current === coverageFitRequest
    )
      return;
    const positions: CoveragePosition[] = [];
    const collect = (value: unknown) => {
      if (!Array.isArray(value)) return;
      if (
        value.length >= 2 &&
        Number.isFinite(value[0]) &&
        Number.isFinite(value[1])
      ) {
        positions.push([value[0], value[1]]);
        return;
      }
      value.forEach(collect);
    };
    collect(coverage.geometry.coordinates);
    if (!positions.length) return;
    const bounds = new runtime.library.LngLatBounds(positions[0], positions[0]);
    for (const position of positions) bounds.extend(position);
    appliedCoverageFitRequest.current = coverageFitRequest;
    runtime.map.fitBounds(bounds, {
      padding: 40,
      maxZoom: 10,
      duration: 450,
    });
  }, [runtime, coverage, coverageFitRequest]);

  useEffect(() => {
    if (!runtime) return;
    const previous = cameraState.current;
    const initial = previous.runtime !== runtime;
    const originChanged = initial || previous.originKey !== originKey;
    const framingChanged = initial || previous.framingKey !== framingKey;
    cameraState.current = { runtime, originKey, framingKey };
    const positions: [number, number][] = [
      ...routeCoordinates,
      ...framingPoints.map((point): [number, number] => [point.lng, point.lat]),
    ];
    if (positions.length && isMapCoordinates(origin))
      positions.push([origin.lng, origin.lat]);
    if (isMapCoordinates(origin) && originChanged) {
      const hasFramingBeyondOrigin = positions.some(
        ([longitude, latitude]) =>
          longitude !== origin.lng || latitude !== origin.lat,
      );
      if (initial && hasFramingBeyondOrigin) {
        const bounds = new runtime.library.LngLatBounds(
          positions[0],
          positions[0],
        );
        for (const position of positions) bounds.extend(position);
        runtime.map.fitBounds(bounds, {
          padding: 56,
          maxZoom: 15,
          duration: 0,
        });
      } else {
        runtime.map.easeTo({
          center: [origin.lng, origin.lat],
          zoom: 16,
          duration: 0,
        });
      }
      return;
    }
    if (!framingChanged) return;
    if (!positions.length && initial && !isMapCoordinates(origin))
      positions.push(
        ...pantries
          .filter(isMapCoordinates)
          .map((point): [number, number] => [point.lng, point.lat]),
        ...stops
          .filter(isMapCoordinates)
          .map((point): [number, number] => [point.lng, point.lat]),
        ...(communityMarkers ?? [])
          .filter(isMapCoordinates)
          .map((point): [number, number] => [point.lng, point.lat]),
      );
    if (!positions.length) return;
    const bounds = new runtime.library.LngLatBounds(positions[0], positions[0]);
    for (const position of positions) bounds.extend(position);
    runtime.map.fitBounds(bounds, {
      padding: 56,
      maxZoom: positions.length === 1 ? 16 : 15,
      duration: 0,
    });
    // Coordinate signatures deliberately prevent unrelated renders, fresh arrays,
    // draft pins and accuracy updates from moving a map the user has panned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, originKey, framingKey]);

  return (
    <div
      aria-label="Interactive journey map"
      role="region"
      data-origin-latitude={origin?.lat}
      data-origin-longitude={origin?.lng}
      data-location-source={locationSource}
      data-accuracy-meters={
        locationSource === "gps" ? accuracyMeters : undefined
      }
      style={{
        position: "relative",
        width: "100%",
        minHeight: 360,
        height: 420,
        background: "#eef3f1",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {markerChooser && (
        <div
          ref={chooserPanel}
          role="dialog"
          aria-label="Choose a map resource"
          aria-modal="false"
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            zIndex: 10,
            left: 12,
            right: 12,
            bottom: 12,
            maxHeight: "75%",
            overflowY: "auto",
            padding: 12,
            background: "#fff",
            color: "#183f35",
            border: "2px solid #183f35",
            borderRadius: 12,
            boxShadow: "0 4px 16px #0004",
          }}
        >
          <strong>{markerChooser.options.length} overlapping places</strong>
          <p>Choose the pantry, bus stop, or community listing you want.</p>
          <div style={{ display: "grid", gap: 8 }}>
            {markerChooser.options.map((resource, index) => (
              <button
                key={`${resource.label}-${index}`}
                type="button"
                style={{
                  minHeight: 44,
                  textAlign: "left",
                  whiteSpace: "normal",
                }}
                onClick={() => {
                  closeMarkerChooser();
                  resource.select();
                }}
              >
                {resource.label}
              </button>
            ))}
            <button
              type="button"
              style={{ minHeight: 44 }}
              onClick={closeMarkerChooser}
            >
              Close map resource chooser
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
