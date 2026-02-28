import { RealMcpSessionFactory } from "../mcp";

async function main(): Promise<void> {
  const serverUrl = process.argv[2];
  const scenario = process.env.MCP_CONFORMANCE_SCENARIO;

  if (!serverUrl) {
    throw new Error("Missing server URL argument from conformance runner");
  }

  if (!scenario) {
    throw new Error("Missing MCP_CONFORMANCE_SCENARIO environment variable");
  }

  const factory = new RealMcpSessionFactory();
  const roomId = "__conformance_client__";

  const session = await factory.getSession(roomId, serverUrl);
  try {
    switch (scenario) {
      case "initialize": {
        // Connection itself validates initialize handshake behavior.
        break;
      }
      case "tools_call": {
        const listing = await session.listTools();
        const toolNames = readToolNames(listing);

        if (!toolNames.includes("add_numbers")) {
          throw new Error(
            `tools_call scenario expected add_numbers tool, got: ${toolNames.join(", ")}`,
          );
        }

        await session.callTool("add_numbers", { a: 2, b: 3 });
        break;
      }
      default:
        throw new Error(
          `Unsupported conformance scenario for roomd client: ${scenario}`,
        );
    }
  } finally {
    await factory.releaseSession(roomId, serverUrl);
  }
}

function readToolNames(listing: unknown): string[] {
  if (!listing || typeof listing !== "object") {
    return [];
  }

  const tools = (listing as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) {
    return [];
  }

  const names: string[] = [];
  for (const tool of tools) {
    const name =
      tool && typeof tool === "object" ? (tool as { name?: unknown }).name : undefined;
    if (typeof name === "string" && name.length > 0) {
      names.push(name);
    }
  }
  return names;
}

main().catch((error) => {
  console.error("[roomd-conformance-client]", error);
  process.exit(1);
});
