import { open } from "node:fs/promises";
import { join } from "node:path";
import { isCoverageFeature } from "../../../lib/coverage-types";

export const runtime = "nodejs";

// These are fixed, repository-owned public assets. Never accept a path or URL
// from a request, and never substitute an approximate district polygon.
async function readCoverageAsset(
  filename: "tx10-119.geojson" | "tx10-119.metadata.json",
) {
  const file = await open(join(process.cwd(), "data", "geo", filename), "r");
  try {
    const info = await file.stat();
    const limit = 1024 * 1024;
    if (!info.isFile() || info.size < 2 || info.size > limit)
      throw new Error("Invalid coverage asset size");
    // Bound the actual read too, in case the file changes after stat.
    const bytes = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        count,
        bytes.length - count,
        null,
      );
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > limit) throw new Error("Coverage asset is too large");
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, count),
      ),
    );
  } finally {
    await file.close();
  }
}

export async function GET() {
  try {
    const [collection, metadata] = await Promise.all([
      readCoverageAsset("tx10-119.geojson"),
      readCoverageAsset("tx10-119.metadata.json"),
    ]);
    const feature: unknown = collection?.features?.[0];
    if (
      collection?.type !== "FeatureCollection" ||
      !Array.isArray(collection.features) ||
      collection.features.length !== 1 ||
      !isCoverageFeature(feature) ||
      feature.properties.GEOID !== "4810" ||
      feature.properties.CDSESSN !== "119" ||
      metadata?.district?.geoid !== "4810" ||
      metadata?.district?.congress !== "119" ||
      metadata?.source?.url !==
        "https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_48_cd119.zip"
    )
      throw new Error("District coverage evidence is invalid");
    return Response.json(
      {
        ...feature,
        properties: {
          ...feature.properties,
          geoid: metadata.district.geoid,
          congress: "119th Congress",
          sourceUrl: metadata.source.url,
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return Response.json(
      {
        error:
          "The official TX-10 boundary is temporarily unavailable. Try again later.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}
