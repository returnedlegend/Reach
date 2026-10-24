import {
  computeOsmJourney,
  journeyRequestSchema,
  osmResponse,
  readOsmRequest,
} from "../../../lib/osm-services";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const parsed = await readOsmRequest(request, journeyRequestSchema);
  if (!parsed.ok) return parsed.response;
  return osmResponse(await computeOsmJourney(parsed.data));
}
