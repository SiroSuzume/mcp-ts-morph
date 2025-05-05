import logger from "../../../utils/logger";
import { calculateRelativePath } from "../../_utils/calculate-relative-path";
import type {
	DependencyClassification,
	NeededExternalImports,
} from "../../types";

type ExtendedImportInfo = {
	defaultName?: string;
	namedImports: Set<string>;
	isNamespaceImport: boolean;
	namespaceImportName?: string;
};

export type ImportMap = Map<string, ExtendedImportInfo>;

function aggregateImports(
	importMap: ImportMap,
	relativePath: string,
	importName: string,
	isDefault: boolean,
) {
	if (isDefault) {
		const actualDefaultName = importName;
		if (!importMap.has(relativePath)) {
			importMap.set(relativePath, {
				namedImports: new Set(),
				isNamespaceImport: false,
			});
		}
		const entry = importMap.get(relativePath);
		if (!entry || entry.isNamespaceImport) {
			logger.warn(
				`Skipping default import aggregation for ${relativePath} due to existing namespace import or missing entry.`,
			);
			return;
		}
		entry.defaultName = actualDefaultName;
		logger.debug(
			`Aggregated default import: ${actualDefaultName} for path: ${relativePath}`,
		);
		return;
	}
	const nameToAdd = importName;
	if (!importMap.has(relativePath)) {
		importMap.set(relativePath, {
			namedImports: new Set(),
			isNamespaceImport: false,
		});
	}
	const entry = importMap.get(relativePath);
	if (!entry || entry.isNamespaceImport) {
		logger.warn(
			`Skipping named import aggregation for ${relativePath} due to existing namespace import or missing entry.`,
		);
		return;
	}
	entry.namedImports.add(nameToAdd);
	logger.debug(
		`Aggregated named import: ${nameToAdd} for path: ${relativePath}`,
	);
}

function processExternalImports(
	importMap: ImportMap,
	neededExternalImports: NeededExternalImports,
	newFilePath: string,
): void {
	logger.debug("Processing external imports...");
	for (const [
		originalModuleSpecifier,
		{ names, declaration, isNamespaceImport, namespaceImportName },
	] of neededExternalImports.entries()) {
		const moduleSourceFile = declaration?.getModuleSpecifierSourceFile();
		let relativePath = "";
		let isSelfReference = false;

		if (
			moduleSourceFile &&
			!moduleSourceFile.getFilePath().includes("/node_modules/")
		) {
			const absoluteModulePath = moduleSourceFile.getFilePath();
			if (absoluteModulePath === newFilePath) {
				isSelfReference = true;
			} else {
				relativePath = calculateRelativePath(newFilePath, absoluteModulePath);
				logger.debug(
					`Calculated relative path for NON-node_modules import: ${relativePath} (from ${absoluteModulePath})`,
				);
			}
		} else {
			relativePath = originalModuleSpecifier;
			logger.debug(
				`Using original module specifier for node_modules or unresolved import: ${relativePath}`,
			);
		}

		if (isSelfReference) {
			logger.debug(`Skipping self-reference import for path: ${newFilePath}`);
			continue;
		}

		if (isNamespaceImport && namespaceImportName) {
			if (!importMap.has(relativePath)) {
				importMap.set(relativePath, {
					namedImports: new Set(),
					isNamespaceImport: true,
					namespaceImportName: namespaceImportName,
				});
				logger.debug(
					`Added namespace import: ${namespaceImportName} for path: ${relativePath}`,
				);
			} else {
				logger.warn(
					`Namespace import for ${relativePath} conflicts with existing non-namespace imports. Skipping.`,
				);
			}
			continue;
		}

		const defaultImportNode = declaration?.getDefaultImport();
		const actualDefaultName = defaultImportNode?.getText();

		for (const name of names) {
			const isDefaultFlag = name === "default" && !!actualDefaultName;
			if (isDefaultFlag) {
				if (!actualDefaultName) {
					logger.warn(
						`Default import name was expected but not found for ${relativePath}. Skipping default import.`,
					);
					continue;
				}
				aggregateImports(importMap, relativePath, actualDefaultName, true);
			} else {
				aggregateImports(importMap, relativePath, name, false);
			}
		}
	}
}

function processInternalDependencies(
	importMap: ImportMap,
	classifiedDependencies: DependencyClassification[],
	newFilePath: string,
	originalFilePath: string,
): void {
	logger.debug("Processing internal dependencies for import map...");

	if (newFilePath === originalFilePath) {
		logger.debug(
			"Skipping internal dependency processing as source and target files are the same.",
		);
		return;
	}

	const dependenciesToImportNames = new Set<string>();

	for (const dep of classifiedDependencies) {
		if (dep.type === "importFromOriginal" || dep.type === "addExport") {
			logger.debug(`Internal dependency to import from original: ${dep.name}`);
			dependenciesToImportNames.add(dep.name);
		}
	}

	if (dependenciesToImportNames.size === 0) {
		logger.debug("No internal dependencies need importing from original file.");
		return;
	}

	const internalImportPath = calculateRelativePath(
		newFilePath,
		originalFilePath,
	);
	logger.debug(
		`Calculated relative path for internal import: ${internalImportPath}`,
	);

	if (internalImportPath !== "." && internalImportPath !== "./") {
		for (const name of dependenciesToImportNames) {
			aggregateImports(importMap, internalImportPath, name, false);
		}
	} else {
		logger.debug("Skipping aggregation for self-referencing internal path.");
	}
}

function buildImportStatementString(
	defaultImportName: string | undefined,
	namedImportSpecifiers: string,
	relativePath: string,
	isNamespaceImport: boolean,
	namespaceImportName?: string,
): string {
	const fromPart = `from "${relativePath}";`;
	if (isNamespaceImport && namespaceImportName) {
		return `import * as ${namespaceImportName} ${fromPart}`;
	}
	if (!defaultImportName && !namedImportSpecifiers) {
		logger.debug(`Building side-effect import for ${relativePath}`);
		return `import ${fromPart}`;
	}
	const defaultPart = defaultImportName ? `${defaultImportName}` : "";
	const namedPart = namedImportSpecifiers ? `{ ${namedImportSpecifiers} }` : "";
	const separator = defaultPart && namedPart ? ", " : "";
	return `import ${defaultPart}${separator}${namedPart} ${fromPart}`;
}

export function calculateRequiredImportMap(
	neededExternalImports: NeededExternalImports,
	classifiedDependencies: DependencyClassification[],
	newFilePath: string,
	originalFilePath: string,
): ImportMap {
	const importMap: ImportMap = new Map();
	processExternalImports(importMap, neededExternalImports, newFilePath);
	processInternalDependencies(
		importMap,
		classifiedDependencies,
		newFilePath,
		originalFilePath,
	);
	return importMap;
}

export function buildImportSectionStringFromMap(importMap: ImportMap): string {
	logger.debug("Generating import section string...");
	let importSection = "";
	const sortedPaths = [...importMap.keys()].sort();
	for (const path of sortedPaths) {
		const importData = importMap.get(path);
		if (!importData) {
			logger.warn(`Import data not found for path ${path} during generation.`);
			continue;
		}
		const {
			defaultName,
			namedImports,
			isNamespaceImport,
			namespaceImportName,
		} = importData;
		const sortedNamedImports = [...namedImports].sort().join(", ");
		const importStatement = buildImportStatementString(
			defaultName,
			sortedNamedImports,
			path,
			isNamespaceImport,
			namespaceImportName,
		);
		if (importStatement) {
			importSection += `${importStatement}\n`;
		}
	}
	if (importSection) {
		importSection += "\n";
	}
	logger.debug(`Generated Import Section String:
${importSection}`);
	return importSection;
}
