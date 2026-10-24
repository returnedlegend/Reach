import type { StyleSpecification } from "maplibre-gl";
import type { MapCoordinates, MapPath } from "./map-types";

export const DEFAULT_MAP_CENTER: MapCoordinates = {
  lat: 30.62798,
  lng: -96.3344,
};
export const DEFAULT_MAP_STYLE_URL =
  "https://tiles.openfreemap.org/styles/liberty";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const ROUTE_APPEARANCE = {
  walking: { color: "#146b56", description: "Walking · dashed line" },
  driving: { color: "#2355a4", description: "Driving · solid blue line" },
  bus: { color: "#783f9e", description: "Bus · solid purple line" },
} as const;

export function isMapCoordinates(
  value: MapCoordinates | null | undefined,
): value is MapCoordinates {
  return (
    !!value &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    Math.abs(value.lat) <= 90 &&
    Math.abs(value.lng) <= 180
  );
}
export function isMapPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    isMapCoordinates({ lng: value[0], lat: value[1] })
  );
}
// Reject the entire malformed path instead of bridging an invalid point.
export function validMapPaths(paths: MapPath[]): MapPath[] {
  return paths.filter(
    (path) =>
      Object.hasOwn(ROUTE_APPEARANCE, path.mode) &&
      path.coordinates.length > 1 &&
      path.coordinates.every(isMapPosition),
  );
}
function escapeAttribution(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}
export function getMapConfiguration(): {
  style: string | StyleSpecification;
  rasterAttribution: string | undefined;
} {
  const rasterUrl = process.env.NEXT_PUBLIC_MAP_RASTER_TILE_URL?.trim();
  const rasterAttribution =
    process.env.NEXT_PUBLIC_MAP_ATTRIBUTION?.trim() ||
    process.env.NEXT_PUBLIC_MAP_RASTER_ATTRIBUTION?.trim();
  if (rasterUrl)
    return {
      rasterAttribution,
      style: {
        version: 8,
        sources: {
          "configured-raster": {
            type: "raster",
            tiles: [rasterUrl],
            tileSize: 256,
            maxzoom: 19,
            attribution: `<a href="${OSM_COPYRIGHT_URL}">© OpenStreetMap contributors</a>${rasterAttribution ? ` · ${escapeAttribution(rasterAttribution)}` : ""}`,
          },
        },
        layers: [
          {
            id: "configured-raster",
            type: "raster",
            source: "configured-raster",
          },
        ],
      },
    };
  // OpenFreeMap offers a key-free hosted service without an SLA.
  return {
    style:
      process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim() || DEFAULT_MAP_STYLE_URL,
    rasterAttribution: undefined,
  };
}
