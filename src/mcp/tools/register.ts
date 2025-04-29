import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** テストツールを登録する */
export function registerTestTool(server: McpServer): void {
	server.tool(
		"test_tool",
		`MCPサーバーへの接続のテストに用いる
## Usage
このツールはMCPサーバーへの接続が正常に行われているかを確認するためのツールです。

## Key Features


## Filtering Options

## Result Interpretation

## When to Use

    `,
		{},
		() => {
			return {
				content: [
					{
						type: "text",
						text: "テスト接続完了",
					},
				],
			};
		},
	);
}
