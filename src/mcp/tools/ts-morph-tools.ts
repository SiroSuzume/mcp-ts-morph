import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerChangeSignatureTool } from "./register-change-signature-tool";
import { registerFindReferencesTool } from "./register-find-references-tool";
import { registerMoveSymbolToFileTool } from "./register-move-symbol-to-file-tool";
import { registerRemovePathAliasTool } from "./register-remove-path-alias-tool";
import { registerRenameFileSystemEntryTool } from "./register-rename-file-system-entry-tool";
import { registerRenameSymbolTool } from "./register-rename-symbol-tool";

/**
 * ts-morph を利用したリファクタリングツール群を MCP サーバーに登録する
 */
export function registerTsMorphTools(server: McpServer): void {
	registerRenameSymbolTool(server);
	registerRenameFileSystemEntryTool(server);
	registerFindReferencesTool(server);
	registerRemovePathAliasTool(server);
	registerMoveSymbolToFileTool(server);
	registerChangeSignatureTool(server);
}
