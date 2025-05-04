import {
	type SourceFile,
	type ImportDeclaration,
	StructureKind,
	type OptionalKind,
	type ImportSpecifierStructure,
} from "ts-morph";
import logger from "../../utils/logger";

/**
 * 文字列から名前付きインポートの構造 (名前とエイリアス) を解析します。
 * 例: "name" -> { name: "name" }
 * 例: "original as alias" -> { name: "original", alias: "alias" }
 */
function parseNamedImport(
	symbolString: string,
): OptionalKind<ImportSpecifierStructure> {
	const aliasMatch = symbolString.match(/^(.+?)\s+as\s+(.+)$/);
	if (aliasMatch) {
		return {
			name: aliasMatch[1].trim(),
			alias: aliasMatch[2].trim(),
			kind: StructureKind.ImportSpecifier,
		};
	}
	return { name: symbolString.trim(), kind: StructureKind.ImportSpecifier };
}

/**
 * 指定された ImportDeclaration から特定の名前付きインポートを削除します。
 * もしその宣言がそのシンボルのみをインポートしていた場合、宣言自体も削除します。
 */
export function removeNamedImport(
	importDeclaration: ImportDeclaration, // SourceFile と moduleSpecifier の代わりに ImportDeclaration を受け取る
	symbolToRemove: string, // "name" or "original as alias" 形式
): void {
	if (importDeclaration.wasForgotten()) return; // すでに削除されていたら何もしない

	const parsedSymbolToRemove = parseNamedImport(symbolToRemove);
	const namedImports = importDeclaration.getNamedImports();
	const importSpecifierToRemove = namedImports.find((specifier) => {
		const name = specifier.getName();
		const alias = specifier.getAliasNode()?.getText();
		if (parsedSymbolToRemove.alias) {
			return (
				name === parsedSymbolToRemove.name &&
				alias === parsedSymbolToRemove.alias
			);
		}
		return name === parsedSymbolToRemove.name && !alias;
	});

	if (importSpecifierToRemove) {
		if (
			namedImports.length === 1 &&
			!importDeclaration.getDefaultImport() &&
			!importDeclaration.getNamespaceImport()
		) {
			importDeclaration.remove();
		} else {
			importSpecifierToRemove.remove();
		}
	}
}

/**
 * 指定されたモジュールから特定の名前付きインポートを追加または更新します。
 * 既に同じモジュールからのインポート宣言が存在する場合は、そこにシンボルを追加します。
 * 存在しない場合は、新しいインポート宣言を作成します。エイリアスも考慮します。
 */
export function addOrUpdateNamedImport(
	sourceFile: SourceFile,
	moduleSpecifier: string,
	symbolToAdd: string, // "name" または "original as alias" 形式
): void {
	const parsedImport = parseNamedImport(symbolToAdd);
	// モジュール指定子が一致する最初の宣言を探す (引用符無視)
	const potentialDeclaration = sourceFile
		.getImportDeclarations()
		.find(
			(decl) =>
				decl.getModuleSpecifierValue().replace(/['"]/g, "") ===
				moduleSpecifier.replace(/['"]/g, ""),
		);

	// 既存の宣言があり、かつ NamespaceImport でない場合に追加を試みる
	if (potentialDeclaration && !potentialDeclaration.getNamespaceImport()) {
		const declarationToUpdate = potentialDeclaration;
		const namedImports = declarationToUpdate.getNamedImports();
		const alreadyExists = namedImports.some((ni) => {
			const name = ni.getName();
			const alias = ni.getAliasNode()?.getText();
			if (parsedImport.alias) {
				return name === parsedImport.name && alias === parsedImport.alias;
			}
			return name === parsedImport.name && !alias; // エイリアスなしの場合もチェック
		});

		if (!alreadyExists) {
			// 既存の namedImports がなくても addNamedImport は動作するはず
			declarationToUpdate.addNamedImport(parsedImport);
		} else {
			logger.debug(
				`Named import '${symbolToAdd}' already exists in declaration from '${moduleSpecifier}'`,
			);
		}
	} else if (!potentialDeclaration) {
		// 潜在的な宣言すら見つからなかった場合のみ新規作成
		sourceFile.addImportDeclaration({
			kind: StructureKind.ImportDeclaration,
			namedImports: [parsedImport],
			moduleSpecifier: moduleSpecifier,
		});
	} else {
		// NamespaceImport だった場合など (ログは上で出力済み)
	}
}
