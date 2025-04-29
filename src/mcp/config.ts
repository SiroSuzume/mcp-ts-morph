import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTestTool } from "./tools/register";
import { registerTsMorphTools } from "./tools/ts-morph-tools";
/** MCPサーバーを作成する */
export function createMcpServer(): McpServer {
	const server = new McpServer({
		name: "mcp-ts-morph",
		version: "0.1.0",
		description: "エージェントがより正確な作業をするためのts-morphを利用したリファクタリングツール集",
	});
	configureMcpServer(server);
	return server;
}

/** MCPサーバーを設定する */
function configureMcpServer(server: McpServer): void {
	registerTestTool(server);
	registerTsMorphTools(server);
}
