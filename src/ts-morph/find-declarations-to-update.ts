import {
	type Project,
	type SourceFile,
	type Directory,
	Node,
	type Identifier,
	type ImportDeclaration,
	type ExportDeclaration,
} from "ts-morph";
import { findAllReferencesAsNodes } from "./rename-symbol";
import * as path from "node:path";
import type { DeclarationToUpdate } from "./types";

// ヘルパー: 参照検索のための Identifier を見つける
function getIdentifierForExportReferenceSearch(
	declaration: Node,
): Identifier | undefined {
	if (
		Node.isVariableDeclaration(declaration) ||
		Node.isFunctionDeclaration(declaration) ||
		Node.isClassDeclaration(declaration) ||
		Node.isInterfaceDeclaration(declaration) ||
		Node.isTypeAliasDeclaration(declaration) ||
		Node.isEnumDeclaration(declaration)
	) {
		const nameNode = declaration.getNameNode();
		return nameNode && Node.isIdentifier(nameNode) ? nameNode : undefined;
	}
	if (Node.isExportSpecifier(declaration)) {
		const identifier = declaration.getNameNode();
		return identifier && Node.isIdentifier(identifier) ? identifier : undefined;
	}
	if (Node.isExportAssignment(declaration)) {
		const expression = declaration.getExpression();
		return expression && Node.isIdentifier(expression) ? expression : undefined;
	}
	return undefined;
}

// ヘルパー: ファイル内のエクスポートへのすべての参照を見つける
function findAllReferencesToExports(targetFile: SourceFile): Node[] {
	const allReferencingNodes: Node[] = [];
	const allDeclarations = [
		...targetFile.getExportedDeclarations().values(),
	].flat();

	for (const declaration of allDeclarations) {
		const identifierNode = getIdentifierForExportReferenceSearch(declaration);
		if (identifierNode) {
			allReferencingNodes.push(...findAllReferencesAsNodes(identifierNode));
		}
	}
	return allReferencingNodes;
}

// ヘルパー: 祖先の Import/Export 宣言を見つける
function findAncestorDeclaration(
	node: Node,
): ImportDeclaration | ExportDeclaration | undefined {
	for (const ancestor of node.getAncestors()) {
		if (
			Node.isImportDeclaration(ancestor) ||
			Node.isExportDeclaration(ancestor)
		) {
			return ancestor;
		}
	}
	return undefined;
}

/**
 * Finds all Import/Export declarations that reference the target file.
 */
export function findDeclarationsReferencingFile(
	targetFile: SourceFile,
): DeclarationToUpdate[] {
	const results: DeclarationToUpdate[] = [];
	const targetFilePath = targetFile.getFilePath();
	const allReferencingNodes = findAllReferencesToExports(targetFile);
	const externalReferencingNodes = allReferencingNodes.filter(
		(node) => node.getSourceFile().getFilePath() !== targetFilePath,
	);
	const uniqueDeclarations = new Set<ImportDeclaration | ExportDeclaration>();

	for (const refNode of externalReferencingNodes) {
		const declaration = findAncestorDeclaration(refNode);
		if (!declaration || uniqueDeclarations.has(declaration)) {
			continue;
		}

		const moduleSpecifier = declaration.getModuleSpecifier();
		const specifierSourceFile = declaration.getModuleSpecifierSourceFile();
		const originalSpecifierText = moduleSpecifier?.getLiteralText();

		if (
			moduleSpecifier &&
			originalSpecifierText &&
			specifierSourceFile?.getFilePath() === targetFilePath
		) {
			results.push({
				declaration,
				resolvedPath: targetFilePath,
				referencingFilePath: declaration.getSourceFile().getFilePath(),
				originalSpecifierText,
			});
			uniqueDeclarations.add(declaration);
		}
	}
	return results;
}

/**
 * Finds all Import/Export declarations that reference the target directory or files within it.
 */
export function findDeclarationsReferencingDirectory(
	project: Project,
	targetDirectory: Directory,
): DeclarationToUpdate[] {
	const results: DeclarationToUpdate[] = [];
	const oldDirectoryPath = targetDirectory.getPath();
	const uniqueDeclarations = new Set<ImportDeclaration | ExportDeclaration>();

	for (const sourceFile of project.getSourceFiles()) {
		const referencingFilePath = sourceFile.getFilePath();
		// 移動対象ディレクトリ内のファイルはスキップ
		if (referencingFilePath.startsWith(oldDirectoryPath + path.sep)) {
			continue;
		}

		const declarations = [
			...sourceFile.getImportDeclarations(),
			...sourceFile.getExportDeclarations(),
		];

		for (const declaration of declarations) {
			if (uniqueDeclarations.has(declaration)) continue;

			const moduleSpecifier = declaration.getModuleSpecifier();
			if (!moduleSpecifier) continue;

			const originalSpecifierText = moduleSpecifier.getLiteralText();

			const resolvedSourceFile = declaration.getModuleSpecifierSourceFile();
			if (!resolvedSourceFile) continue;

			const resolvedPath = resolvedSourceFile.getFilePath();

			// 解決されたパスがディレクトリ自体か、その内部にあるかを確認
			if (
				resolvedPath.startsWith(oldDirectoryPath + path.sep) ||
				resolvedPath === oldDirectoryPath
			) {
				if (originalSpecifierText) {
					results.push({
						declaration,
						resolvedPath,
						referencingFilePath,
						originalSpecifierText,
					});
					uniqueDeclarations.add(declaration);
				}
			}
		}
	}
	return results;
}
