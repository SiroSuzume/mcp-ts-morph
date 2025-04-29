import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./config";

export async function runStdioServer() {
	const mcpServer = createMcpServer();
	const transport = new StdioServerTransport();
	await mcpServer.connect(transport);
}
