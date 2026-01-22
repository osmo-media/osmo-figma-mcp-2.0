import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Logger } from "../utils/logger.js";
import {
  downloadFigmaImagesTool,
  getFigmaDataTool,
  type DownloadImagesParams,
  type GetFigmaDataParams,
} from "./tools/index.js";

const serverInfo = {
  name: "Figma MCP Server",
  version: process.env.NPM_PACKAGE_VERSION ?? "unknown",
};

type CreateServerOptions = {
  isHTTP?: boolean;
  outputFormat?: "yaml" | "json";
  skipImageDownloads?: boolean;
};

/**
 * Creates an MCP server instance.
 * 
 * Authentication is handled per-request via the `figmaAccessToken` parameter
 * in each tool call. No server-level authentication is required.
 */
function createServer(
  { isHTTP = false, outputFormat = "yaml", skipImageDownloads = false }: CreateServerOptions = {},
) {
  const server = new McpServer(serverInfo);
  registerTools(server, { outputFormat, skipImageDownloads });

  Logger.isHTTP = isHTTP;

  return server;
}

function registerTools(
  server: McpServer,
  options: {
    outputFormat: "yaml" | "json";
    skipImageDownloads: boolean;
  },
): void {
  // Register get_figma_data tool
  // Tool handles its own authentication via figmaAccessToken parameter
  server.tool(
    getFigmaDataTool.name,
    getFigmaDataTool.description,
    getFigmaDataTool.parameters,
    (params: GetFigmaDataParams) => getFigmaDataTool.handler(params, options.outputFormat),
  );

  // Register download_figma_images tool if not disabled
  // Tool handles its own authentication via figmaAccessToken parameter
  if (!options.skipImageDownloads) {
    server.tool(
      downloadFigmaImagesTool.name,
      downloadFigmaImagesTool.description,
      downloadFigmaImagesTool.parameters,
      (params: DownloadImagesParams) => downloadFigmaImagesTool.handler(params),
    );
  }
}

export { createServer };
