import { performance } from "node:perf_hooks";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { initializeProject } from "../../ts-morph/_utils/ts-morph-project";
import { getTypeAtPosition } from "../../ts-morph/get-type-at-position/get-type-at-position";
import logger from "../../utils/logger";

export function registerGetTypeAtPositionTool(server: McpServer): void {
	server.tool(
		"get_type_at_position_by_tsmorph",
		`[ts-morph] Return the TypeChecker-inferred type at a specific position in a TypeScript/JavaScript file, plus the symbol and its declaration location.

## When to use
- Quickly verifying "what is the actual inferred type of this variable / expression / function?" without spawning \`tsc\` or running a full type check.
- Cheaper than \`Read\`-ing the declaration file when all you need is the type signature.
- Before refactoring, to confirm what a value's actual shape is (especially helpful when types are inferred through multiple generics).

## When NOT to use
- Bulk type analysis across many positions — call \`tsc\` directly instead.
- Listing every reference of a symbol — use \`find_references_by_tsmorph\`.

## Critical constraints
- \`position\` is 1-based (line/column), matching what editors display.
- All paths (\`tsconfigPath\`, \`targetFilePath\`) MUST be absolute.
- For function-like identifiers the type is expanded to call-style \`(arg: T) => R\` form rather than the \`typeof Foo\` shorthand. Overloads are joined with \`&\`.
- For imported symbols, the resolved (aliased) symbol's declaration location is reported, not the local import binding.

## Result fields
- \`type\`: the inferred type text.
- \`nodeKind\` / \`nodeText\`: what the position landed on (Identifier, StringLiteral, etc., and the source text — truncated to 80 chars).
- \`symbol\` (optional): the resolved symbol's name and the kind of its first declaration.
- \`declaration\` (optional): file path + 1-based line/column of the first declaration.

## Tips
- Pointing at whitespace or a comment line returns a SourceFile/EndOfFileToken node and the file-level inferred type — usually not what you want. Re-target the position to the identifier.`,
		{
			tsconfigPath: z
				.string()
				.describe("Path to the project's tsconfig.json file."),
			targetFilePath: z
				.string()
				.describe("Path to the file containing the position to inspect."),
			position: z
				.object({
					line: z.number().int().positive().describe("1-based line number."),
					column: z
						.number()
						.int()
						.positive()
						.describe("1-based column number."),
				})
				.describe("Exact position to inspect."),
		},
		async (args) => {
			const startTime = performance.now();
			let message = "";
			let isError = false;
			let duration = "0.00";

			const logArgs = {
				targetFilePath: args.targetFilePath,
				position: args.position,
			};

			try {
				const project = initializeProject(args.tsconfigPath);
				const result = getTypeAtPosition(
					project,
					args.targetFilePath,
					args.position,
				);

				const lines: string[] = [
					`Type: ${result.type}`,
					`Node: ${result.nodeKind} ${JSON.stringify(result.nodeText)}`,
				];
				if (result.symbol) {
					lines.push(`Symbol: ${result.symbol.name} (${result.symbol.kind})`);
				}
				if (result.declaration) {
					lines.push(
						`Declared at: ${result.declaration.filePath}:${result.declaration.line}:${result.declaration.column}`,
					);
				}
				message = lines.join("\n");
			} catch (error) {
				logger.error(
					{ err: error, toolArgs: logArgs },
					"Error executing get_type_at_position_by_tsmorph",
				);
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				message = `Error: ${errorMessage}`;
				isError = true;
			} finally {
				const endTime = performance.now();
				duration = ((endTime - startTime) / 1000).toFixed(2);
				logger.info(
					{
						status: isError ? "Failure" : "Success",
						durationMs: Number.parseFloat((endTime - startTime).toFixed(2)),
						...logArgs,
					},
					"get_type_at_position_by_tsmorph tool finished",
				);
				try {
					logger.flush();
				} catch (flushErr) {
					console.error("Failed to flush logs:", flushErr);
				}
			}

			const finalMessage = `${message}\nStatus: ${
				isError ? "Failure" : "Success"
			}\nProcessing time: ${duration} seconds`;

			return {
				content: [{ type: "text", text: finalMessage }],
				isError,
			};
		},
	);
}
