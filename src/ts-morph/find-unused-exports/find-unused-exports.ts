import * as path from "node:path";
import {
	type ImportDeclaration,
	Node,
	type Project,
	type SourceFile,
} from "ts-morph";
import logger from "../../utils/logger";

export interface UnusedExport {
	/** export を宣言しているファイルの絶対パス */
	filePath: string;
	/** 識別子の 1-based 行番号 */
	line: number;
	/** 識別子の 1-based 列番号 */
	column: number;
	/** export 名 (`export default` の場合は元の識別子名、`export default 42` のような無名は対象外) */
	name: string;
	/** 宣言ノードの SyntaxKind 名 (FunctionDeclaration / ClassDeclaration / VariableDeclaration / EnumDeclaration / InterfaceDeclaration / TypeAliasDeclaration / ExportAssignment) */
	kind: string;
	/** `export default` か (`export = x` を含む) */
	isDefaultExport: boolean;
	/**
	 * 同名識別子のテキスト出現数 (**宣言ファイルは除外**、`\bname\b` 単語境界マッチ、合成 import は除外)。
	 * - 0: 宣言ファイルの**外**には名前が一切現れない。ただし同一ファイル内での使用は別途
	 *   `sameFileReferenceCount` を参照すること (このフィールドだけでは「宣言ごと削除して安全」は判断できない)。
	 * - 1+: JSX 名 / 文字列リテラル / 動的参照 (`import().then`) などで触れている可能性あり。
	 *   `find_references_by_tsmorph` で要確認。短い名前 (`a`, `id` 等) は偶然一致しやすいので注意。
	 */
	textOccurrences: number;
	/**
	 * 宣言と同じファイル内での参照数 (宣言自身の識別子と、`export { x }` 等の再エクスポートサイトは除外)。
	 *
	 * この export は定義上「宣言ファイルの**外**では未参照」なので、削除アクションはこの値で決まる:
	 * - `0`: 同一ファイル内でも使われていない = **真のデッド**。宣言ごと削除して安全
	 *   (`textOccurrences === 0` も併せて確認するとより確実)。
	 * - `1+`: 同一ファイル内では使用されている = **過剰 export**。宣言は生きているため、
	 *   `export` キーワードのみ外す (宣言ごと削除すると同一ファイル内参照が壊れる)。
	 */
	sameFileReferenceCount: number;
}

export interface FindUnusedExportsOptions {
	/** これらの絶対パスのファイルは「公開 API」とみなし export を報告しない */
	entryPoints?: string[];
	/** 部分文字列のいずれかを filePath に含むファイルはスキャン対象から除外 */
	excludeFilePatterns?: string[];
	/** 上限件数 (デフォルト 100)。超えた時点でスキャンを打ち切り `truncated=true` を返す */
	maxResults?: number;
	/**
	 * `import * as ns from "./mod"` を消費するファイルに、解析専用の named import を合成注入する。
	 * デフォルト true。namespace 経由でしか使われていない export を「使用中」と認識させ、偽陽性を減らす。
	 * 注入されたファイルは保存しないが、Project インスタンスは書き換わるため、
	 * 呼び出し側で同じ Project を別の目的に使い回す場合は false を渡すこと。
	 */
	expandNamespaceImports?: boolean;
}

export interface FindUnusedExportsResult {
	unusedExports: UnusedExport[];
	/** maxResults に達して打ち切られたか */
	truncated: boolean;
	/** 実際にスキャン対象となったファイル数 (除外後) */
	scannedFiles: number;
}

const DEFAULT_MAX_RESULTS = 100;

interface ExportCandidate {
	name: string;
	identifier: Node;
	declarationKind: string;
	isDefaultExport: boolean;
}

/**
 * プロジェクト全体を走査し、宣言ファイルの外で参照されていない export を列挙する。
 *
 * ## 検出対象
 * - インライン export: `export function/class/const/let/var/enum/interface/type`
 * - `export default <Identifier>` および `export default function/class`
 * - `export = <Identifier>` (CommonJS)
 *
 * ## 「使われていない」の判定基準
 * 識別子に対する `findReferencesAsNodes()` の結果から以下を除外して 0 件なら未使用とする:
 * - 同じファイル内の参照 (内部利用は対象外)
 * - `ExportDeclaration` 配下の参照 (`export { x } from "./y"` など純粋な再エクスポート)
 * - `node_modules` 内の参照
 *
 * ## namespace import 展開 (デフォルト ON)
 * `import * as ns from "./mod"` + `{ ...ns }` / `ns` escape のような動的アクセスパターンでは
 * 個別 export の識別子参照が発生しないため、本来使われている export を未使用と誤判定しがち。
 * これを軽減するため、解析開始時に namespace import 消費ファイルへ
 * `import { a as __synthetic__, b as __synthetic__ } from "./mod"` を合成注入し、
 * 全 named export に強制的に参照を作る (`expandNamespaceImports: false` で無効化可)。
 *
 * ## 既知の限界
 * 静的解析の都合上、以下は検出できない / 偽陽性になり得る:
 * - 動的 `require` / `import()` で文字列から呼ばれる export
 * - ファイルベースルーティング (Next.js の `page.tsx` 等) の規約による暗黙参照
 * - テスト / build / config から文字列で参照される export
 * - 純粋ローカル再エクスポート (`export { x }` の `x` を別の場所で `const x` 宣言したケース) は
 *   現実装では `ExportDeclaration` として扱われるため候補から外す
 *
 * 完璧な検出はできないため、`entryPoints` で公開 API を、`excludeFilePatterns` で
 * テスト / 規約ファイルを除外して候補を絞ることを前提とする。
 */
export function findUnusedExports(
	project: Project,
	options: FindUnusedExportsOptions = {},
): FindUnusedExportsResult {
	const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
	if (!Number.isInteger(maxResults) || maxResults < 1) {
		throw new Error(
			`maxResults は 1 以上の整数で指定してください (受信値: ${maxResults})`,
		);
	}

	const entryPointSet = new Set(
		(options.entryPoints ?? []).map((p) => path.resolve(p)),
	);
	const excludePatterns = options.excludeFilePatterns ?? [];

	const cleanup =
		(options.expandNamespaceImports ?? true)
			? expandNamespaceImports(project)
			: () => {};

	try {
		const sourceFiles = project.getSourceFiles().filter((sf) => {
			if (sf.isInNodeModules()) return false;
			if (sf.isDeclarationFile()) return false;
			const fp = sf.getFilePath();
			if (entryPointSet.has(fp)) return false;
			if (excludePatterns.some((p) => fp.includes(p))) return false;
			return true;
		});

		const unusedExports: UnusedExport[] = [];
		let truncated = false;

		outer: for (const sourceFile of sourceFiles) {
			for (const candidate of collectExportCandidates(sourceFile)) {
				const usage = analyzeExportUsage(candidate.identifier, sourceFile);
				if (!usage || !usage.externallyUnused) continue;

				const startPos = candidate.identifier.getStart();
				const { line, column } = sourceFile.getLineAndColumnAtPos(startPos);
				unusedExports.push({
					filePath: sourceFile.getFilePath(),
					line,
					column,
					name: candidate.name,
					kind: candidate.declarationKind,
					isDefaultExport: candidate.isDefaultExport,
					textOccurrences: countTextOccurrences(
						candidate.name,
						sourceFile,
						project,
					),
					sameFileReferenceCount: usage.sameFileReferenceCount,
				});

				if (unusedExports.length >= maxResults) {
					truncated = true;
					break outer;
				}
			}
		}

		return {
			unusedExports,
			truncated,
			scannedFiles: sourceFiles.length,
		};
	} finally {
		cleanup();
	}
}

function collectExportCandidates(sf: SourceFile): ExportCandidate[] {
	const result: ExportCandidate[] = [];

	for (const stmt of sf.getStatements()) {
		if (Node.isFunctionDeclaration(stmt) && stmt.isExported()) {
			const nameNode = stmt.getNameNode();
			if (nameNode) {
				result.push({
					name: nameNode.getText(),
					identifier: nameNode,
					declarationKind: "FunctionDeclaration",
					isDefaultExport: stmt.hasDefaultKeyword(),
				});
			}
			continue;
		}

		if (Node.isClassDeclaration(stmt) && stmt.isExported()) {
			const nameNode = stmt.getNameNode();
			if (nameNode) {
				result.push({
					name: nameNode.getText(),
					identifier: nameNode,
					declarationKind: "ClassDeclaration",
					isDefaultExport: stmt.hasDefaultKeyword(),
				});
			}
			continue;
		}

		if (Node.isVariableStatement(stmt) && stmt.isExported()) {
			for (const decl of stmt.getDeclarations()) {
				const nameNode = decl.getNameNode();
				// 分割代入は対象外 (BindingPattern → 個別 Identifier は再帰で扱えるが MVP では除外)
				if (Node.isIdentifier(nameNode)) {
					result.push({
						name: nameNode.getText(),
						identifier: nameNode,
						declarationKind: "VariableDeclaration",
						isDefaultExport: false,
					});
				}
			}
			continue;
		}

		if (Node.isEnumDeclaration(stmt) && stmt.isExported()) {
			const nameNode = stmt.getNameNode();
			result.push({
				name: nameNode.getText(),
				identifier: nameNode,
				declarationKind: "EnumDeclaration",
				isDefaultExport: false,
			});
			continue;
		}

		if (Node.isInterfaceDeclaration(stmt) && stmt.isExported()) {
			const nameNode = stmt.getNameNode();
			result.push({
				name: nameNode.getText(),
				identifier: nameNode,
				declarationKind: "InterfaceDeclaration",
				isDefaultExport: false,
			});
			continue;
		}

		if (Node.isTypeAliasDeclaration(stmt) && stmt.isExported()) {
			const nameNode = stmt.getNameNode();
			result.push({
				name: nameNode.getText(),
				identifier: nameNode,
				declarationKind: "TypeAliasDeclaration",
				isDefaultExport: false,
			});
			continue;
		}

		if (Node.isExportAssignment(stmt)) {
			// `export default <expr>` / `export = <expr>` のうち、参照可能な Identifier のみ対象
			const expr = stmt.getExpression();
			if (Node.isIdentifier(expr)) {
				result.push({
					name: expr.getText(),
					identifier: expr,
					declarationKind: "ExportAssignment",
					isDefaultExport: !stmt.isExportEquals(),
				});
			}
		}
	}

	return result;
}

interface ExportUsage {
	/** 宣言ファイルの外で (実利用として) 参照されていないか */
	externallyUnused: boolean;
	/** 宣言と同じファイル内での参照数 (宣言自身の識別子・再エクスポートサイトは除外) */
	sameFileReferenceCount: number;
}

/**
 * 識別子の参照を解析し、「宣言ファイルの外での未使用判定」と「同一ファイル内参照数」を返す。
 *
 * 共通の除外ルール (外部・同一ファイル両方に適用):
 * - `node_modules` 内の参照は無視する。
 * - 再エクスポートサイト (`export { x } from "./y"` や同一ファイル内の `export { x }`) は
 *   実利用ではないので無視する。
 *
 * その上で:
 * - 宣言ファイル**外**に上記以外の参照が 1 つでもあれば `externallyUnused = false`。
 * - 宣言ファイル**内**の参照 (宣言自身の識別子ノードを除く) を `sameFileReferenceCount` に数える。
 *
 * findReferences が不能 / 失敗するノード (`export = 任意式` 等、TypeChecker 解決失敗) は
 * 判断不能とみなして `null` を返し、呼び出し側で候補から除外する (false negative の可能性をログに残す)。
 */
function analyzeExportUsage(
	identifier: Node,
	declSourceFile: SourceFile,
): ExportUsage | null {
	const findable = identifier as Node & {
		findReferencesAsNodes?: () => Node[];
	};
	if (typeof findable.findReferencesAsNodes !== "function") {
		return null;
	}

	let refs: Node[];
	try {
		refs = findable.findReferencesAsNodes();
	} catch (error) {
		// TypeChecker 側の解決失敗は判断不能とみなして候補から除外する。
		// 「未使用ではない」として返すと真陽性を隠してしまうので、解析劣化の事実をログに残す。
		logger.warn(
			{
				err: error,
				name: identifier.getText(),
				filePath: declSourceFile.getFilePath(),
			},
			"findReferencesAsNodes でエラーが発生したため候補から除外します (false negative の可能性)",
		);
		return null;
	}

	// findReferencesAsNodes は宣言自身の識別子ノードも結果に含むため、同一ファイル内参照の
	// カウントから除外する。位置はファイル内で一意なので (file, start) で同定する。
	const declStart = identifier.getStart();

	let externallyUnused = true;
	let sameFileReferenceCount = 0;
	for (const ref of refs) {
		const refFile = ref.getSourceFile();
		if (refFile.isInNodeModules()) continue;
		if (ref.getFirstAncestor(Node.isExportDeclaration)) continue;
		if (refFile === declSourceFile) {
			if (ref.getStart() === declStart) continue; // 宣言自身
			sameFileReferenceCount++;
			continue;
		}
		externallyUnused = false;
	}
	return { externallyUnused, sameFileReferenceCount };
}

const SYNTHETIC_ALIAS_PREFIX = "__find_unused_exports_ns_ref__";

/**
 * 候補名のテキスト出現数を、宣言ファイル以外のソースから単語境界一致でカウントする。
 *
 * 用途: 動的参照 / JSX 名 / 文字列リテラル / 設定ファイル内記述等、findReferences では拾えない
 * 「名前ベースの参照可能性」をエージェントに知らせる補助情報。0 なら確度の高いデッド。
 *
 * - `(?! as <SYNTHETIC_ALIAS_PREFIX>)` の負の look-ahead で、namespace 展開時の合成 import
 *   `import { name as __find_unused_exports_ns_ref__name }` の `name` 部分を除外
 * - node_modules / 宣言ファイル / 宣言ファイル自身はスキャン対象外
 */
// TS の IdentifierPart に相当する文字クラス。`\b` は ASCII のみなので、Unicode 識別子
// (例: `集計`, `λ`) を正しく境界判定するため、lookbehind/lookahead で代替する。
const TS_IDENT_PART_CLASS = "[\\p{L}\\p{N}_$]";

function countTextOccurrences(
	name: string,
	declSourceFile: SourceFile,
	project: Project,
): number {
	if (name.length === 0) return 0;
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// 合成 import の `name as __find_unused_exports_ns_ref__N_name` をカウントから除外。
	// `\s+` で whitespace 揺らぎ (ts-morph の改行挿入等) を吸収。alias 末尾の `\d+_` は
	// expandNamespaceImports のカウンタ付き alias 形式に対応。
	const re = new RegExp(
		`(?<!${TS_IDENT_PART_CLASS})${escaped}(?!${TS_IDENT_PART_CLASS})(?!\\s+as\\s+${SYNTHETIC_ALIAS_PREFIX}\\d+_)`,
		"gu",
	);
	let count = 0;
	for (const sf of project.getSourceFiles()) {
		if (sf === declSourceFile) continue;
		if (sf.isInNodeModules()) continue;
		if (sf.isDeclarationFile()) continue;
		const matches = sf.getFullText().match(re);
		if (matches) count += matches.length;
	}
	return count;
}

/**
 * `import * as ns from "./mod"` 消費ファイルに、対象モジュールの全 named export を
 * エイリアス付きで named import として注入する。
 *
 * これにより、`{ ...ns }` スプレッドや `ns.X` の動的アクセスでしか使われていない export も
 * `findReferencesAsNodes()` が拾えるようになる (= 偽陽性削減)。
 *
 * 注入された import は同ファイル内で参照されないが、TS は ES モジュールのインポート副作用を
 * 維持する都合上 (unused import 警告は出るが) エラーにはならない。
 * ファイルは保存しないため永続化はされない。
 */
function expandNamespaceImports(project: Project): () => void {
	const addedImports: ImportDeclaration[] = [];
	// alias 衝突回避: 同じ名前を異なるモジュールから合成しても重複バインディングを生まないよう、
	// プロセス内でモノトニックに増えるカウンタを使う。textOccurrences の lookahead はカウンタ込みのプレフィックスを許容する。
	let aliasCounter = 0;

	for (const sourceFile of project.getSourceFiles()) {
		if (sourceFile.isInNodeModules()) continue;
		if (sourceFile.isDeclarationFile()) continue;

		const targets: { moduleSpecifier: string; names: string[] }[] = [];
		// 同一ファイル内で同じモジュールが複数回 `import * as` されるケース (`import * as a from "./m"; import * as b from "./m";`)
		// で synthetic import を重複生成しないよう、(moduleSpecifier 解決済みパス) でデデュープ
		const seenModuleSources = new Set<SourceFile>();

		for (const importDecl of sourceFile.getImportDeclarations()) {
			const ns = importDecl.getNamespaceImport();
			if (!ns) continue;

			let targetSource: SourceFile | undefined;
			try {
				targetSource = importDecl.getModuleSpecifierSourceFile();
			} catch {
				continue;
			}
			if (!targetSource) continue;
			if (targetSource === sourceFile) continue;
			if (seenModuleSources.has(targetSource)) continue;
			seenModuleSources.add(targetSource);

			const names: string[] = [];
			for (const [name, decls] of targetSource.getExportedDeclarations()) {
				// `default` は namespace 経由で参照されることが少なく、`import { default as ... }` の
				// 合成は ts-morph の Structure 経由ではエッジケースになりやすいのでスキップ。
				if (name === "default") continue;
				// 型のみの export を value import として注入すると、合成 ImportSpecifier が "使用中" 扱いされて
				// 型 export の偽陰性 (本当に未使用なのに報告されない) を生むのでスキップ。
				// ※ 型は runtime 値を持たず `{ ...ns }` スプレッドの対象にならないため、合成不要。
				if (decls.length === 0) continue;
				const allTypeOnly = decls.every(
					(d) =>
						Node.isInterfaceDeclaration(d) || Node.isTypeAliasDeclaration(d),
				);
				if (allTypeOnly) continue;
				names.push(name);
			}
			if (names.length === 0) continue;

			targets.push({
				moduleSpecifier: importDecl.getModuleSpecifierValue(),
				names,
			});
		}

		if (targets.length === 0) continue;

		// 既存コードへの影響を最小化するため、末尾に新規 ImportDeclaration として追加する
		for (const target of targets) {
			const decl = sourceFile.addImportDeclaration({
				moduleSpecifier: target.moduleSpecifier,
				namedImports: target.names.map((name) => ({
					name,
					alias: `${SYNTHETIC_ALIAS_PREFIX}${aliasCounter++}_${name}`,
				})),
			});
			addedImports.push(decl);
		}
	}

	return () => {
		for (const decl of addedImports) {
			try {
				if (!decl.wasForgotten()) decl.remove();
			} catch (error) {
				logger.warn(
					{ err: error },
					"synthetic ImportDeclaration の撤去に失敗 (Project は dirty 状態のまま)",
				);
			}
		}
	};
}
