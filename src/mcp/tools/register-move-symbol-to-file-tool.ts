import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { moveSymbolToFile } from "../../ts-morph/move-symbol-to-file/move-symbol-to-file";
import { initializeProject } from "../../ts-morph/_utils/ts-morph-project";
import { getChangedFiles } from "../../ts-morph/_utils/ts-morph-project";
import { SyntaxKind } from "ts-morph";
import { performance } from "node:perf_hooks";
import logger from "../../utils/logger";
import * as path from "node:path";

const syntaxKindMapping: { [key: string]: SyntaxKind } = {
	FunctionDeclaration: SyntaxKind.FunctionDeclaration,
	VariableStatement: SyntaxKind.VariableStatement,
	ClassDeclaration: SyntaxKind.ClassDeclaration,
	InterfaceDeclaration: SyntaxKind.InterfaceDeclaration,
	TypeAliasDeclaration: SyntaxKind.TypeAliasDeclaration,
	EnumDeclaration: SyntaxKind.EnumDeclaration,
};
const moveSymbolSchema = z.object({
	tsconfigPath: z
		.string()
		.describe(
			"Absolute path to the project's tsconfig.json file. Essential for ts-morph.",
		),
	originalFilePath: z
		.string()
		.describe("Absolute path to the file containing the symbol to move."),
	targetFilePath: z
		.string()
		.describe(
			"Absolute path to the destination file. Can be an existing file; if the path does not exist, a new file will be created.",
		),
	symbolToMove: z.string().describe("The name of the symbol to move."),
	declarationKindString: z
		.string()
		.optional()
		.describe(
			"Optional. The kind of the declaration as a string (e.g., 'VariableStatement', 'FunctionDeclaration', 'ClassDeclaration', 'InterfaceDeclaration', 'TypeAliasDeclaration', 'EnumDeclaration'). Providing this helps resolve ambiguity if multiple symbols share the same name.",
		),
	dryRun: z
		.boolean()
		.optional()
		.default(false)
		.describe("If true, only show intended changes without modifying files."),
});

type MoveSymbolArgs = z.infer<typeof moveSymbolSchema>;

/**
 * MCPサーバーに 'move_symbol_to_file_by_tsmorph' ツールを登録します。
 * このツールは、指定されたシンボルをファイル間で移動し、関連する参照を更新します。
 *
 * @param server McpServer インスタンス
 */
export function registerMoveSymbolToFileTool(server: McpServer): void {
	server.tool(
		"move_symbol_to_file_by_tsmorph",
		`[Uses ts-morph] Moves a specified symbol (function, variable, class, etc.) and its internal-only dependencies to a new file, automatically updating all references across the project. Aids refactoring tasks like file splitting and improving modularity.

Analyzes the AST (Abstract Syntax Tree) to identify usages of the symbol and corrects import/export paths based on the new file location. It also handles moving necessary internal dependencies (those used only by the symbol being moved).

## Usage

Use this tool for various code reorganization tasks:

1.  **Moving a specific function/class/variable:** Relocate a specific piece of logic to a more appropriate file (e.g., moving a helper function from a general \`utils.ts\` to a feature-specific \`feature-utils.ts\`). **This tool moves the specified symbol and its internal-only dependencies.**
2.  **Extracting or Moving related logic (File Splitting/Reorganization):** To split a large file or reorganize logic, move related functions, classes, types, or variables to a **different file (new or existing)** one by one using this tool. **You will need to run this tool multiple times, once for each top-level symbol you want to move.**
3.  **Improving modularity:** Group related functionalities together by moving multiple symbols (functions, types, etc.) into separate, more focused files. **Run this tool for each symbol you wish to relocate.**

ts-morph parses the project based on \`tsconfig.json\` to resolve references and perform the move safely, updating imports/exports automatically.

## Parameters

- tsconfigPath (string, required): Absolute path to the project\'s root \`tsconfig.json\`
- originalFilePath (string, required): Absolute path to the file currently containing the symbol to move.
- targetFilePath (string, required): Absolute path to the destination file. Can be an existing file; if the path does not exist, a new file will be created.
- symbolToMove (string, required): The name of the **single top-level symbol** you want to move in this execution.
- declarationKindString (string, optional): The kind of the declaration (e.g., \'VariableStatement\', \'FunctionDeclaration\'). Recommended to resolve ambiguity if multiple symbols share the same name.
- dryRun (boolean, optional): If true, only show intended changes without modifying files. Defaults to false.

## Result

- On success: Returns a message confirming the move and reference updates, including a list of modified files (or files that would be modified if dryRun is true).
- On failure: Returns an error message (e.g., symbol not found, default export, AST errors).

## Remarks

- **Moves one top-level symbol per execution:** This tool is designed to move a single specified top-level symbol (and its internal-only dependencies) in each run. To move multiple related top-level symbols (e.g., several functions and types for file splitting), you need to invoke this tool multiple times, once for each symbol.
- **Default exports cannot be moved.**
- **Internal dependency handling:** Dependencies (functions, variables, types, etc.) used *only* by the moved symbol within the original file are moved along with it. Dependencies that are also used by other symbols remaining in the original file will stay, might gain an \`export\` keyword if they didn't have one, and will be imported by the new file where the symbol was moved. Symbols in the original file that are *not* dependencies of the moved symbol will remain untouched unless explicitly moved in a separate execution of this tool.
- **Performance:** Moving symbols with many references in large projects might take time.`,
		moveSymbolSchema.extend({
			symbolToMove: z
				.string()
				.describe(
					"The name of the single top-level symbol you want to move in this execution.",
				),
		}).shape,
		async (args: MoveSymbolArgs) => {
			const startTime = performance.now();
			let message = "";
			let isError = false;
			let changedFilesCount = 0;
			let changedFiles: string[] = [];
			const {
				tsconfigPath,
				originalFilePath,
				targetFilePath,
				symbolToMove,
				declarationKindString,
				dryRun,
			} = args;

			const declarationKind: SyntaxKind | undefined =
				declarationKindString && syntaxKindMapping[declarationKindString]
					? syntaxKindMapping[declarationKindString]
					: undefined;

			if (declarationKindString && declarationKind === undefined) {
				logger.warn(
					`Invalid declarationKindString provided: '${declarationKindString}'. Proceeding without kind specification.`,
				);
			}

			const logArgs = {
				tsconfigPath,
				originalFilePath: path.basename(originalFilePath),
				targetFilePath: path.basename(targetFilePath),
				symbolToMove,
				declarationKindString,
				dryRun,
			};

			try {
				const project = initializeProject(tsconfigPath);
				await moveSymbolToFile(
					project,
					originalFilePath,
					targetFilePath,
					symbolToMove,
					declarationKind,
				);

				changedFiles = getChangedFiles(project).map((sf) => sf.getFilePath());
				changedFilesCount = changedFiles.length;

				const baseMessage = `Moved symbol \"${symbolToMove}\" from ${originalFilePath} to ${targetFilePath}.`;
				const changedFilesList =
					changedFiles.length > 0 ? changedFiles.join("\n - ") : "(No changes)";

				if (dryRun) {
					message = `Dry run: ${baseMessage}\nFiles that would be modified:\n - ${changedFilesList}`;
					logger.info({ changedFiles }, "Dry run: Skipping save.");
				} else {
					await project.save();
					logger.debug("Project changes saved after symbol move.");
					message = `${baseMessage}\nThe following files were modified:\n - ${changedFilesList}`;
				}
				isError = false;
			} catch (error) {
				logger.error(
					{ err: error, toolArgs: logArgs },
					"Error executing move_symbol_to_file_by_tsmorph",
				);
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				message = `Error moving symbol: ${errorMessage}`;
				isError = true;
			} finally {
				const endTime = performance.now();
				const durationMs = endTime - startTime;

				logger.info(
					{
						status: isError ? "Failure" : "Success",
						durationMs: Number.parseFloat(durationMs.toFixed(2)),
						changedFilesCount,
						dryRun,
					},
					"move_symbol_to_file_by_tsmorph tool finished",
				);
				try {
					logger.flush();
				} catch (flushErr) {
					console.error("Failed to flush logs:", flushErr);
				}
			}

			const endTime = performance.now();
			const durationMs = endTime - startTime;
			const durationSec = (durationMs / 1000).toFixed(2);
			const finalMessage = `${message}\nStatus: ${isError ? "Failure" : "Success"}\nProcessing time: ${durationSec} seconds`;

			return {
				content: [{ type: "text", text: finalMessage }],
				isError: isError,
			};
		},
	);
}
