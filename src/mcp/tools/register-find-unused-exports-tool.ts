import { performance } from "node:perf_hooks";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { initializeProject } from "../../ts-morph/_utils/ts-morph-project";
import {
	findUnusedExports,
	type UnusedExport,
} from "../../ts-morph/find-unused-exports/find-unused-exports";
import {
	summarizeUnusedExports,
	type UnusedExportsSummary,
} from "../../ts-morph/find-unused-exports/summarize-unused-exports";
import logger from "../../utils/logger";

/** summary モードで全体像を出すためのスキャン上限 (list モードの既定 100 と区別する)。 */
const SUMMARY_SCAN_CAP = 100_000;
/** summary の「ディレクトリ別」内訳で表示する最大行数。 */
const SUMMARY_TOP_DIRECTORIES = 20;

function safeLogError(error: unknown, toolArgs: Record<string, unknown>): void {
	try {
		logger.error(
			{ err: error, toolArgs },
			"Error executing find_unused_exports_by_tsmorph",
		);
	} catch (loggerErr) {
		console.error("Failed to write error log:", loggerErr);
	}
}

function safeLogInfo(fields: Record<string, unknown>): void {
	try {
		logger.info(fields, "find_unused_exports_by_tsmorph tool finished");
	} catch (loggerErr) {
		console.error("Failed to write info log:", loggerErr);
	}
}

function formatUnusedExport(entry: UnusedExport): string {
	const tag = entry.isDefaultExport ? " [default]" : "";
	return `- ${entry.filePath}:${entry.line}:${entry.column}  ${entry.name} (${entry.kind})${tag}  textHits=${entry.textOccurrences} sameFileRefs=${entry.sameFileReferenceCount}`;
}

/** ディレクトリ群の共通プレフィックスを求め、表示を短くするために切り出す。 */
function commonDirectoryPrefix(directories: string[]): string {
	if (directories.length === 0) return "";
	const split = directories.map((d) => d.split("/"));
	let prefix = split[0];
	for (const parts of split) {
		let i = 0;
		while (i < prefix.length && i < parts.length && prefix[i] === parts[i]) i++;
		prefix = prefix.slice(0, i);
	}
	return prefix.join("/");
}

function formatSummary(
	summary: UnusedExportsSummary,
	scannedFiles: number,
	truncated: boolean,
): string {
	if (summary.total === 0) {
		return `No unused exports found.\nScanned files: ${scannedFiles}\nTruncated: ${truncated}`;
	}

	const prefix = commonDirectoryPrefix(
		summary.byDirectory.map((d) => d.directory),
	);
	const strip = (dir: string): string => {
		if (!prefix) return dir;
		const rest = dir.slice(prefix.length).replace(/^\//, "");
		return rest === "" ? "." : rest;
	};

	const topDirs = summary.byDirectory.slice(0, SUMMARY_TOP_DIRECTORIES);
	const dirLines = topDirs.map((d) => `  ${strip(d.directory)}: ${d.count}`);
	const hiddenDirs = summary.byDirectory.length - topDirs.length;

	const lines = [
		`Unused export summary (total ${summary.total}):`,
		`- Delete-safety: deletable (sameFileRefs=0) = ${summary.deletable}, unexport-only (sameFileRefs>=1) = ${summary.unexportOnly}`,
		`- Default exports (low confidence, verify each): ${summary.defaultExports}`,
		`- By kind: ${summary.byKind.map((k) => `${k.kind}=${k.count}`).join(", ")}`,
		`- By directory${prefix ? ` (root: ${prefix})` : ""}, top ${topDirs.length} of ${summary.byDirectory.length}:`,
		...dirLines,
	];
	if (hiddenDirs > 0) {
		lines.push(`  ... and ${hiddenDirs} more directories`);
	}
	lines.push(
		"",
		'Re-run with responseFormat="list" (optionally entryPoints/excludeFilePatterns to narrow) to get per-symbol locations.',
		`Scanned files: ${scannedFiles}`,
		`Truncated: ${truncated}`,
	);
	return lines.join("\n");
}

export function registerFindUnusedExportsTool(server: McpServer): void {
	server.tool(
		"find_unused_exports_by_tsmorph",
		`[ts-morph] List exports that have no references outside their declaring file across the project. Read-only.

## When to use
- Hunting for dead code candidates after a refactor or migration.
- Auditing a module's surface area: which exports does nobody actually consume?
- Pre-deletion safety check before manually removing exports — combine with \`find_references_by_tsmorph\` to double-confirm.

## When NOT to use
- You want a single symbol's references — use \`find_references_by_tsmorph\`.
- Single-file unused locals — \`tsc --noUnusedLocals\` is faster.

## Detection scope
Reports:
- \`export function/class/const/let/var/enum/interface/type ...\` (inline export keyword)
- \`export default function/class ...\` and \`export default <Identifier>\`
- \`export = <Identifier>\` (CommonJS)

## Detection algorithm
For each candidate identifier, \`findReferencesAsNodes()\` is run and the following references are excluded before deciding "unused":
- References inside the SAME file as the declaration (internal use does not count).
- References inside any \`ExportDeclaration\` (pure re-export sites like \`export { x } from "./y"\` or \`export *\`). This means a symbol re-exported only via a barrel — with nothing actually consuming the barrel — IS reported as unused.
- References in \`node_modules\`.

If 0 references remain, the export is reported.

## Known limitations (this tool returns CANDIDATES, not verdicts)
Static analysis cannot see:
- Dynamic \`require()\` / \`import()\` resolved from runtime strings.
- File-system / convention based routing (Next.js \`page.tsx\`, Remix routes, etc.). Pass these as \`entryPoints\`.
- Symbols looked up via reflection or string keys.
- Pure local re-exports (\`export { x }\` without \`from\`) where \`x\` is declared by a separate \`const x = ...\` in the same file — this form is not enumerated.
- Mixed function + namespace declarations may be partially missed.

### Default exports are high false-positive
\`export default <Identifier>\` / \`export = <Identifier>\` (shown with the \`[default]\` tag) are prone to FALSE POSITIVES: \`findReferencesAsNodes\` runs on the local identifier and often fails to connect to \`import Foo from "./mod"\` default-import sites. A default export reported here with \`textHits\` well above 0 is almost certainly actually used. Treat \`[default]\` candidates as low confidence and always confirm with \`find_references_by_tsmorph\`.

Always verify a candidate with \`find_references_by_tsmorph\` before deletion.

## Options
- \`tsconfigPath\`: absolute path to \`tsconfig.json\`.
- \`entryPoints\`: list of absolute file paths whose exports should be skipped (treat as public API). Reference sites IN these files still count as "used" automatically.
- \`excludeFilePatterns\`: substrings; any file whose absolute path \`includes()\` a pattern is not scanned. Use this for test files (e.g. \`".test."\`), generated dirs, etc.
- \`maxResults\`: cap on number of reported entries. Default 100. When reached, scanning stops and \`truncated\` becomes true — narrow scope with the filters above and retry.

## Output modes (\`responseFormat\`)
- \`"list"\` (default): one line per candidate (format below).
- \`"summary"\`: aggregate counts for the WHOLE project — total, delete-safety split (deletable vs unexport-only), default-export count, and breakdowns by kind and by directory. On large repos the per-line list easily blows past the response size limit, so start with \`"summary"\` to see where dead code clusters, then narrow with \`entryPoints\` / \`excludeFilePatterns\` and switch to \`"list"\` for exact locations. (\`summary\` scans the whole project regardless of \`maxResults\`.)

## Result format (list mode)
A bullet list of candidates with file:line:column, symbol name, declaration kind, a \`[default]\` tag for default exports, \`textHits=N\`, and \`sameFileRefs=N\`.

### \`sameFileRefs\` — decides delete vs. unexport (read this first)
Every reported export is, by definition, unreferenced OUTSIDE its declaring file. \`sameFileRefs\` tells you whether it is still used INSIDE that file (declaration itself and re-export sites excluded), which determines the safe action:
- \`sameFileRefs=0\`: not used anywhere, including its own file → **truly dead, safe to delete the whole declaration** (combine with \`textHits=0\` for highest confidence).
- \`sameFileRefs=1+\`: used within its own file → **only the \`export\` keyword is unnecessary**. Remove \`export\`, but KEEP the declaration — deleting it breaks the in-file references.

Deleting every reported declaration blindly will break the build: the majority are often \`sameFileRefs=1+\` (over-exported but internally used).

### \`textHits\` — text-occurrence triage hint
\`textHits\` is the number of word-boundary occurrences of the export's name in OTHER source files (declaring file excluded — so it says nothing about same-file usage; use \`sameFileRefs\` for that):
- \`textHits=0\`: no OTHER file mentions the name. Does NOT by itself mean deletable — still check \`sameFileRefs\`.
- \`textHits=1+\`: the name appears as a string literal, JSX tag, dynamic \`import().then(m => m.X)\`, or comment. Verify with \`find_references_by_tsmorph\` before deleting. Short names (e.g. \`a\`, \`id\`) match incidentally — discount accordingly.

Trailing line reports \`Scanned files: N\` and \`Truncated: bool\`.`,
		{
			tsconfigPath: z
				.string()
				.describe("Absolute path to the project's tsconfig.json."),
			entryPoints: z
				.array(z.string())
				.optional()
				.describe(
					"Absolute file paths to treat as public API. Exports declared here are skipped.",
				),
			excludeFilePatterns: z
				.array(z.string())
				.optional()
				.describe(
					"Substrings; files whose absolute path includes any of these are not scanned.",
				),
			maxResults: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					'Cap on reported entries (list mode). Default 100. Ignored intent in "summary" mode, which scans the whole project.',
				),
			responseFormat: z
				.enum(["list", "summary"])
				.optional()
				.default("list")
				.describe(
					'"list" (default): one line per candidate. "summary": aggregate counts (delete-safety / kind / directory) for the WHOLE project — use this first on large repos to avoid huge output, then narrow with entryPoints/excludeFilePatterns and switch to "list".',
				),
			expandNamespaceImports: z
				.boolean()
				.optional()
				.default(true)
				.describe(
					"Default true. Inject synthetic named imports into files containing `import * as ns from \"./mod\"` so that exports of the target module register as 'used' even when consumed only via `{ ...ns }` spread or other escaping patterns. Set to false if you want raw findReferences semantics.",
				),
		},
		async (args) => {
			const startTime = performance.now();
			let message = "";
			let isError = false;
			let duration = "0.00";

			const isSummary = args.responseFormat === "summary";

			const logArgs = {
				tsconfigPath: args.tsconfigPath,
				entryPoints: args.entryPoints,
				excludeFilePatterns: args.excludeFilePatterns,
				maxResults: args.maxResults,
				responseFormat: args.responseFormat,
				expandNamespaceImports: args.expandNamespaceImports,
			};

			try {
				const project = initializeProject(args.tsconfigPath);
				// summary は全体像が目的なので、ユーザー指定が無ければ実質無制限でスキャンする。
				const effectiveMaxResults = isSummary
					? (args.maxResults ?? SUMMARY_SCAN_CAP)
					: args.maxResults;
				const result = findUnusedExports(project, {
					entryPoints: args.entryPoints,
					excludeFilePatterns: args.excludeFilePatterns,
					maxResults: effectiveMaxResults,
					expandNamespaceImports: args.expandNamespaceImports,
				});

				if (isSummary) {
					message = formatSummary(
						summarizeUnusedExports(result.unusedExports),
						result.scannedFiles,
						result.truncated,
					);
				} else if (result.unusedExports.length === 0) {
					message = `No unused exports found.\nScanned files: ${result.scannedFiles}\nTruncated: ${result.truncated}`;
				} else {
					const lines = [
						`Unused export candidates (${result.unusedExports.length}):`,
						...result.unusedExports.map(formatUnusedExport),
						"",
						`Scanned files: ${result.scannedFiles}`,
						`Truncated: ${result.truncated}`,
					];
					message = lines.join("\n");
				}
			} catch (error) {
				safeLogError(error, logArgs);
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				message = `Error: ${errorMessage}`;
				isError = true;
			} finally {
				const endTime = performance.now();
				duration = ((endTime - startTime) / 1000).toFixed(2);
				safeLogInfo({
					status: isError ? "Failure" : "Success",
					durationMs: Number.parseFloat((endTime - startTime).toFixed(2)),
					...logArgs,
				});
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
