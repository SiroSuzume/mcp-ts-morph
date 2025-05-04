import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { moveSymbolToFile } from "../../ts-morph/move-symbol-to-file/move-symbol-to-file";
import { initializeProject } from "../../ts-morph/_utils/ts-morph-project";
import { SyntaxKind } from "ts-morph";
import { performance } from "node:perf_hooks";
import logger from "../../utils/logger";
import * as path from "node:path";

// ★ 追加: 文字列と SyntaxKind のマッピング
const syntaxKindMapping: { [key: string]: SyntaxKind } = {
	FunctionDeclaration: SyntaxKind.FunctionDeclaration,
	VariableStatement: SyntaxKind.VariableStatement,
	ClassDeclaration: SyntaxKind.ClassDeclaration,
	InterfaceDeclaration: SyntaxKind.InterfaceDeclaration,
	TypeAliasDeclaration: SyntaxKind.TypeAliasDeclaration,
	EnumDeclaration: SyntaxKind.EnumDeclaration,
	// 必要に応じて他の SyntaxKind を追加
};

const positionSchema = z.object({
	line: z.number().int().positive().describe("1-based line number."),
	column: z.number().int().positive().describe("1-based column number."),
});

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
	// ★ 型を z.string().optional() に変更し、スキーマ名も変更
	declarationKindString: z
		.string()
		.optional()
		.describe(
			"Optional. The kind of the declaration as a string (e.g., 'VariableStatement', 'FunctionDeclaration', 'ClassDeclaration', 'InterfaceDeclaration', 'TypeAliasDeclaration', 'EnumDeclaration'). Providing this helps resolve ambiguity if multiple symbols share the same name.",
		),
	// TODO: dryRun オプションを追加するか検討
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
		/**
		 * @description [ts-morphを使用] 指定されたシンボルをプロジェクト内のファイル間で移動し、すべての参照（インポート/エクスポートパスを含む）を自動的に更新します。
		 *
		 * AST（抽象構文木）を解析して、シンボルが使用されているすべての箇所を特定し、
		 * 新しいファイルの場所に合わせてパスを修正します。依存関係も考慮されます。
		 *
		 * ## 用途
		 *
		 * あるファイルで定義された関数や変数を別のファイルに整理したい場合に使用します。
		 * 例えば、`utils.ts` 内の特定のヘルパー関数を、より関連性の高い `feature-utils.ts` に移動する場合などです。
		 * ts-morph は `tsconfig.json` に基づいてプロジェクトを解析し、参照を解決して安全な移動を実行します。
		 *
		 * ## パラメータ
		 *
		 * - tsconfigPath (string, required): プロジェクトのルートにある `tsconfig.json` への絶対パス。
		 * - originalFilePath (string, required): 移動したいシンボルが含まれるファイルの絶対パス。
		 * - newFilePath (string, required): シンボルを移動させたい先のファイルの絶対パス。
		 * - symbolToMove (string, required): 移動したいシンボルの名前。
		 * - declarationKindString (string, optional): 移動するシンボルの種類を示す文字列（例: 'VariableStatement', 'FunctionDeclaration' など）。曖昧さ回避のために指定を推奨。
		 *
		 * ## 結果
		 *
		 * - 成功時: シンボルの移動と参照更新が完了した旨のメッセージを返します。
		 * - 失敗時: シンボルが見つからない、デフォルトエクスポートの移動試行、AST操作エラーなどを示すエラーメッセージを返します。
		 *
		 * ## 注意事項
		 * - **デフォルトエクスポートは移動できません。**
		 * - 内部依存関係の扱いは複雑です。
		 *   - 移動対象シンボルからのみ参照される依存関係は一緒に移動されます。
		 *   - 元のファイルに残る他のシンボルからも参照される依存関係は元のファイルに残り、必要に応じて `export` が追加され、新しいファイルからはインポートされます。
		 * - パフォーマンス: 大規模なプロジェクトや多数の参照を持つシンボルの移動には時間がかかる場合があります。
		 */
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

## Result

- On success: Returns a message confirming the symbol move and reference updates.
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
			const {
				tsconfigPath,
				originalFilePath,
				newFilePath,
				symbolToMove,
				declarationKindString, // ★ スキーマ名変更に合わせて変数名変更
			} = args;

			// ★ 文字列から SyntaxKind へのマッピング
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
				declarationKindString, // ★ ログには元の文字列を記録
			};

			try {
				const project = initializeProject(tsconfigPath);
				await moveSymbolToFile(
					project,
					originalFilePath,
					newFilePath,
					symbolToMove,
					declarationKind, // ★ マッピング後の Kind (または undefined) を渡す
				);

				message = `Successfully moved symbol \"${symbolToMove}\" from ${originalFilePath} to ${newFilePath} and updated references.`;
				isError = false;

				// 変更を保存
				await project.save(); // ★★★ コメントアウト解除 ★★★
				logger.debug("Project changes saved after symbol move."); // ★★★ コメントアウト解除 ★★★
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
