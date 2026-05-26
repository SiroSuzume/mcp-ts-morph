import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renameSymbol } from "../../ts-morph/rename-symbol/rename-symbol";
import { performance } from "node:perf_hooks";

export function registerRenameSymbolTool(server: McpServer): void {
	server.tool(
		"rename_symbol_by_tsmorph",
		`[ts-morph] Type-aware rename of a TypeScript/JavaScript symbol (function, variable, class, type, interface, enum, etc.) across the entire project.

## When to use
- Renaming any symbol that may be imported, re-exported, or referenced in other files.
- Prefer this over manual Edit + grep / sed. Identifier-based search misses re-exports, JSX attribute usage, and matches unrelated same-name tokens. This tool resolves references via the type checker, so it is both safer and faster.
- Even for a "local-only" symbol, this tool is the correct default: it costs nothing extra and guarantees no missed reference.

## When NOT to use
- Renaming a file or folder (and updating imports to it) -> use \`rename_filesystem_entry_by_tsmorph\`.
- Moving a symbol to a different file -> use \`move_symbol_to_file_by_tsmorph\`.
- Just looking up where a symbol is used (no rename) -> use \`find_references_by_tsmorph\`.

## Critical constraints
- \`position\` must point at the symbol's identifier (1-based line/column, as shown by editors). If the position lands on whitespace or a different token, the rename fails.
- \`symbolName\` must match the identifier text at that position; it is used as a sanity check.
- All paths (\`tsconfigPath\`, \`targetFilePath\`) MUST be absolute.

## Tips
- Run with \`dryRun: true\` first when the change spans many files, to preview the affected file list.

## Result
Returns the list of modified (or to-be-modified, in dryRun) file paths, plus status and processing time.`,
		{
			tsconfigPath: z
				.string()
				.describe("Path to the project's tsconfig.json file."),
			targetFilePath: z
				.string()
				.describe("Path to the file containing the symbol to rename."),
			position: z
				.object({
					line: z.number().describe("1-based line number."),
					column: z.number().describe("1-based column number."),
				})
				.describe("The exact position of the symbol to rename."),
			symbolName: z.string().describe("The current name of the symbol."),
			newName: z.string().describe("The new name for the symbol."),
			dryRun: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					"If true, only show intended changes without modifying files.",
				),
		},
		async (args) => {
			const startTime = performance.now();
			let message = "";
			let isError = false;
			let duration = "0.00";

			try {
				const {
					tsconfigPath,
					targetFilePath,
					position,
					symbolName,
					newName,
					dryRun,
				} = args;
				const result = await renameSymbol({
					tsconfigPath: tsconfigPath,
					targetFilePath: targetFilePath,
					position: position,
					symbolName: symbolName,
					newName: newName,
					dryRun: dryRun,
				});

				const changedFilesList =
					result.changedFiles.length > 0
						? result.changedFiles.join("\n - ")
						: "(No changes)";

				if (dryRun) {
					message = `Dry run complete: Renaming symbol '${symbolName}' to '${newName}' would modify the following files:\n - ${changedFilesList}`;
				} else {
					message = `Rename successful: Renamed symbol '${symbolName}' to '${newName}'. The following files were modified:\n - ${changedFilesList}`;
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				message = `Error during rename process: ${errorMessage}`;
				isError = true;
			} finally {
				const endTime = performance.now();
				duration = ((endTime - startTime) / 1000).toFixed(2);
			}

			const finalMessage = `${message}\nStatus: ${
				isError ? "Failure" : "Success"
			}\nProcessing time: ${duration} seconds`;

			return {
				content: [{ type: "text", text: finalMessage }],
				isError: isError,
			};
		},
	);
}
