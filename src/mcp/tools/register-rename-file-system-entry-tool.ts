import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renameFileSystemEntry } from "../../ts-morph/rename-file-system-entry"; // Import the updated function
import * as path from "node:path"; // pathモジュールをインポート
import { performance } from "node:perf_hooks";

export function registerRenameFileSystemEntryTool(server: McpServer): void {
	server.tool(
		"rename_filesystem_entry_by_tsmorph", // ツール名変更 (entry)
		// Note for developers:
		// The following English description is primarily intended for the LLM's understanding.
		// Please refer to the JSDoc comment above for the original Japanese description.
		`[Uses ts-morph] Renames **a single** TypeScript/JavaScript file **OR FOLDER** and updates all import/export paths referencing it throughout the project.

Analyzes the project based on \`tsconfig.json\` to find all references to the file/folder being renamed and automatically corrects its paths. **Includes a remark about potential issues with path aliases and relative index imports.**

## Usage

Use this tool when you want to rename a file (e.g., \`utils.ts\` -> \`helpers.ts\`) or a folder (e.g., \`src/data\` -> \`src/coreData\`) and need all the \`import\` statements in other files that point to it to be automatically updated.

1.  Specify the path to the project\'s \`tsconfig.json\` file. **Must be an absolute path.**
2.  Specify the current **absolute path** of the file or folder to rename.
3.  Specify the new desired **absolute path** for the file or folder.
4.  It\'s recommended to first run with \`dryRun: true\` to check which files will be affected.
5.  If the preview looks correct, run with \`dryRun: false\` (or omit it) to actually save the changes to the file system.

## Parameters

- tsconfigPath (string, required): Absolute path to the project\'s root \`tsconfig.json\` file. Essential for ts-morph to parse the project. **Must be an absolute path.**
- oldPath (string, required): The current absolute path of the file or folder to rename. **Must be an absolute path.**
- newPath (string, required): The new desired absolute path for the file or folder. **Must be an absolute path.**
- dryRun (boolean, optional): If set to true, prevents ts-morph from making and saving file changes, returning only the list of files that would be affected. Useful for verification. Defaults to false.

## Result

- On success: Returns a message containing the list of file paths modified (the renamed file/folder and files with updated imports) or scheduled to be modified if dryRun.
- On failure: Returns a message indicating the error.

## Remarks (Added)
- **Caution:** Updating import/export statements containing path aliases (like \`@/\`) or relative paths referencing a directory\'s \`index.ts\` (like \`import from '.\' \`\) might be incomplete in the current \`ts-morph\` implementation. Manual verification and correction might be necessary after renaming.`,
		{
			tsconfigPath: z
				.string()
				.describe("Absolute path to the project's tsconfig.json file."),
			oldPath: z
				.string()
				.describe("The current absolute path of the file or folder to rename."),
			newPath: z
				.string()
				.describe("The new desired absolute path for the file or folder."),
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
			let duration = "0.00"; // duration を外で宣言・初期化

			try {
				const { tsconfigPath, oldPath, newPath, dryRun } = args;
				const result = await renameFileSystemEntry({
					tsconfigPath: tsconfigPath,
					oldPath: oldPath,
					newPath: newPath,
					dryRun,
				});

				const changedFilesList =
					result.changedFiles.length > 0
						? result.changedFiles.join("\n - ")
						: "(No changes)";

				const targetDescription = `'${path.basename(oldPath)}' (${oldPath})`;
				if (dryRun) {
					message = `Dry run complete: Renaming ${targetDescription} to '${newPath}' would modify the following files:\n - ${changedFilesList}`;
				} else {
					message = `Rename successful: Renamed ${targetDescription} to '${newPath}'. The following files were modified:\n - ${changedFilesList}`;
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				message = `Error during rename process (${args.oldPath} -> ${args.newPath}): ${errorMessage}`;
				isError = true;
			} finally {
				const endTime = performance.now();
				duration = ((endTime - startTime) / 1000).toFixed(2); // duration を更新
			}

			// finally の外で return する
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
