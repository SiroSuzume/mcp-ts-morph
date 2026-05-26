export type ChangeSignatureOperation =
	| {
			kind: "add";
			/** 挿入位置 (0-based)。省略時は末尾。 */
			index?: number;
			/** 追加するパラメータ名 */
			name: string;
			/** パラメータの型注釈テキスト (例: "string", "{ id: number }")。省略時は型注釈なし。 */
			typeText?: string;
			/** パラメータをオプショナル (`?`) にするか */
			optional?: boolean;
			/** デフォルト値テキスト (例: "0", '"hello"") */
			defaultValue?: string;
			/**
			 * 既存の呼び出し側に挿入する引数式テキスト。
			 * - 省略時はデフォルト値があればそれを使用、なければ呼び出し側に何も挿入しない (末尾追加かつオプショナル/デフォルトあり前提)。
			 * - 既存呼び出しに新しい引数が必要な場合は明示的に指定すること。
			 */
			argumentForCallers?: string;
	  }
	| {
			kind: "remove";
			/** 削除するパラメータの index (0-based) */
			index: number;
	  }
	| {
			kind: "reorder";
			/** 新しい順序。例: [2, 0, 1] は newParams[0] = oldParams[2] を意味する。長さは現在のパラメータ数と一致する必要がある。 */
			newOrder: number[];
	  };

export interface ChangeSignatureParams {
	tsconfigPath: string;
	targetFilePath: string;
	position: { line: number; column: number };
	functionName: string;
	changes: ChangeSignatureOperation[];
	dryRun?: boolean;
}

export interface ChangeSignatureResult {
	changedFiles: string[];
}
