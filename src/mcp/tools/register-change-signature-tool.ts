import { performance } from "node:perf_hooks";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { changeSignature } from "../../ts-morph/change-signature/change-signature";
import logger from "../../utils/logger";

const addOpSchema = z.object({
	kind: z.literal("add"),
	index: z
		.number()
		.int()
		.nonnegative()
		.optional()
		.describe(
			"0-based insertion index. Omit to append at the end of the parameter list.",
		),
	name: z.string().describe("Name of the new parameter."),
	typeText: z
		.string()
		.optional()
		.describe(
			'Type annotation text (e.g. "string", "{ id: number }"). Omit for no type annotation.',
		),
	optional: z
		.boolean()
		.optional()
		.describe("If true, marks the parameter optional with `?`."),
	defaultValue: z
		.string()
		.optional()
		.describe(
			'Default value text (e.g. "0", \'"hello"\'). Sets the parameter initializer.',
		),
	argumentForCallers: z
		.string()
		.optional()
		.describe(
			"Argument expression text to insert into every existing call site. REQUIRED when inserting a parameter in the middle, OR when the new parameter is required (no defaultValue/optional) AND existing callers must be updated. Omit ONLY when the new parameter is trailing optional/defaulted and you want callers to remain unchanged.",
		),
});

const removeOpSchema = z.object({
	kind: z.literal("remove"),
	index: z
		.number()
		.int()
		.nonnegative()
		.describe("0-based index of the parameter to remove."),
});

const reorderOpSchema = z.object({
	kind: z.literal("reorder"),
	newOrder: z
		.array(z.number().int().nonnegative())
		.describe(
			"Array describing the new order. Length must equal the current parameter count, each old index appears exactly once. Example: [2, 0, 1] means new[0]=old[2], new[1]=old[0], new[2]=old[1].",
		),
});

const operationSchema = z.discriminatedUnion("kind", [
	addOpSchema,
	removeOpSchema,
	reorderOpSchema,
]);

export function registerChangeSignatureTool(server: McpServer): void {
	server.tool(
		"change_signature_by_tsmorph",
		`[ts-morph] Add, remove, or reorder parameters of a function/method/arrow-function and propagate the matching argument changes to every call site in the project.

## When to use
- Adding a required parameter to a function with many callers (LLM single-edit reliably misses some — this tool guarantees every call site is updated via the type checker).
- Removing or reordering parameters of a function that is imported, re-exported, or accessed through a method chain.
- Inserting a context-like first parameter (\`ctx\`, \`logger\`, etc.) into existing helpers.

## When NOT to use
- Renaming a parameter — use \`rename_symbol_by_tsmorph\` on the parameter identifier instead.
- Changing only the parameter's type annotation without changing arity — edit the source file directly.
- Moving the function to another file — use \`move_symbol_to_file_by_tsmorph\`.

## Critical constraints
- \`position\` must point at the function's name identifier (1-based line/column). For \`const foo = () => {}\`, point at \`foo\`; for \`class C { foo() {} }\`, point at \`foo\`.
- \`functionName\` must match the identifier text at that position (sanity check).
- All paths (\`tsconfigPath\`, \`targetFilePath\`) MUST be absolute.
- **Spread arguments** (\`fn(...args)\`) at call sites cause the operation to fail when a change would modify arguments. Refactor those callers manually first, or limit changes to trailing optional/defaulted parameters with no \`argumentForCallers\`.
- Operations apply sequentially; later operations see the parameter list produced by earlier ones.

## Operation semantics
- **add**: Inserts a parameter at \`index\` (default: end). If \`argumentForCallers\` is provided, that exact text is inserted at the same index in every call site. If omitted, callers are left untouched (use only for trailing optional / defaulted parameters).
- **remove**: Removes the parameter at \`index\`. Each call site with at least that many arguments drops the corresponding one. Calls passing fewer arguments are left untouched.
- **reorder**: Rebuilds the parameter list and every call site according to \`newOrder\`. Fails if any call site does not pass exactly that many arguments (no way to safely reorder omitted optionals).

## Tips
- Run with \`dryRun: true\` first when the function has many callers to preview the impacted files.
- For adding multiple parameters at once, list multiple \`add\` operations; their \`index\` values refer to the parameter list *after* prior operations in the same call have been applied.

## Result
Returns the list of modified (or to-be-modified, in dryRun) file paths, plus status and processing time.`,
		{
			tsconfigPath: z
				.string()
				.describe("Path to the project's tsconfig.json file."),
			targetFilePath: z
				.string()
				.describe("Path to the file containing the function declaration."),
			position: z
				.object({
					line: z.number().int().positive().describe("1-based line number."),
					column: z
						.number()
						.int()
						.positive()
						.describe("1-based column number."),
				})
				.describe("Exact position of the function name identifier."),
			functionName: z
				.string()
				.describe("Name of the function/method at that position."),
			changes: z
				.array(operationSchema)
				.min(1)
				.describe(
					"Ordered list of signature operations to apply. See the tool description for semantics.",
				),
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
			let changedFilesCount = 0;

			const logArgs = {
				targetFilePath: args.targetFilePath,
				functionName: args.functionName,
				operationKinds: args.changes.map((c) => c.kind),
				dryRun: args.dryRun,
			};

			try {
				const result = await changeSignature({
					tsconfigPath: args.tsconfigPath,
					targetFilePath: args.targetFilePath,
					position: args.position,
					functionName: args.functionName,
					changes: args.changes,
					dryRun: args.dryRun,
				});

				changedFilesCount = result.changedFiles.length;
				const changedFilesList =
					result.changedFiles.length > 0
						? result.changedFiles.join("\n - ")
						: "(No changes)";

				if (args.dryRun) {
					message = `Dry run complete: Changing signature of '${args.functionName}' would modify the following files:\n - ${changedFilesList}`;
				} else {
					message = `Signature change successful for '${args.functionName}'. The following files were modified:\n - ${changedFilesList}`;
				}
			} catch (error) {
				logger.error(
					{ err: error, toolArgs: logArgs },
					"Error executing change_signature_by_tsmorph",
				);
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				message = `Error during change_signature: ${errorMessage}`;
				isError = true;
			} finally {
				const endTime = performance.now();
				duration = ((endTime - startTime) / 1000).toFixed(2);
				logger.info(
					{
						status: isError ? "Failure" : "Success",
						durationMs: Number.parseFloat((endTime - startTime).toFixed(2)),
						changedFilesCount,
						...logArgs,
					},
					"change_signature_by_tsmorph tool finished",
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
