import sharp from "sharp";

/** Decode and re-encode a bounded image; never retain GPS/EXIF or user filenames. */
export async function sanitizeCommunityPhoto(dataUrl: string): Promise<{
  bytes: Uint8Array;
  mime: "image/jpeg";
}> {
  if (typeof dataUrl !== "string" || dataUrl.length > 2_800_000)
    throw new Error("Choose a JPEG, PNG or WebP photo smaller than 2 MB.");
  const match =
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0)
    throw new Error("Choose a JPEG, PNG or WebP photo.");
  const input = Buffer.from(match[2], "base64");
  if (!input.length || input.length > 2_097_152)
    throw new Error("The photo must be smaller than 2 MB.");
  try {
    const image = sharp(input, {
      limitInputPixels: 8_000_000,
      failOn: "warning",
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error("Unsupported image");
    const bytes = await image
      .rotate()
      .resize({
        width: 1200,
        height: 1200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { bytes, mime: "image/jpeg" };
  } catch {
    throw new Error(
      "This photo could not be read. Use a still image under 8 megapixels.",
    );
  }
}
