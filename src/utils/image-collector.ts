import type { SimplifiedDesign, SimplifiedNode, GlobalVars } from "~/extractors/types.js";
import type { SimplifiedFill, SimplifiedImageFill } from "~/transformers/style.js";
import { Logger } from "./logger.js";

/**
 * Collected image information for batch processing
 */
export type ImageCollectionResult = {
  /** Map of imageRef -> processing metadata for image fills */
  imageFills: Map<string, ImageFillInfo>;
  /** Array of node IDs that are IMAGE-SVG type */
  svgNodeIds: string[];
};

export type ImageFillInfo = {
  imageRef: string;
  needsCropping: boolean;
  cropTransform?: number[][];
  requiresImageDimensions: boolean;
  filenameSuffix?: string;
};

/**
 * Collect all image references from a SimplifiedDesign.
 * Walks through globalVars.styles to find IMAGE fills and
 * walks through nodes to find IMAGE-SVG nodes.
 */
export function collectImageReferences(design: SimplifiedDesign): ImageCollectionResult {
  const imageFills = new Map<string, ImageFillInfo>();
  const svgNodeIds: string[] = [];

  // Collect image fills from globalVars.styles
  for (const [_styleId, styleValue] of Object.entries(design.globalVars.styles)) {
    // Check if it's an array (fills are stored as arrays)
    if (Array.isArray(styleValue)) {
      for (const fill of styleValue as SimplifiedFill[]) {
        if (isImageFill(fill) && fill.imageRef) {
          // Use imageRef + suffix as unique key to handle different crops
          const uniqueKey = fill.imageDownloadArguments?.filenameSuffix
            ? `${fill.imageRef}-${fill.imageDownloadArguments.filenameSuffix}`
            : fill.imageRef;

          if (!imageFills.has(uniqueKey)) {
            imageFills.set(uniqueKey, {
              imageRef: fill.imageRef,
              needsCropping: fill.imageDownloadArguments?.needsCropping ?? false,
              cropTransform: fill.imageDownloadArguments?.cropTransform as number[][] | undefined,
              requiresImageDimensions: fill.imageDownloadArguments?.requiresImageDimensions ?? false,
              filenameSuffix: fill.imageDownloadArguments?.filenameSuffix,
            });
          }
        }
      }
    }
  }

  // Collect SVG nodes recursively
  collectSvgNodesRecursive(design.nodes, svgNodeIds);

  Logger.log(`Collected ${imageFills.size} image fills and ${svgNodeIds.length} SVG nodes`);

  return { imageFills, svgNodeIds };
}

/**
 * Recursively collect IMAGE-SVG node IDs from the node tree
 */
function collectSvgNodesRecursive(nodes: SimplifiedNode[], result: string[]): void {
  for (const node of nodes) {
    if (node.type === "IMAGE-SVG") {
      result.push(node.id);
    }
    if (node.children) {
      collectSvgNodesRecursive(node.children, result);
    }
  }
}

/**
 * Type guard to check if a fill is an image fill
 */
function isImageFill(fill: SimplifiedFill): fill is SimplifiedImageFill {
  return typeof fill === "object" && fill !== null && "type" in fill && fill.type === "IMAGE";
}

/**
 * Inject S3 URLs into a SimplifiedDesign, replacing imageRef with imageUrl.
 * Also removes imageDownloadArguments as they're no longer needed.
 *
 * @param design - The design to mutate
 * @param urlMap - Map of (imageRef or nodeId) -> S3 URL
 */
export function injectImageUrls(
  design: SimplifiedDesign,
  urlMap: Map<string, string>,
): void {
  // Inject URLs into globalVars.styles (image fills)
  for (const [_styleId, styleValue] of Object.entries(design.globalVars.styles)) {
    if (Array.isArray(styleValue)) {
      for (const fill of styleValue as SimplifiedFill[]) {
        if (isImageFill(fill) && fill.imageRef) {
          // Build the lookup key (same logic as collection)
          const uniqueKey = fill.imageDownloadArguments?.filenameSuffix
            ? `${fill.imageRef}-${fill.imageDownloadArguments.filenameSuffix}`
            : fill.imageRef;

          const s3Url = urlMap.get(uniqueKey);
          if (s3Url) {
            // Add imageUrl and remove imageRef + processing metadata
            (fill as any).imageUrl = s3Url;
            delete (fill as any).imageRef;
            delete (fill as any).imageDownloadArguments;
          }
        }
      }
    }
  }

  // Inject URLs into IMAGE-SVG nodes
  injectSvgUrlsRecursive(design.nodes, urlMap);

  Logger.log(`Injected ${urlMap.size} image URLs into design`);
}

/**
 * Recursively inject imageUrl into IMAGE-SVG nodes
 */
function injectSvgUrlsRecursive(nodes: SimplifiedNode[], urlMap: Map<string, string>): void {
  for (const node of nodes) {
    if (node.type === "IMAGE-SVG") {
      const s3Url = urlMap.get(node.id);
      if (s3Url) {
        (node as any).imageUrl = s3Url;
      }
    }
    if (node.children) {
      injectSvgUrlsRecursive(node.children, urlMap);
    }
  }
}
