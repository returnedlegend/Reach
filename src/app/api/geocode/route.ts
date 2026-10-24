import {
  geocodeOsmAddress,
  geocodeRequestSchema,
  osmResponse,
  readOsmRequest,
} from "../../../lib/osm-services";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const parsed = await readOsmRequest(request, geocodeRequestSchema);
  if (!parsed.ok) return parsed.response;
  return osmResponse(await geocodeOsmAddress(parsed.data.address));
}
