import { z } from "zod";
import type { GetFileResponse, GetFileNodesResponse } from "@figma/rest-api-spec";
import { FigmaService } from "~/services/figma.js";
import { Logger } from "~/utils/logger.js";

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
      "The ID of the node to fetch, often found as URL parameter node-id=<nodeId>. Use format '1234:5678'.",
    ),
  depth: z
    .number()
    .optional()
    .describe(
      "OPTIONAL. Controls how many levels deep to traverse the node tree.",
    ),
  figmaAccessToken: z
    .string()
    .describe(
      "User's Figma access token. Can be a Personal Access Token (PAT, starts with 'figd_') or OAuth token (starts with 'figu_'). Required for authentication.",
    ),
};

const parametersSchema = z.object(parameters);
export type GetRawFigmaApiParams = z.infer<typeof parametersSchema>;

/**
 * Handler for get_raw_figma_api tool.
 * Returns the raw, unprocessed Figma API response.
 */
async function getRawFigmaApi(params: GetRawFigmaApiParams) {
  try {
    const {
      fileKey,
      nodeId: rawNodeId,
      depth,
      figmaAccessToken,
    } = parametersSchema.parse(params);

    // Create FigmaService with per-request token
    const figmaService = new FigmaService({ accessToken: figmaAccessToken });

    // Replace - with : in nodeId for our query—Figma API expects :
    const nodeId = rawNodeId?.replace(/-/g, ":");

    Logger.log(
      `[RAW API] Fetching ${depth ? `${depth} layers deep` : "all layers"} of ${
        nodeId ? `node ${nodeId} from file` : `full file`
      } ${fileKey}`,
    );

    // Get raw Figma API response - NO processing, NO S3 uploads
    let rawApiResponse: GetFileResponse | GetFileNodesResponse;
    if (nodeId) {
      rawApiResponse = await figmaService.getRawNode(fileKey, nodeId, depth);
    } else {
      rawApiResponse = await figmaService.getRawFile(fileKey, depth);
    }

    Logger.log(`[RAW API] Returning unprocessed Figma API response`);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(rawApiResponse, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error(`[RAW API] Error fetching file ${params.fileKey}:`, message);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error fetching raw Figma API: ${message}` }],
    };
  }
}

// Export tool configuration
export const getRawFigmaApiTool = {
  name: "get_raw_figma_api",
  description:
    "ADVANCED: Get the raw, unprocessed Figma REST API response. WARNING: This returns a LARGE response body with Figma's native data structure - use sparingly. Does NOT include S3 image uploads or any processing. Only use this when you need specific Figma API fields not available in get_figma_data, or for debugging. For normal use cases, prefer get_figma_data which provides a cleaner, AI-optimized format with embedded image URLs.",
  parameters,
  handler: getRawFigmaApi,
} as const;
