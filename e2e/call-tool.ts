import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTsMorphTools } from "../src/mcp/tools/ts-morph-tools";

export interface ToolResult {
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
}

type ToolHandler = (args: unknown) => Promise<ToolResult>;

export interface ToolHarness {
	callTool: (name: string, args: unknown) => Promise<ToolResult>;
}

/**
 * 実 STDIO サーバーを介さず、登録済み MCP ツールを名前で直接呼べる軽量ハーネス。
 * register*Tool が呼ぶ server.tool(name, description, schema, handler) を捕捉する。
 * src/mcp/tools/integration.test.ts と同じ方式。
 */
export function createToolHarness(): ToolHarness {
	const tools = new Map<string, ToolHandler>();

	const mockServer = {
		tool: (
			name: string,
			_description: string,
			_schema: unknown,
			handler: ToolHandler,
		) => {
			tools.set(name, handler);
		},
	};

	registerTsMorphTools(mockServer as unknown as McpServer);

	return {
		callTool: async (name, args) => {
			const handler = tools.get(name);
			if (!handler) {
				throw new Error(`[e2e] ツール '${name}' が登録されていません`);
			}
			return handler(args);
		},
	};
}
