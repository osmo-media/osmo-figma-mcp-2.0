import { z } from "zod";
import type { GetFileResponse, GetFileNodesResponse } from "@figma/rest-api-spec";
import { FigmaService } from "~/services/figma.js";
import {
  simplifyRawFigmaObject,
  allExtractors,
  collapseSvgContainers,
} from "~/extractors/index.js";
import { collectImageReferences, injectImageUrls } from "~/utils/image-collector.js";
import { getS3ConfigFromEnv } from "~/utils/s3-upload.js";
import yaml from "js-yaml";
import { Logger, writeLogs } from "~/utils/logger.js";

const parameters = {
  fileKey: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
    .describe(
      "The key of the Figma file to fetch, often found in a provided URL like figma.com/(file|design)/<fileKey>/...",
    ),
  nodeId: z
    .string()
    .regex(
      /^I?\d+[:|-]\d+(?:;\d+[:|-]\d+)*$/,
      "Node ID must be like '1234:5678' or 'I5666:180910;1:10515;1:10336'",
    )
    .optional()
    .describe(
      "The ID of the node to fetch, often found as URL parameter node-id=<nodeId>, always use if provided. Use format '1234:5678' or 'I5666:180910;1:10515;1:10336' for multiple nodes.",
    ),
  depth: z
    .number()
    .optional()
    .describe(
      "OPTIONAL. Do NOT use unless explicitly requested by the user. Controls how many levels deep to traverse the node tree.",
    ),
  figmaAccessToken: z
    .string()
    .describe(
      "User's Figma access token. Can be a Personal Access Token (PAT, starts with 'figd_') or OAuth token (starts with 'figu_'). Required for authentication.",
    ),
  outputFormat: z
    .enum(["json", "yaml"])
    .optional()
    .default("json")
    .describe(
      "Output format. Defaults to 'json' which is recommended for LLMs. Use 'yaml' for more compact human-readable output.",
    ),
  downloadImages: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "When true, automatically downloads all images and embeds S3 URLs in the response. Set to false for faster responses when images are not needed. Requires AWS S3 configuration.",
    ),
};

const parametersSchema = z.object(parameters);
export type GetFigmaDataParams = z.infer<typeof parametersSchema>;

/**
 * Handler for get_figma_data tool.
 * Creates a FigmaService instance per-request using the provided access token.
 */
async function getFigmaData(params: GetFigmaDataParams) {
  try {
    const {
      fileKey,
      nodeId: rawNodeId,
      depth,
      figmaAccessToken,
      outputFormat,
      downloadImages,
    } = parametersSchema.parse(params);

    // Create FigmaService with per-request token
    const figmaService = new FigmaService({ accessToken: figmaAccessToken });

    // Replace - with : in nodeId for our query—Figma API expects :
    const nodeId = rawNodeId?.replace(/-/g, ":");

    Logger.log(
      `Fetching ${depth ? `${depth} layers deep` : "all layers"} of ${
        nodeId ? `node ${nodeId} from file` : `full file`
      } ${fileKey}`,
    );

    // Get raw Figma API response
    let rawApiResponse: GetFileResponse | GetFileNodesResponse;
    if (nodeId) {
      rawApiResponse = await figmaService.getRawNode(fileKey, nodeId, depth);
    } else {
      rawApiResponse = await figmaService.getRawFile(fileKey, depth);
    }

    // Use unified design extraction (handles nodes + components consistently)
    const simplifiedDesign = simplifyRawFigmaObject(rawApiResponse, allExtractors, {
      maxDepth: depth,
      afterChildren: collapseSvgContainers,
    });

    writeLogs("figma-simplified.json", simplifiedDesign);

    Logger.log(
      `Successfully extracted data: ${simplifiedDesign.nodes.length} nodes, ${
        Object.keys(simplifiedDesign.globalVars.styles).length
      } styles`,
    );

    // Process images if requested and S3 is configured
    let imageWarning: string | undefined;
    if (downloadImages) {
      const s3Config = getS3ConfigFromEnv();
      if (s3Config) {
        // Collect all image references
        const { imageFills, svgNodeIds } = collectImageReferences(simplifiedDesign);

        if (imageFills.size > 0 || svgNodeIds.length > 0) {
          // Process and upload to S3
          const urlMap = await figmaService.processDesignImages(
            fileKey,
            imageFills,
            svgNodeIds,
            { pngScale: 2 },
          );

          // Inject S3 URLs into the design
          if (urlMap.size > 0) {
            injectImageUrls(simplifiedDesign, urlMap);
            Logger.log(`Embedded ${urlMap.size} image URLs in response`);
          }
        } else {
          Logger.log("No images found in design");
        }
      } else {
        imageWarning = "S3 configuration not found. Images not processed. Set AWS_REGION, AWS_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY to enable.";
        Logger.log(imageWarning);
      }
    }

    const { nodes, globalVars, ...metadata } = simplifiedDesign;
    const result = {
      metadata: {
        ...metadata,
        ...(imageWarning ? { imageWarning } : {}),
      },
      nodes,
      globalVars,
    };

    Logger.log(`Generating ${outputFormat.toUpperCase()} result from extracted data`);
    const formattedResult =
      outputFormat === "json" ? JSON.stringify(result, null, 2) : yaml.dump(result);

    Logger.log("Sending result to client");
    return {
      content: [{ type: "text" as const, text: formattedResult }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error(`Error fetching file ${params.fileKey}:`, message);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error fetching file: ${message}` }],
    };
  }
}

// Export tool configuration
export const getFigmaDataTool = {
  name: "get_figma_data",
  description:
    "Get comprehensive Figma design data with EXACT measurements, layout, colors, typography, and components. Automatically downloads all images/fills and embeds S3 URLs directly in the JSON. Returns precise pixel values, hex colors, font properties, spacing, and positioning. RECOMMENDED WORKFLOW: (1) Call get_figma_screenshot for visual reference, (2) Call this with downloadImages=true for measurements + embedded images, (3) Use screenshot as visual source of truth and this JSON for precise pixel values when generating code.",
  parameters,
  handler: getFigmaData,
} as const;
