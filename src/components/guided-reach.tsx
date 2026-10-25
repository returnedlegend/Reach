"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Clock3,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  HeartHandshake,
  Map as MapIcon,
  MapPin,
  Navigation,
  Phone,
  Printer,
  Share2,
  ShieldCheck,
  Soup,
  Bus,
  Home,
  Footprints,
  Car,
  X,
} from "lucide-react";
import { filterDirectory, nextPublishedWindow } from "@/lib/discovery";
import { takeNavigationOrigin } from "@/lib/navigation-handoff";
import { ThemeToggle } from "./theme-toggle";
import { MoreMenu } from "./site-navigation";
import { Surface, ActionButton } from "./ui";
import { LocationPicker, type SelectedLocation } from "./location-picker";
import { JourneyMap } from "./journey-map";
import { LoadingState } from "./loading-state";
import { AILoadingIndicator } from "./ai-loading-indicator";
import {
  transportResources,
  transitStops,
  type Resource,
} from "@/data/resources";
import { googleMapsUrl, chicagoNow } from "@/lib/journey";
import { rankResources, summarizeResource } from "@/lib/resource-summary";
import {
  loadSavedItems,
  storeSavedItems,
  savedTripText,
  type SavedItems,
  type SavedTrip,
} from "@/lib/saved-items";
import type {
  CommunityMapMarker,
  MapPath,
  MapAttribution,
} from "@/lib/map-types";
import { formatTime } from "@/lib/time";
import { CORE_FEATURES, type PublicFeatures } from "@/lib/public-feature-types";
import { serviceFreshness } from "@/lib/service-freshness";
import { SimpleFoodFinder } from "./simple-food-finder";
import { foodTripIsFresh, type CheckedFoodTrip } from "@/lib/food-trip";
import styles from "./guided-reach.module.css";

type Tab = "explore" | "map" | "community" | "saved";
type Mode = "walking" | "transit" | "driving";
type Need = "food" | "shelter" | "transportation";
type RouteResult = {
  status: string;
  message?: string;
  label?: string;
  distanceMiles?: number;
  durationMinutes?: number;
  paths?: MapPath[];
  attribution?: MapAttribution[];
  steps?: { instruction: string }[];
};
const CommunityPanel = dynamic(
  () => import("./community-panel").then((module) => module.CommunityPanel),
  { loading: () => <LoadingState label="Loading community food…" /> },
);
const AccessPlanner = dynamic(
  () => import("./access-planner").then((m) => m.AccessPlanner),
  {
    ssr: false,
    loading: () => <LoadingState label="Loading food access planner…" />,
  },
);
const ReachAssistant = dynamic(
  () => import("./reach-assistant").then((m) => m.ReachAssistant),
  {
    ssr: false,
    loading: () => <LoadingState label="Loading Reach assistant…" />,
  },
);

const PantryDetail = dynamic(
  () => import("./pantry-detail").then((module) => module.PantryDetail),
  {
    loading: () => <p role="status">Loading pantry information…</p>,
  },
);
const needs = [
  {
    id: "food",
    label: "Food",
    description: "Pantries & food assistance",
    Icon: Soup,
  },
  {
    id: "shelter",
    label: "Shelter",
    description: "Understand what’s available",
    Icon: Home,
  },
] as const;
const modes = [
  { id: "walking", label: "Walking", Icon: Footprints },
  { id: "transit", label: "Public transit", Icon: Bus },
  { id: "driving", label: "Driving / a ride", Icon: Car },
] as const;
const friendlyLocation = (location: SelectedLocation | null) =>
  !location
    ? "Choose your starting point"
    : /^[-\d.]+,\s*[-\d.]+$/.test(location.label)
      ? "Your selected starting point"
      : location.label;

export function GuidedReach({
  initialHotspots = false,
  initialCommunityOffers = false,
  foodResources = [],
  directoryError = "",
  features = CORE_FEATURES,
}: {
  initialHotspots?: boolean;
  initialCommunityOffers?: boolean;
  foodResources?: Resource[];
  directoryError?: string;
  features?: PublicFeatures;
} = {}) {
  const allResources = [...foodResources, ...transportResources];
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (detailId) detailDialog.current?.showModal();
  }, [detailId]);
  const [clock, setClock] = useState<Date | null>(null);
  const [tab, setTab] = useState<Tab>(
    (initialHotspots || initialCommunityOffers) && features.community
      ? "community"
      : "explore",
  );
  const [hotspotRequest, setHotspotRequest] = useState(
    initialHotspots && features.community ? 1 : 0,
  );
  const [communityLoaded, setCommunityLoaded] = useState(
    initialHotspots && features.community,
  );
  useEffect(() => {
    if (features.community && (tab === "community" || tab === "map"))
      setCommunityLoaded(true);
  }, [tab]);
  const [step, setStep] = useState(0);
  const [simpleExplore, setSimpleExplore] = useState(true);
  const [simpleRequest, setSimpleRequest] = useState("");
  const [checkedFoodTrip, setCheckedFoodTrip] =
    useState<CheckedFoodTrip | null>(null);
  const flowPanel = useRef<HTMLElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const heading = flowPanel.current?.querySelector("h2");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus();
  }, [step]);
  const [accessPlanning, setAccessPlanning] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const assistantOpener = useRef<HTMLButtonElement | null>(null);
  const [need, setNeed] = useState<Need>("food");
  const [location, setLocation] = useState<SelectedLocation | null>(null);
  const [destination, setDestination] = useState("");
  const [mode, setMode] = useState<Mode>("walking");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [navigationActive, setNavigationActive] = useState(false);
  const [directionsVisible, setDirectionsVisible] = useState(true);
  const [routeRequest, setRouteRequest] = useState(0);
  const directionsHeading = useRef<HTMLHeadingElement>(null);
  const mapArea = useRef<HTMLDivElement>(null);
  const [searchedAt, setSearchedAt] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(true);
  const sheetDrag = useRef<{ y: number; moved: boolean } | null>(null);
  const suppressSheetClick = useRef(false);
  const [saved, setSaved] = useState<SavedItems>({
    version: 1,
    resourceIds: [],
    trips: [],
  });
  const [saveOrigin, setSaveOrigin] = useState(false);
  const [notice, setNotice] = useState("");
  const [printText, setPrintText] = useState("");
  const [maxDistance, setMaxDistance] = useState("");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [sortBy, setSortBy] = useState("distance");
  const [travelComparisons, setTravelComparisons] = useState<
    Record<string, { miles: number; minutes: number }>
  >({});
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [comparisonNotice, setComparisonNotice] = useState("");
  const comparisonController = useRef<AbortController | null>(null);

  const [publishedWindowOnly, setPublishedWindowOnly] = useState(false);
  const [accessibilityFilter, setAccessibilityFilter] = useState(false);
  const [communityMarkers, setCommunityMarkers] = useState<
    CommunityMapMarker[]
  >([]);
  const [communitySelection, setCommunitySelection] = useState<string>();
  const requestVersion = useRef(0);
  const routingEnabled = useRef(false);
  const routeController = useRef<AbortController | null>(null);
  const previewFocus = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const resources =
    need === "transportation"
      ? transportResources
      : need === "food"
        ? foodResources
        : [];
  const selected = allResources.find((resource) => resource.id === destination);
  const searchable = filterDirectory(resources, directoryQuery).filter(
    (item) =>
      !serviceFilter ||
      (serviceFilter === "mobile" ? /mobile/i : /produce|fresh food/i).test(
        item.offering ?? "",
      ),
  );
  const ranked = rankResources(searchable, {
    origin: location?.coordinates,
    now: clock ?? undefined,
    mode,
    ...(maxDistance && location
      ? { maxDistanceMiles: Number(maxDistance) }
      : {}),
  })
    .filter(
      ({ summary }) =>
        !publishedWindowOnly ||
        summary.availabilityLabel === "Published distribution window",
    )
    .filter(
      ({ resource }) =>
        !accessibilityFilter ||
        Boolean(
          resource.accessibility &&
            !/not verified|not confirmed|unknown|confirm|not reviewed/i.test(
              resource.accessibility,
            ),
        ),
    );
  ranked.sort((a, b) => {
    // Uncertain locations never become the top recommendation solely for being close.
    const trust =
      Number(b.resource.verificationStatus === "confirmed-site") -
      Number(a.resource.verificationStatus === "confirmed-site");
    if (trust) return trust;
    if (sortBy === "travel")
      return (
        (travelComparisons[a.resource.id]?.minutes ?? Infinity) -
          (travelComparisons[b.resource.id]?.minutes ?? Infinity) || 0
      );
    if (sortBy === "open")
      return (
        Number(
          b.summary.availabilityLabel === "Published distribution window",
        ) -
        Number(a.summary.availabilityLabel === "Published distribution window")
      );
    if (sortBy === "soonest" && clock)
      return (
        (Date.parse(nextPublishedWindow(a.resource, clock)?.startsAt ?? "") ||
          Infinity) -
          (Date.parse(nextPublishedWindow(b.resource, clock)?.startsAt ?? "") ||
            Infinity) || 0
      );
    return (
      (a.straightLineMiles ?? Infinity) - (b.straightLineMiles ?? Infinity) || 0
    );
  });
  useEffect(() => {
    comparisonController.current?.abort();
    setTravelComparisons({});
    setComparisonBusy(false);
    setComparisonNotice("");
    return () => comparisonController.current?.abort();
  }, [
    location?.coordinates.lat,
    location?.coordinates.lng,
    mode,
    directoryQuery,
    serviceFilter,
  ]);
  async function compareTravelTimes() {
    if (!location || mode === "transit") return;
    comparisonController.current?.abort();
    const controller = new AbortController();
    comparisonController.current = controller;
    const origin = { ...location.coordinates };
    const candidates = rankResources(searchable, { origin })
      .filter(
        ({ resource }) =>
          resource.coordinates &&
          resource.verificationStatus === "confirmed-site",
      )
      .slice(0, 5);
    setComparisonBusy(true);
    setComparisonNotice(
      "Comparing up to five nearby confirmed sites using real routes…",
    );
    const metrics: Record<string, { miles: number; minutes: number }> = {};
    try {
      for (const { resource } of candidates) {
        if (controller.signal.aborted) return;
        const response = await fetch("/api/journey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
          body: JSON.stringify({
            origin,
            destination: resource.coordinates,
            mode,
          }),
        });
        const data: RouteResult = await response.json();
        if (controller.signal.aborted) return;
        if (
          data.status === "available" &&
          Number.isFinite(data.distanceMiles) &&
          Number.isFinite(data.durationMinutes)
        )
          metrics[resource.id] = {
            miles: data.distanceMiles!,
            minutes: data.durationMinutes!,
          };
      }
      if (!controller.signal.aborted) {
        setTravelComparisons(metrics);
        setSortBy("travel");
        setComparisonNotice(
          `${Object.keys(metrics).length} of ${candidates.length} nearby sites have routed travel times. Other times are unavailable. This is not a district-wide fastest-trip ranking.`,
        );
      }
    } catch {
      if (!controller.signal.aborted) {
        setTravelComparisons(metrics);
        setComparisonNotice(
          "Some routes could not be checked. Retry to compare nearby sites; missing travel times remain unknown.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setComparisonBusy(false);
    }
  }
  const pins =
    need === "food"
      ? ranked.flatMap(({ resource }) =>
          resource.coordinates
            ? [
                {
                  id: resource.id,
                  name: resource.name,
                  ...resource.coordinates,
                },
              ]
            : [],
        )
      : [];
  const shownStops: typeof transitStops = [];
  useEffect(() => {
    setSaved(loadSavedItems());
    setClock(new Date());
    const timer = setInterval(() => setClock(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (previewOpen) previewFocus.current?.focus();
  }, [previewOpen]);
  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    if (previousFocus.current?.isConnected) previousFocus.current.focus();
    else
      document
        .querySelector<HTMLButtonElement>(
          '.reach-bottom-nav button[aria-current="page"]',
        )
        ?.focus();
  }, []);
  useEffect(() => {
    if (!previewOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePreview();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [previewOpen, closePreview]);
  function clearRoute() {
    requestVersion.current++;
    routeController.current?.abort();
    setRoute(null);
    setBusy(false);
    setSearchedAt("");
    setCheckedFoodTrip(null);
  }
  function changeLocation(value: SelectedLocation) {
    if (
      value.coordinates.lat !== location?.coordinates.lat ||
      value.coordinates.lng !== location?.coordinates.lng
    )
      clearRoute();
    setLocation(value);
    setSaveOrigin(false);
  }
  function selectResource(id: string, preview = false) {
    if (id !== destination) {
      clearRoute();
      setDestination(id);
    }
    if (transportResources.some((resource) => resource.id === id))
      setNeed("transportation");
    else if (foodResources.some((resource) => resource.id === id))
      setNeed("food");
    if (preview) {
      previousFocus.current = document.activeElement as HTMLElement;
      setSheetExpanded(true);
      setPreviewOpen(true);
    }
  }
  function advance(next: number) {
    clearRoute();
    setStep(next);
  }
  async function calculate(missed = false) {
    if (!location || !selected?.coordinates) return;
    routingEnabled.current = true;
    routeController.current?.abort();
    const controller = new AbortController();
    routeController.current = controller;
    const version = ++requestVersion.current;
    setBusy(true);
    setRoute(null);
    setCheckedFoodTrip(null);
    const now = new Date(),
      local = chicagoNow(now);
    setSearchedAt(`${local.date} ${local.time} America/Chicago`);
    try {
      const response = await fetch("/api/journey", {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: location.coordinates,
          destination: selected.coordinates,
          mode,
          missedBus: missed,
        }),
      });
      const result = await response.json();
      if (version !== requestVersion.current) return;
      if (result.status === "available") setRoute(result);
      else if (mode === "transit") {
        setRoute({
          status: "unavailable",
          message:
            "Open Google Maps to calculate public-transit directions. Reach does not provide transit schedules in this flow.",
        });
      } else setRoute(result);
    } catch {
      if (version === requestVersion.current)
        setRoute({
          status: "unavailable",
          message:
            "Routing is unavailable. Open Google Maps for directions, or contact the provider.",
        });
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!routingEnabled.current || !location || !selected?.coordinates) return;
    // Live fixes update the marker immediately; debounce routing to avoid a
    // request for every GPS fix. Manual changes still clear stale paths first.
    const timer = setTimeout(
      () => {
        if (routingEnabled.current) void calculate();
      },
      location.source === "gps" ? 1100 : 0,
    );
    return () => {
      clearTimeout(timer);
      requestVersion.current++;
      routeController.current?.abort();
    };
    // Endpoint changes only reroute after an explicit Get directions request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    location?.coordinates.lat,
    location?.coordinates.lng,
    selected?.id,
    mode,
    routeRequest,
  ]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const assistantPantry =
      params.get("assistant") === "1" ? params.get("pantry") : null;
    if (
      assistantPantry &&
      foodResources.some((item) => item.id === assistantPantry)
    ) {
      setDestination(assistantPantry);
      setNeed("food");
      setTab("map");
      setAssistantOpen(true);
      return;
    }
    const id = params.get("directions");
    if (!id || !foodResources.some((item) => item.id === id)) return;
    const origin = takeNavigationOrigin(id);
    if (origin) setLocation(origin);
    const requestedMode = new URLSearchParams(window.location.search).get(
      "mode",
    );
    if (
      requestedMode === "walking" ||
      requestedMode === "driving" ||
      requestedMode === "transit"
    )
      setMode(requestedMode);
    setDestination(id);
    setNavigationActive(true);
    setTab("map");
    routingEnabled.current = true;
    setRouteRequest((value) => value + 1);
    // Only consume a handoff when this directory first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function startDirections(
    resource: Resource,
    origin?: SelectedLocation | null,
  ) {
    if (resource.communityOffer) {
      window.location.assign(
        `/food-hotspots?type=offer#community-item-${encodeURIComponent(resource.communityOffer.recordId)}`,
      );
      return;
    }
    clearRoute();
    if (origin !== undefined) {
      setLocation(origin);
      setSaveOrigin(false);
    }
    selectResource(resource.id);
    setPreviewOpen(false);
    setDetailId(null);
    setNavigationActive(true);
    setDirectionsVisible(true);
    setSheetExpanded(true);
    setTab("map");
    routingEnabled.current = true;
    setRouteRequest((value) => value + 1);
    requestAnimationFrame(() => directionsHeading.current?.focus());
  }
  function endDirections() {
    routingEnabled.current = false;
    clearRoute();
    setRouteRequest((value) => value + 1);
    setNavigationActive(false);
    setPreviewOpen(false);
  }
  function showCheckedFoodTrip(trip: CheckedFoodTrip) {
    const out = trip.option.outbound;
    if (!out) return;
    routingEnabled.current = false;
    clearRoute();
    selectResource(trip.option.id);
    const checkedMode =
      out.mode ?? (out.source === "scheduled" ? "transit" : mode);
    setMode(checkedMode);
    setCheckedFoodTrip(trip);
    setClock(new Date());
    setRoute({
      status: out.source === "scheduled" ? "scheduled" : "available",
      label: "Checked itinerary — published times and routed estimates",
      message: `Checked for ${trip.date} in America/Chicago. Distance and duration below describe the outbound leg. ${trip.option.returnJourney ? "The requested return is included in these instructions and map paths." : "No return itinerary was retrieved."}`,
      ...(out.distanceMiles !== undefined
        ? { distanceMiles: out.distanceMiles }
        : {}),
      ...(out.durationMinutes !== undefined
        ? { durationMinutes: out.durationMinutes }
        : {}),
      paths: [
        ...out.paths.map((p) => ({ ...p, id: `checked-out-${p.id}` })),
        ...(trip.option.returnJourney?.paths ?? []).map((p) => ({
          ...p,
          id: `checked-back-${p.id}`,
        })),
      ],
      steps: [
        {
          instruction: `Outbound: ${formatTime(out.departure)}–${formatTime(out.arrival)} Central time.`,
        },
        ...out.steps.map((instruction) => ({ instruction })),
        ...(trip.option.serviceStart !== null && trip.option.serviceEnd !== null
          ? [
              {
                instruction: `Modeled pantry visit: ${formatTime(trip.option.serviceStart)}–${formatTime(trip.option.serviceEnd)}. Confirm admission and food availability.`,
              },
            ]
          : []),
        ...(trip.option.returnJourney
          ? [
              {
                instruction: `Return: ${formatTime(trip.option.returnJourney.departure)}–${formatTime(trip.option.returnJourney.arrival)} Central time.`,
              },
              ...trip.option.returnJourney.steps.map((instruction) => ({
                instruction,
              })),
            ]
          : []),
      ],
      attribution: [
        ...new Map(
          [
            ...out.attribution,
            ...(trip.option.returnJourney?.attribution ?? []),
          ].map((a) => [a.url, a]),
        ).values(),
      ],
    });
    setPreviewOpen(false);
    setDetailId(null);
    setNavigationActive(true);
    setDirectionsVisible(true);
    setSheetExpanded(true);
    setTab("map");
    requestAnimationFrame(() => directionsHeading.current?.focus());
  }
  function recheckFoodOptions() {
    endDirections();
    setSimpleExplore(true);
    setTab("explore");
  }
  function persist(next: SavedItems) {
    if (!storeSavedItems(next)) {
      setNotice(
        "This browser could not save your items. Try downloading your trip instead.",
      );
      return false;
    }
    setSaved(next);
    return true;
  }
  function toggleSaved(id: string) {
    const exists = saved.resourceIds.includes(id);
    if (
      !persist({
        ...saved,
        resourceIds: exists
          ? saved.resourceIds.filter((item) => item !== id)
          : [...saved.resourceIds, id].slice(-200),
      })
    )
      return;
    setNotice(
      exists
        ? "Resource removed from Saved."
        : "Resource saved on this device. Your location was not saved.",
    );
  }
  function saveTrip() {
    if (!selected) return;
    const trip: SavedTrip = {
      id: crypto.randomUUID(),
      resourceId: selected.id,
      need,
      mode,
      savedAt: new Date().toISOString(),
      ...(saveOrigin && location
        ? {
            origin: {
              coordinates: { ...location.coordinates },
              label: location.label.slice(0, 250),
            },
          }
        : {}),
      ...(saveOrigin &&
      route &&
      (route.status === "available" || route.status === "scheduled")
        ? {
            route: {
              label: route.label ?? "Calculated route",
              steps: (route.steps ?? [])
                .slice(0, 100)
                .map((item) => item.instruction.slice(0, 1500)),
              ...(route.distanceMiles !== undefined
                ? { distanceMiles: route.distanceMiles }
                : {}),
              ...(route.durationMinutes !== undefined
                ? { durationMinutes: route.durationMinutes }
                : {}),
            },
          }
        : {}),
    };
    if (!persist({ ...saved, trips: [trip, ...saved.trips].slice(0, 30) }))
      return;
    setNotice(
      saveOrigin
        ? "Trip saved on this device, including your precise starting point."
        : "Trip saved on this device. Your starting point was not saved.",
    );
  }
  function printTrip(trip: SavedTrip) {
    const resource = allResources.find((item) => item.id === trip.resourceId);
    if (!resource) return;
    setPrintText(savedTripText(trip, resource));
    window.addEventListener("afterprint", () => setPrintText(""), {
      once: true,
    });
    requestAnimationFrame(() => window.print());
  }
  function downloadTrip(trip: SavedTrip) {
    const resource = allResources.find((item) => item.id === trip.resourceId);
    if (!resource) return;
    const url = URL.createObjectURL(
      new Blob([savedTripText(trip, resource)], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reach-saved-trip.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Keep the blob alive until the browser has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function shareResource(resource: Resource) {
    const url = resource.communityOffer
      ? new URL(
          `/food-hotspots?type=offer#community-item-${encodeURIComponent(resource.communityOffer.recordId)}`,
          window.location.origin,
        ).href
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(resource.coordinates ? `${resource.coordinates.lat},${resource.coordinates.lng}` : resource.address)}`;
    try {
      if (navigator.share)
        await navigator.share({
          title: resource.name,
          text: `${resource.name}\n${resource.address}\nConfirm hours and availability before visiting.`,
          url,
        });
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          `${resource.name}\n${resource.address}\n${url}`,
        );
        setNotice(
          "Resource link copied. Your starting point was not included.",
        );
      } else
        setNotice(
          "Sharing is unavailable in this browser. Use the resource’s address or directions link.",
        );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setNotice("Could not share this resource. Try its directions link.");
    }
  }
  function renderResourceActions({
    resource,
    compact = false,
  }: {
    resource: Resource;
    compact?: boolean;
  }) {
    return (
      <div
        className={`reach-actions ${compact ? "reach-actions-compact" : ""}`}
      >
        {resource.communityContact ? (
          <a
            className="btn btn-primary reach-action"
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
            className="btn btn-primary reach-action"
            href={`/food-hotspots?type=offer#community-item-${encodeURIComponent(resource.communityOffer.recordId)}`}
          >
            Request food
          </a>
        ) : (
          <button
            className="btn btn-primary reach-action reach-action-primary"
            aria-label={`Get directions to ${resource.name}`}
            onClick={() => startDirections(resource)}
          >
            <Navigation size={17} />
            Get directions
          </button>
        )}
        {resource.phone && (
          <a
            className="btn btn-outline reach-action"
            href={`tel:${resource.phone}`}
            aria-label={`Call ${resource.name}`}
          >
            <Phone size={17} />
            Call
          </a>
        )}
        <button
          className="btn btn-outline reach-action"
          aria-label={`${saved.resourceIds.includes(resource.id) ? "Unsave" : "Save"} ${resource.name}`}
          aria-pressed={saved.resourceIds.includes(resource.id)}
          onClick={() => toggleSaved(resource.id)}
        >
          <Bookmark
            size={17}
            fill={
              saved.resourceIds.includes(resource.id) ? "currentColor" : "none"
            }
          />
          {saved.resourceIds.includes(resource.id) ? "Saved" : "Save"}
        </button>
        {!compact && (
          <button
            className="btn btn-outline reach-action"
            aria-label={`Share ${resource.name}`}
            onClick={() => void shareResource(resource)}
          >
            <Share2 size={17} />
            Share
          </button>
        )}
      </div>
    );
  }
  function renderResourceCard({
    resource,
    distance,
    detailed = false,
  }: {
    resource: Resource;
    distance?: number;
    detailed?: boolean;
  }) {
    const summary = summarizeResource(resource, clock ?? undefined);
    const freshness = clock ? serviceFreshness(resource, clock) : null;
    return (
      <Surface
        key={resource.id}
        className={`reach-resource ${styles.resourceCard} ${detailed ? "reach-resource-detail" : ""}`}
        aria-label={resource.name}
      >
        <div className="reach-card-meta">
          <span className="badge badge-soft badge-primary">
            <ShieldCheck size={14} />
            {summary.statusLabel}
          </span>
          {distance !== undefined && (
            <span>{distance.toFixed(1)} mi · straight-line</span>
          )}
        </div>
        <h3>
          {detailed ? (
            resource.name
          ) : (
            <button onClick={() => selectResource(resource.id, true)}>
              {resource.name}
              <ChevronRight size={19} />
            </button>
          )}
        </h3>
        <p className="reach-address">
          <MapPin size={15} />
          {summary.address}
        </p>
        <p className="reach-offering">{summary.offering}</p>
        {detailed && resource.pedestrianPickup !== "allowed" && (
          <p className={styles.pedestrianPickup} role="status">
            <strong>
              Pedestrian pickup:{" "}
              {resource.pedestrianPickup === "not-allowed"
                ? "not allowed"
                : "UNKNOWN"}
            </strong>
            {resource.pedestrianPickup === "not-allowed"
              ? " — walking or transit pickup is not available."
              : " — confirm walk-in access before using walking or transit directions."}
          </p>
        )}
        <p className="reach-hours">
          <Clock3 size={15} aria-hidden="true" />
          <span className="line-clamp-2">{summary.hours}</span>
        </p>
        <p className="reach-caution">
          {summary.availabilityLabel}
          {resource.detailsNeedConfirmation
            ? " · Some details need confirmation."
            : ". Availability is not live."}
        </p>
        {freshness && (
          <p className="reach-help" data-source-freshness={freshness.status}>
            {freshness.label}
          </p>
        )}
        {travelComparisons[resource.id] && (
          <p className="reach-help">
            Routed: {travelComparisons[resource.id].miles.toFixed(2)} miles ·{" "}
            {Math.ceil(travelComparisons[resource.id].minutes)} minutes ({mode},
            estimated).
          </p>
        )}
        {sortBy === "soonest" && clock && (
          <p className="reach-help">
            {nextPublishedWindow(resource, clock)?.label ??
              "Next distribution not confirmed in the recorded calendar."}
          </p>
        )}
        {renderResourceActions({ resource })}
        <details className="reach-disclosure">
          <summary>Hours & visit requirements</summary>
          <p>
            <strong>Published hours:</strong> {summary.hours}
          </p>
          <p>{summary.requirements}</p>
          <p>{summary.accessibilityLabel}</p>
        </details>
        {!resource.communityHotspot &&
          foodResources.some((pantry) => pantry.id === resource.id) && (
            <button
              className="btn btn-ghost reach-text-button"
              onClick={() => setDetailId(resource.id)}
            >
              Pantry information & busy times
            </button>
          )}
        {detailed && (
          <SourceDetails resource={resource} now={clock ?? undefined} />
        )}
      </Surface>
    );
  }
  const map = (
    <JourneyMap
      origin={location?.coordinates ?? null}
      originLabel={location?.label}
      accuracyMeters={location?.accuracyMeters}
      locationSource={location?.source}
      destination={selected?.coordinates}
      pantries={pins}
      selectedPantryId={need === "food" ? selected?.id : undefined}
      onPantrySelect={(id) => selectResource(id, true)}
      stops={shownStops}
      selectedStopId={need === "transportation" ? selected?.id : undefined}
      onStopSelect={(id) => {
        setNeed("transportation");
        selectResource(id, true);
      }}
      paths={route?.paths}
      communityMarkers={communityMarkers}
      selectedCommunityId={communitySelection}
      onCommunitySelect={(id) => {
        if (features.community) {
          setCommunitySelection(id);
          setTab("community");
        }
      }}
      onOriginChange={(coordinates) =>
        changeLocation({
          coordinates,
          label: "Selected map location",
          source: "map",
          timestamp: Date.now(),
        })
      }
    />
  );
  const modeSelect = (id: string) => (
    <>
      <label htmlFor={id}>How will you travel?</label>
      <select
        className="select w-full"
        id={id}
        value={mode}
        onChange={(event) => {
          clearRoute();
          setMode(event.target.value as Mode);
        }}
      >
        {modes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </>
  );
  const filters = (
    <div className="reach-filters">
      <label>
        Search places, city or ZIP
        <input
          className="input w-full"
          type="search"
          value={directoryQuery}
          onChange={(event) => setDirectoryQuery(event.target.value)}
          placeholder="Name, city, address or ZIP code"
        />
      </label>
      <label>
        Food assistance
        <select
          className="select w-full"
          value={serviceFilter}
          onChange={(event) => setServiceFilter(event.target.value)}
          aria-label="Food assistance filter"
        >
          <option value="">All listed services</option>
          <option value="mobile">Published mobile distributions</option>
          <option value="produce">Published produce / fresh food</option>
        </select>
      </label>
      <label>
        Sort options
        <select
          className="select w-full"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value)}
          aria-label="Sort options"
        >
          <option value="distance">Closest (straight-line)</option>
          <option value="travel">Travel time (compared sites)</option>
          <option value="open">In a verified published window</option>
          <option value="soonest">Soonest confirmed distribution</option>
        </select>
      </label>
      <button
        className="btn btn-outline reach-action"
        disabled={!location || mode === "transit" || comparisonBusy}
        onClick={() => void compareTravelTimes()}
      >
        {comparisonBusy ? "Comparing routes…" : "Compare nearby travel times"}
      </button>
      <p className="reach-help">
        Comparison sends your selected origin to the routing provider for up to
        five confirmed nearby sites. Choose walking or driving. Unknown times
        and hours stay unknown.
      </p>
      {comparisonNotice && <p role="status">{comparisonNotice}</p>}

      <label>
        Resource type
        <select
          className="select w-full"
          aria-label="Resource type"
          value={need}
          onChange={(event) => {
            clearRoute();
            setNeed(event.target.value as Need);
            setDestination("");
          }}
        >
          {needs.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Straight-line distance
        <select
          className="select w-full"
          aria-label="Maximum straight-line distance"
          disabled={!location}
          value={maxDistance}
          onChange={(event) => setMaxDistance(event.target.value)}
        >
          <option value="">Any distance</option>
          <option value="2">Within 2 miles</option>
          <option value="5">Within 5 miles</option>
          <option value="10">Within 10 miles</option>
        </select>
      </label>
      <label>
        Published hours
        <select
          className="select w-full"
          aria-label="Published hours filter"
          value={publishedWindowOnly ? "window" : "all"}
          onChange={(event) =>
            setPublishedWindowOnly(event.target.value === "window")
          }
        >
          <option value="all">Any published hours</option>
          <option value="window">In a published window</option>
        </select>
      </label>
      <button
        type="button"
        className="btn btn-ghost reach-text-button"
        onClick={() => {
          setDirectoryQuery("");
          setServiceFilter("");
          setMaxDistance("");
          setPublishedWindowOnly(false);
          setAccessibilityFilter(false);
          setSortBy("distance");
        }}
      >
        Reset filters
      </button>
      <label className="reach-checkbox">
        <input
          type="checkbox"
          checked={accessibilityFilter}
          onChange={(event) => setAccessibilityFilter(event.target.checked)}
        />
        Verified accessibility only
      </label>
      <p>
        Published windows follow recorded schedules in America/Chicago, not live
        food availability. Accessibility is often unverified. Distance is a
        straight line, not a travel route.
      </p>
    </div>
  );
  const preview =
    previewOpen && selected ? (
      <section
        className={`reach-preview ${tab === "map" ? styles.sheetPreview : ""}`}
        role="region"
        aria-label="Destination preview"
      >
        <button
          ref={previewFocus}
          className="reach-preview-close"
          aria-label="Close destination preview"
          onClick={closePreview}
        >
          <X size={20} />
        </button>
        <span className="reach-kicker">YOUR SELECTED STOP</span>
        <h2>{selected.name}</h2>
        <p>
          <MapPin size={15} />
          {selected.address}
        </p>
        <p className="reach-caution">
          Check hours and availability before visiting.
        </p>
        {renderResourceActions({ resource: selected, compact: true })}
        {features.ai &&
          foodResources.some((pantry) => pantry.id === selected.id) && (
            <button
              className="btn btn-outline reach-action"
              onClick={(event) => {
                assistantOpener.current = event.currentTarget;
                setAssistantOpen(true);
              }}
            >
              Ask Reach AI assistant
            </button>
          )}
        {!selected.communityHotspot &&
          foodResources.some((pantry) => pantry.id === selected.id) && (
            <button
              className="btn btn-ghost reach-text-button"
              onClick={() => setDetailId(selected.id)}
            >
              Pantry information & busy times
            </button>
          )}
        <button
          className="btn btn-ghost reach-text-button"
          onClick={() => {
            setPreviewOpen(false);
            setTab("explore");
            setSimpleExplore(false);
            setStep(location ? 3 : 1);
          }}
        >
          View details & plan trip
          <ArrowRight size={16} />
        </button>
      </section>
    ) : null;
  const results = (
    <section
      aria-label={
        need === "food" ? "Food assistance options" : "Resource options"
      }
      className="reach-results"
    >
      <div className="reach-section-heading">
        <div>
          <span className="reach-kicker">Local directory</span>
          <h2>
            {need === "food"
              ? "Food assistance options"
              : need === "transportation"
                ? "Transportation options"
                : "Shelter information"}
          </h2>
        </div>
        <span>{ranked.length} listings</span>
      </div>
      {tab === "map" ? (
        <details className="reach-map-filter-disclosure">
          <summary>Filter resources</summary>
          {filters}
        </details>
      ) : (
        filters
      )}
      {!ranked.length ? (
        <div className="reach-empty">
          <Home size={28} />
          <h3>
            {need === "shelter"
              ? "Shelter availability isn’t verified here"
              : "No listings match these filters"}
          </h3>
          <p>
            {need === "shelter"
              ? "We don’t have verified beds, eligibility or shelter hours. Call 211 for help finding local services; confirm availability with the provider."
              : "This growing directory covers selected sites in central Texas, not every community. Try another name, city or ZIP, a wider distance, or fewer filters. A search elsewhere does not establish that no food assistance exists. Call 211 for broader help; confirm food availability directly."}
          </p>
          {need === "shelter" && (
            <a className="btn btn-outline reach-action" href="tel:211">
              Call 211
            </a>
          )}
        </div>
      ) : (
        <div
          className={tab === "map" ? "reach-map-cards" : "reach-resource-grid"}
        >
          {ranked.map(({ resource, straightLineMiles }) =>
            renderResourceCard({ resource, distance: straightLineMiles }),
          )}
        </div>
      )}
    </section>
  );
  if (accessPlanning)
    return (
      <AccessPlanner
        location={location}
        onLocationChange={changeLocation}
        onBack={() => setAccessPlanning(false)}
        foodResources={foodResources}
        features={features}
      />
    );
  return (
    <main
      className={`reach-app ${printText ? "reach-printing" : ""}`}
      id="main-content"
    >
      <pre className="reach-print-content">{printText}</pre>
      <header className="navbar reach-header">
        <a href="/" className="reach-brand" aria-label="Reach home">
          <span>
            <HeartHandshake size={25} />
          </span>
          reach<span className="reach-brand-dot">.</span>
        </a>
        <span className="reach-place">
          <MapPin size={14} />
          Central Texas
        </span>
        <span className="reach-account-note">No account needed to explore</span>
        <Link className="btn btn-primary" href="/share">
          Share food
        </Link>
        {features.volunteering && (
          <Link href="/volunteer">Volunteer pickups</Link>
        )}
        <ThemeToggle />
        <MoreMenu>
          {features.volunteering && (
            <Link href="/volunteer">Volunteer pickups</Link>
          )}
          <Link href="/pantry-planner">Detailed trip planner</Link>
          {features.accounts && <Link href="/manage">Manage a pantry</Link>}
          <Link href="/share">Host a Food Pickup / Share Extra Food</Link>
          <Link href="/admin">Admin submissions</Link>
          <Link href="/privacy">Privacy & location</Link>
        </MoreMenu>
      </header>
      <nav aria-label="Main navigation" className="dock reach-bottom-nav">
        {(
          [
            { id: "explore", label: "Explore", Icon: Compass },
            { id: "map", label: "Map", Icon: MapIcon },
            ...(features.community
              ? [
                  {
                    id: "community" as const,
                    label: "Community",
                    Icon: HeartHandshake,
                  },
                ]
              : []),
            { id: "saved", label: "Saved", Icon: Bookmark },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => {
              setPreviewOpen(false);
              setTab(id);
              if (id === "explore") setSimpleExplore(true);
            }}
          >
            <Icon size={21} />
            <span className="dock-label">{label}</span>
          </button>
        ))}
      </nav>
      <div className="reach-content">
        {directoryError && <p role="alert">{directoryError}</p>}
        {tab === "explore" && simpleExplore && (
          <SimpleFoodFinder
            resources={foodResources}
            location={location}
            onLocationChange={changeLocation}
            mode={mode}
            onModeChange={(value) => {
              clearRoute();
              setMode(value);
            }}
            onDirections={startDirections}
            onViewMap={(resource) => {
              selectResource(resource.id);
              setTab("map");
              setPreviewOpen(true);
            }}
            onCheckedDirections={showCheckedFoodTrip}
            initialRequest={simpleRequest}
            onRequestChange={setSimpleRequest}
            onDetails={setDetailId}
            onSave={toggleSaved}
            savedIds={saved.resourceIds}
            onAdvanced={() => setSimpleExplore(false)}
            aiAvailable={features.ai}
            directoryError={directoryError}
          />
        )}
        {tab === "explore" && !simpleExplore && (
          <>
            <section
              className={`reach-intro ${styles.hero} ${step > 0 ? styles.heroCompact : ""}`}
            >
              <div className={styles.heroCopy}>
                <span className="reach-kicker">
                  FOOD ASSISTANCE · GROWING REGIONAL COVERAGE
                </span>
                <h1>
                  Food and support,
                  <br />
                  within reach<span>.</span>
                </h1>
                <p>Find local food assistance and a way to get there.</p>
                <div className="reach-intro-note">
                  <ShieldCheck size={17} />
                  Free to explore. No account needed. Your location is your
                  choice.
                </div>
              </div>
              <div className={styles.heroControls}>
                {step === 0 && (
                  <div className={styles.quickStart}>
                    <LocationPicker
                      compact
                      className={styles.heroLocation}
                      value={location}
                      onChange={changeLocation}
                      resources={foodResources}
                    />
                    <button
                      className={`btn btn-primary reach-primary ${styles.findFood}`}
                      onClick={() => {
                        clearRoute();
                        setNeed("food");
                        setDestination("");
                        setStep(location ? 3 : 1);
                      }}
                    >
                      Find food near me{" "}
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  </div>
                )}
                <div className={styles.secondaryTools}>
                  <p>Find the best checked pantry for your trip.</p>
                  <button
                    className={"btn btn-outline " + styles.secondaryAction}
                    onClick={() => {
                      clearRoute();
                      setAccessPlanning(true);
                    }}
                  >
                    Find food I can reach{" "}
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                  {features.ai && (
                    <button
                      className={"btn btn-outline " + styles.secondaryAction}
                      onClick={(event) => {
                        assistantOpener.current = event.currentTarget;
                        setAssistantOpen(true);
                      }}
                    >
                      Reach AI assistant
                    </button>
                  )}
                </div>
              </div>
              <div className={styles.heroLinks}>
                <Link className="btn btn-primary" href="/share">
                  Host a Food Pickup / Share Extra Food
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
                {features.community && (
                  <button
                    aria-label="Browse food hotspots"
                    className="btn btn-ghost reach-text-button"
                    onClick={() => {
                      setHotspotRequest((request) => request + 1);
                      setTab("community");
                    }}
                  >
                    Food hotspots <ArrowRight size={17} aria-hidden="true" />
                  </button>
                )}
                {step === 0 && features.volunteering && (
                  <Link href="/volunteer">
                    Help with a food pickup{" "}
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                )}
              </div>
            </section>
            <nav className="reach-progress" aria-label="Your progress">
              {[
                "Choose support",
                "Starting point",
                "Choose a pantry",
                "Visit & save",
              ].map((label, index) => (
                <span
                  key={label}
                  aria-current={index === step ? "step" : undefined}
                >
                  <b>{index < step ? <Check size={13} /> : index + 1}</b>
                  <span>{label}</span>
                </span>
              ))}
            </nav>
            <section
              ref={flowPanel}
              className="reach-flow"
              aria-label={`Step ${step + 1}`}
            >
              <div className="reach-flow-top">
                <span className="reach-kicker">STEP {step + 1} OF 4</span>
                {step > 0 && (
                  <button
                    className="btn btn-ghost reach-text-button"
                    onClick={() => advance(step - 1)}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                )}
              </div>
              {step === 0 && (
                <>
                  <h2>What do you need?</h2>
                  <p>Let’s start with what would help today.</p>
                  <div className="reach-needs">
                    {needs.map(({ id, label, description, Icon }) => (
                      <button
                        key={id}
                        aria-label={label}
                        aria-pressed={need === id}
                        onClick={() => {
                          clearRoute();
                          setNeed(id);
                          setDestination("");
                        }}
                      >
                        <span className="reach-need-icon">
                          <Icon size={24} />
                        </span>
                        <span>
                          <strong>{label}</strong>
                          <small>{description}</small>
                        </span>
                        <span className="reach-radio">
                          {need === id && <Check size={13} />}
                        </span>
                      </button>
                    ))}
                  </div>
                  <ActionButton
                    className="reach-primary"
                    onClick={() => advance(1)}
                  >
                    Continue
                    <ArrowRight size={17} />
                  </ActionButton>
                </>
              )}
              {step === 1 && (
                <>
                  <h2>Where are you starting?</h2>
                  <p>Choose a place that works for you.</p>
                  <LocationPicker
                    value={location}
                    onChange={changeLocation}
                    resources={foodResources}
                  />

                  {map}
                  <button
                    className="btn btn-primary reach-primary"
                    disabled={!location}
                    onClick={() => advance(2)}
                  >
                    Continue
                    <ArrowRight size={17} />
                  </button>
                </>
              )}
              {step === 2 && (
                <>
                  <h2>Travel choices</h2>
                  <p>
                    Starting from <strong>{friendlyLocation(location)}</strong>.
                  </p>
                  {resources.length > 0 ? (
                    <>
                      <label htmlFor="destination">
                        Where would you like to go?
                      </label>
                      <select
                        className="select w-full"
                        id="destination"
                        value={destination}
                        onChange={(event) => selectResource(event.target.value)}
                      >
                        <option value="">Choose a destination</option>
                        {rankResources(resources, {
                          origin: location?.coordinates,
                          now: clock ?? undefined,
                        }).map(({ resource }) => (
                          <option key={resource.id} value={resource.id}>
                            {resource.name}
                          </option>
                        ))}
                      </select>
                      {modeSelect("travel-mode")}
                      <p className="reach-help">
                        Depart now. Transit schedules use America/Chicago.
                        Confirm accessibility and pedestrian access before
                        travel.
                      </p>
                    </>
                  ) : (
                    <p>
                      {need === "shelter"
                        ? "Shelter availability and beds are not verified here. You can review the limitations and contact 211 for help."
                        : "Pantry listings are unavailable right now. Please try again later or contact 211 for food assistance."}
                    </p>
                  )}
                  <button
                    className="btn btn-primary reach-primary"
                    disabled={resources.length > 0 && !destination}
                    onClick={() => advance(3)}
                  >
                    Show my options
                    <ArrowRight size={17} />
                  </button>
                </>
              )}
              {step === 3 && (
                <>
                  <h2>Your options</h2>
                  <div className="reach-origin">
                    <MapPin size={18} />
                    <span>
                      <small>STARTING POINT</small>
                      <strong>{friendlyLocation(location)}</strong>
                      {location?.accuracyMeters !== undefined && (
                        <small>
                          Estimated accuracy ±
                          {Math.round(location.accuracyMeters)} m
                        </small>
                      )}
                    </span>
                    <button
                      className="btn btn-ghost reach-text-button"
                      onClick={() => advance(1)}
                    >
                      Edit starting point
                    </button>
                  </div>
                  {!selected && (
                    <p>
                      Compare the food assistance options below, then open a
                      pantry for hours, visit requirements and directions.
                      Distances are straight-line estimates, not walking routes.
                    </p>
                  )}
                  {selected && (
                    <>
                      {modeSelect("results-mode")}
                      {renderResourceCard({
                        resource: selected,
                        detailed: true,
                      })}
                      {map}
                      {!selected.communityOffer && (
                        <div className="reach-directions">
                          <h3>A way to get there</h3>
                          <p>
                            Get directions here in Reach using your selected
                            starting point.
                          </p>
                          <button
                            className="btn btn-primary reach-primary"
                            onClick={() => startDirections(selected)}
                          >
                            <Navigation size={17} /> Get directions
                          </button>
                          <p className="reach-help">
                            Walking and driving use routed paths. Transit
                            requires verified timetables.
                          </p>
                        </div>
                      )}
                      <section className="reach-save-trip">
                        <h3>Keep this trip handy</h3>
                        <p>
                          Save a snapshot on this device. Route details are
                          included only if you choose to save your starting
                          location. Schedules and availability can change.
                        </p>
                        <label className="reach-checkbox">
                          <input
                            type="checkbox"
                            checked={saveOrigin}
                            onChange={(event) =>
                              setSaveOrigin(event.target.checked)
                            }
                          />
                          Include my precise starting location and route details
                          in this saved trip
                        </label>
                        <button
                          className="btn btn-outline reach-action"
                          onClick={saveTrip}
                        >
                          <Bookmark size={17} />
                          Save trip
                        </button>
                      </section>
                    </>
                  )}
                  <button
                    className="btn btn-ghost reach-text-button"
                    onClick={() => advance(0)}
                  >
                    Edit what I need
                  </button>
                </>
              )}
            </section>
            {step === 0 && features.community && (
              <aside className="reach-community-invite">
                <span className="reach-invite-icon">
                  <HeartHandshake size={28} />
                </span>
                <div>
                  <span className="reach-kicker">
                    NEIGHBORS HELPING NEIGHBORS
                  </span>
                  <h2>There’s room at the table.</h2>
                  <p>
                    Discover community food sharing and local public gathering
                    places.
                  </p>
                </div>
                <button
                  className="btn btn-ghost reach-text-button"
                  onClick={() => setTab("community")}
                >
                  Explore community
                  <ArrowRight size={17} />
                </button>
              </aside>
            )}
            {step === 3 && results}
            {step === 3 && <ProviderInfo />}
          </>
        )}
        {tab === "map" && (
          <section className="reach-map-view">
            {features.ai && (
              <button
                className="btn btn-outline reach-action"
                type="button"
                onClick={(event) => {
                  assistantOpener.current = event.currentTarget;
                  setAssistantOpen(true);
                }}
              >
                Reach AI assistant
              </button>
            )}
            <div className="reach-section-heading">
              <div>
                <span className="reach-kicker">FIND YOUR NEXT STOP</span>
                <h1>Good things nearby.</h1>
              </div>
              <button
                className="btn btn-outline reach-action"
                onClick={() => {
                  setTab("explore");
                  setSimpleExplore(false);
                  advance(1);
                }}
              >
                <MapPin size={17} />
                {location ? "Edit starting point" : "Choose starting point"}
              </button>
            </div>
            <p>
              {friendlyLocation(location)}. Select a resource pin or card for
              details.
            </p>
            <div className={styles.mapWorkspace}>
              <div className={styles.mapArea} ref={mapArea}>
                {map}
              </div>
              <section
                className={styles.resourceSheet}
                aria-label="Map resource list"
                data-expanded={sheetExpanded}
              >
                <button
                  type="button"
                  className={styles.sheetHandle}
                  aria-expanded={sheetExpanded}
                  aria-controls="map-resource-sheet-content"
                  onClick={(event) => {
                    if (suppressSheetClick.current && event.detail !== 0) {
                      suppressSheetClick.current = false;
                      return;
                    }
                    setSheetExpanded((expanded) => !expanded);
                  }}
                  onPointerDown={(event) => {
                    if (!event.isPrimary || event.button !== 0) return;
                    suppressSheetClick.current = false;
                    sheetDrag.current = { y: event.clientY, moved: false };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (
                      sheetDrag.current &&
                      Math.abs(event.clientY - sheetDrag.current.y) > 10
                    )
                      sheetDrag.current.moved = true;
                  }}
                  onPointerUp={(event) => {
                    const drag = sheetDrag.current;
                    if (!drag) return;
                    const distance = event.clientY - drag.y;
                    if (drag.moved) {
                      suppressSheetClick.current = true;
                      if (Math.abs(distance) > 35)
                        setSheetExpanded(distance < 0);
                    }
                    sheetDrag.current = null;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                  onPointerCancel={() => {
                    sheetDrag.current = null;
                  }}
                >
                  <span className={styles.grabBar} aria-hidden="true" />
                  <span>
                    <strong>
                      {navigationActive && directionsVisible
                        ? sheetExpanded
                          ? "Hide directions"
                          : "Show directions"
                        : sheetExpanded
                          ? "Hide resources"
                          : "Show resources"}
                    </strong>
                    <small>
                      {ranked.length} local listings · tap or swipe{" "}
                      {sheetExpanded ? "down" : "up"}
                    </small>
                  </span>
                  <ChevronDown size={20} aria-hidden="true" />
                </button>
                <div
                  id="map-resource-sheet-content"
                  className={styles.sheetContent}
                  hidden={!sheetExpanded}
                >
                  {navigationActive && selected ? (
                    <>
                      <div className={styles.directionsTabs}>
                        <button
                          className="btn btn-outline reach-action"
                          onClick={() => {
                            setSheetExpanded(false);
                            mapArea.current?.scrollIntoView({ block: "start" });
                          }}
                        >
                          Map view
                        </button>
                        <button
                          className="btn btn-outline reach-action"
                          aria-pressed={directionsVisible}
                          onClick={() => setDirectionsVisible(true)}
                        >
                          Directions
                        </button>
                        <button
                          className="btn btn-outline reach-action"
                          aria-pressed={!directionsVisible}
                          onClick={() => setDirectionsVisible(false)}
                        >
                          Browse places
                        </button>
                      </div>
                      <section
                        aria-label="Trip directions"
                        hidden={!directionsVisible}
                        className={styles.directionsPanel}
                      >
                        <div className="reach-section-heading">
                          <h2 ref={directionsHeading} tabIndex={-1}>
                            Trip directions
                          </h2>
                          <button
                            className="btn btn-outline reach-action"
                            onClick={endDirections}
                          >
                            End route
                          </button>
                        </div>
                        <p className="reach-kicker">DESTINATION</p>
                        <h3>{selected.name}</h3>
                        <p>{selected.address}</p>
                        <details open={!location} className="reach-disclosure">
                          <summary>
                            {location
                              ? "Edit starting point"
                              : "Choose starting point"}
                          </summary>
                          <LocationPicker
                            value={location}
                            onChange={changeLocation}
                            resources={foodResources}
                          />
                        </details>
                        <p className="reach-help">
                          From: {friendlyLocation(location)}
                          {location?.accuracyMeters !== undefined
                            ? ` · estimated accuracy ±${Math.round(location.accuracyMeters)} m`
                            : ""}
                          .
                        </p>
                        {modeSelect("navigation-mode")}
                        {(mode === "walking" || mode === "transit") &&
                          selected.pedestrianPickup !== "allowed" && (
                            <aside
                              className={styles.pedestrianPickup}
                              role="alert"
                            >
                              <strong>
                                Pedestrian pickup:{" "}
                                {selected.pedestrianPickup === "not-allowed"
                                  ? "not allowed"
                                  : "UNKNOWN"}
                              </strong>
                              <span>
                                {selected.pedestrianPickup === "not-allowed"
                                  ? " Do not plan a walking or transit pickup here. Choose another pantry or travel by car."
                                  : " Confirm that walk-in pickup is available before traveling by foot or transit."}
                              </span>
                            </aside>
                          )}
                        {checkedFoodTrip ? (
                          <>
                            <p>
                              Checked at{" "}
                              {new Date(
                                checkedFoodTrip.checkedAt,
                              ).toLocaleTimeString("en-US", {
                                timeZone: "America/Chicago",
                              })}{" "}
                              Central time. This is a saved calculation, not
                              live guidance.
                            </p>
                            {clock &&
                              !foodTripIsFresh(
                                {
                                  options: [checkedFoodTrip.option],
                                  recommendation: {
                                    selectedId: checkedFoodTrip.option.id,
                                  },
                                  searchedAt: checkedFoodTrip.checkedAt,
                                  planningDate: checkedFoodTrip.date,
                                },
                                new Date(
                                  +clock + (checkedFoodTrip.clockOffsetMs ?? 0),
                                ),
                              ) && (
                                <p role="alert">
                                  This trip check has expired. Recheck before
                                  relying on a departure or pickup time.
                                </p>
                              )}
                            <button
                              className="btn btn-primary reach-primary"
                              onClick={recheckFoodOptions}
                            >
                              {mode === "transit"
                                ? "Missed a bus? Recheck food options"
                                : "Recheck food options"}
                            </button>
                            <details className="reach-disclosure">
                              <summary>
                                Checked requirements and assumptions
                              </summary>
                              <ul>
                                {[
                                  ...new Set([
                                    ...checkedFoodTrip.assumptions,
                                    ...checkedFoodTrip.option.reasons,
                                    ...checkedFoodTrip.option.warnings,
                                  ]),
                                ].map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </details>
                          </>
                        ) : (
                          <button
                            className="btn btn-primary reach-primary"
                            disabled={
                              busy || !location || !selected.coordinates
                            }
                            aria-label={busy ? "Calculating route…" : undefined}
                            onClick={() => {
                              routingEnabled.current = true;
                              setRouteRequest((value) => value + 1);
                            }}
                          >
                            {busy ? (
                              <AILoadingIndicator label="Calculating route…" />
                            ) : route ? (
                              "Recalculate directions"
                            ) : (
                              "Calculate route here"
                            )}
                          </button>
                        )}
                        {mode === "transit" && !checkedFoodTrip && (
                          <button
                            className="btn btn-outline reach-action"
                            disabled={
                              busy || !location || !selected.coordinates
                            }
                            onClick={() => void calculate(true)}
                          >
                            I missed my bus
                          </button>
                        )}
                        {!selected.coordinates && (
                          <p role="status">
                            This destination’s pin is unverified. Confirm the
                            published address before travel. No route has been
                            calculated.
                          </p>
                        )}
                        <div role="status" aria-live="polite" aria-busy={busy}>
                          {busy ? (
                            <p>Checking route…</p>
                          ) : (
                            route && (
                              <>
                                <h3>
                                  {route.status === "available"
                                    ? mode === "walking"
                                      ? "Walking directions"
                                      : "Driving directions"
                                    : route.status === "scheduled"
                                      ? route.label
                                      : "Route unavailable"}
                                </h3>
                                {route.message && <p>{route.message}</p>}
                                {route.status === "available" &&
                                  route.distanceMiles !== undefined &&
                                  route.durationMinutes !== undefined && (
                                    <p className={styles.routeSummary}>
                                      Routed distance:{" "}
                                      {route.distanceMiles.toFixed(2)} miles ·{" "}
                                      {Math.ceil(route.durationMinutes)}{" "}
                                      minutes. Estimated travel time; conditions
                                      can change.
                                    </p>
                                  )}
                              </>
                            )
                          )}
                        </div>
                        {!busy && route?.steps && (
                          <ol className={styles.routeSteps}>
                            {route.steps.map((item, index) => (
                              <li key={index}>{item.instruction}</li>
                            ))}
                          </ol>
                        )}
                        {route?.status === "available" && (
                          <details className="reach-disclosure">
                            <summary>Route source & estimate</summary>
                            <p>{route.label}</p>
                            <p>
                              This is a routing estimate, not live traffic.
                              Confirm an accessible entrance before travel.
                            </p>
                          </details>
                        )}
                        {route?.attribution?.map((source) => (
                          <a
                            key={source.url}
                            className={styles.routeAttribution}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.label}
                          </a>
                        ))}
                        {searchedAt && (
                          <p className="reach-help">
                            Calculated for {searchedAt}. No live traffic or bus
                            tracking is shown.
                          </p>
                        )}
                        <p className="reach-help">
                          The routing provider receives your chosen coordinates
                          after you request directions. Watch your surroundings;
                          entrances, sidewalks, accessibility and safe crossings
                          are not independently verified.
                        </p>
                        <details className="reach-disclosure">
                          <summary>Save these directions</summary>
                          <label className="reach-checkbox">
                            <input
                              type="checkbox"
                              checked={saveOrigin}
                              onChange={(event) =>
                                setSaveOrigin(event.target.checked)
                              }
                            />
                            Include my precise starting location and route
                            details in this saved trip
                          </label>
                          <button
                            className="btn btn-outline reach-action"
                            onClick={saveTrip}
                          >
                            Save trip
                          </button>
                          <p>
                            Saved trips can be downloaded or printed from Saved.
                            No map tiles are downloaded.
                          </p>
                        </details>
                        {location && selected.coordinates && (
                          <a
                            className="btn btn-outline reach-action"
                            href={googleMapsUrl(
                              location.coordinates,
                              selected.coordinates,
                              mode,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in Google Maps
                          </a>
                        )}
                        <p className="reach-help">
                          Google Maps opens separately and calculates its own
                          route.
                        </p>
                      </section>
                      {!directionsVisible && (
                        <>
                          {preview}
                          {results}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {preview}
                      {results}
                    </>
                  )}
                </div>
              </section>
            </div>
          </section>
        )}
        {features.community && (
          <div hidden={tab !== "community"}>
            {tab === "community" && (
              <div className="reach-section-heading">
                <div>
                  <span className="reach-kicker">
                    NEIGHBORS HELPING NEIGHBORS
                  </span>
                  <h1>Food sharing</h1>
                </div>
              </div>
            )}
            {communityLoaded && (
              <CommunityPanel
                hotspotRequest={hotspotRequest}
                initialOffers={initialCommunityOffers}
                origin={location?.coordinates ?? null}
                onDiscoveryChange={setCommunityMarkers}
                selectedMarkerId={communitySelection}
              />
            )}
          </div>
        )}
        {tab === "saved" && (
          <section className="reach-saved">
            <span className="reach-kicker">HERE WHEN YOU NEED THEM</span>
            <h1>Your saved places & trips.</h1>
            <p>
              Saved on this browser, on this device. Resource bookmarks never
              include your location.
            </p>
            <h2>Saved resources</h2>
            {!saved.resourceIds.length ? (
              <div className="reach-empty">
                <Bookmark size={28} />
                <h3>A place to keep your next steps.</h3>
                <p>Tap Save on a resource to find it here.</p>
                <button
                  className="btn btn-outline reach-action"
                  onClick={() => {
                    setTab("explore");
                    if (step < 3) setTab("map");
                  }}
                >
                  Explore resources
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <div className="reach-resource-grid">
                {saved.resourceIds
                  .map((id) => allResources.find((item) => item.id === id))
                  .filter((item): item is Resource => Boolean(item))
                  .map((resource) => renderResourceCard({ resource }))}
              </div>
            )}
            <h2>Saved trips</h2>
            {!saved.trips.length && (
              <p>
                No trips saved yet. Save one from Your options after choosing a
                destination.
              </p>
            )}
            {saved.trips.map((trip) => {
              const resource = allResources.find(
                (item) => item.id === trip.resourceId,
              );
              return resource ? (
                <article
                  className="card bg-base-100 reach-resource reach-saved-trip"
                  key={trip.id}
                >
                  <h3>{resource.name}</h3>
                  <p>
                    {trip.mode} · created{" "}
                    {new Date(trip.savedAt).toLocaleDateString()}
                  </p>
                  <p>
                    {trip.origin
                      ? "Precise starting location included with your consent."
                      : "Starting location not saved."}{" "}
                    This snapshot may be out of date and is not live directions.
                  </p>
                  <details className="reach-disclosure">
                    <summary>View saved trip</summary>
                    <pre className="reach-trip-text">
                      {savedTripText(trip, resource)}
                    </pre>
                  </details>
                  <div className="reach-actions">
                    <button
                      className="btn btn-outline reach-action"
                      onClick={() => {
                        clearRoute();
                        setDestination(resource.id);
                        setNeed(trip.need);
                        setMode(trip.mode);
                        setSaveOrigin(false);
                        if (trip.origin)
                          setLocation({
                            ...trip.origin,
                            source: "manual",
                            timestamp: Date.now(),
                          });
                        setStep(trip.origin || location ? 3 : 1);
                        setTab("explore");
                      }}
                    >
                      <Navigation size={17} />
                      Open trip
                    </button>
                    <button
                      className="btn btn-outline reach-action"
                      onClick={() => downloadTrip(trip)}
                    >
                      <ArrowDownToLine size={17} />
                      Download text
                    </button>
                    <button
                      className="btn btn-outline reach-action"
                      onClick={() => printTrip(trip)}
                    >
                      <Printer size={17} />
                      Print
                    </button>
                    <button
                      className="btn btn-ghost reach-text-button"
                      onClick={() =>
                        persist({
                          ...saved,
                          trips: saved.trips.filter(
                            (item) => item.id !== trip.id,
                          ),
                        })
                      }
                    >
                      Delete trip
                    </button>
                  </div>
                </article>
              ) : null;
            })}
            <p>
              <a href="/pantry-planner">
                Open the detailed pantry round-trip planner
              </a>{" "}
              for its existing saved plans.
            </p>
          </section>
        )}
        {notice && (
          <div className="reach-notice" role="status">
            <span>{notice}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
        <footer className="reach-footer">
          <a className="reach-brand-small" href="/">
            reach.
          </a>
          <p>
            A little more within reach. Verified sites across Texas District 10;
            coverage is incomplete.
          </p>
          <div>
            <a href="/privacy">Privacy and location</a>
            <a href="/terms">Terms of use</a>
            <a href="/pantry-planner">Detailed pantry round-trip planner</a>
          </div>
          <details className="reach-disclosure">
            <summary>About this directory & your location</summary>
            <p>
              Your precise location stays in this session unless you explicitly
              save a trip and choose to include it. Routing sends coordinates to
              the configured provider after you request a route; later endpoint
              changes recalculate. Map tiles connect to the configured map
              provider. No live bus predictions are connected. Pantry coverage
              is limited to verified local listings. Searching elsewhere does
              not add coverage.
            </p>
          </details>
        </footer>
      </div>

      {tab !== "map" && preview}
      {detailId && (
        <dialog
          ref={detailDialog}
          aria-label="Pantry information"
          className="reach-pantry-dialog"
          onClose={() => setDetailId(null)}
        >
          <button
            className="btn btn-ghost reach-text-button"
            onClick={() => detailDialog.current?.close()}
          >
            Back to your trip
          </button>
          <PantryDetail
            embedded
            id={detailId}
            initialOrigin={location?.coordinates ?? null}
            initialLocation={location}
            features={features}
            onDeviceSave={setSaved}
            onLocationChange={(origin) => {
              if (origin) changeLocation(origin);
              else {
                clearRoute();
                setLocation(null);
                setSaveOrigin(false);
              }
            }}
            onDirections={(origin) => {
              const resource = foodResources.find(
                (item) => item.id === detailId,
              );
              if (resource) startDirections(resource, origin);
            }}
          />
        </dialog>
      )}
      {assistantOpen && features.ai && (
        <ReachAssistant
          returnFocusTo={assistantOpener.current}
          location={location}
          onLocationChange={changeLocation}
          resources={foodResources}
          selectedPantryId={
            foodResources.some((item) => item.id === destination)
              ? destination
              : undefined
          }
          onSelectPantry={(id, travelMode, option) => {
            if (!foodResources.some((item) => item.id === id)) return;
            selectResource(id, true);
            setMode(travelMode);
            setTab("map");
            routingEnabled.current = false;
            const journey = option?.outbound;
            if (journey) {
              setRoute({
                status:
                  journey.source === "scheduled" ? "scheduled" : "available",
                label:
                  journey.source === "scheduled"
                    ? "Scheduled transit — confirm with operator"
                    : "Retrieved routing estimate — confirm pickup details",
                message: `${option.status === "no" ? "This trip does not meet your stated limits." : option.status === "confirm" ? "This trip needs confirmation." : "Meets the checked constraints."} ${[...option.reasons, ...option.warnings].join(" ")}`,
                ...(journey.distanceMiles != null
                  ? { distanceMiles: journey.distanceMiles }
                  : {}),
                durationMinutes:
                  journey.durationMinutes ??
                  journey.arrival - journey.departure,
                paths: journey.paths,
                attribution: journey.attribution,
                steps: journey.steps.map((instruction) => ({ instruction })),
              });
              setNavigationActive(true);
              setDirectionsVisible(true);
              const local = chicagoNow(new Date());
              setSearchedAt(`${local.date} ${local.time} America/Chicago`);
            } else {
              setNavigationActive(false);
            }
          }}
          onClose={() => setAssistantOpen(false)}
        />
      )}
    </main>
  );
}

function SourceDetails({ resource, now }: { resource: Resource; now?: Date }) {
  const freshness = now ? serviceFreshness(resource, now) : null;
  return (
    <details className="reach-disclosure reach-source-details">
      <summary>Sources & verification details</summary>
      <p>{resource.notes}</p>
      {freshness && (
        <p data-source-freshness={freshness.status}>{freshness.label}</p>
      )}
      <ul>
        {resource.sources.map((source, index) => (
          <li key={index}>
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
      <p>
        A published listing confirms recorded information, not today’s
        availability or a safe entrance.
      </p>
    </details>
  );
}
function ProviderInfo() {
  return (
    <p>
      Use the destination’s Google Maps link to calculate travel directions.
      Transit schedules and vehicle tracking are outside Reach’s food discovery
      feature.
    </p>
  );
}
