import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerRenameSymbolTool } from "./register-rename-symbol-tool";
import { registerRenameFileSystemEntryTool } from "./register-rename-file-system-entry-tool";
import { registerFindReferencesTool } from "./register-find-references-tool";
import { registerRemovePathAliasTool } from "./register-remove-path-alias-tool";

/**
 * ts-morph を利用したリファクタリングツール群を MCP サーバーに登録する
 */
export function registerTsMorphTools(server: McpServer): void {
	registerRenameSymbolTool(server);
	registerRenameFileSystemEntryTool(server);
	registerFindReferencesTool(server);
	registerRemovePathAliasTool(server);
}
