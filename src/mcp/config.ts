import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTsMorphTools } from "./tools/ts-morph-tools";

/** MCPサーバーを作成する */
export function createMcpServer(): McpServer {
	const server = new McpServer({
		name: "mcp-ts-morph",
		version: "0.2.5",
		description:
			"エージェントがより正確な作業をするためのts-morphを利用したリファクタリングツール集",
	});
	registerTsMorphTools(server);
	return server;
}
