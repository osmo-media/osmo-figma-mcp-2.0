import sharp from "sharp";
import type { Transform } from "@figma/rest-api-spec";
import { Logger } from "./logger.js";

/**
 * Apply crop transform to an image buffer based on Figma's transformation matrix
 * @param buffer - The image buffer
 * @param cropTransform - Figma transform matrix [[scaleX, skewX, translateX], [skewY, scaleY, translateY]]
 * @returns Promise<Buffer> - The cropped image buffer
 */
export async function applyCropTransformToBuffer(
  buffer: Buffer,
  cropTransform: Transform,
): Promise<{ buffer: Buffer; cropRegion?: CropRegion }> {
  try {
    // Extract transform values
    const scaleX = cropTransform[0]?.[0] ?? 1;
    const translateX = cropTransform[0]?.[2] ?? 0;
    const scaleY = cropTransform[1]?.[1] ?? 1;
    const translateY = cropTransform[1]?.[2] ?? 0;

    // Load the image and get metadata
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error("Could not get image dimensions");
    }

    const { width, height } = metadata;

    // Calculate crop region based on transform matrix
    const cropLeft = Math.max(0, Math.round(translateX * width));
    const cropTop = Math.max(0, Math.round(translateY * height));
    const cropWidth = Math.min(width - cropLeft, Math.round(scaleX * width));
    const cropHeight = Math.min(height - cropTop, Math.round(scaleY * height));

    // Validate crop dimensions
    if (cropWidth <= 0 || cropHeight <= 0) {
      Logger.log("Invalid crop dimensions, returning original buffer");
      return { buffer };
    }

    const cropRegion = { left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight };

    // Apply crop transformation
    const croppedBuffer = await image
      .extract({
        left: cropLeft,
        top: cropTop,
        width: cropWidth,
        height: cropHeight,
      })
      .toBuffer();

    Logger.log(`Cropped image: ${cropLeft}, ${cropTop}, ${cropWidth}x${cropHeight} from ${width}x${height}`);

    return { buffer: croppedBuffer, cropRegion };
  } catch (error) {
    Logger.error("Error cropping image buffer:", error);
    // Return original buffer if cropping fails
    return { buffer };
  }
}

/**
 * Get image dimensions from a buffer
 * @param buffer - The image buffer
 * @returns Promise<{width: number, height: number}>
 */
export async function getBufferDimensions(buffer: Buffer): Promise<{
  width: number;
  height: number;
}> {
  try {
    const metadata = await sharp(buffer).metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error("Could not get image dimensions from buffer");
    }

    return {
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    Logger.error("Error getting buffer dimensions:", error);
    // Return default dimensions if reading fails
    return { width: 1000, height: 1000 };
  }
}

export type CropRegion = { left: number; top: number; width: number; height: number };

export type BufferProcessingResult = {
  buffer: Buffer;
  fileName: string;
  originalDimensions: { width: number; height: number };
  finalDimensions: { width: number; height: number };
  wasCropped: boolean;
  cropRegion?: CropRegion;
  cssVariables?: string;
};

/**
 * Download image from URL and process it in memory (no local files)
 * @param fileName - The filename (used for content type detection)
 * @param imageUrl - Image URL
 * @param needsCropping - Whether to apply crop transform
 * @param cropTransform - Transform matrix for cropping
 * @param requiresImageDimensions - Whether to generate dimension metadata
 * @returns Promise<BufferProcessingResult> - Processed image buffer and metadata
 */
export async function downloadAndProcessImageToBuffer(
  fileName: string,
  imageUrl: string,
  needsCropping: boolean = false,
  cropTransform?: Transform,
  requiresImageDimensions: boolean = false,
): Promise<BufferProcessingResult> {
  // Download image to buffer
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  let buffer = Buffer.from(arrayBuffer);

  Logger.log(`Downloaded image ${fileName}: ${buffer.length} bytes`);

  // Get original dimensions before any processing
  const originalDimensions = await getBufferDimensions(buffer);
  Logger.log(`Original dimensions: ${originalDimensions.width}x${originalDimensions.height}`);

  let wasCropped = false;
  let cropRegion: CropRegion | undefined;

  // Apply crop transform if needed (only for raster images)
  const isSvg = fileName.toLowerCase().endsWith(".svg");
  if (!isSvg && needsCropping && cropTransform) {
    Logger.log("Applying crop transform...");
    const cropResult = await applyCropTransformToBuffer(buffer, cropTransform);
    buffer = cropResult.buffer;
    cropRegion = cropResult.cropRegion;
    wasCropped = !!cropRegion;
    if (wasCropped) {
      Logger.log(`Cropped to region: ${cropRegion!.left}, ${cropRegion!.top}, ${cropRegion!.width}x${cropRegion!.height}`);
    }
  }

  // Get final dimensions after processing
  const finalDimensions = isSvg ? originalDimensions : await getBufferDimensions(buffer);
  Logger.log(`Final dimensions: ${finalDimensions.width}x${finalDimensions.height}`);

  // Generate CSS variables if required
  let cssVariables: string | undefined;
  if (requiresImageDimensions) {
    cssVariables = generateImageCSSVariables(finalDimensions);
  }

  return {
    buffer,
    fileName,
    originalDimensions,
    finalDimensions,
    wasCropped,
    cropRegion,
    cssVariables,
  };
}

/**
 * Create CSS custom properties for image dimensions
 */
export function generateImageCSSVariables({
  width,
  height,
}: {
  width: number;
  height: number;
}): string {
  return `--original-width: ${width}px; --original-height: ${height}px;`;
}
