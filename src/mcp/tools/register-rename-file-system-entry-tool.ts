import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renameFileSystemEntry } from "../../ts-morph/rename-file-system/rename-file-system-entry";
import { initializeProject } from "../../ts-morph/_utils/ts-morph-project";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { TimeoutError } from "../../errors/timeout-error";
import logger from "../../utils/logger";

const renameSchema = z.object({
	tsconfigPath: z
		.string()
		.describe("Absolute path to the project's tsconfig.json file."),
	renames: z
		.array(
			z.object({
				oldPath: z
					.string()
					.describe(
						"The current absolute path of the file or folder to rename.",
					),
				newPath: z
					.string()
					.describe("The new desired absolute path for the file or folder."),
			}),
		)
		.nonempty()
		.describe("An array of rename operations, each with oldPath and newPath."),
	dryRun: z
		.boolean()
		.optional()
		.default(false)
		.describe("If true, only show intended changes without modifying files."),
	timeoutSeconds: z
		.number()
		.int()
		.positive()
		.optional()
		.default(120)
		.describe(
			"Maximum time in seconds allowed for the operation before it times out. Defaults to 120.",
		),
});

type RenameArgs = z.infer<typeof renameSchema>;

export function registerRenameFileSystemEntryTool(server: McpServer): void {
	server.tool(
		"rename_filesystem_entry_by_tsmorph",
		`[Uses ts-morph] Renames **one or more** TypeScript/JavaScript files **and/or folders** and updates all import/export paths referencing them throughout the project.

Analyzes the project based on \`tsconfig.json\` to find all references to the items being renamed and automatically corrects their paths. **Handles various path types, including relative paths, path aliases (e.g., @/), and imports referencing a directory\'s index.ts (\`from \'.\'\` or \`from \'..\'\`).** Checks for conflicts before applying changes.

## Usage

Use this tool when you want to rename/move multiple files or folders simultaneously (e.g., renaming \`util.ts\` to \`helper.ts\` and moving \`src/data\` to \`src/coreData\` in one operation) and need all the \`import\`/\`export\` statements referencing them to be updated automatically.

1.  Specify the path to the project's \`tsconfig.json\` file. **Must be an absolute path.**
2.  Provide an array of rename operations. Each object in the array must contain:
    - \`oldPath\`: The current **absolute path** of the file or folder to rename.
    - \`newPath\`: The new desired **absolute path** for the file or folder.
3.  It\'s recommended to first run with \`dryRun: true\` to check which files will be affected.
4.  If the preview looks correct, run with \`dryRun: false\` (or omit it) to actually save the changes to the file system.

## Parameters

- tsconfigPath (string, required): Absolute path to the project's root \`tsconfig.json\` file. **Must be an absolute path.**
- renames (array of objects, required): An array where each object specifies a rename operation with:
    - oldPath (string, required): The current absolute path of the file or folder. **Must be an absolute path.**
    - newPath (string, required): The new desired absolute path for the file or folder. **Must be an absolute path.**
- dryRun (boolean, optional): If set to true, prevents making and saving file changes, returning only the list of files that would be affected. Defaults to false.
- timeoutSeconds (number, optional): Maximum time in seconds allowed for the operation before it times out. Defaults to 120 seconds.

## Result

- On success: Returns a message listing the file paths modified or scheduled to be modified.
- On failure: Returns a message indicating the error (e.g., path conflict, file not found, timeout).

## Remarks
- This tool effectively updates various import/export path formats, including relative paths, path aliases (like \`@/\`), and implicit index file references (like \`import from \'.\'\` or \`import from \'..\'\`), ensuring comprehensive reference updates.
- **Performance:** Renaming a large number of files/folders or operating in a very large project might take a significant amount of time due to reference analysis and updates.
- **Conflicts:** The tool checks for conflicts (e.g., renaming to an existing path, duplicate target paths within the same operation) before applying changes.
- **Timeout:** If the operation takes longer than the specified \`timeoutSeconds\`, it will be canceled and an error will be returned.
- **Path Alias Issue:** This tool may sometimes fail to update import paths that use path aliases (e.g., \`@/features/...\`), although other factors could contribute. If you encounter this issue, it's recommended to either manually correct any remaining import paths after renaming or use the \`remove_path_alias_by_tsmorph\` tool beforehand to convert aliases to relative paths. This can help ensure safer refactoring.`,
		renameSchema.shape,
		async (args: RenameArgs) => {
			const startTime = performance.now();
			let message = "";
			let isError = false;
			let changedFilesCount = 0;
			const { tsconfigPath, renames, dryRun, timeoutSeconds } = args;
			const TIMEOUT_MS = timeoutSeconds * 1000;

			let resultPayload: {
				content: { type: "text"; text: string }[];
				isError: boolean;
			} = {
				content: [{ type: "text", text: "An unexpected error occurred." }],
				isError: true,
			};

			const controller = new AbortController();
			let timeoutId: NodeJS.Timeout | undefined = undefined;
			const logArgs = {
				tsconfigPath,
				renames: renames.map((r) => ({
					old: path.basename(r.oldPath),
					new: path.basename(r.newPath),
				})),
				dryRun,
				timeoutSeconds,
			};

			try {
				timeoutId = setTimeout(() => {
					const errorMessage = `Operation timed out after ${timeoutSeconds} seconds`;
					logger.error(
						{ toolArgs: logArgs, durationSeconds: timeoutSeconds },
						errorMessage,
					);
					controller.abort(new TimeoutError(errorMessage, timeoutSeconds));
				}, TIMEOUT_MS);

				const project = initializeProject(tsconfigPath);
				const result = await renameFileSystemEntry({
					project,
					renames,
					dryRun,
					signal: controller.signal,
				});

				changedFilesCount = result.changedFiles.length;

				const changedFilesList =
					result.changedFiles.length > 0
						? result.changedFiles.join("\n - ")
						: "(No changes)";
				const renameSummary = renames
					.map(
						(r) =>
							`'${path.basename(r.oldPath)}' -> '${path.basename(r.newPath)}'`,
					)
					.join(", ");

				if (dryRun) {
					message = `Dry run complete: Renaming [${renameSummary}] would modify the following files:\n - ${changedFilesList}`;
				} else {
					message = `Rename successful: Renamed [${renameSummary}]. The following files were modified:\n - ${changedFilesList}`;
				}
				isError = false;
			} catch (error) {
				logger.error(
					{ err: error, toolArgs: logArgs },
					"Error executing rename_filesystem_entry_by_tsmorph",
				);

				if (error instanceof TimeoutError) {
					message = `処理が ${error.durationSeconds} 秒以内に完了しなかったため、タイムアウトしました。操作はキャンセルされました.\nプロジェクトの規模が大きいか、変更箇所が多い可能性があります.`;
				} else if (error instanceof Error && error.name === "AbortError") {
					message = `操作がキャンセルされました: ${error.message}`;
				} else {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					message = `Error during rename process: ${errorMessage}`;
				}
				isError = true;
			} finally {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				const endTime = performance.now();
				const durationMs = endTime - startTime;

				logger.info(
					{
						status: isError ? "Failure" : "Success",
						durationMs: Number.parseFloat(durationMs.toFixed(2)),
						changedFilesCount,
						dryRun,
					},
					"rename_filesystem_entry_by_tsmorph tool finished",
				);
				try {
					logger.flush();
					logger.trace("Logs flushed after tool execution.");
				} catch (flushErr) {
					console.error("Failed to flush logs:", flushErr);
				}
			}

			const endTime = performance.now();
			const durationMs = endTime - startTime;
			const durationSec = (durationMs / 1000).toFixed(2);
			const finalMessage = `${message}\nStatus: ${isError ? "Failure" : "Success"}\nProcessing time: ${durationSec} seconds`;
			resultPayload = {
				content: [{ type: "text", text: finalMessage }],
				isError: isError,
			};

			return resultPayload;
		},
	);
}
