import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSymbolReferences } from "../../ts-morph/find-references"; // 新しい関数と型をインポート
import { performance } from "node:perf_hooks";

export function registerFindReferencesTool(server: McpServer): void {
	server.tool(
		"find_references_by_tsmorph",
		`[ts-morph] Locate the definition AND every reference of a symbol at a given position, project-wide. Read-only.

## When to use
- Assessing the blast radius of a planned refactor before changing anything.
- Answering "who calls this function?" / "where is this type used?" precisely.
- Prefer this over \`grep\` for identifier lookups: grep matches unrelated same-name tokens (different scopes, comments, strings), while this tool uses the type checker to return only true references.

## When NOT to use
- You just want a free-text search (comments, strings, doc files) -> use \`grep\`.
- You already plan to rename -> skip straight to \`rename_symbol_by_tsmorph\` (it computes the same set internally and supports \`dryRun\`).

## Critical constraints
- \`position\` must land on the symbol identifier itself (1-based line/column, as shown by editors). A position on whitespace or another token will fail to resolve.
- All paths (\`tsconfigPath\`, \`targetFilePath\`) MUST be absolute.

## Result
Returns the definition (file path, line, column, source line) when found, followed by a numbered list of references with the same fields.`,
		{
			tsconfigPath: z
				.string()
				.describe("Absolute path to the project's tsconfig.json file."),
			targetFilePath: z
				.string()
				.describe("Absolute path to the file containing the symbol."),
			position: z
				.object({
					line: z.number().describe("1-based line number."),
					column: z.number().describe("1-based column number."),
				})
				.describe("The exact position of the symbol."),
		},
		async (args) => {
			const startTime = performance.now();
			let message = "";
			let isError = false;
			let duration = "0.00"; // duration を外で宣言・初期化

			try {
				const { tsconfigPath, targetFilePath, position } = args;
				const { references, definition } = await findSymbolReferences({
					tsconfigPath: tsconfigPath,
					targetFilePath: targetFilePath,
					position,
				});

				let resultText = "";

				if (definition) {
					resultText += "Definition:\n";
					resultText += `- ${definition.filePath}:${definition.line}:${definition.column}\n`;
					resultText += `  \`\`\`typescript\n  ${definition.text}\n  \`\`\`\n\n`;
				} else {
					resultText += "Definition not found.\n\n";
				}

				if (references.length > 0) {
					resultText += `References (${references.length} found):\n`;
					const formattedReferences = references
						.map(
							(ref) =>
								`- ${ref.filePath}:${ref.line}:${ref.column}\n  \`\`\`typescript\n  ${ref.text}\n  \`\`\`\``,
						)
						.join("\n\n");
					resultText += formattedReferences;
				} else {
					resultText += "References not found.";
				}
				message = resultText.trim();
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				message = `Error during reference search: ${errorMessage}`;
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
