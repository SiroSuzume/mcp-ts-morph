import * as path from "node:path";
import { calculateRelativePath } from "./calculate-relative-path";

const RUNTIME_EXTENSIONS = new Set([".js", ".jsx", ".json", ".mjs", ".cjs"]);
const SOURCE_EXTENSIONS = [
	".d.mts",
	".d.cts",
	".d.ts",
	".tsx",
	".mts",
	".cts",
	".jsx",
	".mjs",
	".cjs",
	".json",
	".ts",
	".js",
];

/**
 * Calculate a relative module specifier while preserving an explicit runtime
 * extension from the original import. This matters in NodeNext projects where
 * a `.js` specifier resolves to a `.ts` source file.
 */
export function calculateModuleSpecifier(
	fromPath: string,
	toPath: string,
	originalSpecifierText: string,
	options: { simplifyIndex?: boolean } = {},
): string {
	const originalExtension = path.extname(originalSpecifierText);
	if (!RUNTIME_EXTENSIONS.has(originalExtension)) {
		return calculateRelativePath(fromPath, toPath, options);
	}

	const relativePath = calculateRelativePath(fromPath, toPath, {
		...options,
		removeExtensions: false,
	});
	const sourceExtension = SOURCE_EXTENSIONS.find((extension) =>
		relativePath.endsWith(extension),
	);

	return sourceExtension
		? `${relativePath.slice(0, -sourceExtension.length)}${originalExtension}`
		: `${relativePath}${originalExtension}`;
}
