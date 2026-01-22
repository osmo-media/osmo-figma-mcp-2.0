import { z } from "zod";
import { FigmaService } from "../../services/figma.js";
import { Logger } from "../../utils/logger.js";

const parameters = {
  fileKey: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
    .describe("The key of the Figma file containing the node to screenshot."),
  nodeId: z
    .string()
    .regex(
      /^I?\d+[:|-]\d+(?:;\d+[:|-]\d+)*$/,
      "Node ID must be like '1234:5678' or 'I5666:180910;1:10515;1:10336'",
    )
    .describe(
      "The ID of the node to screenshot. Can be a frame, component, group, or any renderable node.",
    ),
  figmaAccessToken: z
    .string()
    .describe(
      "User's Figma access token. Can be a Personal Access Token (PAT, starts with 'figd_') or OAuth token (starts with 'figu_'). Required for authentication.",
    ),
  scale: z
    .number()
    .min(0.5)
    .max(4)
    .optional()
    .default(2)
    .describe(
      "Export scale for the screenshot (0.5-4). Default: 2. Higher values produce larger, more detailed images.",
    ),
  format: z
    .enum(["png", "svg"])
    .optional()
    .default("png")
    .describe(
      "Image format. 'png' for raster images (default), 'svg' for vector graphics.",
    ),
};

const parametersSchema = z.object(parameters);
export type GetFigmaScreenshotParams = z.infer<typeof parametersSchema>;

/**
 * Handler for get_figma_screenshot tool.
 * Takes a screenshot of a Figma node and uploads it to S3.
 */
async function getFigmaScreenshot(params: GetFigmaScreenshotParams) {
  try {
    const {
      fileKey,
      nodeId: rawNodeId,
      figmaAccessToken,
      scale = 2,
      format = "png",
    } = parametersSchema.parse(params);

    // Replace - with : in nodeId for Figma API
    const nodeId = rawNodeId.replace(/-/g, ":");

    // Create FigmaService with per-request token
    const figmaService = new FigmaService({ accessToken: figmaAccessToken });

    // Take screenshot and upload to S3
    const result = await figmaService.screenshotToS3(fileKey, nodeId, {
      format,
      scale,
    });

    const response = {
      success: true,
      nodeId: rawNodeId,
      s3Url: result.s3Url,
      dimensions: result.dimensions,
      format: result.format,
      scale: result.scale,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.error(`Error taking screenshot of node ${params.nodeId}:`, message);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: false,
              error: message,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}

// Export tool configuration
export const getFigmaScreenshotTool = {
  name: "get_figma_screenshot",
  description:
    "Take a screenshot of a Figma node and upload it to S3. Returns a permanent S3 URL showing the exact visual appearance of the design. Use this as the PRIMARY VISUAL REFERENCE when generating code - the screenshot is the source of truth for how the design should look.",
  parameters,
  handler: getFigmaScreenshot,
} as const;
