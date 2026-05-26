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
		`[ts-morph] Rename or move one or more TypeScript/JavaScript files and/or folders, and automatically rewrite every import/export path that references them.

## When to use
- Renaming or moving any .ts/.tsx/.js/.jsx file or directory (single or batch).
- Prefer this over \`mv\` + manual import fixing. This tool resolves references via the type checker, so it handles relative paths, path aliases (\`@/\`), and barrel imports (\`from '.'\`, \`from '..'\`) that grep cannot reliably find.
- Use batch mode (multiple entries in \`renames\`) when reorganizing several files at once -- a single AST pass is much faster than running the tool repeatedly.

## When NOT to use
- Renaming a symbol inside a file -> \`rename_symbol_by_tsmorph\`.
- Moving a single symbol (not the whole file) to another file -> \`move_symbol_to_file_by_tsmorph\`.

## Critical constraints
- Path aliases in updated imports are REWRITTEN AS RELATIVE PATHS (e.g., \`@/foo\` -> \`../foo\`). If you want to keep aliases, run \`remove_path_alias_by_tsmorph\` separately beforehand, or accept the conversion.
- Barrel imports like \`import X from '../components'\` are rewritten to point at the resolved index file (e.g., \`'../components/index.tsx'\`).
- Default exports declared via a bare identifier (\`export default Foo;\`) may not be updated correctly. Default function/class declarations (\`export default function foo() {}\`) are handled.
- All paths (\`tsconfigPath\`, \`oldPath\`, \`newPath\`) MUST be absolute.
- The tool refuses to run on path conflicts (target already exists, duplicate destinations).

## Tips
- Run with \`dryRun: true\` first for any non-trivial rename to inspect the affected file list.
- \`timeoutSeconds\` defaults to 120; raise it for very large projects or huge batch renames.

## Result
Returns the list of modified (or to-be-modified, in dryRun) file paths, plus status and processing time. On timeout the operation is cancelled and an error is returned.`,
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
