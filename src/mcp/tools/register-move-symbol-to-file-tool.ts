import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { moveSymbolToFile } from "../../ts-morph/move-symbol-to-file/move-symbol-to-file";
import { initializeProject } from "../../ts-morph/_utils/ts-morph-project";
import { getChangedFiles } from "../../ts-morph/_utils/ts-morph-project";
import { SyntaxKind } from "ts-morph";
import { performance } from "node:perf_hooks";
import logger from "../../utils/logger";
import * as path from "node:path";

const declarationKindNames = [
	"FunctionDeclaration",
	"VariableStatement",
	"ClassDeclaration",
	"InterfaceDeclaration",
	"TypeAliasDeclaration",
	"EnumDeclaration",
] as const;

const syntaxKindMapping: Record<
	(typeof declarationKindNames)[number],
	SyntaxKind
> = {
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
		.enum(declarationKindNames)
		.optional()
		.describe(
			"Optional. The kind of the declaration. Providing this helps resolve ambiguity if multiple symbols share the same name.",
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
		`[ts-morph] Move one top-level symbol (function, variable, class, interface, type, enum) from one file to another, carrying its internal-only dependencies and rewriting all imports/exports across the project.

## When to use
- Splitting a large file: move related symbols to a new file one by one.
- Relocating a helper from a generic \`utils.ts\` to a feature-specific module.
- Prefer this over manual cut-and-paste + import fixing. Manual moves frequently miss re-exports, leave stale imports, or fail to add the new export -- this tool handles all of that via the type checker.

## When NOT to use
- Renaming the file (without moving a single symbol out of it) -> \`rename_filesystem_entry_by_tsmorph\`.
- Renaming a symbol in place -> \`rename_symbol_by_tsmorph\`.
- The symbol you want to move is a \`export default\` -> NOT SUPPORTED, refactor it to a named export first.

## Critical constraints
- ONE top-level symbol per call. To move N symbols, invoke the tool N times.
- Default exports CANNOT be moved. Convert them to named exports beforehand.
- If multiple top-level declarations share the same name (e.g., function + namespace), pass \`declarationKindString\` (e.g., \`"FunctionDeclaration"\`, \`"VariableStatement"\`) to disambiguate.
- Internal dependency rules:
  - Dependencies used ONLY by the moved symbol travel with it.
  - Dependencies also used by other symbols in the source file stay put, gain \`export\` if missing, and are imported back into the destination file.
- All paths (\`tsconfigPath\`, \`originalFilePath\`, \`targetFilePath\`) MUST be absolute.
- \`targetFilePath\` may point to a non-existent file; it will be created.

## Tips
- Run with \`dryRun: true\` first when the source file has many co-dependencies to confirm what gets pulled along.

## Result
Returns the list of modified (or to-be-modified, in dryRun) file paths, plus status and processing time.`,
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

			const declarationKind: SyntaxKind | undefined = declarationKindString
				? syntaxKindMapping[declarationKindString]
				: undefined;

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
