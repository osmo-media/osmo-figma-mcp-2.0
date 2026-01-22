# Figma MCP Server

Internal MCP server for Figma design data extraction. Optimized for motion graphics and precise design implementation.

## Features

- **Per-request authentication** - Supports both Personal Access Tokens (PAT) and OAuth tokens
- **Direct S3 uploads** - Images and screenshots automatically uploaded to S3 with permanent URLs
- **Design data extraction** - Simplified JSON structure optimized for AI code generation
- **Screenshot tool** - Capture visual references of Figma nodes
- **Motion graphics focused** - Preserves exact measurements for non-responsive layouts

## Quick Start

### Local Development

1. Install dependencies:
```bash
pnpm install
```

2. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
# Add your test credentials
```

3. Run tests:
```bash
pnpm test
```

4. Start server:
```bash
pnpm start
# Server runs on http://127.0.0.1:3333
```

### AWS Deployment

Deploy to EC2 in 4 simple steps:

```bash
cd deployment

# 1. Configure AWS CLI (one-time)
./1_configure_aws.sh

# 2. Launch EC2 instance
./2_launch_instance.sh
# Returns PUBLIC_IP

# 3. Deploy server
./3_deploy_code.sh <PUBLIC_IP>

# 4. Configure S3 credentials
./4_setup_s3.sh <PUBLIC_IP>
```

Server will be available at `http://<PUBLIC_IP>:3333`

## Available Tools

### `get_figma_data`
Fetches design data from Figma with embedded S3 image URLs.

**Parameters:**
- `fileKey` - Figma file key (from URL)
- `nodeId` - Optional specific node ID
- `figmaAccessToken` - PAT or OAuth token
- `downloadImages` - Auto-download images to S3 (default: true)
- `outputFormat` - `json` or `yaml` (default: json)

### `get_figma_screenshot`
Takes a screenshot of a Figma node and uploads to S3.

**Parameters:**
- `fileKey` - Figma file key
- `nodeId` - Node to screenshot
- `figmaAccessToken` - PAT or OAuth token
- `format` - `png`, `jpg`, or `svg` (default: png)
- `scale` - Export scale 0.5-4x (default: 2)

### `download_figma_images`
Supplementary tool for downloading specific images.

**Parameters:**
- `fileKey` - Figma file key
- `nodes` - Array of image nodes with metadata
- `figmaAccessToken` - PAT or OAuth token
- `pngScale` - Export scale (default: 2)

## Configuration

### Required Environment Variables (EC2)

```bash
# Server
NODE_ENV=production
PORT=3333

# S3 (for image uploads)
AWS_REGION=us-east-2
AWS_BUCKET_NAME=your-bucket
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

### Optional Variables

```bash
AWS_TRANSFER_ACCELERATION=false  # Enable S3 acceleration
HOST=0.0.0.0                     # Server bind address
```

## Architecture

- **Per-request auth** - No tokens stored on server
- **Direct S3 upload** - Images processed in memory, no local storage
- **Systemd service** - Auto-restart on failure
- **Ubuntu 24.04** - EC2 instances use latest LTS

## Development

```bash
# Run tests
pnpm test

# Build
pnpm build

# Type check
pnpm type-check

# Lint
pnpm lint
```

## License

MIT
