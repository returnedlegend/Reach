import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { sanitizeCommunityPhoto } from "../src/lib/community-photo";

describe("community photo privacy and validation", () => {
  it("re-encodes supported images and removes EXIF including location metadata", async () => {
    const source = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#228844" },
    })
      .withExif({
        IFD0: { Artist: "Private uploader" },
        IFD3: { GPSLatitudeRef: "N" },
      })
      .jpeg()
      .toBuffer();
    const result = await sanitizeCommunityPhoto(
      `data:image/jpeg;base64,${source.toString("base64")}`,
    );
    const metadata = await sharp(result.bytes).metadata();
    expect(result.mime).toBe("image/jpeg");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.width).toBe(32);
  });
  it("rejects SVG, malformed images, and oversized payloads", async () => {
    for (const value of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,YmFk",
      "x".repeat(2_800_001),
    ])
      await expect(sanitizeCommunityPhoto(value)).rejects.toThrow();
  });
  it("rejects a decompression-sized image even if its encoded bytes are small", async () => {
    const source = await sharp({
      create: { width: 3000, height: 3000, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    await expect(
      sanitizeCommunityPhoto(
        `data:image/png;base64,${source.toString("base64")}`,
      ),
    ).rejects.toThrow();
  });
});
