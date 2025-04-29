import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renameSymbol } from "../../ts-morph/rename-symbol";
import { performance } from "node:perf_hooks";

export function registerRenameSymbolTool(server: McpServer): void {
	server.tool(
		"rename_symbol_by_tsmorph",
		// Note for developers:
		// The following English description is primarily intended for the LLM's understanding.
		// Please refer to the JSDoc comment above for the original Japanese description.
		`[Uses ts-morph] Renames TypeScript/JavaScript symbols across the project.

Analyzes the AST (Abstract Syntax Tree) to track and update references 
throughout the project, not just the definition site.
Useful for cross-file refactoring tasks during Vibe Coding.

## Usage

Use this tool, for example, when you change a function name defined in one file 
and want to reflect that change in other files that import and use it.
ts-morph parses the project based on \`tsconfig.json\` to resolve symbol references 
and perform the rename.

1.  Specify the exact location (file path, line, column) of the symbol 
    (function name, variable name, class name, etc.) you want to rename. 
    This is necessary for ts-morph to identify the target Identifier node in the AST.
2.  Specify the current symbol name and the new symbol name.
3.  It\'s recommended to first run with \`dryRun: true\` to check which files 
    ts-morph will modify.
4.  If the preview looks correct, run with \`dryRun: false\` (or omit it) 
    to actually save the changes to the file system.

## Parameters

- tsconfigPath (string, required): Path to the project\'s root \`tsconfig.json\` file. 
  Essential for ts-morph to correctly parse the project structure and file references. **Must be an absolute path (relative paths can be misinterpreted).**
- targetFilePath (string, required): Path to the file where the symbol to be renamed 
  is defined (or first appears). **Must be an absolute path (relative paths can be misinterpreted).**
- position (object, required): The exact position on the symbol to be renamed. 
  Serves as the starting point for ts-morph to locate the AST node.
  - line (number, required): 1-based line number, typically obtained from an editor.
  - column (number, required): 1-based column number (position of the first character 
    of the symbol name), typically obtained from an editor.
- symbolName (string, required): The current name of the symbol before renaming. 
  Used to verify against the node name found at the specified position.
- newName (string, required): The new name for the symbol after renaming.
- dryRun (boolean, optional): If set to true, prevents ts-morph from making and saving 
  file changes, returning only the list of files that would be affected. 
  Useful for verification. Defaults to false.

## Result

- On success: Returns a message containing the list of file paths modified 
  (or scheduled to be modified if dryRun) by the rename.
- On failure: Returns a message indicating the error.`,
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
