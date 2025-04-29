import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTestTool } from "./tools/register";
import { registerTsMorphTools } from "./tools/ts-morph-tools";
/** MCPサーバーを作成する */
export function createMcpServer(): McpServer {
	const server = new McpServer({
		name: "my-mcp-server",
		version: "1.0.0",
		description: "MCPサーバーのテンプレート",
	});
	configureMcpServer(server);
	return server;
}

/** MCPサーバーを設定する */
function configureMcpServer(server: McpServer): void {
	registerTestTool(server);
	registerTsMorphTools(server);
}
