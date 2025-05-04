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
	newFilePath: z
		.string()
		.describe("Absolute path to the new file where the symbol will be moved."),
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
		`[Uses ts-morph] Moves a specified symbol between files in the project, automatically updating all references (including import/export paths).

Analyzes the AST (Abstract Syntax Tree) to identify all usages of the symbol and corrects paths based on the new file location. Handles internal and external dependencies.

## Usage

Use this tool when you want to reorganize code by moving a function, variable, class, interface, type alias, or enum from one file to another. For example, moving a specific helper function from a general \`utils.ts\` to a more relevant \`feature-utils.ts\`. ts-morph parses the project based on \`tsconfig.json\` to resolve references and perform the move safely.

## Parameters

- tsconfigPath (string, required): Absolute path to the project's root \`tsconfig.json\`.
- originalFilePath (string, required): Absolute path to the file containing the symbol to move.
- newFilePath (string, required): Absolute path to the destination file.
- symbolToMove (string, required): The name of the symbol to move.
- declarationKindString (string, optional): The kind of the declaration as a string (e.g., 'VariableStatement', 'FunctionDeclaration' など). Recommended to resolve ambiguity if multiple symbols share the same name.
- dryRun (boolean, optional): If true, only show intended changes without modifying files. Defaults to false.

## Result

- On success: Returns a message confirming the symbol move and reference updates, including a list of modified files (or files that would be modified if dryRun is true).
- On failure: Returns an error message indicating issues like symbol not found, attempting to move a default export, or AST manipulation errors.

## Remarks
- **Default exports cannot be moved.**
- Handling of internal dependencies is complex:
    - Dependencies used only by the moved symbol are moved with it.
    - Dependencies also used by other symbols remaining in the original file stay there, potentially gain an \`export\` keyword, and are imported by the new file.
- Performance: Moving symbols with many references in large projects might take time.`,
		moveSymbolSchema.shape,
		async (args: MoveSymbolArgs) => {
			const startTime = performance.now();
			let message = "";
			let isError = false;
			let changedFilesCount = 0;
			let changedFiles: string[] = [];
			const {
				tsconfigPath,
				originalFilePath,
				newFilePath,
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
				newFilePath: path.basename(newFilePath),
				symbolToMove,
				declarationKindString,
				dryRun,
			};

			try {
				const project = initializeProject(tsconfigPath);
				await moveSymbolToFile(
					project,
					originalFilePath,
					newFilePath,
					symbolToMove,
					declarationKind,
				);

				changedFiles = getChangedFiles(project).map((sf) => sf.getFilePath());
				changedFilesCount = changedFiles.length;

				const baseMessage = `Moved symbol \"${symbolToMove}\" from ${originalFilePath} to ${newFilePath}.`;
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
