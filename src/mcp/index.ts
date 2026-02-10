import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Logger } from "../utils/logger.js";
import {
  downloadFigmaImagesTool,
  getFigmaDataTool,
  getFigmaScreenshotTool,
  type DownloadImagesParams,
  type GetFigmaDataParams,
  type GetFigmaScreenshotParams,
} from "./tools/index.js";

const serverInfo = {
  name: "Figma MCP Server",
  version: process.env.NPM_PACKAGE_VERSION ?? "unknown",
};

type CreateServerOptions = {
  isHTTP?: boolean;
};

/**
 * Creates an MCP server instance.
 *
 * Authentication and output format are handled per-request via tool parameters.
 * No server-level configuration is required.
 */
function createServer({ isHTTP = false }: CreateServerOptions = {}) {
  const server = new McpServer(serverInfo);
  registerTools(server);

  Logger.isHTTP = isHTTP;

  return server;
}

function registerTools(server: McpServer): void {
  // Register get_figma_data tool
  // Tool handles its own authentication and output format via parameters
  server.tool(
    getFigmaDataTool.name,
    getFigmaDataTool.description,
    getFigmaDataTool.parameters,
    (params: GetFigmaDataParams) => getFigmaDataTool.handler(params),
  );

  // Register download_figma_images tool
  // Tool handles its own authentication via figmaAccessToken parameter
  server.tool(
    downloadFigmaImagesTool.name,
    downloadFigmaImagesTool.description,
    downloadFigmaImagesTool.parameters,
    (params: DownloadImagesParams) => downloadFigmaImagesTool.handler(params),
  );

  // Register get_figma_screenshot tool
  // Takes a screenshot of a node and uploads to S3
  server.tool(
    getFigmaScreenshotTool.name,
    getFigmaScreenshotTool.description,
    getFigmaScreenshotTool.parameters,
    (params: GetFigmaScreenshotParams) => getFigmaScreenshotTool.handler(params),
  );
}

export { createServer };
