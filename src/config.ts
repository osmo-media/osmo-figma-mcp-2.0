import { config as loadEnv } from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { resolve } from "path";

interface ServerConfig {
  port: number;
  host: string;
  configSources: {
    port: "cli" | "env" | "default";
    host: "cli" | "env" | "default";
    envFile: "cli" | "default";
  };
}

interface CliArgs {
  env?: string;
  port?: number;
  host?: string;
}

/**
 * Gets server configuration from CLI arguments and environment variables.
 *
 * Note: Figma authentication is handled per-request via the `figmaAccessToken`
 * parameter in each tool call. No server-level authentication is configured here.
 *
 * Output format (JSON/YAML) is also handled per-request via tool parameters.
 */
export function getServerConfig(isStdioMode: boolean): ServerConfig {
  // Parse command line arguments
  const argv = yargs(hideBin(process.argv))
    .options({
      env: {
        type: "string",
        description: "Path to custom .env file to load environment variables from",
      },
      port: {
        type: "number",
        description: "Port to run the server on",
      },
      host: {
        type: "string",
        description: "Host to run the server on",
      },
    })
    .help()
    .version(process.env.NPM_PACKAGE_VERSION ?? "unknown")
    .parseSync() as CliArgs;

  // Load environment variables from custom path or default
  let envFilePath: string;
  let envFileSource: "cli" | "default";

  if (argv["env"]) {
    envFilePath = resolve(argv["env"]);
    envFileSource = "cli";
  } else {
    envFilePath = resolve(process.cwd(), ".env");
    envFileSource = "default";
  }

  // Override anything auto-loaded from .env if a custom file is provided.
  loadEnv({ path: envFilePath, override: true });

  const config: ServerConfig = {
    port: 3333,
    host: "127.0.0.1",
    configSources: {
      port: "default",
      host: "default",
      envFile: envFileSource,
    },
  };

  // Handle PORT (FRAMELINK_PORT takes precedence, PORT is fallback for backwards compatibility)
  if (argv.port) {
    config.port = argv.port;
    config.configSources.port = "cli";
  } else if (process.env.FRAMELINK_PORT) {
    config.port = parseInt(process.env.FRAMELINK_PORT, 10);
    config.configSources.port = "env";
  } else if (process.env.PORT) {
    config.port = parseInt(process.env.PORT, 10);
    config.configSources.port = "env";
  }

  // Handle HOST
  if (argv.host) {
    config.host = argv.host;
    config.configSources.host = "cli";
  } else if (process.env.FRAMELINK_HOST) {
    config.host = process.env.FRAMELINK_HOST;
    config.configSources.host = "env";
  }

  // Log configuration sources
  if (!isStdioMode) {
    console.log("\nConfiguration:");
    console.log(`- ENV_FILE: ${envFilePath} (source: ${config.configSources.envFile})`);
    console.log("- Authentication: Per-request (via figmaAccessToken parameter)");
    console.log("- Output format: Per-request (via outputFormat parameter, defaults to JSON)");
    console.log(`- PORT: ${config.port} (source: ${config.configSources.port})`);
    console.log(`- HOST: ${config.host} (source: ${config.configSources.host})`);
    console.log();
  }

  return config;
}
