import type {
  GetImagesResponse,
  GetFileResponse,
  GetFileNodesResponse,
  GetImageFillsResponse,
} from "@figma/rest-api-spec";
import {
  downloadAndProcessImageToBuffer,
  type BufferProcessingResult,
} from "~/utils/image-processing.js";
import { uploadBufferToS3, getS3ConfigFromEnv, type S3Config } from "~/utils/s3-upload.js";
import { Logger, writeLogs } from "~/utils/logger.js";
import { fetchWithRetry } from "~/utils/fetch-with-retry.js";

/**
 * Authentication options for FigmaService.
 * Accepts a single token that works for both Personal Access Tokens (PAT) and OAuth tokens.
 * The service auto-detects the token type based on its format.
 */
export type FigmaAuthOptions = {
  /** Figma access token - can be either a Personal Access Token or OAuth token */
  accessToken: string;
};

type SvgOptions = {
  outlineText: boolean;
  includeId: boolean;
  simplifyStroke: boolean;
};

export type S3UploadedImage = {
  fileName: string;
  s3Url: string;
  dimensions: { width: number; height: number };
  wasCropped: boolean;
  cssVariables?: string;
};

export class FigmaService {
  private readonly accessToken: string;
  private readonly isOAuthToken: boolean;
  private readonly baseUrl = "https://api.figma.com/v1";

  constructor({ accessToken }: FigmaAuthOptions) {
    this.accessToken = accessToken;
    // PAT tokens start with "figd_", OAuth tokens start with "figu_"
    // Both can be used with Bearer auth, but we log the type for debugging
    this.isOAuthToken = accessToken.startsWith("figu_");
  }

  private getAuthHeaders(): Record<string, string> {
    // Figma API accepts both token types with Bearer auth
    // OAuth tokens: Authorization: Bearer figd_xxx
    // PATs: Can use either X-Figma-Token or Bearer auth
    // Using Bearer for both is simpler and works universally
    Logger.log(`Using ${this.isOAuthToken ? "OAuth" : "Personal Access"} token for authentication`);
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  /**
   * Filters out null values from Figma image responses. This ensures we only work with valid image URLs.
   */
  private filterValidImages(
    images: { [key: string]: string | null } | undefined,
  ): Record<string, string> {
    if (!images) return {};
    return Object.fromEntries(Object.entries(images).filter(([, value]) => !!value)) as Record<
      string,
      string
    >;
  }

  private async request<T>(endpoint: string): Promise<T> {
    try {
      Logger.log(`Calling ${this.baseUrl}${endpoint}`);
      const headers = this.getAuthHeaders();

      return await fetchWithRetry<T & { status?: number }>(`${this.baseUrl}${endpoint}`, {
        headers,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to make request to Figma API endpoint '${endpoint}': ${errorMessage}`,
      );
    }
  }

  /**
   * Builds URL query parameters for SVG image requests.
   */
  private buildSvgQueryParams(svgIds: string[], svgOptions: SvgOptions): string {
    const params = new URLSearchParams({
      ids: svgIds.join(","),
      format: "svg",
      svg_outline_text: String(svgOptions.outlineText),
      svg_include_id: String(svgOptions.includeId),
      svg_simplify_stroke: String(svgOptions.simplifyStroke),
    });
    return params.toString();
  }

  /**
   * Gets download URLs for image fills without downloading them.
   *
   * @returns Map of imageRef to download URL
   */
  async getImageFillUrls(fileKey: string): Promise<Record<string, string>> {
    const endpoint = `/files/${fileKey}/images`;
    const response = await this.request<GetImageFillsResponse>(endpoint);
    return response.meta.images || {};
  }

  /**
   * Gets download URLs for rendered nodes without downloading them.
   *
   * @returns Map of node ID to download URL
   */
  async getNodeRenderUrls(
    fileKey: string,
    nodeIds: string[],
    format: "png" | "svg",
    options: { pngScale?: number; svgOptions?: SvgOptions } = {},
  ): Promise<Record<string, string>> {
    if (nodeIds.length === 0) return {};

    if (format === "png") {
      const scale = options.pngScale || 2;
      const endpoint = `/images/${fileKey}?ids=${nodeIds.join(",")}&format=png&scale=${scale}`;
      const response = await this.request<GetImagesResponse>(endpoint);
      return this.filterValidImages(response.images);
    } else {
      const svgOptions = options.svgOptions || {
        outlineText: true,
        includeId: false,
        simplifyStroke: true,
      };
      const params = this.buildSvgQueryParams(nodeIds, svgOptions);
      const endpoint = `/images/${fileKey}?${params}`;
      const response = await this.request<GetImagesResponse>(endpoint);
      return this.filterValidImages(response.images);
    }
  }

  /**
   * Download images and upload directly to S3 (no local filesystem required).
   *
   * Supports:
   * - Image fills vs rendered nodes (based on imageRef vs nodeId)
   * - PNG vs SVG format (based on filename extension)
   * - Image cropping based on transform matrices
   * - CSS variable generation for image dimensions
   *
   * @returns Array of S3 URLs for successfully uploaded images
   */
  async downloadAndUploadImages(
    fileKey: string,
    items: Array<{
      imageRef?: string;
      nodeId?: string;
      fileName: string;
      needsCropping?: boolean;
      cropTransform?: any;
      requiresImageDimensions?: boolean;
    }>,
    options: { pngScale?: number; svgOptions?: SvgOptions } = {},
  ): Promise<S3UploadedImage[]> {
    if (items.length === 0) return [];

    // Get S3 config from environment - required
    const s3Config = getS3ConfigFromEnv();
    if (!s3Config) {
      throw new Error(
        "S3 configuration not found. Required environment variables: AWS_REGION, AWS_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY",
      );
    }

    const { pngScale = 2, svgOptions } = options;

    // Separate items by type
    const imageFills = items.filter(
      (item): item is typeof item & { imageRef: string } => !!item.imageRef,
    );
    const renderNodes = items.filter(
      (item): item is typeof item & { nodeId: string } => !!item.nodeId,
    );

    // Collect all download jobs
    const downloadJobs: Array<{
      fileName: string;
      imageUrl: string;
      needsCropping?: boolean;
      cropTransform?: any;
      requiresImageDimensions?: boolean;
    }> = [];

    // Get URLs for image fills
    if (imageFills.length > 0) {
      const fillUrls = await this.getImageFillUrls(fileKey);
      for (const fill of imageFills) {
        const imageUrl = fillUrls[fill.imageRef];
        if (imageUrl) {
          downloadJobs.push({
            fileName: fill.fileName,
            imageUrl,
            needsCropping: fill.needsCropping,
            cropTransform: fill.cropTransform,
            requiresImageDimensions: fill.requiresImageDimensions,
          });
        } else {
          Logger.log(`No URL found for imageRef: ${fill.imageRef}`);
        }
      }
    }

    // Get URLs for rendered nodes
    if (renderNodes.length > 0) {
      const pngNodes = renderNodes.filter((node) => !node.fileName.toLowerCase().endsWith(".svg"));
      const svgNodes = renderNodes.filter((node) => node.fileName.toLowerCase().endsWith(".svg"));

      if (pngNodes.length > 0) {
        const pngUrls = await this.getNodeRenderUrls(
          fileKey,
          pngNodes.map((n) => n.nodeId),
          "png",
          { pngScale },
        );
        for (const node of pngNodes) {
          const imageUrl = pngUrls[node.nodeId];
          if (imageUrl) {
            downloadJobs.push({
              fileName: node.fileName,
              imageUrl,
              needsCropping: node.needsCropping,
              cropTransform: node.cropTransform,
              requiresImageDimensions: node.requiresImageDimensions,
            });
          } else {
            Logger.log(`No URL found for node: ${node.nodeId}`);
          }
        }
      }

      if (svgNodes.length > 0) {
        const svgOpts = svgOptions || {
          outlineText: true,
          includeId: false,
          simplifyStroke: true,
        };
        const svgUrls = await this.getNodeRenderUrls(
          fileKey,
          svgNodes.map((n) => n.nodeId),
          "svg",
          { svgOptions: svgOpts },
        );
        for (const node of svgNodes) {
          const imageUrl = svgUrls[node.nodeId];
          if (imageUrl) {
            downloadJobs.push({
              fileName: node.fileName,
              imageUrl,
              needsCropping: node.needsCropping,
              cropTransform: node.cropTransform,
              requiresImageDimensions: node.requiresImageDimensions,
            });
          } else {
            Logger.log(`No URL found for SVG node: ${node.nodeId}`);
          }
        }
      }
    }

    // Process all downloads in parallel: download -> process -> upload to S3
    const results = await Promise.allSettled(
      downloadJobs.map(async (job) => {
        // Download and process in memory
        const processed = await downloadAndProcessImageToBuffer(
          job.fileName,
          job.imageUrl,
          job.needsCropping,
          job.cropTransform,
          job.requiresImageDimensions,
        );

        // Upload buffer directly to S3
        const s3Result = await uploadBufferToS3(processed.buffer, processed.fileName, s3Config);

        return {
          fileName: processed.fileName,
          s3Url: s3Result.url,
          dimensions: processed.finalDimensions,
          wasCropped: processed.wasCropped,
          cssVariables: processed.cssVariables,
        } as S3UploadedImage;
      }),
    );

    // Filter successful results
    const successfulResults: S3UploadedImage[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        successfulResults.push(result.value);
      } else {
        Logger.error("Failed to process/upload image:", result.reason);
      }
    }

    return successfulResults;
  }

  /**
   * Process all images in a design: download from Figma, process (crop if needed), upload to S3.
   * Returns a map of (imageRef or nodeId) -> S3 URL for injection into the design.
   *
   * @param fileKey - Figma file key
   * @param imageFills - Map of unique key -> image fill info (from collectImageReferences)
   * @param svgNodeIds - Array of node IDs for IMAGE-SVG nodes
   * @param options - Processing options (pngScale)
   * @returns Map of unique key (imageRef or nodeId) -> S3 URL
   */
  async processDesignImages(
    fileKey: string,
    imageFills: Map<string, { imageRef: string; needsCropping: boolean; cropTransform?: number[][]; requiresImageDimensions: boolean; filenameSuffix?: string }>,
    svgNodeIds: string[],
    options: { pngScale?: number } = {},
  ): Promise<Map<string, string>> {
    const urlMap = new Map<string, string>();
    const { pngScale = 2 } = options;

    // Get S3 config - if not available, return empty map (caller handles gracefully)
    const s3Config = getS3ConfigFromEnv();
    if (!s3Config) {
      Logger.log("S3 configuration not found, skipping image processing");
      return urlMap;
    }

    const downloadJobs: Array<{
      uniqueKey: string;
      fileName: string;
      imageUrl: string;
      needsCropping: boolean;
      cropTransform?: number[][];
      requiresImageDimensions: boolean;
    }> = [];

    // Get URLs for image fills
    if (imageFills.size > 0) {
      const fillUrls = await this.getImageFillUrls(fileKey);
      for (const [uniqueKey, info] of imageFills) {
        const imageUrl = fillUrls[info.imageRef];
        if (imageUrl) {
          // Generate filename from imageRef (use suffix if present for uniqueness)
          const fileName = info.filenameSuffix
            ? `${info.imageRef.substring(0, 8)}-${info.filenameSuffix}.png`
            : `${info.imageRef.substring(0, 8)}.png`;

          downloadJobs.push({
            uniqueKey,
            fileName,
            imageUrl,
            needsCropping: info.needsCropping,
            cropTransform: info.cropTransform,
            requiresImageDimensions: info.requiresImageDimensions,
          });
        } else {
          Logger.log(`No URL found for imageRef: ${info.imageRef}`);
        }
      }
    }

    // Get URLs for SVG nodes
    if (svgNodeIds.length > 0) {
      const svgUrls = await this.getNodeRenderUrls(fileKey, svgNodeIds, "svg");
      for (const nodeId of svgNodeIds) {
        const imageUrl = svgUrls[nodeId];
        if (imageUrl) {
          // Generate filename from nodeId
          const fileName = `${nodeId.replace(/:/g, "-")}.svg`;
          downloadJobs.push({
            uniqueKey: nodeId,
            fileName,
            imageUrl,
            needsCropping: false,
            requiresImageDimensions: false,
          });
        } else {
          Logger.log(`No URL found for SVG node: ${nodeId}`);
        }
      }
    }

    if (downloadJobs.length === 0) {
      return urlMap;
    }

    Logger.log(`Processing ${downloadJobs.length} images for S3 upload...`);

    // Process all downloads in parallel
    const results = await Promise.allSettled(
      downloadJobs.map(async (job) => {
        const processed = await downloadAndProcessImageToBuffer(
          job.fileName,
          job.imageUrl,
          job.needsCropping,
          job.cropTransform,
          job.requiresImageDimensions,
        );

        const s3Result = await uploadBufferToS3(processed.buffer, processed.fileName, s3Config);

        return {
          uniqueKey: job.uniqueKey,
          s3Url: s3Result.url,
        };
      }),
    );

    // Build URL map from successful results
    for (const result of results) {
      if (result.status === "fulfilled") {
        urlMap.set(result.value.uniqueKey, result.value.s3Url);
      } else {
        Logger.error("Failed to process image:", result.reason);
      }
    }

    Logger.log(`Successfully processed ${urlMap.size}/${downloadJobs.length} images`);

    return urlMap;
  }

  /**
   * Get raw Figma API response for a file (for use with flexible extractors)
   */
  async getRawFile(fileKey: string, depth?: number | null): Promise<GetFileResponse> {
    const endpoint = `/files/${fileKey}${depth ? `?depth=${depth}` : ""}`;
    Logger.log(`Retrieving raw Figma file: ${fileKey} (depth: ${depth ?? "default"})`);

    const response = await this.request<GetFileResponse>(endpoint);
    writeLogs("figma-raw.json", response);

    return response;
  }

  /**
   * Get raw Figma API response for specific nodes (for use with flexible extractors)
   */
  async getRawNode(
    fileKey: string,
    nodeId: string,
    depth?: number | null,
  ): Promise<GetFileNodesResponse> {
    const endpoint = `/files/${fileKey}/nodes?ids=${nodeId}${depth ? `&depth=${depth}` : ""}`;
    Logger.log(
      `Retrieving raw Figma node: ${nodeId} from ${fileKey} (depth: ${depth ?? "default"})`,
    );

    const response = await this.request<GetFileNodesResponse>(endpoint);
    writeLogs("figma-raw.json", response);

    return response;
  }
}
