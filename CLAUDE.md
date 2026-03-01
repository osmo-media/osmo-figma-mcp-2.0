# CLAUDE.md

## Project Overview

Figma Developer MCP (figma-developer-mcp) - An MCP server that gives AI coding agents access to Figma design data. Bridges Figma designs and code generation by simplifying Figma API responses for LLM consumption.

Forked from `figma-developer-mcp` (upstream: GLips/Figma-Context-MCP). Deployed to AWS EC2.

## Tech Stack

- **Language**: TypeScript 5.7 (strict mode, ES2022, ESM)
- **Runtime**: Node.js 20 (minimum 18.0.0)
- **Package Manager**: pnpm
- **Build**: tsup (ESM output, minified)
- **Test**: Jest with ts-jest
- **Lint/Format**: ESLint + Prettier (100 char width, 2 spaces, double quotes, trailing commas)
- **Versioning**: Changesets

## Key Commands

```bash
pnpm build          # Build to dist/
pnpm dev            # Dev server with watch mode (HTTP on localhost:3333)
pnpm dev:cli        # Dev in stdio mode
pnpm test           # Run tests
pnpm type-check     # tsc --noEmit
pnpm lint           # ESLint
pnpm format         # Prettier
pnpm inspect        # MCP inspector for debugging
```

## Architecture

Three MCP tools:
- `get_figma_data` - Fetches and simplifies Figma design data into structured nodes
- `download_figma_images` - Downloads, processes, and uploads images to S3
- `get_figma_screenshot` - Takes a screenshot of a Figma node and uploads to S3

Data flow: Figma API → parseAPIResponse → extractFromDesign (tree walk with extractors) → SimplifiedDesign (YAML/JSON)

### Directory Structure

- `src/mcp/` - MCP server setup and tool definitions
- `src/services/` - Figma API client
- `src/extractors/` - Pluggable design data extraction system
- `src/transformers/` - Layout, style, text, effects, component transformers
- `src/utils/` - Logger, fetch retry, image processing, S3 upload
- `src/tests/` - Integration and benchmark tests
- `deployment/` - AWS EC2 deployment scripts (3_deploy_code.sh)

### Key Types

- `SimplifiedNode` - Core output type for extracted design nodes
- `ExtractorFn` - Pluggable functions that modify nodes during tree traversal
- `SimplifiedLayout`, `SimplifiedFill`, `SimplifiedStroke`, `SimplifiedTextStyle`, `SimplifiedEffects`

## Conventions

- **Files**: kebab-case (`get-figma-data-tool.ts`)
- **Functions**: camelCase
- **Types/Interfaces**: PascalCase
- **Constants**: UPPER_SNAKE_CASE
- **Path alias**: `~/*` maps to `./src/*`
- **Barrel exports**: Each directory has `index.ts`
- **Validation**: Zod for runtime schema validation of tool parameters
- **Error handling**: Try-catch with descriptive messages, logger abstraction for HTTP vs CLI

## Philosophy

- Unix philosophy: tools have one job, few arguments
- Server focuses ONLY on design ingestion for AI consumption
- Out of scope: image manipulation, CMS syncing, code generation, third-party integrations
- Prefer CLI args over tool parameters for project-level config

## Environment Variables

- `FIGMA_API_KEY` (required for stdio mode) - Figma PAT or OAuth token
- `PORT` - HTTP server port (default: 3333)
- `OUTPUT_FORMAT` - "yaml" or "json" (default: "json")
- `SKIP_IMAGE_DOWNLOADS` - "true" to hide download tool
- `NODE_ENV` - "cli" for stdio, else HTTP mode
- `AWS_REGION`, `AWS_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` - S3 credentials for image/screenshot uploads

## Deployment

Deploy to EC2 via `bash deployment/3_deploy_code.sh <PUBLIC_IP>`. Requires `~/.ssh/mcp-server-key.pem` and local pnpm + Node 20+. The script builds, packages, uploads, and restarts the systemd service. S3 credentials are auto-injected from local `.env` if present.
