import {
  reverseGeocodeOsm,
  reverseGeocodeRequestSchema,
  osmResponse,
  readOsmRequest,
} from "../../../lib/osm-services";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const parsed = await readOsmRequest(request, reverseGeocodeRequestSchema);
  if (!parsed.ok) return parsed.response;
  return osmResponse(await reverseGeocodeOsm(parsed.data.coordinates));
}
