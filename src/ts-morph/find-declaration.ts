import {
	type SourceFile,
	type Statement,
	SyntaxKind,
	type VariableStatement,
	type FunctionDeclaration,
	type ClassDeclaration,
	type InterfaceDeclaration,
	type TypeAliasDeclaration,
	type EnumDeclaration,
} from "ts-morph";

/**
 * SourceFile 内から指定された名前と（オプションで）種類に一致する最初のトップレベル宣言を見つける。
 *
 * 同名の宣言が複数存在する場合（例: 型と値、関数オーバーロード）、ファイル内で最初に出現するものが返される。
 * VariableStatement 内に複数の VariableDeclaration がある場合、指定された名前に一致する Declaration を含む
 * 最初の VariableStatement が返される。
 *
 * @param sourceFile 検索対象の SourceFile
 * @param name 検索する宣言の名前
 * @param kind オプション: 検索する宣言の種類 (SyntaxKind)
 * @returns 見つかった Statement、または undefined
 */
export function findTopLevelDeclarationByName(
	sourceFile: SourceFile,
	name: string,
	kind?: SyntaxKind,
): Statement | undefined {
	// 1. ファイル直下のすべてのステートメントを取得
	const allStatements = sourceFile.getStatements();

	// 2. 宣言リストを走査
	for (const statement of allStatements) {
		const currentKind = statement.getKind();

		// 3. kind が指定されていれば、種類が一致するか確認
		if (kind !== undefined && currentKind !== kind) {
			continue;
		}

		// 4. 宣言の名前を取得して比較
		let declarationName: string | undefined;
		let foundMatch = false;

		if (currentKind === SyntaxKind.VariableStatement) {
			const varStatement = statement as VariableStatement;
			// VariableStatement 内の Declaration をチェック
			for (const varDecl of varStatement.getDeclarations()) {
				if (varDecl.getName() === name) {
					declarationName = name; // 名前が見つかったことを記録
					foundMatch = true;
					break; // この VariableStatement が対象
				}
			}
		} else if (
			// getName() を持つ可能性のある宣言
			currentKind === SyntaxKind.FunctionDeclaration ||
			currentKind === SyntaxKind.ClassDeclaration ||
			currentKind === SyntaxKind.InterfaceDeclaration ||
			currentKind === SyntaxKind.TypeAliasDeclaration ||
			currentKind === SyntaxKind.EnumDeclaration
		) {
			const namedDeclaration = statement as
				| FunctionDeclaration
				| ClassDeclaration
				| InterfaceDeclaration
				| TypeAliasDeclaration
				| EnumDeclaration;
			// デフォルトエクスポートの場合、getName() は undefined だが、シンボル名でマッチさせたい場合がある
			// ここでは isDefaultExport() と実際の名前を比較
			if (namedDeclaration.isDefaultExport?.()) {
				// デフォルトエクスポートされた関数/クラスの名前を取得しようと試みる
				// 例: export default function myFunction() {} -> "myFunction"
				const actualName = namedDeclaration.getName?.();
				if (actualName === name) {
					declarationName = actualName;
					foundMatch = true;
				}
				// 'default' という名前での検索は現状サポートしない
			} else {
				declarationName = namedDeclaration.getName?.();
				if (declarationName === name) {
					foundMatch = true;
				}
			}
		}
		// 他の種類のトップレベル宣言 (ExportDeclaration など) は名前での検索対象外

		// 5. 名前と種類 (指定されていれば) が一致したら返す
		if (foundMatch) {
			// kind の再チェック (VariableStatement 全体としての kind はチェック済み)
			if (kind === undefined || currentKind === kind) {
				return statement;
			}
		}
	}

	// 6. 見つからなければ undefined を返す
	return undefined;
}
