import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSymbolReferences } from "../../ts-morph/find-references"; // 新しい関数と型をインポート
import { performance } from "node:perf_hooks";

export function registerFindReferencesTool(server: McpServer): void {
	server.tool(
		"find_references_by_tsmorph",
		`[Uses ts-morph] Finds the definition and all references to a symbol at a given position throughout the project.

Analyzes the project based on \`tsconfig.json\` to locate the definition and all usages of the symbol (function, variable, class, etc.) specified by its position.

## Usage

Use this tool before refactoring to understand the impact of changing a specific symbol. It helps identify where a function is called, where a variable is used, etc.

1.  Specify the **absolute path** to the project's \`tsconfig.json\`.
2.  Specify the **absolute path** to the file containing the symbol you want to investigate.
3.  Specify the exact **position** (line and column) of the symbol within the file.

## Parameters

- tsconfigPath (string, required): Absolute path to the project's root \`tsconfig.json\` file. Essential for ts-morph to parse the project. **Must be an absolute path.**
- targetFilePath (string, required): The absolute path to the file containing the symbol to find references for. **Must be an absolute path.**
- position (object, required): The exact position of the symbol to find references for.
  - line (number, required): 1-based line number.
  - column (number, required): 1-based column number.

## Result

- On success: Returns a message containing the definition location (if found) and a list of reference locations (file path, line number, column number, and line text).
- On failure: Returns a message indicating the error.`,
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
