export type MapCoordinates = { lat: number; lng: number };
export type CommunityMapMarker = MapCoordinates & {
  id: string;
  name: string;
  kind: "hotspot" | "offer";
};
export type MapPath = {
  id: string;
  mode: "walking" | "driving" | "bus";
  coordinates: [number, number][]; // GeoJSON longitude, latitude
  label: string;
};
export type MapAttribution = { label: string; url: string };
