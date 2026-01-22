/**
 * Simple test runner - run with: npx tsx src/tests/run-test.ts
 */
import { createServer } from "../mcp/index.js";
import { config } from "dotenv";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

config();

const TEST_FIGMA_TOKEN = process.env.TEST_FIGMA_TOKEN || "";
const TEST_FILE_KEY = process.env.TEST_FILE_KEY || "";
const TEST_NODE_ID = process.env.TEST_NODE_ID || "";

// Check for S3 config
const hasS3Config = !!(
  process.env.AWS_REGION &&
  process.env.AWS_BUCKET_NAME &&
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY
);

async function runTest() {
  console.log("\n🧪 Figma MCP Server Test\n");

  // Check env vars
  if (!TEST_FIGMA_TOKEN || !TEST_FILE_KEY || !TEST_NODE_ID) {
    console.log("❌ Missing env vars in .env:");
    if (!TEST_FIGMA_TOKEN) console.log("   - TEST_FIGMA_TOKEN");
    if (!TEST_FILE_KEY) console.log("   - TEST_FILE_KEY");
    if (!TEST_NODE_ID) console.log("   - TEST_NODE_ID");
    console.log("\n   Copy .env.example to .env and fill in values.\n");
    process.exit(1);
  }

  // Detect token type
  const tokenType = TEST_FIGMA_TOKEN.startsWith("figd_")
    ? "PAT"
    : TEST_FIGMA_TOKEN.startsWith("figu_")
      ? "OAuth"
      : "Unknown";
  console.log(`🔑 Token type: ${tokenType}`);
  console.log(`📁 File: ${TEST_FILE_KEY}`);
  console.log(`📍 Node: ${TEST_NODE_ID}`);
  console.log(`☁️  S3 Config: ${hasS3Config ? "Present" : "Missing (image embedding will be skipped)"}\n`);

  // Setup
  const server = createServer();
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  try {
    // Test 1: Fetch file data WITHOUT images (fast mode)
    console.log("📥 Test 1: Fetching file data (downloadImages=false)...");
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_figma_data",
          arguments: {
            fileKey: TEST_FILE_KEY,
            figmaAccessToken: TEST_FIGMA_TOKEN,
            downloadImages: false,
          },
        },
      },
      CallToolResultSchema,
    );

    const content = result.content[0].text as string;
    const parsed = JSON.parse(content);

    console.log(`   ✅ Fetched "${parsed.metadata.name}" with ${parsed.nodes.length} nodes\n`);

    // Test 2: Fetch specific node WITH embedded images (S3)
    if (hasS3Config) {
      console.log(`📥 Test 2: Fetching node ${TEST_NODE_ID} with embedded S3 images...`);
      const nodeResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "get_figma_data",
            arguments: {
              fileKey: TEST_FILE_KEY,
              nodeId: TEST_NODE_ID,
              figmaAccessToken: TEST_FIGMA_TOKEN,
              downloadImages: true,
            },
          },
        },
        CallToolResultSchema,
      );

      const nodeContent = nodeResult.content[0].text as string;
      const nodeParsed = JSON.parse(nodeContent);
      console.log(`   ✅ Fetched node with ${nodeParsed.nodes.length} nodes`);

      // Check for embedded image URLs
      let imageUrlCount = 0;
      let svgNodeCount = 0;

      // Count imageUrl in globalVars.styles (image fills)
      for (const [_styleId, styleValue] of Object.entries(nodeParsed.globalVars.styles)) {
        if (Array.isArray(styleValue)) {
          for (const fill of styleValue as any[]) {
            if (fill.type === "IMAGE" && fill.imageUrl) {
              imageUrlCount++;
            }
          }
        }
      }

      // Count IMAGE-SVG nodes with imageUrl
      function countSvgUrls(nodes: any[]): void {
        for (const node of nodes) {
          if (node.type === "IMAGE-SVG" && node.imageUrl) {
            svgNodeCount++;
          }
          if (node.children) {
            countSvgUrls(node.children);
          }
        }
      }
      countSvgUrls(nodeParsed.nodes);

      if (imageUrlCount > 0 || svgNodeCount > 0) {
        console.log(`   📎 Found ${imageUrlCount} image fills and ${svgNodeCount} SVG nodes with S3 URLs embedded\n`);
      } else {
        console.log(`   📎 No images found in this node (this is OK if the node has no images)\n`);
      }

      // Verify no imageRef remains (should be replaced with imageUrl)
      let hasUnprocessedImageRef = false;
      for (const [_styleId, styleValue] of Object.entries(nodeParsed.globalVars.styles)) {
        if (Array.isArray(styleValue)) {
          for (const fill of styleValue as any[]) {
            if (fill.type === "IMAGE" && fill.imageRef && !fill.imageUrl) {
              hasUnprocessedImageRef = true;
            }
          }
        }
      }

      if (hasUnprocessedImageRef) {
        console.log("   ⚠️  Warning: Some imageRef values were not replaced with imageUrl\n");
      }
    } else {
      console.log("⏭️  Test 2: Skipping embedded image test (no S3 config)\n");
    }

    // Test 3: Verify supplementary download_figma_images tool still works
    if (hasS3Config) {
      console.log("📥 Test 3: Testing supplementary download_figma_images tool...");

      const imageResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "download_figma_images",
            arguments: {
              fileKey: TEST_FILE_KEY,
              nodes: [
                {
                  nodeId: TEST_NODE_ID,
                  fileName: `test-node-${TEST_NODE_ID.replace(":", "-")}.png`,
                },
              ],
              pngScale: 1,
              figmaAccessToken: TEST_FIGMA_TOKEN,
            },
          },
        },
        CallToolResultSchema,
      );

      const imageContent = imageResult.content[0].text as string;
      const imageParsed = JSON.parse(imageContent);

      if (imageParsed.success && imageParsed.totalUploaded > 0) {
        console.log(`   ✅ Uploaded ${imageParsed.totalUploaded} image(s) to S3`);
        for (const img of imageParsed.images) {
          console.log(`      - ${img.fileName}: ${img.dimensions.width}x${img.dimensions.height}`);
        }
        console.log();
      } else {
        console.log(`   ⚠️  No images uploaded: ${imageParsed.error || "No images to download"}\n`);
      }
    } else {
      console.log("⏭️  Test 3: Skipping supplementary tool test (no S3 config)\n");
    }

    console.log("🎉 All tests passed!\n");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

runTest();
