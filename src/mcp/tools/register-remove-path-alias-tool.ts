import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { removePathAlias } from "../../ts-morph/remove-path-alias";
import { Project } from "ts-morph";
import * as path from "node:path"; // path モジュールが必要
import { performance } from "node:perf_hooks";

export function registerRemovePathAliasTool(server: McpServer): void {
	server.tool(
		"remove_path_alias_by_tsmorph",
		`[Uses ts-morph] Replaces path aliases (e.g., '@/') with relative paths in import/export statements within the specified target path.

Analyzes the project based on \`tsconfig.json\` to resolve aliases and calculate relative paths.

## Usage

Use this tool to convert alias paths like \`import Button from '@/components/Button'\` to relative paths like \`import Button from '../../components/Button'\`. This can be useful for improving portability or adhering to specific project conventions.

1.  Specify the **absolute path** to the project\`tsconfig.json\`.
2.  Specify the **absolute path** to the target file or directory where path aliases should be removed.
3.  Optionally, run with \`dryRun: true\` to preview the changes without modifying files.

## Parameters

- tsconfigPath (string, required): Absolute path to the project\`tsconfig.json\` file. **Must be an absolute path.**
- targetPath (string, required): The absolute path to the file or directory to process. **Must be an absolute path.**
- dryRun (boolean, optional): If true, only show intended changes without modifying files. Defaults to false.

## Result

- On success: Returns a message containing the list of file paths modified (or scheduled to be modified if dryRun).
- On failure: Returns a message indicating the error.`,
		{
			tsconfigPath: z
				.string()
				.describe("Absolute path to the project's tsconfig.json file."),
			targetPath: z
				.string()
				.describe("Absolute path to the target file or directory."),
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
			const project = new Project({
				tsConfigFilePath: args.tsconfigPath,
			});

			try {
				const { tsconfigPath, targetPath, dryRun } = args;
				const compilerOptions = project.compilerOptions.get();
				const tsconfigDir = path.dirname(tsconfigPath);
				const baseUrl = path.resolve(
					tsconfigDir,
					compilerOptions.baseUrl ?? ".",
				);
				const pathsOption = compilerOptions.paths ?? {};

				const result = await removePathAlias({
					project,
					targetPath,
					dryRun,
					baseUrl,
					paths: pathsOption,
				});

				if (!dryRun) {
					await project.save();
				}

				const changedFilesList =
					result.changedFiles.length > 0
						? result.changedFiles.join("\n - ")
						: "(No changes)";
				const actionVerb = dryRun ? "scheduled for modification" : "modified";
				message = `Path alias removal (${
					dryRun ? "Dry run" : "Execute"
				}): Within the specified path '${targetPath}', the following files were ${actionVerb}:\n - ${changedFilesList}`;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				message = `Error during path alias removal process: ${errorMessage}`;
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
