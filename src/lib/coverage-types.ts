export type CoveragePosition = [number, number];

export type CoverageGeometry =
  | { type: "Polygon"; coordinates: CoveragePosition[][] }
  | { type: "MultiPolygon"; coordinates: CoveragePosition[][][] };

export type CoverageFeature = {
  type: "Feature";
  geometry: CoverageGeometry;
  properties: Record<string, unknown>;
};

function isPosition(value: unknown): value is CoveragePosition {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

function isRing(value: unknown): value is CoveragePosition[] {
  return Array.isArray(value) && value.length >= 4 && value.every(isPosition);
}

function isPolygonCoordinates(value: unknown): value is CoveragePosition[][] {
  return Array.isArray(value) && value.length > 0 && value.every(isRing);
}

export function isCoverageFeature(value: unknown): value is CoverageFeature {
  if (!value || typeof value !== "object") return false;
  const feature = value as Record<string, unknown>;
  if (
    feature.type !== "Feature" ||
    !feature.properties ||
    typeof feature.properties !== "object" ||
    Array.isArray(feature.properties)
  )
    return false;
  const geometry = feature.geometry;
  if (!geometry || typeof geometry !== "object") return false;
  const candidate = geometry as Record<string, unknown>;
  if (candidate.type === "Polygon")
    return isPolygonCoordinates(candidate.coordinates);
  if (candidate.type === "MultiPolygon")
    return (
      Array.isArray(candidate.coordinates) &&
      candidate.coordinates.length > 0 &&
      candidate.coordinates.every(isPolygonCoordinates)
    );
  return false;
}
