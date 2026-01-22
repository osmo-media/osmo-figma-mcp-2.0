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
  console.log(`📍 Node: ${TEST_NODE_ID}\n`);

  // Setup
  const server = createServer();
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  try {
    // Test 1: Fetch file data
    console.log("📥 Fetching file data...");
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_figma_data",
          arguments: {
            fileKey: TEST_FILE_KEY,
            figmaAccessToken: TEST_FIGMA_TOKEN,
          },
        },
      },
      CallToolResultSchema,
    );

    const content = result.content[0].text as string;
    const parsed = JSON.parse(content);

    console.log(`   ✅ Fetched "${parsed.metadata.name}" with ${parsed.nodes.length} nodes\n`);

    // Test 2: Fetch specific node
    console.log(`📥 Fetching node ${TEST_NODE_ID}...`);
    const nodeResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_figma_data",
          arguments: {
            fileKey: TEST_FILE_KEY,
            nodeId: TEST_NODE_ID,
            figmaAccessToken: TEST_FIGMA_TOKEN,
          },
        },
      },
      CallToolResultSchema,
    );

    const nodeContent = nodeResult.content[0].text as string;
    const nodeParsed = JSON.parse(nodeContent);
    console.log(`   ✅ Fetched node with ${nodeParsed.nodes.length} nodes\n`);

    console.log("🎉 All tests passed!\n");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

runTest();
